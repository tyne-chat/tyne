// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: shared rebase-safe allowlist for upstream findings reported in `--all` scans or fork-touched
// upstream files across Tyne's monorepo AST linters (`fork-web-safety-lint.mjs`,
// `fork-backend-desktop-lint.mjs`, `fork-render-fetch-lint.mjs`, `fork-px-lint.mjs`,
// `fork-string-lint.mjs`). Aligned 1:1 with `tyne-mobile/tool/fork_lint_reviewed.dart`
// (`version: 1`, `--include-reviewed`, `--check-reviewed`, `--reviewed <path>`).
// Keeping reviewed exceptions in `fluxer_app/scripts/fork-lint-reviewed.json` avoids inserting
// inline ignore comments into untouched upstream files that would cause nightly rebase conflicts
// (tyne-chat/tyne#947).

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPTS_DIR, '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');

export const DEFAULT_REVIEWED_LINT_PATH = 'fluxer_app/scripts/fork-lint-reviewed.json';

export const VALID_REVIEWED_LINTERS = new Set(['web-safety', 'backend-desktop', 'render-fetch', 'px', 'string']);

export const VALID_RULE_NAMES = {
	'web-safety': new Set([
		'missing-observer',
		'mobx-stale-memo',
		'uncaptured-timer',
		'effect-missing-cleanup',
		'raw-web-storage',
		'messages-untracked-read',
		'zoom-blind-viewport',
	]),
	'backend-desktop': new Set([
		'non-atomic-index-write',
		'zod-schema-trap',
		'promise-race-timeout-leak',
		'desktop-ipc-sender',
		'desktop-window-safety',
		'api-controller-hygiene',
		'rust-async-blocking-fs',
		'gleam-fork-test-sleep',
	]),
	'render-fetch': new Set(['render-fetch', 'effect-no-deps-fetch']),
	px: new Set(['px-lint']),
	string: new Set(['string-lint']),
};

const MULTI_RULE_LINTERS = new Set(['web-safety', 'backend-desktop', 'render-fetch']);
const VALID_TOP_LEVEL_KEYS = new Set(['version', 'entries']);
const VALID_ENTRY_KEYS = new Set(['linter', 'file', 'rule', 'enclosing', 'symbol', 'target', 'code', 'reason']);

/**
 * Normalizes a file path to a forward-slash repository-relative path so `fork_app`-relative
 * paths (`src/...`) and repo-relative paths (`fluxer_app/src/...`, `fluxer_desktop/src/...`)
 * match one canonical key in `fork-lint-reviewed.json`.
 * @param {string} file
 * @param {string} [defaultPackage]
 * @returns {string}
 */
export function normalizeRepoRelPath(file, defaultPackage = 'fluxer_app') {
	const norm = file.replace(/\\/g, '/').replace(/^\.\//, '');
	if (norm.startsWith('src/') && defaultPackage) {
		return `${defaultPackage}/${norm}`;
	}
	return norm;
}

/**
 * Returns the enclosing `Type.member`, `Type`, top-level function, or variable declarator symbol
 * for a Babel AST node given its ancestor chain so allowlist entries survive upstream line shifts.
 * @param {ReadonlyArray<any>} ancestors
 * @returns {string}
 */
export function enclosingAstSymbol(ancestors) {
	let memberName;
	let hasMember = false;
	let typeName;

	for (let i = ancestors.length - 1; i >= 0; i--) {
		const cur = ancestors[i];
		if (!cur || typeof cur.type !== 'string') continue;
		const parent = i > 0 ? ancestors[i - 1] : undefined;

		if (!hasMember) {
			if ((cur.type === 'ClassMethod' || cur.type === 'ObjectMethod') && cur.key?.type === 'Identifier') {
				memberName = cur.key.name;
				hasMember = true;
			} else if (cur.type === 'FunctionDeclaration' && cur.id?.type === 'Identifier') {
				memberName = cur.id.name;
				hasMember = true;
			} else if (cur.type === 'FunctionExpression' || cur.type === 'ArrowFunctionExpression') {
				if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
					memberName = parent.id.name;
					hasMember = true;
				} else if (cur.id?.type === 'Identifier') {
					memberName = cur.id.name;
					hasMember = true;
				}
			} else if (
				cur.type === 'VariableDeclarator' &&
				cur.id?.type === 'Identifier' &&
				(cur.init?.type === 'ArrowFunctionExpression' ||
					cur.init?.type === 'FunctionExpression' ||
					(cur.init?.type === 'CallExpression' &&
						cur.init.callee?.type === 'Identifier' &&
						/^(observer|Observer|memo|forwardRef)$/.test(cur.init.callee.name)))
			) {
				memberName = cur.id.name;
				hasMember = true;
			}
		}

		if (
			!typeName &&
			(cur.type === 'ClassDeclaration' || cur.type === 'ClassExpression') &&
			cur.id?.type === 'Identifier'
		) {
			typeName = cur.id.name;
		}
	}

	if (typeName && hasMember && memberName) {
		return `${typeName}.${memberName}`;
	}
	if (typeName) {
		return typeName;
	}
	return memberName ?? '';
}

