// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests of scripts/fork-px-lint.mjs, the check that the fork's web code writes sizes in rem as upstream
// does, so the desktop app's zoom reaches them (tyne-chat/tyne#637).

import {describe, expect, it} from 'vitest';
import {lintSource} from '../../../../scripts/fork-px-lint.mjs';

const css = (source: string, lines: 'all' | Set<number> = 'all'): Array<string> =>
	lintSource('src/Example.module.css', source, lines);
const tsx = (source: string, lines: 'all' | Set<number> = 'all'): Array<string> =>
	lintSource('src/Example.tsx', source, lines);

describe('fork-px-lint', () => {
	it('reports every px size in CSS, borders, shadows, outlines and radii included', () => {
		expect(
			css(
				[
					'.box {',
					'\tmax-height: 490px;',
					'\tpadding: 0.5rem 12px;',
					'\tborder: 1px solid var(--border-color);',
					'\tbox-shadow: 0 8px 16px rgb(0 0 0 / 0.24);',
					'\toutline: 2px solid var(--focus);',
					'\tborder-radius: 9999px;',
					'\tmargin-top: -2px;',
					'\twidth: calc(100% - 20px);',
					'}',
				].join('\n'),
			),
		).toEqual([
			'src/Example.module.css:2: max-height: 490px',
			'src/Example.module.css:3: padding: 12px',
			'src/Example.module.css:4: border: 1px',
			'src/Example.module.css:5: box-shadow: 8px',
			'src/Example.module.css:5: box-shadow: 16px',
			'src/Example.module.css:6: outline: 2px',
			'src/Example.module.css:7: border-radius: 9999px',
			'src/Example.module.css:8: margin-top: 2px',
			'src/Example.module.css:9: width: 20px',
		]);
	});

	it('leaves 0px, @media queries, comments, names and rem alone, but checks @container queries', () => {
		expect(
			css(
				[
					'/* Below a 640px window,',
					'   the 12px gap goes. */',
					'@media (max-width: 520px) {',
					'\t.box {',
					'\t\tpadding: 0px 0.5rem; /* was 8px */',
					'\t\twidth: var(--size-16px, 22.5rem);',
					'\t\tborder-radius: var(--radius-full);',
					'\t}',
					'}',
					'@container (max-width: 640px) {',
					'}',
				].join('\n'),
			),
		).toEqual(['src/Example.module.css:10: 640px']);
	});

	it('reports px literals and bare numbers in style objects, not computed values or a bare lineHeight', () => {
		expect(
			tsx(
				[
					"const a = <div style={{width: 16, height: '12px', border: '1px solid red', lineHeight: 1.2}} />;",
					"const narrow = window.matchMedia('(max-height: 680px)').matches;",
					`const b = <div style={{width: \`\${rect.width}px\`, height: remFromPx(16)}} />;`,
					'const c = <div',
					'\tstyle={{',
					'\t\tmarginTop: 6,',
					'\t\topacity: 0.5,',
					'\t}}',
					'/>;',
				].join('\n'),
			),
		).toEqual([
			'src/Example.tsx:1: width: 16 (px)',
			'src/Example.tsx:1: literal 12px',
			'src/Example.tsx:1: literal 1px',
			'src/Example.tsx:2: literal 680px',
			'src/Example.tsx:6: marginTop: 6 (px)',
		]);
	});

	it('reads style values as expressions: ternaries, negative numbers and logical properties', () => {
		expect(
			tsx(
				[
					'const a = <div style={{marginBottom: tagError ? 2 : 0, marginTop: -2}} />;',
					'const b = <div style={{insetInlineStart: 4, inlineSize: 40, borderTopLeftRadius: 3}} />;',
					'const c = <div style={{gap: remFromPx(8), width: Math.max(4, size), opacity: 0.5, zIndex: 3}} />;',
				].join('\n'),
			),
		).toEqual([
			'src/Example.tsx:1: marginBottom: 2 (px)',
			'src/Example.tsx:1: marginTop: 2 (px)',
			'src/Example.tsx:2: insetInlineStart: 4 (px)',
			'src/Example.tsx:2: inlineSize: 40 (px)',
			'src/Example.tsx:2: borderTopLeftRadius: 3 (px)',
		]);
	});

	it('finds px in every string, and none in comments or regular expressions', () => {
		expect(
			tsx(
				[
					"const a = {href: 'https://example.test', width: '12px', top: '-2px'};",
					"const b = 1; /* was '12px' */ // and '8px'",
					'const c = /\\d+px/.test(value);',
					'const d = `calc(100% -',
					'\t20px)`;',
					`const e = \`\${size}px \${remFromPx(4)}\`;`,
				].join('\n'),
			),
		).toEqual(['src/Example.tsx:1: literal 12px', 'src/Example.tsx:1: literal 2px', 'src/Example.tsx:5: literal 20px']);
	});

	it('leaves numbers outside style objects alone, such as Floating UI options', () => {
		expect(tsx('const middleware = [flip({padding: 16}), shift({padding: 8}), offset(4)];')).toEqual([]);
	});

	it('accepts px-ok on the line or the line above', () => {
		expect(
			css(['.a {', '\t/* px-ok: a reason. */', '\twidth: 15px;', '\theight: 8px; /* px-ok: same */', '}'].join('\n')),
		).toEqual([]);
		expect(tsx("const margin = {rootMargin: '200px'}; // px-ok: rootMargin takes px or %, never rem")).toEqual([]);
	});

	it('lets a px-ok comment above a CSS rule cover the whole rule, and only that rule', () => {
		expect(
			css(
				[
					'/* A seam strip in device pixels.',
					'   px-ok: device pixels. */',
					'.strip::before {',
					'\tinset-block-start: -1px;',
					'\tborder: 2px solid;',
					'}',
					'.next {',
					'\twidth: 4px;',
					'}',
				].join('\n'),
			),
		).toEqual(['src/Example.module.css:8: width: 4px']);
	});

	it("checks only the fork's lines when given them", () => {
		expect(css(['.a {', '\twidth: 40px;', '\theight: 40px;', '}'].join('\n'), new Set([3]))).toEqual([
			'src/Example.module.css:3: height: 40px',
		]);
	});
});
