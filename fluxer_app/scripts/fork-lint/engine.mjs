// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 4 orchestration engine for the monorepo custom compiler-pipeline linter.
// Parses each file at most once, constructs shared IRs, dispatches all active passes in a
// single AST traversal, and aggregates diagnostics & reviewed catalog stats.

import fs from 'node:fs';
import {
	evaluateReviewedForLinters,
	extractReviewedCliArgs,
	finishReviewedCheckOrNotes,
	loadReviewedCatalogOrExit,
	normalizeRepoRelPath,
	reviewedCatalogExists,
	VALID_RULE_NAMES,
} from '../fork-lint-reviewed.mjs';
import {
	ALL_MONOREPO_LINTERS,
	APP_DIR,
	APP_SCRIPT_SOURCE_RE,
	discoverMonorepoTargets,
	REPO_ROOT,
	TEST_FILE_RE,
	WorkspaceFacts,
} from './discovery.mjs';
import {parseAndBuildTsModuleIR, traverseAst} from './ir-ts.mjs';
import {
	ALL_BACKEND_DESKTOP_RULES,
	createBackendDesktopAstPass,
	runBackendGleamPass,
	runBackendRustPass,
} from './passes/backend-desktop.mjs';
import {ALL_PX_RULES, createPxAstPass, runPxCssPass} from './passes/px.mjs';
import {ALL_RENDER_FETCH_RULES, createRenderFetchAstPass} from './passes/render-fetch.mjs';
import {ALL_STRING_RULES, createStringAstPass} from './passes/string.mjs';
import {ALL_WEB_SAFETY_RULES, createWebSafetyAstPass, runWebSafetyCssPass} from './passes/web-safety.mjs';
import {createSourceUnit} from './source-unit.mjs';

const SCRIPT_FILE_RE = /\.(ts|tsx|js|jsx|mjs)$/;

const DEFAULT_RULES_BY_LINTER = {
	'web-safety': ALL_WEB_SAFETY_RULES,
	'backend-desktop': ALL_BACKEND_DESKTOP_RULES,
	'render-fetch': ALL_RENDER_FETCH_RULES,
	px: ALL_PX_RULES,
	string: ALL_STRING_RULES,
};

const RULE_OWNER = (() => {
	const map = new Map();
	for (const [linter, rules] of Object.entries(VALID_RULE_NAMES)) {
		for (const rule of rules) map.set(rule, linter);
	}
	return map;
})();

function sortLocationLines(problems) {
	return problems.sort((a, b) => {
		const ma = /^[^:]+:(\d+):(\d+):/.exec(a);
		const mb = /^[^:]+:(\d+):(\d+):/.exec(b);
		if (!ma || !mb) return a.localeCompare(b);
		return Number(ma[1]) - Number(mb[1]) || Number(ma[2]) - Number(mb[2]);
	});
}

function backendDesktopNeedsAst(repoFile) {
	const isTest = TEST_FILE_RE.test(repoFile);
	if (repoFile.startsWith('fluxer_api/src/')) return true;
	if (!isTest && repoFile.startsWith('packages/schema/src/domains/')) return true;
	if (!isTest && repoFile.startsWith('fluxer_desktop/src/')) return true;
	return false;
}

/**
 * Runs active compiler-pipeline lint passes against a single `SourceUnit` with at most one parse.
 * @param {import('./source-unit.mjs').SourceUnit} sourceUnit
 * @param {{
 *   activeLinters: Set<string>;
 *   rulesByLinter?: Map<string, Set<string>>;
 *   workspaceFacts?: WorkspaceFacts;
 *   reviewed?: import('../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   isAllUnfiltered?: boolean;
 *   explicitRules?: boolean;
 *   hasReviewedCss?: boolean;
 *   onParse?: (displayFile: string) => void;
 * }} options
 * @returns {{problemsByLinter: Map<string, Array<string>>; parseCount: number}}
 */
