// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 1 of the monorepo custom compiler-pipeline linter — target discovery, git diff
// line-set mapping, and lazy workspace-wide facts (MobX state modules & Desktop IPC guards).

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';

const FORK_LINT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(FORK_LINT_DIR, '..');
export const APP_DIR = path.resolve(SCRIPTS_DIR, '..');
export const REPO_ROOT = path.resolve(APP_DIR, '..');

export const ALL_MONOREPO_LINTERS = ['string', 'px', 'render-fetch', 'web-safety', 'backend-desktop'];
const APP_LINTERS = new Set(['string', 'px', 'render-fetch', 'web-safety']);

export const APP_SCRIPT_SOURCE_RE = /^src\/.*\.(ts|tsx|js|jsx|mjs)$/;
const APP_SOURCE_WITH_CSS_RE = /^src\/.*\.(ts|tsx|js|jsx|mjs|css)$/;
export const APP_SKIPPED_RE =
	/(\.test\.|\.spec\.|\.stories\.|\.bench\.|\/__tests__\/|\/__fixtures__\/|\/test\/|\/testing\/|\.d\.ts$)/;
export const TEST_FILE_RE = /(\.test\.|\.spec\.|\/tests\/|\/__tests__\/|\/__fixtures__\/|\/testing\/|\.d\.ts$)/;

const BACKEND_DESKTOP_DIFF_SCOPES = [
	'fluxer_api/src',
	'packages/schema/src/domains',
	'fluxer_desktop/src',
	'fluxer_gateway',
	'*.rs',
];
const BACKEND_DESKTOP_ALL_SCOPES = [
	'fluxer_api/src',
	'packages/schema/src/domains',
	'fluxer_desktop/src',
	'fluxer_gateway/test',
	'*.rs',
];

function git(cwd, ...args) {
	return execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
}

function walkFiles(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkFiles(full, out);
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
	return out;
}

function walkBabel(node, visit) {
	if (!node || typeof node.type !== 'string') return;
	visit(node);
	for (const key of Object.keys(node)) {
		if (key === 'loc' || key.endsWith('Comments')) continue;
		const val = node[key];
		if (Array.isArray(val)) {
			for (const child of val) walkBabel(child, visit);
		} else if (val && typeof val === 'object' && typeof val.type === 'string') {
			walkBabel(val, visit);
		}
	}
}

const mobxModulesCache = new Map();
const ipcGuardCache = new Map();

/**
 * Discovers MobX state modules under `fluxer_app/src/features` as `@app/...` specifiers.
 * Cached per resolved `appDir`.
 * @param {string} [appDir]
 * @returns {Set<string>}
 */
export function discoverMobxStateModules(appDir = APP_DIR) {
	const resolvedDir = path.resolve(appDir);
	const cached = mobxModulesCache.get(resolvedDir);
	if (cached) return cached;

	const modules = new Set();
	const featuresDir = path.join(resolvedDir, 'src', 'features');
	for (const full of walkFiles(featuresDir)) {
		const rel = path.relative(resolvedDir, full).replace(/\\/g, '/');
		if (!rel.includes('/state/') || !/\.(ts|tsx)$/.test(rel) || APP_SKIPPED_RE.test(rel)) continue;
		const src = fs.readFileSync(full, 'utf8');
		if (/\b(makeAutoObservable|makeObservable|observable)\b/.test(src)) {
			modules.add(`@app/${rel.slice('src/'.length).replace(/\.(ts|tsx)$/, '')}`);
		}
	}
	mobxModulesCache.set(resolvedDir, modules);
	return modules;
}

/**
 * Loads IPC channel names guarded by `installForkPrivilegedIpcGuard` when active in desktop main startup.
 * Cached per resolved `repoRoot`.
 * @param {string} [repoRoot]
 * @returns {Set<string>}
 */
