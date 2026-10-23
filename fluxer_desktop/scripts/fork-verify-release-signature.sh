#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Fork: checks the signature of a release's SHA256SUMS.txt against each public key in a PEM file,
# as installed apps do (src/main/ForkReleaseSignature.ts). The release workflow runs it before
# publishing and again on the published files.
#
#   scripts/fork-verify-release-signature.sh <keys.pem> <file> <signature>

set -euo pipefail

if [ "$#" -ne 3 ]; then
	echo "usage: $0 <keys.pem> <file> <signature>" >&2
	exit 2
fi
keys="$1"
file="$2"
signature="$3"

split="$(mktemp -d)"
trap 'rm -rf "$split"' EXIT
awk -v dir="$split" '/-----BEGIN PUBLIC KEY-----/ { n++ } n { print > (dir "/key" n ".pem") }' "$keys"

for key in "$split"/key*.pem; do
	[ -e "$key" ] || break
	if openssl pkeyutl -verify -pubin -inkey "$key" -rawin -in "$file" -sigfile "$signature" >/dev/null 2>&1; then
		echo "$file: signature verified with $(basename "$key" .pem) of $keys"
		exit 0
	fi
done
echo "$file: no key in $keys verifies $signature" >&2
exit 1