export function lintSourceUnitWithPipeline(sourceUnit, options) {
	const {
		activeLinters,
		rulesByLinter = null,
		workspaceFacts = new WorkspaceFacts(),
		reviewed = null,
		isAllUnfiltered = false,
		explicitRules = false,
		hasReviewedCss = false,
		onParse,
	} = options;

	const problemsByLinter = new Map();
	for (const linter of activeLinters) {
		problemsByLinter.set(linter, []);
	}
	if (sourceUnit.isGenerated) {
		return {problemsByLinter, parseCount: 0};
	}

	const report = (linter, line) => {
		problemsByLinter.get(linter)?.push(line);
	};
	const rulesFor = (linter) => rulesByLinter?.get(linter) ?? DEFAULT_RULES_BY_LINTER[linter];

	const file = sourceUnit.displayFile;
	const repoFile = sourceUnit.repoFile;

	// CSS sources (`.css` under `fluxer_app/src`).
	if (file.endsWith('.css')) {
		if (!file.startsWith('src/')) {
			return {problemsByLinter, parseCount: 0};
		}
		if (activeLinters.has('px')) {
			runPxCssPass({sourceUnit, rules: rulesFor('px'), reviewed, report});
		}
		if (activeLinters.has('web-safety') && !(isAllUnfiltered && !explicitRules && !hasReviewedCss)) {
			runWebSafetyCssPass({sourceUnit, rules: rulesFor('web-safety'), reviewed, report});
		}
		return {problemsByLinter, parseCount: 0};
	}

	// Rust / Gleam sources (`backend-desktop`).
	if (file.endsWith('.rs') || file.endsWith('.gleam')) {
		if (!activeLinters.has('backend-desktop')) return {problemsByLinter, parseCount: 0};
		const pushBd = (rule, line, col, message, meta = {}) => {
			if (
				reviewed?.matches({
					linter: 'backend-desktop',
					rule,
					file: repoFile,
					enclosing: meta.enclosing ?? '',
					symbol: meta.symbol,
					target: meta.target,
					sourceLine: sourceUnit.sourceLineAt(line).trim(),
				})
			) {
				return;
			}
			report('backend-desktop', `${repoFile}:${line}:${col}: [${rule}] ${message}`);
		};
		if (file.endsWith('.rs')) {
			runBackendRustPass({sourceUnit, rules: rulesFor('backend-desktop'), pushProblem: pushBd});
		} else {
			runBackendGleamPass({sourceUnit, rules: rulesFor('backend-desktop'), pushProblem: pushBd});
		}
		sortLocationLines(problemsByLinter.get('backend-desktop'));
		return {problemsByLinter, parseCount: 0};
	}

	if (!SCRIPT_FILE_RE.test(file) || file.endsWith('.d.ts')) {
		return {problemsByLinter, parseCount: 0};
	}

	// Determine which JS/TS passes apply to this file before parsing.
	const isAppScript = APP_SCRIPT_SOURCE_RE.test(file);
	const wantString = isAppScript && activeLinters.has('string');
	const wantPx = isAppScript && activeLinters.has('px');
	const wantRenderFetch = isAppScript && activeLinters.has('render-fetch');
	const wantWebSafety = isAppScript && activeLinters.has('web-safety');
	const wantBackendDesktop = activeLinters.has('backend-desktop') && backendDesktopNeedsAst(repoFile);

	if (!wantString && !wantPx && !wantRenderFetch && !wantWebSafety && !wantBackendDesktop) {
		return {problemsByLinter, parseCount: 0};
	}

	// Stage 3: Single `@babel/parser` parse + shared TsModuleIR.
	const tsIR = parseAndBuildTsModuleIR(sourceUnit, {
		mobxStateModules: wantWebSafety ? workspaceFacts.getMobxStateModules() : undefined,
		onParse,
	});
	if (tsIR.parseError) {
		let firstLinter = 'backend-desktop';
		if (wantWebSafety) firstLinter = 'web-safety';
		else if (wantRenderFetch) firstLinter = 'render-fetch';
		else if (wantString) firstLinter = 'string';
		else if (wantPx) firstLinter = 'px';
		const errPath = firstLinter === 'backend-desktop' ? repoFile : file;
		report(firstLinter, `${errPath}: could not parse: ${tsIR.parseError}`);
		return {problemsByLinter, parseCount: 1};
	}

	// Stage 4: Instantiate active AST passes and run one shared traversal.
	const passes = [];
	if (wantString) {
		passes.push(createStringAstPass({tsIR, rules: rulesFor('string'), reviewed, report}));
	}
	if (wantPx) {
		passes.push(createPxAstPass({tsIR, rules: rulesFor('px'), reviewed, report}));
	}
	if (wantRenderFetch) {
		passes.push(createRenderFetchAstPass({tsIR, rules: rulesFor('render-fetch'), reviewed, report}));
	}
	if (wantWebSafety) {
		passes.push(createWebSafetyAstPass({tsIR, rules: rulesFor('web-safety'), reviewed, report}));
	}
	if (wantBackendDesktop) {
		passes.push(
			createBackendDesktopAstPass({
				tsIR,
				rules: rulesFor('backend-desktop'),
				reviewed,
				forkGuardedIpcChannels: workspaceFacts.getForkGuardedIpcChannels(),
				rawProblems: problemsByLinter.get('backend-desktop'),
			}),
		);
	}

	const enterHooks = passes.map((p) => p.enter).filter(Boolean);
	const leaveHooks = passes.map((p) => p.leave).filter(Boolean);
	const afterHooks = passes.map((p) => p.afterAst).filter(Boolean);

	if (enterHooks.length > 0 || leaveHooks.length > 0) {
		traverseAst(
			tsIR.ast.program,
			(node) => {
				for (let i = 0; i < enterHooks.length; i++) enterHooks[i](node);
			},
			leaveHooks.length > 0
				? (node) => {
						for (let i = leaveHooks.length - 1; i >= 0; i--) leaveHooks[i](node);
					}
				: undefined,
		);
	}
	for (const fn of afterHooks) fn();

	if (wantBackendDesktop) {
		sortLocationLines(problemsByLinter.get('backend-desktop'));
	}

	return {problemsByLinter, parseCount: 1};
}

