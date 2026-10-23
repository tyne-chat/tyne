#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Fork: checks that the signed macOS release opens for someone who downloads it
# (tyne-chat/tyne#202). The release workflow's test-macos job runs it on the DMG that sign-macos
# made, on one of GitHub's Apple silicon runners:
#
#   1. marks the DMG as downloaded from the internet, as a browser does, and asks Gatekeeper about
#      it, then mounts it and copies the app to /Applications the way a user would;
#   2. asks Gatekeeper about the copied app, which must be accepted as notarized Developer ID, and
#      runs Apple's own distribution check (syspolicy_check) on it;
#   3. starts the app and waits until it has started a renderer and is still running some seconds
#      later, without a crash report. A signing mistake (a missing entitlement, a library macOS
#      refuses to load under the hardened runtime) makes it exit or crash here.
#
# The first launch of a downloaded app waits for the user to confirm a dialog, which nobody can
# do on a runner, so step 3 starts the app after removing the download mark; Gatekeeper's verdict
# on the marked app is step 2.
#
#   scripts/fork-test-macos-launch.sh <Tyne-<version>-mac-<arch>.dmg>

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <dmg>" >&2
	exit 2
fi
dmg="$1"
test -f "$dmg" || { echo "Missing $dmg" >&2; exit 1; }

RENDERER_TIMEOUT_S=120
STAY_UP_S=20
installed="/Applications/Tyne.app"
work="$(mktemp -d)"
mountpoint="$work/mnt"
log="$work/tyne.log"
pid=""

cleanup() {
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
		kill "$pid" 2>/dev/null || true
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			kill -0 "$pid" 2>/dev/null || break
			sleep 1
		done
		kill -9 "$pid" 2>/dev/null || true
	fi
	hdiutil detach "$mountpoint" -quiet 2>/dev/null || true
	rm -rf "$work"
}
trap cleanup EXIT

fail() {
	echo "::error::$1"
	if [ -s "$log" ]; then
		echo "::group::App output"
		tail -n 200 "$log"
		echo "::endgroup::"
	fi
	for report in "$HOME"/Library/Logs/DiagnosticReports/Tyne*; do
		[ -e "$report" ] || continue
		echo "::group::Crash report $(basename "$report")"
		head -n 120 "$report"
		echo "::endgroup::"
	done
	exit 1
}

count_crash_reports() {
	local count=0 report
	for report in "$HOME"/Library/Logs/DiagnosticReports/Tyne*; do
		[ -e "$report" ] && count=$((count + 1))
	done
	echo "$count"
}

assess() {
	local output
	output="$(spctl --assess --verbose=4 "$@" 2>&1)" || { echo "$output"; return 1; }
	echo "$output"
	[[ "$output" == *"source=Notarized Developer ID"* ]]
}

echo "::group::The downloaded disk image"
xattr -w com.apple.quarantine "0083;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)" "$dmg"
assess --type open --context context:primary-signature "$dmg" || fail "Gatekeeper does not accept the disk image as notarized Developer ID."
xcrun stapler validate "$dmg"
mkdir "$mountpoint"
hdiutil attach "$dmg" -nobrowse -noautoopen -readonly -mountpoint "$mountpoint" -quiet
test -d "$mountpoint/Tyne.app" || fail "The disk image has no Tyne.app."
[ "$(readlink "$mountpoint/Applications")" = "/Applications" ] || fail "The disk image has no link to /Applications."
echo "::endgroup::"

echo "::group::The installed app"
rm -rf "$installed"
ditto "$mountpoint/Tyne.app" "$installed"
hdiutil detach "$mountpoint" -quiet
# Finder hands the disk image's download mark on to what is copied out of it; ditto does not.
xattr -w com.apple.quarantine "$(xattr -p com.apple.quarantine "$dmg")" "$installed"
assess --type execute "$installed" || fail "Gatekeeper does not accept the installed app as notarized Developer ID."
codesign --verify --deep --strict --verbose=2 "$installed" || fail "The installed app's signature does not verify."
xcrun stapler validate "$installed" || fail "The installed app carries no notarization ticket."
if command -v syspolicy_check >/dev/null; then
	syspolicy_check distribution "$installed" || fail "syspolicy_check reports a problem with the installed app."
else
	echo "syspolicy_check is not on this runner; skipped."
fi
echo "::endgroup::"

echo "::group::Opening the app"
xattr -d com.apple.quarantine "$installed"
crash_reports_before="$(count_crash_reports)"
"$installed/Contents/MacOS/Tyne" > "$log" 2>&1 &
pid=$!
started=$SECONDS
until pgrep -f "^$installed/Contents/Frameworks/Tyne Helper \(Renderer\)" >/dev/null; do
	kill -0 "$pid" 2>/dev/null || fail "The app exited before it started a renderer."
	(( SECONDS - started < RENDERER_TIMEOUT_S )) || fail "The app started no renderer within ${RENDERER_TIMEOUT_S} s."
	sleep 2
done
echo "A renderer started after $((SECONDS - started)) s."
stay_up_until=$((SECONDS + STAY_UP_S))
while (( SECONDS < stay_up_until )); do
	kill -0 "$pid" 2>/dev/null || fail "The app exited within ${STAY_UP_S} s of starting a renderer."
	sleep 2
done
crash_reports_after="$(count_crash_reports)"
[ "$crash_reports_after" = "$crash_reports_before" ] || fail "A Tyne process left a crash report."
pgrep -fl "^$installed/" || true
echo "::endgroup::"
echo "The signed app opens: Gatekeeper accepts the downloaded disk image and app, and the app runs."
