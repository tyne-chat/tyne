// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: unified 4-stage compiler-pipeline custom linter for the monorepo (tyne-chat/tyne#953).
// Runs `string`, `px`, `render-fetch`, `web-safety`, and `backend-desktop` passes over shared
// single-parse SourceUnit / CssStylesheetIR / MaskedBracedIR / TsModuleIR representations.
//
//   node scripts/fork-lint.mjs [--upstream <git ref>] [--all] [--linter <l1,l2>] [--rule <r1,r2>]
//                              [--include-reviewed] [--check-reviewed] [--audit-json]
//                              [--reviewed <path>] [<file>...]

import {pathToFileURL} from 'node:url';
import {ALL_MONOREPO_LINTERS} from './fork-lint/discovery.mjs';
import {lintFileWithPipeline, runForkLintCli} from './fork-lint/engine.mjs';

export {ALL_MONOREPO_LINTERS, lintFileWithPipeline, runForkLintCli};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runForkLintCli(process.argv.slice(2), {defaultLinters: ALL_MONOREPO_LINTERS});
}