/**
 * Programmatic single-file helper backing `lint*Source` and `ForkLintPipeline.test.ts`.
 * @param {string} filePath
 * @param {string} source
 * @param {'all' | Set<number>} [lines]
 * @param {{
 *   linters?: Iterable<string>;
 *   rulesByLinter?: Map<string, Set<string>>;
 *   rules?: Set<string>;
 *   mobxStateModules?: Set<string>;
 *   forkGuardedIpcChannels?: Set<string>;
 *   reviewed?: import('../fork-lint-reviewed.mjs').ReviewedLintCatalog | null | undefined;
 *   defaultPackage?: string;
 *   onParse?: (displayFile: string) => void;
 * }} [options]
 * @returns {{problems: Array<string>; problemsByLinter: Map<string, Array<string>>; parseCount: number}}
 */
export function lintFileWithPipeline(filePath, source, lines = 'all', options = {}) {
	const linters = new Set(options.linters ?? ALL_MONOREPO_LINTERS);
	const normalizedDisplay = filePath.replace(/\\/g, '/');
	const defaultPkg =
		options.defaultPackage ?? (linters.size === 1 && linters.has('backend-desktop') ? '' : 'fluxer_app');
	const repoFile = normalizeRepoRelPath(normalizedDisplay, defaultPkg);
	const unit = createSourceUnit({
		repoFile,
		displayFile: normalizedDisplay,
		source,
		lines,
	});
	const rulesByLinter = options.rulesByLinter ? new Map(options.rulesByLinter) : new Map();
	if (options.rules && linters.size === 1) {
		const [only] = [...linters];
		rulesByLinter.set(only, options.rules);
	}
	const workspaceFacts = new WorkspaceFacts({
		mobxStateModules: options.mobxStateModules,
		forkGuardedIpcChannels: options.forkGuardedIpcChannels,
	});

	const {problemsByLinter, parseCount} = lintSourceUnitWithPipeline(unit, {
		activeLinters: linters,
		rulesByLinter,
		workspaceFacts,
		reviewed: options.reviewed ?? null,
		explicitRules: Boolean(options.rules || options.rulesByLinter),
		onParse: options.onParse,
	});

	const problems = [];
	for (const linter of linters) {
		problems.push(...(problemsByLinter.get(linter) ?? []));
	}
	return {problems, problemsByLinter, parseCount};
}

function optionValue(args, name, fallback) {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
}