function requireNonEmptyString(map, key, index) {
	const value = map[key];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Entry #${index} in reviewed lint catalog must have a non-empty \`${key}\`.`);
	}
	return value.trim();
}

function optionalNonEmptyString(map, key, index) {
	if (!Object.hasOwn(map, key) || map[key] === null || map[key] === undefined) {
		return undefined;
	}
	const value = map[key];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Entry #${index} \`${key}\` in reviewed lint catalog must be a non-empty string when provided.`);
	}
	return value.trim();
}

export class ReviewedLintEntry {
	/**
	 * @param {{
	 *   linter: string;
	 *   file: string;
	 *   reason: string;
	 *   rule?: string;
	 *   enclosing?: string;
	 *   symbol?: string;
	 *   target?: string;
	 *   code?: string;
	 * }} fields
	 */
	constructor({linter, file, reason, rule, enclosing, symbol, target, code}) {
		this.linter = linter;
		this.file = file;
		this.reason = reason;
		this.rule = rule;
		this.enclosing = enclosing;
		this.symbol = symbol;
		this.target = target;
		this.code = code;
	}

	static fromJson(raw, index) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error(`Entry #${index} in reviewed lint catalog must be a JSON object.`);
		}
		for (const key of Object.keys(raw)) {
			if (!VALID_ENTRY_KEYS.has(key)) {
				throw new Error(`Unknown key \`${key}\` in entry #${index} of reviewed lint catalog.`);
			}
		}

		const linter = requireNonEmptyString(raw, 'linter', index);
		if (!VALID_REVIEWED_LINTERS.has(linter)) {
			throw new Error(
				`Entry #${index} has invalid linter \`${linter}\` (expected one of: ${[...VALID_REVIEWED_LINTERS].join(', ')}).`,
			);
		}

		const file = requireNonEmptyString(raw, 'file', index);
		if (file.startsWith('/') || file.includes('\\')) {
			throw new Error(`Entry #${index} \`file\` must be a repository-relative forward-slash path: \`${file}\`.`);
		}

		const reason = requireNonEmptyString(raw, 'reason', index);
		const rule = optionalNonEmptyString(raw, 'rule', index);
		const enclosing = optionalNonEmptyString(raw, 'enclosing', index);
		const symbol = optionalNonEmptyString(raw, 'symbol', index);
		const target = optionalNonEmptyString(raw, 'target', index);
		const code = optionalNonEmptyString(raw, 'code', index);

		const allowedRules = VALID_RULE_NAMES[linter];
		if (target === '*' && linter !== 'string') {
			throw new Error(`Entry #${index} (\`${file}\`): wildcard \`target: "*"\` is only supported for \`string\`.`);
		}
		if (MULTI_RULE_LINTERS.has(linter)) {
			if (!rule || !allowedRules.has(rule)) {
				throw new Error(
					`Entry #${index} for \`${linter}\` must specify a valid \`rule\` (${[...allowedRules].join(', ')}).`,
				);
			}
			if (!enclosing && !symbol && !target && !code) {
				throw new Error(
					`Entry #${index} (\`${file}\`) must narrow matches with \`enclosing\`, \`symbol\`, \`target\`, or \`code\`.`,
				);
			}
		} else {
			if (rule && !allowedRules.has(rule)) {
				throw new Error(`Entry #${index} has invalid \`rule\` \`${rule}\` for linter \`${linter}\`.`);
			}
			if (!enclosing && !symbol && !target && !code) {
				throw new Error(
					`Entry #${index} (\`${file}\`) must narrow matches with \`enclosing\`, \`symbol\`, \`target\`, or \`code\`.`,
				);
			}
		}

		return new ReviewedLintEntry({linter, file, reason, rule, enclosing, symbol, target, code});
	}

	/**
	 * @param {{
	 *   linter: string;
	 *   rule?: string;
	 *   file: string;
	 *   enclosing?: string;
	 *   symbol?: string;
	 *   target?: string;
	 *   sourceLine: string;
	 * }} candidate
	 * @returns {boolean}
	 */
	matches(candidate) {
		if (candidate.linter !== this.linter || candidate.file !== this.file) {
			return false;
		}
		if (this.rule !== undefined && candidate.rule !== this.rule) {
			return false;
		}
		if (this.enclosing !== undefined && (candidate.enclosing ?? '') !== this.enclosing) {
			return false;
		}
		if (this.symbol !== undefined) {
			const candidateSymbol = candidate.symbol ?? '';
			if (this.symbol.endsWith('.*')) {
				const prefix = this.symbol.slice(0, -1);
				if (!candidateSymbol.startsWith(prefix)) {
					return false;
				}
			} else if (candidateSymbol !== this.symbol) {
				return false;
			}
		}
		if (this.target !== undefined && this.target !== '*' && (candidate.target ?? '') !== this.target) {
			return false;
		}
		if (this.code !== undefined && !candidate.sourceLine.includes(this.code)) {
			return false;
		}
		return true;
	}

	describe() {
		const parts = [`linter=${this.linter}`, `file=${this.file}`];
		if (this.rule) parts.push(`rule=${this.rule}`);
		if (this.enclosing) parts.push(`enclosing=${this.enclosing}`);
		if (this.symbol) parts.push(`symbol=${this.symbol}`);
		if (this.target) parts.push(`target=${this.target}`);
		if (this.code) parts.push(`code=${this.code}`);
		return parts.join(' ');
	}
}

