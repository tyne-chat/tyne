#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Fork: the macOS launch test on the Mac mini cherry (tyne-chat/tyne#928), in place of GitHub's
# macos-15 when TYNE_MACOS_LAUNCH_RUNNER names cherry-launch. The test is about a Mac that has never
# seen Tyne, which cherry is not, so it runs in a throwaway VM: a fresh clone of a clean macOS for
# each run. macOS VMs start only in an account with a login session, which a runner account never
# has, so this job only hands the files over: it writes a request to
# /Users/Shared/tyne-launch-requests/<id>/ (the disk image and scripts/fork-test-macos-launch.sh,
# then `ready`), and cherry's VM agent (tyne-tools cherry/launch-test-agent.sh) runs the test in the
# VM and writes /Users/Shared/tyne-launch-results/<id>/log and .../exit. This prints the log as it
# grows and exits with the test's status. Nothing here runs the test itself.
#
#   scripts/fork-test-macos-launch-cherry.sh <Tyne-<version>-mac-arm64.dmg>

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <dmg>" >&2
	exit 2
fi
dmg="$1"
test -f "$dmg" || { echo "Missing $dmg" >&2; exit 1; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

requests=/Users/Shared/tyne-launch-requests
results=/Users/Shared/tyne-launch-results
id="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
WAIT_S=1500
STALE_S=120

agent_alive() {
	local beat
	beat=$(stat -f %m "$results/agent-alive" 2>/dev/null) || return 1
	(( $(date +%s) - beat < STALE_S ))
}

agent_alive || {
	echo "::error::cherry's launch test VM agent is not running (no heartbeat in $results/agent-alive). It runs in chiaracoetzee's login session; see tyne-tools runbooks/mac-runner.md. To use GitHub's Mac instead, delete the repository variable TYNE_MACOS_LAUNCH_RUNNER."
	exit 1
}

request="$requests/$id"
cleanup() { rm -rf "$request"; }
trap cleanup EXIT
mkdir -m 755 "$request"
cp "$dmg" "$request/"
cp "$here/fork-test-macos-launch.sh" "$request/"
chmod 644 "$request"/*
touch "$request/ready"
echo "Handed the test to cherry's VM agent as request $id."

shown=0
started=$SECONDS
until [ -f "$results/$id/exit" ]; do
	if [ -f "$results/$id/log" ]; then
		lines=$(wc -l < "$results/$id/log")
		if (( lines > shown )); then
			sed -n "$((shown + 1)),${lines}p" "$results/$id/log"
			shown=$lines
		fi
	fi
	(( SECONDS - started < WAIT_S )) || { echo "::error::No result from cherry's VM agent within ${WAIT_S} s."; exit 1; }
	agent_alive || { echo "::error::cherry's VM agent stopped (its heartbeat is older than ${STALE_S} s)."; exit 1; }
	sleep 3
done
[ -f "$results/$id/log" ] && sed -n "$((shown + 1)),\$p" "$results/$id/log"
status=$(cat "$results/$id/exit")
[[ "$status" =~ ^[0-9]+$ ]] || status=1
exit "$status"
