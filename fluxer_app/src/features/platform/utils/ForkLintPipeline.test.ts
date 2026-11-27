// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests for the unified monorepo 4-stage compiler-pipeline linter (`scripts/fork-lint.mjs`
// and `scripts/fork-lint/*`, tyne-chat/tyne#953).

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
	ALL_BACKEND_DESKTOP_RULES,
	loadForkGuardedDesktopIpcChannels,
} from '../../../../scripts/fork-backend-desktop-lint.mjs';
import {parseAndBuildTsModuleIR} from '../../../../scripts/fork-lint/ir-ts.mjs';
import {createSourceUnit} from '../../../../scripts/fork-lint/source-unit.mjs';
import {ALL_MONOREPO_LINTERS, lintFileWithPipeline, runForkLintCli} from '../../../../scripts/fork-lint.mjs';
import {
	enclosingAstSymbol,
	evaluateReviewedForLinters,
	ReviewedLintCatalog,
	ReviewedLintEntry,
	reviewedCatalogExists,
} from '../../../../scripts/fork-lint-reviewed.mjs';
import {ALL_WEB_SAFETY_RULES, discoverMobxStateModules} from '../../../../scripts/fork-web-safety-lint.mjs';

const TEST_STORES = new Set(['@app/features/user/state/Users']);
const SCRIPT_PATH = path.resolve(import.meta.dirname, '../../../../scripts/fork-lint.mjs');

