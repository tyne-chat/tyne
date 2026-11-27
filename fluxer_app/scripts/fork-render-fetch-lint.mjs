// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: backwards-compatible wrapper delegating `render-fetch` checks to the unified compiler pipeline
// (`fork-lint.mjs` / `fork-lint/engine.mjs`, tyne-chat/tyne#114, tyne-chat/tyne#945, tyne-chat/tyne#953).

import {pathToFileURL} from 'node:url';
import {lintFileWithPipeline, runForkLintCli} from './fork-lint/engine.mjs';

/**
 * Checks a single file's source on the given lines ('all' or Set<number>).
 * @param {string} file
 * @param {string} source
 * @param {'all' | Set<number>} [lines]
 * @param {{reviewed?: import('./fork-lint-reviewed.mjs').ReviewedLintCatalog | null | undefined}} [options]
 * @returns {Array<string>}
 */
export function lintRenderFetchSource(file, source, lines = 'all', options = {}) {
	return lintFileWithPipeline(file, source, lines, {
		linters: ['render-fetch'],
		reviewed: options.reviewed,
		defaultPackage: 'fluxer_app',
	}).problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runForkLintCli(process.argv.slice(2), {
		defaultLinters: ['render-fetch'],
		failureFooter: (n) =>
			`\n${n} React render/effect network-call violation(s). Move fetches into a guarded ` +
			'useEffect(..., [deps]) or event handler, mark fork lines with `// render-fetch-ignore: <reason>`, or record reviewed upstream entries in `fluxer_app/scripts/fork-lint-reviewed.json`.',
	});
}
