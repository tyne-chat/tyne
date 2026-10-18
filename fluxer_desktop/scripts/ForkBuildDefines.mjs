// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the GitHub repository whose releases the in-app updater reads (src/main/ForkReleaseFeed.ts).
// Compiled into every build so that none can fall back to upstream's package server.
const forkReleaseRepository = process.env.FLUXER_FORK_RELEASES || 'tyne-chat/tyne';

// Fork: the fork's entries in build.mjs's publicBuildDefines(), which spreads them in at the end.
export function forkPublicBuildDefines() {
	return {
		'process.env.FLUXER_FORK_RELEASES': JSON.stringify(forkReleaseRepository),
		// Fork: install as "Tyne" (src/common/DesktopIdentity.ts). FLUXER_FORK_IDENTITY=0 builds with upstream's identity.
		'process.env.FLUXER_FORK_IDENTITY': JSON.stringify(process.env.FLUXER_FORK_IDENTITY === '0' ? '' : '1'),
		// Fork: a Linux build packaged with stock Electron (electron-builder.config.cjs).
		'process.env.FLUXER_FORK_STOCK_LINUX_ELECTRON': JSON.stringify(
			process.env.FLUXER_FORK_STOCK_LINUX_ELECTRON === '1' ? '1' : '',
		),
	};
}