function parseLintSelection(args, defaultLinters) {
	const rawLinters = optionValue(args, '--linter', '');
	const rawRules = optionValue(args, '--rule', '');

	let selectedLinters;
	if (rawLinters) {
		selectedLinters = new Set(
			rawLinters
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		);
		for (const l of selectedLinters) {
			if (!ALL_MONOREPO_LINTERS.includes(l)) {
				console.error(`Unknown linter: ${l}. Available: ${ALL_MONOREPO_LINTERS.join(', ')}`);
				process.exit(2);
			}
		}
	}

	const rulesByLinter = new Map();
	let inferredFromRules = null;
	if (rawRules) {
		const chosenRules = rawRules
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		inferredFromRules = new Set();
		for (const r of chosenRules) {
			const owner = RULE_OWNER.get(r);
			if (!owner || (selectedLinters && !selectedLinters.has(owner))) {
				const allowed = selectedLinters
					? [...selectedLinters].flatMap((l) => [...(VALID_RULE_NAMES[l] ?? [])])
					: [...RULE_OWNER.keys()];
				console.error(`Unknown rule: ${r}. Available: ${allowed.join(', ')}`);
				process.exit(2);
			}
			inferredFromRules.add(owner);
			if (!rulesByLinter.has(owner)) rulesByLinter.set(owner, new Set());
			rulesByLinter.get(owner).add(r);
		}
	}

	const activeLinters = selectedLinters ?? inferredFromRules ?? new Set(defaultLinters);
	return {
		activeLinters,
		rulesByLinter,
		explicitRules: Boolean(rawRules),
	};
}

/**
 * Shared CLI entry point powering `fork-lint.mjs` and all 5 legacy wrapper scripts.
 * @param {ReadonlyArray<string>} argv
 * @param {{defaultLinters?: ReadonlyArray<string>; failureFooter?: string}} [config]
 */
