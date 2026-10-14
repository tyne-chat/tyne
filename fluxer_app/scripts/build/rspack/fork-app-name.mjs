// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the page the fork's web and desktop apps load names Tyne, not Fluxer. The name is
// written into the built index.html instead of the source, because upstream's app-proxy tests
// read the source (fluxer_app_proxy/src/routes/spa_index.rs) and expect upstream's name there.
// An instance's own branding still replaces the title when the app proxy serves the page.

import {Compilation, sources} from '@rspack/core';

export const FORK_APP_NAME = 'Tyne';

const UPSTREAM_NAME = 'Fluxer';

const REPLACEMENTS = [
	[`<title>${UPSTREAM_NAME}</title>`, `<title>${FORK_APP_NAME}</title>`],
	[
		`<meta name="apple-mobile-web-app-title" content="${UPSTREAM_NAME}">`,
		`<meta name="apple-mobile-web-app-title" content="${FORK_APP_NAME}">`,
	],
	[`<meta name="description" content="${UPSTREAM_NAME} is `, `<meta name="description" content="${FORK_APP_NAME} is `],
];

export function withForkAppName(html) {
	let result = html;
	for (const [upstream, fork] of REPLACEMENTS) {
		if (!result.includes(upstream)) {
			throw new Error(`index.html no longer contains ${upstream}; update fork-app-name.mjs`);
		}
		result = result.replace(upstream, fork);
	}
	return result;
}

export function forkAppNamePlugin() {
	return {
		apply(compiler) {
			compiler.hooks.thisCompilation.tap('ForkAppNamePlugin', (compilation) => {
				compilation.hooks.processAssets.tap(
					{name: 'ForkAppNamePlugin', stage: Compilation.PROCESS_ASSETS_STAGE_REPORT},
					() => {
						const asset = compilation.getAsset('index.html');
						if (asset == null) {
							return;
						}
						const html = String(asset.source.source());
						compilation.updateAsset('index.html', new sources.RawSource(withForkAppName(html)));
					},
				);
			});
		},
	};
}
