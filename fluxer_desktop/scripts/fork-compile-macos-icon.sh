#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Fork: compiles Tyne's macOS app icon, build_resources/icons-tyne/AppIcon.icon (Icon Composer's
# format), into the files next to it in _compiled/, as upstream's icon folders carry them:
# Assets.car (the Liquid Glass icon macOS 26 shows, found through CFBundleIconName), AppIcon.icns
# (for older macOS) and the partial Info.plist. Upstream commits these and so does Tyne
# (tyne-chat/tyne#868).
#
# Needs macOS with Xcode 26 or later (actool), so it runs on a GitHub macOS runner:
# .github/workflows/fork-macos-icon.yaml. Commit what it writes whenever AppIcon.icon changes
# (tyne-tools scripts/install_icon_kit.py writes AppIcon.icon from the icon kit).

set -euo pipefail

desktop="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
icons="$desktop/build_resources/icons-tyne"
# The oldest macOS the app runs on (macOSMinimumSystemVersion in electron-builder.config.cjs).
minimum_macos="$(sed -n "s/^const macOSMinimumSystemVersion = '\([0-9.]*\)';$/\1/p" "$desktop/electron-builder.config.cjs")"
if [[ -z "$minimum_macos" ]]; then
	echo "Could not read macOSMinimumSystemVersion from electron-builder.config.cjs" >&2
	exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# actool prints its version as a plist whose top key has dots in it, which plutil's key paths cannot
# name; PlistBuddy separates keys with colons.
xcrun actool --version >"$work/version.plist"
version="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.actool.version:short-bundle-version' "$work/version.plist")"
if (( ${version%%.*} < 26 )); then
	echo "actool $version cannot compile Icon Composer icons; Xcode 26 or later is needed" >&2
	exit 1
fi
mkdir "$work/out"
xcrun actool "$icons/AppIcon.icon" \
	--compile "$work/out" \
	--output-format human-readable-text --notices --warnings --errors \
	--output-partial-info-plist "$work/out/icon.part.plist" \
	--app-icon AppIcon --include-all-app-icons \
	--enable-on-demand-resources NO \
	--development-region en \
	--target-device mac \
	--minimum-deployment-target "$minimum_macos" \
	--platform macosx

for name in Assets.car AppIcon.icns icon.part.plist; do
	if [[ ! -s "$work/out/$name" ]]; then
		echo "actool wrote no $name" >&2
		exit 1
	fi
done

out="$icons/_compiled"
rm -rf "$out"
mkdir -p "$out"
cp "$work/out/Assets.car" "$work/out/AppIcon.icns" "$out/"
# The plists carry the same license line as upstream's.
awk 'NR == 1 { print; print "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->"; next } { print }' \
	"$work/out/icon.part.plist" >"$out/icon.part.plist"
# Upstream's folders also keep an empty assetcatalog_generated_info.plist; nothing reads it.
cat >"$out/assetcatalog_generated_info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
echo "actool $version compiled $icons/AppIcon.icon into $out:"
ls -l "$out"
