// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: backwards-compatible wrapper delegating `backend-desktop` checks to the unified compiler pipeline
// (`fork-lint.mjs` / `fork-lint/engine.mjs`, tyne-chat/tyne#947, tyne-chat/tyne#953).

import {pathToFileURL} from 'node:url';
import {loadForkGuardedDesktopIpcChannels} from './fork-lint/discovery.mjs';
import {lintFileWithPipeline, runForkLintCli} from './fork-lint/engine.mjs';
import {ALL_BACKEND_DESKTOP_RULES} from './fork-lint/passes/backend-desktop.mjs';

export {ALL_BACKEND_DESKTOP_RULES, loadForkGuardedDesktopIpcChannels};

/**
 * Checks a single monorepo file on the given lines ('all' or Set<number>).
 * @param {string} relFile Path relative to repository root (e.g. `fluxer_api/src/...`)
 * @param {string} source
 * @param {'all' | Set<number>} [lines]
 * @param {{rules?: Set<string>; reviewed?: import('./fork-lint-reviewed.mjs').ReviewedLintCatalog | null | undefined; forkGuardedIpcChannels?: Set<string>}} [options]
 * @returns {Array<string>}
 */
export function lintBackendDesktopFile(relFile, source, lines = 'all', options = {}) {
	return lintFileWithPipeline(relFile, source, lines, {
		linters: ['backend-desktop'],
		rules: options.rules,
		reviewed: options.reviewed,
		forkGuardedIpcChannels: options.forkGuardedIpcChannels,
		defaultPackage: '',
	}).problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runForkLintCli(process.argv.slice(2), {
		defaultLinters: ['backend-desktop'],
		failureFooter: (n) =>
			`\n${n} backend/desktop safety violation(s). Fix the underlying issue, mark fork lines with \`// safety-lint-ignore: <reason>\`, or record reviewed upstream entries in \`fluxer_app/scripts/fork-lint-reviewed.json\`.`,
	});
}