export class ReviewedLintCatalog {
	constructor(entries, sourcePath = DEFAULT_REVIEWED_LINT_PATH) {
		this.entries = Object.freeze([...entries]);
		this.sourcePath = sourcePath;
		this._matchCounts = new Map();
		this._suppressedByLinter = new Map();
	}

	static empty(sourcePath = DEFAULT_REVIEWED_LINT_PATH) {
		return new ReviewedLintCatalog([], sourcePath);
	}

	static fromEntries(entries, sourcePath = DEFAULT_REVIEWED_LINT_PATH) {
		return new ReviewedLintCatalog(entries, sourcePath);
	}

	static fromJsonString(raw, sourcePath = DEFAULT_REVIEWED_LINT_PATH) {
		const decoded = JSON.parse(raw);
		if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
			throw new Error(`Reviewed lint catalog \`${sourcePath}\` must contain a JSON object.`);
		}
		for (const key of Object.keys(decoded)) {
			if (!VALID_TOP_LEVEL_KEYS.has(key)) {
				throw new Error(`Unknown top-level key \`${key}\` in reviewed lint catalog \`${sourcePath}\`.`);
			}
		}
		if (decoded.version !== 1) {
			throw new Error(`Reviewed lint catalog \`${sourcePath}\` must specify \`"version": 1\`.`);
		}
		if (!Array.isArray(decoded.entries)) {
			throw new Error(`Reviewed lint catalog \`${sourcePath}\` must have an \`"entries"\` list.`);
		}
		const parsed = decoded.entries.map((entry, idx) => ReviewedLintEntry.fromJson(entry, idx));
		return ReviewedLintCatalog.fromEntries(parsed, sourcePath);
	}

	static load(reviewedPath = DEFAULT_REVIEWED_LINT_PATH) {
		const resolved = resolveCatalogPath(reviewedPath);
		if (!resolved.exists) {
			return ReviewedLintCatalog.empty(resolved.displayPath);
		}
		return ReviewedLintCatalog.fromJsonString(fs.readFileSync(resolved.diskPath, 'utf8'), resolved.displayPath);
	}

	matches(candidate) {
		let matched = false;
		for (let i = 0; i < this.entries.length; i++) {
			if (this.entries[i].matches(candidate)) {
				this._matchCounts.set(i, (this._matchCounts.get(i) ?? 0) + 1);
				matched = true;
			}
		}
		if (matched) {
			this._suppressedByLinter.set(candidate.linter, (this._suppressedByLinter.get(candidate.linter) ?? 0) + 1);
		}
		return matched;
	}

	suppressedCount(linter) {
		return this._suppressedByLinter.get(linter) ?? 0;
	}

	entryCountFor(linter, rules = null) {
		return this.entries.filter((e) => e.linter === linter && (!e.rule || !rules || rules.has(e.rule))).length;
	}

	unmatchedEntries(linter, rules = null) {
		const unmatched = [];
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry.linter !== linter) continue;
			if (entry.rule && rules && !rules.has(entry.rule)) continue;
			if ((this._matchCounts.get(i) ?? 0) === 0) {
				unmatched.push(entry);
			}
		}
		return unmatched;
	}
}