export function runForkLintCli(argv = process.argv.slice(2), config = {}) {
	const defaultLinters = config.defaultLinters ?? ALL_MONOREPO_LINTERS;
	const {reviewedPath, includeReviewed, checkReviewed, restArgs} = extractReviewedCliArgs(argv);
	const auditJson = restArgs.includes('--audit-json');
	const explicitAll = restArgs.includes('--all') || auditJson;
	const all = explicitAll || checkReviewed;
	const upstream = optionValue(restArgs, '--upstream', 'upstream/main');
	const {activeLinters, rulesByLinter, explicitRules} = parseLintSelection(restArgs, defaultLinters);

	const givenArgs = restArgs.filter(
		(arg, i, args) =>
			!arg.startsWith('--') && args[i - 1] !== '--upstream' && args[i - 1] !== '--rule' && args[i - 1] !== '--linter',
	);

	// In `--audit-json`, always load the reviewed catalog (never bypass via `--include-reviewed`).
	const catalog = loadReviewedCatalogOrExit(reviewedPath, {
		includeReviewed: auditJson ? false : includeReviewed,
		checkReviewed: checkReviewed || auditJson,
	});

	const hasReviewedCss = Boolean(catalog?.entries.some((e) => e.linter === 'web-safety' && e.file.endsWith('.css')));
	const targets = discoverMonorepoTargets({
		repoRoot: REPO_ROOT,
		appDir: APP_DIR,
		upstream,
		all,
		activeLinters,
		givenArgs,
	});
	const workspaceFacts = new WorkspaceFacts({repoRoot: REPO_ROOT, appDir: APP_DIR});

	const allProblemsByLinter = new Map();
	for (const l of activeLinters) allProblemsByLinter.set(l, []);

	for (const target of targets) {
		const source = fs.readFileSync(target.absPath, 'utf8');
		const unit = createSourceUnit({
			repoFile: target.repoFile,
			displayFile: target.displayFile,
			source,
			lines: target.lines,
		});
		const {problemsByLinter} = lintSourceUnitWithPipeline(unit, {
			activeLinters,
			rulesByLinter,
			workspaceFacts,
			reviewed: catalog,
			isAllUnfiltered: all && givenArgs.length === 0,
			explicitRules,
			hasReviewedCss,
		});
		for (const [linter, list] of problemsByLinter) {
			if (list.length > 0) allProblemsByLinter.get(linter).push(...list);
		}
	}

	const orderedLinters = ALL_MONOREPO_LINTERS.filter((l) => activeLinters.has(l));
	const allProblems = orderedLinters.flatMap((l) => allProblemsByLinter.get(l) ?? []);

	// Single-pass audit JSON output for automated audits (`--audit-json`).
	if (auditJson) {
		const {byLinter} = evaluateReviewedForLinters(catalog, orderedLinters, rulesByLinter);
		const lintersJson = {};
		for (const l of orderedLinters) {
			const stats = byLinter.get(l);
			lintersJson[l] = {
				violations: allProblemsByLinter.get(l) ?? [],
				staleReviewed: (stats?.staleEntries ?? []).map((e) => `Stale reviewed entry: ${e.describe()}`),
				suppressed: stats?.suppressed ?? 0,
				entryCount: stats?.entryCount ?? 0,
			};
		}
		console.log(JSON.stringify({linters: lintersJson}));
		process.exit(0);
	}

	// Single-linter legacy wrapper or `--check-reviewed` without `--all`.
	if (checkReviewed && !explicitAll) {
		if (orderedLinters.length === 1) {
			const only = orderedLinters[0];
			finishReviewedCheckOrNotes({
				linter: only,
				catalog,
				reviewedPath,
				checkReviewed: true,
				reportAllSummary: true,
				allFilesScanned: givenArgs.length === 0,
				rules: rulesByLinter.get(only) ?? null,
			});
		} else {
			if (!reviewedCatalogExists(reviewedPath)) {
				console.error(`Reviewed lint catalog \`${catalog.sourcePath}\` does not exist.`);
				process.exit(2);
			}
			const {byLinter, allStaleEntries} = evaluateReviewedForLinters(catalog, orderedLinters, rulesByLinter);
			if (allStaleEntries.length > 0) {
				for (const entry of allStaleEntries) {
					console.error(`Stale reviewed entry: ${entry.describe()}`);
				}
				console.error(
					`\n${allStaleEntries.length} stale reviewed entry/entries in \`${catalog.sourcePath}\`. Remove entries that upstream fixed, or adjust selectors if upstream renamed the symbol.`,
				);
				process.exit(1);
			}
			for (const l of orderedLinters) {
				const {entryCount, suppressed} = byLinter.get(l);
				console.log(
					`${catalog.sourcePath} (${l}): all ${entryCount} reviewed entry/entries matched (${suppressed} finding(s) suppressed).`,
				);
			}
			process.exit(0);
		}
	}

	// `--all` combined with `--check-reviewed` verifies BOTH stale entries AND unreviewed violations.
	let hasStale = false;
	if (all && catalog) {
		if (checkReviewed) {
			if (!reviewedCatalogExists(reviewedPath)) {
				console.error(`Reviewed lint catalog \`${catalog.sourcePath}\` does not exist.`);
				process.exit(2);
			}
			const {byLinter, allStaleEntries} = evaluateReviewedForLinters(catalog, orderedLinters, rulesByLinter);
			if (allStaleEntries.length > 0) {
				hasStale = true;
				for (const entry of allStaleEntries) {
					console.error(`Stale reviewed entry: ${entry.describe()}`);
				}
				console.error(
					`\n${allStaleEntries.length} stale reviewed entry/entries in \`${catalog.sourcePath}\`. Remove entries that upstream fixed, or adjust selectors if upstream renamed the symbol.`,
				);
			} else if (allProblems.length === 0) {
				for (const l of orderedLinters) {
					const {entryCount, suppressed} = byLinter.get(l);
					console.log(
						`${catalog.sourcePath} (${l}): all ${entryCount} reviewed entry/entries matched (${suppressed} finding(s) suppressed).`,
					);
				}
			}
		} else if (orderedLinters.length === 1) {
			const only = orderedLinters[0];
			finishReviewedCheckOrNotes({
				linter: only,
				catalog,
				reviewedPath,
				checkReviewed: false,
				reportAllSummary: true,
				allFilesScanned: givenArgs.length === 0,
				rules: rulesByLinter.get(only) ?? null,
			});
		} else {
			const {totalSuppressed, allStaleEntries} = evaluateReviewedForLinters(catalog, orderedLinters, rulesByLinter);
			if (totalSuppressed > 0) {
				console.error(
					`Suppressed ${totalSuppressed} reviewed upstream finding(s) via ${catalog.sourcePath} (pass --include-reviewed to list all).`,
				);
			}
			if (givenArgs.length === 0 && allStaleEntries.length > 0) {
				console.error(
					`Note: ${allStaleEntries.length} reviewed entry/entries in \`${catalog.sourcePath}\` matched 0 findings (run --check-reviewed to inspect).`,
				);
			}
		}
	}

	for (const problem of allProblems) console.log(problem);
	if (allProblems.length > 0) {
		const footer =
			config.failureFooter ??
			`\n${allProblems.length} fork lint violation(s). Fix the issue, add the domain's inline ignore comment with a reason on fork lines, or record reviewed upstream entries in \`fluxer_app/scripts/fork-lint-reviewed.json\`.`;
		console.error(typeof footer === 'function' ? footer(allProblems.length) : footer);
		process.exit(1);
	}
	if (hasStale) {
		process.exit(1);
	}
}