export function loadForkGuardedDesktopIpcChannels(repoRoot = REPO_ROOT) {
	const resolvedRoot = path.resolve(repoRoot);
	const cached = ipcGuardCache.get(resolvedRoot);
	if (cached) return cached;

	const guarded = new Set();
	const guardFile = path.join(resolvedRoot, 'fluxer_desktop/src/main/ForkPrivilegedIpcGuard.ts');
	const indexFile = path.join(resolvedRoot, 'fluxer_desktop/src/main/index.ts');
	if (!fs.existsSync(guardFile) || !fs.existsSync(indexFile)) {
		ipcGuardCache.set(resolvedRoot, guarded);
		return guarded;
	}
	const indexSrc = fs.readFileSync(indexFile, 'utf8');
	const startupIdx = indexSrc.indexOf('initializeMainWindowStartup');
	if (startupIdx === -1 || !indexSrc.slice(startupIdx).includes('installForkPrivilegedIpcGuard(')) {
		ipcGuardCache.set(resolvedRoot, guarded);
		return guarded;
	}
	const guardSrc = fs.readFileSync(guardFile, 'utf8');
	const guardAst = parse(guardSrc, {sourceType: 'module', plugins: ['typescript'], errorRecovery: true});
	walkBabel(guardAst.program, (node) => {
		if (
			node.type === 'VariableDeclarator' &&
			node.id?.type === 'Identifier' &&
			node.id.name === 'FORK_GUARDED_IPC_CHANNELS' &&
			node.init?.type === 'NewExpression' &&
			node.init.arguments[0]?.type === 'ArrayExpression'
		) {
			for (const el of node.init.arguments[0].elements) {
				if (!el) continue;
				if (el.type === 'StringLiteral') guarded.add(el.value);
				else guarded.add(guardSrc.slice(el.start, el.end));
			}
		}
	});
	ipcGuardCache.set(resolvedRoot, guarded);
	return guarded;
}

/**
 * Lazily resolved workspace-wide facts shared across all files in a pipeline run.
 */
export class WorkspaceFacts {
	/**
	 * @param {{repoRoot?: string; appDir?: string; mobxStateModules?: Set<string>; forkGuardedIpcChannels?: Set<string>}} [options]
	 */
	constructor(options = {}) {
		this.repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
		this.appDir = path.resolve(options.appDir ?? path.join(this.repoRoot, 'fluxer_app'));
		this._mobxStateModules = options.mobxStateModules ?? null;
		this._forkGuardedIpcChannels = options.forkGuardedIpcChannels ?? null;
	}

	/** @returns {Set<string>} */
	getMobxStateModules() {
		if (!this._mobxStateModules) {
			this._mobxStateModules = discoverMobxStateModules(this.appDir);
		}
		return this._mobxStateModules;
	}

	/** @returns {Set<string>} */
	getForkGuardedIpcChannels() {
		if (!this._forkGuardedIpcChannels) {
			this._forkGuardedIpcChannels = loadForkGuardedDesktopIpcChannels(this.repoRoot);
		}
		return this._forkGuardedIpcChannels;
	}
}

function collectForkChanges(repoRoot, upstream, scopes) {
	const base = git(repoRoot, 'merge-base', 'HEAD', upstream).trim();
	const changes = new Map();
	let current;
	for (const line of git(
		repoRoot,
		'diff',
		'-U0',
		'--no-color',
		'--no-renames',
		'--diff-filter=AM',
		base,
		'--',
		...scopes,
	).split('\n')) {
		if (line.startsWith('+++ ')) {
			current = line === '+++ /dev/null' ? undefined : line.slice('+++ b/'.length);
			if (current) changes.set(current, new Set());
		} else if (current && line.startsWith('@@')) {
			const match = /\+(\d+)(?:,(\d+))?/.exec(line);
			const start = Number(match[1]);
			const count = match[2] === undefined ? 1 : Number(match[2]);
			for (let i = 0; i < count; i++) changes.get(current).add(start + i);
		}
	}
	for (const file of git(repoRoot, 'ls-files', '--others', '--exclude-standard', '--', ...scopes).split('\n')) {
		if (file) changes.set(file, 'all');
	}
	return changes;
}

