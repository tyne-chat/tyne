#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Fork: signs the macOS build with the Tyne team's Developer ID, notarizes it and staples the
# tickets (tyne-chat/tyne#202). The release workflow's sign-macos job runs it on the files the build
# job made (signed ad hoc by electron-builder) and publishes what it leaves in their place:
#
#   Tyne-<version>-mac-<arch>.zip   the app, signed, notarized and stapled
#   Tyne-<version>-mac-<arch>.dmg   a new disk image of that app, signed, notarized and stapled
#   tyne-latest-darwin-<arch>.json  the same document with the two new checksums
#
# It uses only Apple's tools (security, codesign, notarytool, stapler, spctl, hdiutil, ditto)
# and the runner's openssl, python3 and file, so the signing identity never reaches code installed
# from a package registry. The signing order is electron-builder's (@electron/osx-sign): every
# Mach-O file and nested bundle first, deepest first, with the inherited entitlements, then the app
# with its own.
#
#   scripts/fork-sign-macos.sh <assets dir> <entitlements.plist> <inherited entitlements.plist>
#
# Environment: VERSION, ARCH, TEAM_ID, DEVELOPER_ID_P12 (base64), DEVELOPER_ID_P12_PASSWORD,
# NOTARY_KEY_P8, NOTARY_KEY_ID, NOTARY_ISSUER_ID.

set -euo pipefail

# A team's first notarizations can take hours at Apple; later ones usually take minutes.
NOTARY_TIMEOUT=2h

if [ "$#" -ne 3 ]; then
	echo "usage: $0 <assets dir> <entitlements.plist> <inherited entitlements.plist>" >&2
	exit 2
fi
assets="$(cd "$1" && pwd)"
entitlements="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
inherited="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
for name in VERSION ARCH TEAM_ID DEVELOPER_ID_P12 DEVELOPER_ID_P12_PASSWORD NOTARY_KEY_P8 NOTARY_KEY_ID NOTARY_ISSUER_ID; do
	if [ -z "${!name:-}" ]; then
		echo "$name is not set (the Developer ID and notarization secrets live in the desktop-release environment)." >&2
		exit 1
	fi
done

zip="$assets/Tyne-$VERSION-mac-$ARCH.zip"
dmg="$assets/Tyne-$VERSION-mac-$ARCH.dmg"
latest="$assets/tyne-latest-darwin-$ARCH.json"
for file in "$zip" "$dmg" "$latest" "$entitlements" "$inherited"; do
	test -f "$file" || { echo "Missing $file" >&2; exit 1; }
done

work="$(mktemp -d)"
keychain="$work/signing.keychain-db"
cleanup() {
	security delete-keychain "$keychain" 2>/dev/null || true
	rm -rf "$work"
}
trap cleanup EXIT

echo "::group::Signing identity"
keychain_password="$(openssl rand -base64 24)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
printf '%s' "$DEVELOPER_ID_P12" | base64 --decode > "$work/developer-id.p12"
security import "$work/developer-id.p12" -k "$keychain" -P "$DEVELOPER_ID_P12_PASSWORD" -T /usr/bin/codesign
rm -f "$work/developer-id.p12"
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
# codesign looks up the intermediate certificate in the search list, so the keychain joins it.
previous_keychains=()
while IFS= read -r line; do
	line="${line#"${line%%[![:space:]]*}"}"
	previous_keychains+=("${line//\"/}")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$keychain" "${previous_keychains[@]}"
identities="$(security find-identity -v -p codesigning "$keychain")"
identity="$(awk -v team="($TEAM_ID)" '/"Developer ID Application: / && index($0, team) { print $2; exit }' <<<"$identities")"
if [ -z "$identity" ]; then
	echo "No Developer ID Application identity of team $TEAM_ID in the certificate:" >&2
	echo "$identities" >&2
	exit 1
fi
grep -F "$identity" <<<"$identities"
printf '%s\n' "$NOTARY_KEY_P8" > "$work/notary.p8"
chmod 600 "$work/notary.p8"
echo "::endgroup::"

sign() {
	codesign --force --timestamp --options runtime --keychain "$keychain" --sign "$identity" "$@"
}

