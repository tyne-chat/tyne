// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: backwards-compatible wrapper delegating `px-lint` checks to the unified compiler pipeline
// (`fork-lint.mjs` / `fork-lint/engine.mjs`, tyne-chat/tyne#637, tyne-chat/tyne#953).

import {pathToFileURL} from 'node:url';
import {lintFileWithPipeline, runForkLintCli} from './fork-lint/engine.mjs';

/**
 * The problems in one file's source, on the given lines ('all' for every line).
 * @param {string} file
 * @param {string} source
 * @param {'all' | Set<number>} [lines]
 * @param {{reviewed?: import('./fork-lint-reviewed.mjs').ReviewedLintCatalog | null | undefined}} [options]
 * @returns {Array<string>}
 */
export function lintSource(file, source, lines = 'all', options = {}) {
	return lintFileWithPipeline(file, source, lines, {
		linters: ['px'],
		reviewed: options.reviewed,
		defaultPackage: 'fluxer_app',
	}).problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runForkLintCli(process.argv.slice(2), {
		defaultLinters: ['px'],
		failureFooter: (n) =>
			`\n${n} size(s) in px. Write them as upstream does, in rem (16px = 1rem; remFromPx(n) in ` +
			'style objects; var(--radius-full) for a pill), which follows the desktop zoom. See CHECKS.md.',
	});
}