function resolveGivenRepoPath(arg, repoRoot, appDir) {
	if (path.isAbsolute(arg)) {
		return path.relative(repoRoot, arg).replace(/\\/g, '/');
	}
	const cwdCandidate = path.resolve(process.cwd(), arg);
	if (fs.existsSync(cwdCandidate)) {
		return path.relative(repoRoot, cwdCandidate).replace(/\\/g, '/');
	}
	return path.relative(repoRoot, path.resolve(appDir, arg)).replace(/\\/g, '/');
}

function toTargetDescriptor(repoFile, lines, repoRoot) {
	const isApp = repoFile.startsWith('fluxer_app/src/');
	const appFile = isApp ? repoFile.slice('fluxer_app/'.length) : undefined;
	return {
		repoFile,
		appFile,
		displayFile: appFile ?? repoFile,
		absPath: path.join(repoRoot, repoFile),
		domain: isApp ? 'app' : 'backend-desktop',
		lines,
	};
}

/**
 * Discovers target files and line sets once across all active monorepo linters.
 * @param {{
 *   repoRoot?: string;
 *   appDir?: string;
 *   upstream?: string;
 *   all?: boolean;
 *   activeLinters: Set<string>;
 *   givenArgs?: Array<string>;
 * }} options
 * @returns {Array<{
 *   repoFile: string;
 *   appFile: string | undefined;
 *   displayFile: string;
 *   absPath: string;
 *   domain: 'app' | 'backend-desktop';
 *   lines: 'all' | Set<number>;
 * }>}
 */
export function discoverMonorepoTargets({
	repoRoot = REPO_ROOT,
	appDir = APP_DIR,
	upstream = 'upstream/main',
	all = false,
	activeLinters,
	givenArgs = [],
}) {
	const resolvedRoot = path.resolve(repoRoot);
	const resolvedAppDir = path.resolve(appDir);
	const wantApp = [...activeLinters].some((l) => APP_LINTERS.has(l));
	const wantBackendDesktop = activeLinters.has('backend-desktop');

	let targetMap;
	if (all) {
		if (givenArgs.length > 0) {
			targetMap = new Map(givenArgs.map((arg) => [resolveGivenRepoPath(arg, resolvedRoot, resolvedAppDir), 'all']));
		} else {
			targetMap = new Map();
			const trackedScopes = [];
			if (wantApp) trackedScopes.push('fluxer_app/src');
			if (wantBackendDesktop) trackedScopes.push(...BACKEND_DESKTOP_ALL_SCOPES);
			if (trackedScopes.length > 0) {
				for (const file of git(resolvedRoot, 'ls-files', '--', ...trackedScopes).split('\n')) {
					if (file) targetMap.set(file, 'all');
				}
			}
			if (wantBackendDesktop) {
				for (const file of git(
					resolvedRoot,
					'ls-files',
					'--others',
					'--exclude-standard',
					'--',
					...BACKEND_DESKTOP_ALL_SCOPES,
				).split('\n')) {
					if (file) targetMap.set(file, 'all');
				}
			}
		}
	} else {
		const diffScopes = [];
		if (wantApp) diffScopes.push('fluxer_app/src');
		if (wantBackendDesktop) diffScopes.push(...BACKEND_DESKTOP_DIFF_SCOPES);
		const changes = diffScopes.length > 0 ? collectForkChanges(resolvedRoot, upstream, diffScopes) : new Map();
		if (givenArgs.length > 0) {
			targetMap = new Map(
				givenArgs.map((arg) => {
					const repoFile = resolveGivenRepoPath(arg, resolvedRoot, resolvedAppDir);
					return [repoFile, changes.get(repoFile) ?? new Set()];
				}),
			);
		} else {
			targetMap = changes;
		}
	}

	const descriptors = [];
	const sortedEntries = [...targetMap].sort(([a], [b]) => a.localeCompare(b));
	for (const [repoFile, lines] of sortedEntries) {
		const desc = toTargetDescriptor(repoFile, lines, resolvedRoot);
		if (!fs.existsSync(desc.absPath)) continue;
		if (desc.domain === 'app') {
			if (!APP_SOURCE_WITH_CSS_RE.test(desc.appFile) || APP_SKIPPED_RE.test(desc.appFile)) continue;
		} else if (!wantBackendDesktop) {
			continue;
		}
		descriptors.push(desc);
	}
	return descriptors;
}
