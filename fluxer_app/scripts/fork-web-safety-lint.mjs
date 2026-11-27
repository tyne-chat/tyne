// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: backwards-compatible wrapper delegating `web-safety` checks to the unified compiler pipeline
// (`fork-lint.mjs` / `fork-lint/engine.mjs`, tyne-chat/tyne#947, tyne-chat/tyne#953).

import {pathToFileURL} from 'node:url';
import {discoverMobxStateModules} from './fork-lint/discovery.mjs';
import {lintFileWithPipeline, runForkLintCli} from './fork-lint/engine.mjs';
import {ALL_WEB_SAFETY_RULES} from './fork-lint/passes/web-safety.mjs';

export {ALL_WEB_SAFETY_RULES, discoverMobxStateModules};

/**
 * Checks a single file's source on the given lines ('all' or Set<number>).
 * @param {string} file
 * @param {string} source
 * @param {'all' | Set<number>} [lines]
 * @param {{rules?: Set<string>; mobxStateModules?: Set<string>; reviewed?: import('./fork-lint-reviewed.mjs').ReviewedLintCatalog | null | undefined}} [options]
 * @returns {Array<string>}
 */
export function lintWebSafetySource(file, source, lines = 'all', options = {}) {
	return lintFileWithPipeline(file, source, lines, {
		linters: ['web-safety'],
		rules: options.rules,
		mobxStateModules: options.mobxStateModules,
		reviewed: options.reviewed,
		defaultPackage: 'fluxer_app',
	}).problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runForkLintCli(process.argv.slice(2), {
		defaultLinters: ['web-safety'],
		failureFooter: (n) =>
			`\n${n} web safety violation(s). Fix the underlying issue, mark fork lines with \`// web-safety-ignore: <reason>\`, or record reviewed upstream entries in \`fluxer_app/scripts/fork-lint-reviewed.json\`.`,
	});
}
