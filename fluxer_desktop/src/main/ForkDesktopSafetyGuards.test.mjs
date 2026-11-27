// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: guards for Desktop MainApp bundle separation, ShellDownloadFormats VM import safety,
// release workflow CI step parity, and createWindow vs openAppWindow listener parity (tyne-chat/tyne#947).

import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const MAIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(MAIN_DIR, '../..');
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..');

function resolveLocalModule(fromFile, specifier) {
	let candidateBase;
	if (specifier.startsWith('@electron/')) {
		candidateBase = path.join(DESKTOP_DIR, 'src', specifier.slice('@electron/'.length));
	} else if (specifier.startsWith('./') || specifier.startsWith('../')) {
		candidateBase = path.resolve(path.dirname(fromFile), specifier);
	} else {
		return null;
	}
	for (const ext of ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.js']) {
		const full = candidateBase + ext;
		if (existsSync(full)) return full;
	}
	return null;
}

function extractModuleImports(source) {
	const specifiers = [];
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	for (const match of stripped.matchAll(/\bimport\s+(?!type\b)(?:[^;'"]+\s+from\s+)?['"]([^'"]+)['"]/g)) {
		specifiers.push(match[1]);
	}
	for (const match of stripped.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
		specifiers.push(match[1]);
	}
	return specifiers;
}

function toSnakeCaseStep(pascalName) {
	return pascalName
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase();
}

function extractFunctionBody(source, signaturePrefix) {
	const idx = source.indexOf(signaturePrefix);
	assert.notEqual(idx, -1, `Could not find ${signaturePrefix} in Window.ts`);
	// Find the `{` that opens the function body after the parameter list (`): ... {`)
	const parenStart = source.indexOf('(', idx);
	let pDepth = 0;
	let i = parenStart;
	while (i < source.length) {
		if (source[i] === '(') pDepth++;
		else if (source[i] === ')') {
			pDepth--;
			if (pDepth === 0) break;
		}
		i++;
	}
	const braceStart = source.indexOf('{', i);
	assert.notEqual(braceStart, -1, `Could not find body opening brace for ${signaturePrefix}`);
	let bDepth = 1;
	let p = braceStart + 1;
	while (p < source.length && bDepth > 0) {
		const ch = source[p];
		if (ch === '/' && source[p + 1] === '/') {
			const nl = source.indexOf('\n', p);
			p = nl === -1 ? source.length : nl + 1;
			continue;
		}
		if (ch === '/' && source[p + 1] === '*') {
			const end = source.indexOf('*/', p + 2);
			p = end === -1 ? source.length : end + 2;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') {
			const q = ch;
			p++;
			while (p < source.length && source[p] !== q) {
				if (source[p] === '\\') p++;
				p++;
			}
			p++;
			continue;
		}
		if (ch === '{') bDepth++;
		else if (ch === '}') bDepth--;
		p++;
	}
	return source.slice(braceStart, p);
}

function extractEventListeners(body, targetRegex) {
	const events = new Set();
	const re = new RegExp(`${targetRegex.source}\\.(?:on|once)\\(\\s*['"]([^'"]+)['"]`, 'g');
	for (const match of body.matchAll(re)) {
		events.add(match[1]);
	}
	return events;
}

describe('fork desktop safety guards', () => {
	it('never reaches SplashWindow from MainApp module graph (SplashBundleOwnership)', () => {
		const visited = new Set();
		const queue = [path.join(MAIN_DIR, 'index.ts')];
		while (queue.length > 0) {
			const file = queue.pop();
			if (visited.has(file) || !existsSync(file)) continue;
			visited.add(file);
			const src = readFileSync(file, 'utf8');
			for (const spec of extractModuleImports(src)) {
				const resolved = resolveLocalModule(file, spec);
				if (resolved) queue.push(resolved);
			}
		}
		const splashPath = path.join(MAIN_DIR, 'SplashWindow.ts');
		assert.equal(
			visited.has(splashPath),
			false,
			'MainApp entry graph must never import SplashWindow.ts (disabled in fork builds)',
		);
	});

	it('keeps @electron/common/BuildChannel as the sole runtime import in ShellDownloadFormats.ts', () => {
		const src = readFileSync(path.join(MAIN_DIR, 'ShellDownloadFormats.ts'), 'utf8');
		const runtimeImports = extractModuleImports(src);
		assert.deepEqual(
			runtimeImports,
			['@electron/common/BuildChannel'],
			'scripts/fork-release-assets.mjs evaluates ShellDownloadFormats.ts in a minimal VM with only BuildChannel stubbed',
		);
	});

	it('keeps every build-desktop --step in fork-desktop-release.yaml aligned with tools/ci/src/desktop.rs', () => {
		const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/fork-desktop-release.yaml'), 'utf8');
		const desktopRs = readFileSync(path.join(REPO_ROOT, 'tools/ci/src/desktop.rs'), 'utf8');
		const enumMatch = /enum\s+DesktopStep\s*\{([\s\S]*?)\}/.exec(desktopRs);
		assert.ok(enumMatch, 'DesktopStep enum not found in tools/ci/src/desktop.rs');
		const definedSteps = new Set(
			enumMatch[1]
				.split('\n')
				.map((l) => l.trim().replace(/,$/, ''))
				.filter((l) => /^[A-Z][A-Za-z0-9]+$/.test(l))
				.map(toSnakeCaseStep),
		);
		const workflowSteps = [...workflow.matchAll(/--step\s+([a-z0-9_]+)/g)].map((m) => m[1]);
		assert.ok(workflowSteps.length >= 10, 'Expected at least 10 build-desktop --step entries');
		for (const step of workflowSteps) {
			assert.ok(definedSteps.has(step), `fork-desktop-release.yaml references unknown build-desktop --step '${step}'`);
		}
	});

	it('flags new BrowserWindow/webContents event listeners added to createWindow without openAppWindow parity', () => {
		const windowSrc = readFileSync(path.join(MAIN_DIR, 'Window.ts'), 'utf8');
		const createBody = extractFunctionBody(windowSrc, 'export function createWindow(');
		const openBody = extractFunctionBody(windowSrc, 'export function openAppWindow(');
		const trackBody = extractFunctionBody(windowSrc, 'function trackForkAppWindow(');

		const createWinEvents = extractEventListeners(createBody, /\b(?:createdWindow|mainWindow)\b/);
		const extraWinEvents = new Set([
			...extractEventListeners(openBody, /\bwindow\b/),
			...extractEventListeners(trackBody, /\bwindow\b/),
		]);
		const createContentsEvents = extractEventListeners(createBody, /\bwebContents\b/);
		const extraContentsEvents = new Set([
			...extractEventListeners(openBody, /\bcontents\b/),
			...extractEventListeners(trackBody, /\bwindow\.webContents\b/),
		]);

		// Documented main-window-only events (tray/bounds/reveal) + tracked tyne-chat/tyne#337 gaps:
		const ALLOWED_CREATE_ONLY_WINDOW_EVENTS = new Set([
			'show',
			'will-resize',
			'resized',
			'blur',
			'minimize',
			'restore',
			'hide',
		]);
		const ALLOWED_CREATE_ONLY_CONTENTS_EVENTS = new Set([
			'console-message', // tyne-chat/tyne#337
			'unresponsive', // tyne-chat/tyne#337
			'responsive', // tyne-chat/tyne#337
			'did-finish-load',
		]);

		for (const ev of createWinEvents) {
			assert.ok(
				extraWinEvents.has(ev) || ALLOWED_CREATE_ONLY_WINDOW_EVENTS.has(ev),
				`createWindow registered BrowserWindow '${ev}' listener missing from openAppWindow/trackForkAppWindow`,
			);
		}
		for (const ev of createContentsEvents) {
			assert.ok(
				extraContentsEvents.has(ev) || ALLOWED_CREATE_ONLY_CONTENTS_EVENTS.has(ev),
				`createWindow registered webContents '${ev}' listener missing from openAppWindow/trackForkAppWindow`,
			);
		}
	});
});