function resolveCatalogPath(reviewedPath) {
	if (reviewedPath === DEFAULT_REVIEWED_LINT_PATH) {
		const defaultDisk = path.join(SCRIPTS_DIR, 'fork-lint-reviewed.json');
		return {
			diskPath: defaultDisk,
			displayPath: DEFAULT_REVIEWED_LINT_PATH,
			exists: fs.existsSync(defaultDisk),
		};
	}
	const cwdResolved = path.resolve(process.cwd(), reviewedPath);
	if (fs.existsSync(cwdResolved)) {
		return {diskPath: cwdResolved, displayPath: reviewedPath, exists: true};
	}
	const repoResolved = path.resolve(REPO_ROOT, reviewedPath);
	if (fs.existsSync(repoResolved)) {
		return {diskPath: repoResolved, displayPath: reviewedPath, exists: true};
	}
	return {diskPath: cwdResolved, displayPath: reviewedPath, exists: false};
}

/**
 * Strips `--include-reviewed`, `--check-reviewed`, and `--reviewed <path>` from CLI argv.
 * @param {ReadonlyArray<string>} args
 */
export function extractReviewedCliArgs(args) {
	let reviewedPath = DEFAULT_REVIEWED_LINT_PATH;
	let includeReviewed = false;
	let checkReviewed = false;
	const restArgs = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--include-reviewed') {
			includeReviewed = true;
		} else if (arg === '--check-reviewed') {
			checkReviewed = true;
		} else if (arg === '--reviewed') {
			if (i + 1 >= args.length) {
				console.error('--reviewed requires a path argument.');
				process.exit(2);
			}
			reviewedPath = args[++i];
		} else {
			restArgs.push(arg);
		}
	}

	return {reviewedPath, includeReviewed, checkReviewed, restArgs};
}

/**
 * Loads the reviewed catalog from `reviewedPath`, or returns `null` when `--include-reviewed`
 * disables allowlist filtering (and `--check-reviewed` was not requested).
 */