describe('fork-lint compiler pipeline (monorepo)', () => {
	it('parses a multi-issue TSX file once and dispatches web-safety, render-fetch, string, and px over shared IR', () => {
		const source = [
			"import Users from '@app/features/user/state/Users';",
			'export function BrokenBanner() {',
			'\tconst name = Users.currentUser?.username;',
			"\tvoid http.get('/api/users/@me');",
			'\treturn <div style={{width: 24}}>Unsaved Banner {name}</div>;',
			'}',
		].join('\n');

		const parsedFiles: Array<string> = [];
		const result = lintFileWithPipeline('src/BrokenBanner.tsx', source, 'all', {
			mobxStateModules: TEST_STORES,
			onParse: (file) => parsedFiles.push(file),
		});

		expect(parsedFiles).toEqual(['src/BrokenBanner.tsx']);
		expect(result.parseCount).toBe(1);
		expect(result.problemsByLinter.get('web-safety')).toEqual([
			'src/BrokenBanner.tsx:3:15: [missing-observer] component `BrokenBanner` reads `Users.currentUser` during render without `observer()` (never re-renders on store changes)',
		]);
		expect(result.problemsByLinter.get('render-fetch')).toEqual([
			'src/BrokenBanner.tsx:4:7: [render-fetch] network call `http.get()` inside React render/hook body (move into useEffect with deps or an event handler; tyne-chat/tyne#114)',
		]);
		expect(result.problemsByLinter.get('px')).toEqual(['src/BrokenBanner.tsx:5: width: 24 (px)']);
		expect(result.problemsByLinter.get('string')).toEqual(['src/BrokenBanner.tsx:5:34: JSX text: "Unsaved Banner"']);
	});

	it('reuses shared SourceUnit & TsModuleIR fields (enclosingSymbol, scope shadowing, runsInRender, directAwaitStmtIndices)', () => {
		const unit = createSourceUnit({
			repoFile: 'fluxer_desktop/src/main/WindowHelper.ts',
			displayFile: 'src/WindowHelper.ts',
			source: [
				'export async function refresh(win: any, localStorage: Storage) {',
				'\tvoid localStorage.getItem("k");',
				'\tawait Promise.resolve();',
				'\twin.focus();',
				'}',
			].join('\n'),
		});
		const ir = parseAndBuildTsModuleIR(unit);
		expect(ir.parseError).toBeNull();
		if (!ir.ast || !ir.functionList || !ir.enclosingSymbol || !ir.isLexicallyShadowed) {
			throw new Error('Expected TsModuleIR to be populated');
		}
		expect(ir.functionList).toHaveLength(1);
		expect(ir.functionList[0].directAwaitStmtIndices.has(1)).toBe(true);

		const firstStmt = ir.ast.program.body[0];
		if (firstStmt.type !== 'ExportNamedDeclaration' || firstStmt.declaration?.type !== 'FunctionDeclaration') {
			throw new Error('Expected exported function declaration');
		}
		const firstBodyStmt = firstStmt.declaration.body.body[0];
		if (firstBodyStmt.type !== 'ExpressionStatement') {
			throw new Error('Expected expression statement');
		}
		const expr =
			firstBodyStmt.expression.type === 'UnaryExpression'
				? firstBodyStmt.expression.argument
				: firstBodyStmt.expression;
		if (expr.type !== 'CallExpression' || expr.callee.type !== 'MemberExpression') {
			throw new Error('Expected call expression');
		}
		const idNode = expr.callee.object;
		expect(ir.enclosingSymbol(idNode)).toBe('refresh');
		expect(enclosingAstSymbol([firstStmt.declaration])).toBe('refresh');
		expect(ir.isLexicallyShadowed(idNode, 'localStorage')).toBe(true);
	});

	it('preserves legacy wrapper constants and workspace discovery helpers', () => {
		expect(ALL_WEB_SAFETY_RULES.size).toBe(7);
		expect(ALL_BACKEND_DESKTOP_RULES.size).toBe(8);
		expect(typeof discoverMobxStateModules).toBe('function');
		expect(typeof loadForkGuardedDesktopIpcChannels).toBe('function');
	});

	it('treats rem/percentage template expressions in JSX styles as non-px under AST analysis', () => {
		const source = [
			'export function Progress({depth, pct}: {depth: number; pct: number}) {',
			`\treturn <div style={{paddingInlineStart: \`$\{'0.5 + depth * 0.75'}rem\`, width: \`$\{'pct'}%\`}} />;`,
			'}',
		].join('\n');
		const result = lintFileWithPipeline('src/Progress.tsx', source, 'all', {linters: ['px']});
		expect(result.problems).toEqual([]);
	});

	it('evaluates multi-linter reviewed catalog staleness and suppression metrics in one pass', () => {
		const catalog = ReviewedLintCatalog.fromEntries([
			new ReviewedLintEntry({
				linter: 'web-safety',
				rule: 'raw-web-storage',
				file: 'fluxer_app/src/Sample.tsx',
				enclosing: 'Sample',
				symbol: 'localStorage',
				reason: 'reviewed upstream exception',
			}),
			new ReviewedLintEntry({
				linter: 'string',
				rule: 'string-lint',
				file: 'fluxer_app/src/Sample.tsx',
				enclosing: 'Other',
				target: 'JSX text',
				reason: 'stale entry that no longer matches',
			}),
		]);

		lintFileWithPipeline(
			'src/Sample.tsx',
			['export function Sample() {', '\tlocalStorage.setItem("a", "b");', '\treturn <div />;', '}'].join('\n'),
			'all',
			{linters: ALL_MONOREPO_LINTERS, reviewed: catalog},
		);

		const summary = evaluateReviewedForLinters(catalog, ['web-safety', 'string']);
		expect(summary.totalSuppressed).toBe(1);
		expect(summary.byLinter.get('web-safety')?.suppressed).toBe(1);
		expect(summary.byLinter.get('web-safety')?.staleEntries).toEqual([]);
		expect(summary.allStaleEntries).toHaveLength(1);
		expect(summary.allStaleEntries[0].linter).toBe('string');
		expect(typeof runForkLintCli).toBe('function');
		expect(reviewedCatalogExists()).toBe(true);
	});

	it('produces per-linter violations and staleReviewed entries in a single --audit-json pass', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-lint-audit-'));
		try {
			const catalogPath = path.join(tmpDir, 'reviewed.json');
			fs.writeFileSync(
				catalogPath,
				JSON.stringify({
					version: 1,
					entries: [
						{
							linter: 'web-safety',
							rule: 'raw-web-storage',
							file: 'fluxer_app/src/Missing.tsx',
							enclosing: 'Missing',
							symbol: 'localStorage',
							reason: 'deliberately stale for test',
						},
					],
				}),
			);

			const stdout = execFileSync(
				'node',
				[
					SCRIPT_PATH,
					'--linter',
					'render-fetch,web-safety',
					'--reviewed',
					catalogPath,
					'--audit-json',
					'src/features/messaging/components/markdown/renderers/MentionRenderer.tsx',
				],
				{
					cwd: path.resolve(import.meta.dirname, '../../../..'),
					encoding: 'utf8',
				},
			);
			const payload = JSON.parse(stdout);
			expect(payload.linters['render-fetch'].violations).toEqual([]);
			expect(payload.linters['web-safety'].violations).toHaveLength(1);
			expect(payload.linters['web-safety'].violations[0]).toContain('[messages-untracked-read]');
			expect(payload.linters['web-safety'].staleReviewed).toHaveLength(1);
			expect(payload.linters['web-safety'].staleReviewed[0]).toContain('Stale reviewed entry:');
		} finally {
			fs.rmSync(tmpDir, {recursive: true, force: true});
		}
	});

	it('restricts CSS passes to fluxer_app/src stylesheets', () => {
		const desktopCss = lintFileWithPipeline('fluxer_desktop/src/splash/index.css', '.splash { width: 92px; }', 'all', {
			linters: ['px', 'web-safety'],
		});
		expect(desktopCss.problems).toEqual([]);

		const appCss = lintFileWithPipeline('src/Example.module.css', '.box { width: 24px; }', 'all', {
			linters: ['px'],
		});
		expect(appCss.problems).toEqual(['src/Example.module.css:1: 24px']);
	});
});