# notarytool prints its result as one JSON line: on standard output when Apple has answered, on
# standard error when it stopped waiting. Prints "<id> <status>", "-" for either one missing.
read_submission() {
	python3 - "$work/notary.out" "$work/notary.err" <<'PYTHON'
import json, re, sys

found = {}
for path in sys.argv[1:]:
    try:
        lines = open(path).read().splitlines()
    except OSError:
        continue
    for line in lines:
        try:
            document = json.loads(line)
        except ValueError:
            continue
        if isinstance(document, dict):
            for key in ("id", "status"):
                if isinstance(document.get(key), str):
                    found.setdefault(key, document[key])
submission = found.get("id", "")
if not re.fullmatch(r"[0-9a-fA-F-]{36}", submission):
    submission = ""
print(submission or "-", found.get("status", "").replace(" ", "_") or "-")
PYTHON
}

notarize() {
	local file="$1" id status
	echo "Notarizing $(basename "$file")"
	xcrun notarytool submit "$file" --key "$work/notary.p8" --key-id "$NOTARY_KEY_ID" \
		--issuer "$NOTARY_ISSUER_ID" --wait --timeout "$NOTARY_TIMEOUT" --output-format json \
		> "$work/notary.out" 2> "$work/notary.err" || true
	read -r id status < <(read_submission)
	[ "$id" != "-" ] || id=""
	[ "$status" != "-" ] || status=""
	echo "Notarization ${id:-(no id)}: ${status:-(no status)}"
	if [ "$status" = "Accepted" ]; then
		return
	fi
	cat "$work/notary.out" "$work/notary.err" >&2 || true
	if [ -z "$id" ]; then
		echo "Apple did not take the submission." >&2
	elif [ -z "$status" ] || [ "$status" = "In_Progress" ]; then
		echo "Apple is still processing submission $id after $NOTARY_TIMEOUT; it goes on after this job." >&2
	else
		xcrun notarytool log "$id" --key "$work/notary.p8" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID" >&2 || true
	fi
	exit 1
}

echo "::group::Sign the app"
ditto -x -k "$zip" "$work/unpacked"
app="$work/unpacked/Tyne.app"
test -d "$app" || { echo "No Tyne.app in $zip" >&2; exit 1; }
# Deepest first, so each bundle is sealed over code that is already signed. No name in an
# Electron app has a newline or a tab.
find "$app/Contents" \( -type f -o -type d \( -name '*.app' -o -name '*.framework' \) \) |
	awk -F/ '{ print NF "\t" $0 }' | sort -rn | cut -f2- > "$work/nested.txt"
signed=0
while IFS= read -r path; do
	# Not "file | grep -q": with pipefail, grep leaving early can fail the pipe and skip a file.
	if [ -d "$path" ] || [[ "$(file -b "$path")" == Mach-O* ]]; then
		sign --entitlements "$inherited" "$path"
		signed=$((signed + 1))
	fi
done < "$work/nested.txt"
sign --entitlements "$entitlements" "$app"
echo "Signed $signed nested items and the app"
codesign --verify --deep --strict --verbose=2 "$app"
details="$(codesign --display --verbose=2 "$app" 2>&1)"
grep -E '^(Authority|TeamIdentifier|Runtime|Timestamp)' <<<"$details"
if ! grep -qx "TeamIdentifier=$TEAM_ID" <<<"$details"; then
	echo "The app is not signed by team $TEAM_ID." >&2
	exit 1
fi
echo "::endgroup::"

echo "::group::Notarize and staple the app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/notarize.zip"
notarize "$work/notarize.zip"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=4 "$app"
rm -f "$zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
echo "::endgroup::"

echo "::group::Disk image"
mkdir "$work/dmg"
ditto "$app" "$work/dmg/Tyne.app"
ln -s /Applications "$work/dmg/Applications"
rm -f "$dmg"
hdiutil create -volname "Tyne" -srcfolder "$work/dmg" -ov -format UDZO "$dmg"
codesign --force --timestamp --keychain "$keychain" --sign "$identity" "$dmg"
notarize "$dmg"
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"
echo "::endgroup::"

python3 - "$latest" "$dmg" "$zip" <<'EOF'
import hashlib, json, sys

latest, dmg, zip_file = sys.argv[1:]
with open(latest) as stream:
    document = json.load(stream)
for kind, path in (("dmg", dmg), ("zip", zip_file)):
    with open(path, "rb") as stream:
        document["files"][kind]["sha256"] = hashlib.sha256(stream.read()).hexdigest()
with open(latest, "w") as stream:
    stream.write(json.dumps(document, indent="\t") + "\n")
EOF
echo "Signed, notarized and stapled: $(basename "$zip"), $(basename "$dmg"); checksums updated in $(basename "$latest")"