export function loadReviewedCatalogOrExit(reviewedPath, {includeReviewed, checkReviewed}) {
	if (includeReviewed && !checkReviewed) {
		return null;
	}
	try {
		return ReviewedLintCatalog.load(reviewedPath);
	} catch (error) {
		console.error(`Invalid reviewed lint catalog: ${error.message}`);
		process.exit(2);
	}
}

/**
 * Handles `--check-reviewed` exit behavior or prints reviewed suppression/staleness notes
 * during `--all` scans.
 */
export function finishReviewedCheckOrNotes({
	linter,
	catalog,
	reviewedPath,
	checkReviewed,
	reportAllSummary,
	allFilesScanned,
	rules = null,
}) {
	if (!catalog) return;

	if (checkReviewed) {
		const resolved = resolveCatalogPath(reviewedPath);
		if (!resolved.exists) {
			console.error(`Reviewed lint catalog \`${catalog.sourcePath}\` does not exist.`);
			process.exit(2);
		}
		const stale = catalog.unmatchedEntries(linter, rules);
		if (stale.length > 0) {
			for (const entry of stale) {
				console.error(`Stale reviewed entry: ${entry.describe()}`);
			}
			console.error(
				`\n${stale.length} stale reviewed entry/entries in \`${catalog.sourcePath}\` for \`${linter}\`. Remove entries that upstream fixed, or adjust selectors if upstream renamed the symbol.`,
			);
			process.exit(1);
		}
		const entryCount = catalog.entryCountFor(linter, rules);
		const suppressed = catalog.suppressedCount(linter);
		console.log(
			`${catalog.sourcePath} (${linter}): all ${entryCount} reviewed entry/entries matched (${suppressed} finding(s) suppressed).`,
		);
		process.exit(0);
	}

	if (!reportAllSummary) return;

	const suppressed = catalog.suppressedCount(linter);
	if (suppressed > 0) {
		console.error(
			`Suppressed ${suppressed} reviewed upstream finding(s) via ${catalog.sourcePath} (pass --include-reviewed to list all).`,
		);
	}
	if (allFilesScanned) {
		const stale = catalog.unmatchedEntries(linter, rules);
		if (stale.length > 0) {
			console.error(
				`Note: ${stale.length} reviewed entry/entries in \`${catalog.sourcePath}\` for \`${linter}\` matched 0 findings (run --check-reviewed to inspect).`,
			);
		}
	}
}

/**
 * Evaluates reviewed catalog match and staleness stats across multiple linters without exiting.
 * @param {ReviewedLintCatalog | null} catalog
 * @param {Iterable<string>} linters
 * @param {Map<string, Set<string>> | null} [rulesByLinter]
 * @returns {{
 *   byLinter: Map<string, {entryCount: number; suppressed: number; staleEntries: Array<ReviewedLintEntry>}>;
 *   totalSuppressed: number;
 *   allStaleEntries: Array<ReviewedLintEntry>;
 * }}
 */
export function evaluateReviewedForLinters(catalog, linters, rulesByLinter = null) {
	const byLinter = new Map();
	const allStaleEntries = [];
	let totalSuppressed = 0;

	if (!catalog) {
		return {byLinter, totalSuppressed, allStaleEntries};
	}

	for (const linter of linters) {
		const rules = rulesByLinter?.get(linter) ?? null;
		const entryCount = catalog.entryCountFor(linter, rules);
		const suppressed = catalog.suppressedCount(linter);
		const staleEntries = catalog.unmatchedEntries(linter, rules);
		byLinter.set(linter, {entryCount, suppressed, staleEntries});
		totalSuppressed += suppressed;
		allStaleEntries.push(...staleEntries);
	}

	return {byLinter, totalSuppressed, allStaleEntries};
}

/**
 * Resolves whether the catalog file for `reviewedPath` exists on disk.
 * @param {string} reviewedPath
 * @returns {boolean}
 */
export function reviewedCatalogExists(reviewedPath = DEFAULT_REVIEWED_LINT_PATH) {
	return resolveCatalogPath(reviewedPath).exists;
}
