#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Fork: writes SHA256SUMS.txt for every file of a release and signs it with the release signing key
# (SIGNING_KEY, from the desktop-release environment), then checks the signature against the public
# keys in the repository, as installed apps will (src/main/ForkReleaseSignature.ts). The key is
# never written to disk. The release workflow runs it before publishing, and on test runs without
# publishing, so the same steps are exercised before a release depends on them.
#
#   scripts/fork-sign-release-checksums.sh <release files dir>

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <release files dir>" >&2
	exit 2
fi
scripts="$(cd "$(dirname "$0")" && pwd)"
cd "$1"

if [ -z "${SIGNING_KEY:-}" ]; then
	echo "TYNE_RELEASE_SIGNING_KEY is not set in the desktop-release environment." >&2
	exit 1
fi
if [ -e SHA256SUMS.txt ] || [ -e SHA256SUMS.txt.sig ]; then
	echo "$1 already has SHA256SUMS.txt or its signature." >&2
	exit 1
fi

sha256sum -- * > SHA256SUMS.txt
openssl pkeyutl -sign -rawin -inkey <(printf '%s\n' "$SIGNING_KEY") -in SHA256SUMS.txt -out SHA256SUMS.txt.sig
"$scripts/fork-verify-release-signature.sh" "$scripts/fork-release-signing-keys.pem" SHA256SUMS.txt SHA256SUMS.txt.sig
echo "Signed the checksums of $(wc -l < SHA256SUMS.txt) files."
