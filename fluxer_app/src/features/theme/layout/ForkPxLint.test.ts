// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests of scripts/fork-px-lint.mjs, the check for px sizes in the fork's web code, which the desktop
// app's zoom does not reach (tyne-chat/tyne#637).

import {describe, expect, it} from 'vitest';
import {lintSource} from '../../../../scripts/fork-px-lint.mjs';

const css = (source: string, lines: 'all' | Set<number> = 'all'): Array<string> =>
	lintSource('src/Example.module.css', source, lines);
const tsx = (source: string, lines: 'all' | Set<number> = 'all'): Array<string> =>
	lintSource('src/Example.tsx', source, lines);

describe('fork-px-lint', () => {
	it('reports px sizes in CSS declarations', () => {
		expect(
			css(
				[
					'.box {',
					'\tmax-height: 490px;',
					'\tpadding: 0.5rem 12px;',
					'\tfont-size: 13px;',
					'\tborder-radius: 6px;',
					'\twidth: calc(100% - 20px);',
					'}',
				].join('\n'),
			),
		).toEqual([
			'src/Example.module.css:2: max-height: 490px',
			'src/Example.module.css:3: padding: 12px',
			'src/Example.module.css:4: font-size: 13px',
			'src/Example.module.css:5: border-radius: 6px',
			'src/Example.module.css:6: width: 20px',
		]);
	});

	it('leaves hairlines, borders, shadows, outlines, pills, media queries and rem alone', () => {
		expect(
			css(
				[
					'@media (max-width: 520px) {',
					'\t.box {',
					'\t\tborder: 1px solid var(--border-color);',
					'\t\tborder-top: 2px solid red;',
					'\t\tbox-shadow: 0 8px 16px rgb(0 0 0 / 0.24);',
					'\t\toutline: 2px solid var(--focus);',
					'\t\tborder-radius: 9999px;',
					'\t\tmargin: 1px 0.5rem;',
					'\t\theight: 0.5px;',
					'\t\twidth: 22.5rem;',
					'\t}',
					'}',
				].join('\n'),
			),
		).toEqual([]);
	});

	it('reports px literals and bare numbers in style objects, not computed values', () => {
		expect(
			tsx(
				[
					"const a = <div style={{width: 16, height: '12px', borderRadius: '50%'}} />;",
					"const narrow = window.matchMedia('(max-height: 680px)').matches;",
					`const b = <div style={{width: \`\${rect.width}px\`}} />;`,
					'const c = <div',
					'\tstyle={{',
					'\t\tmarginTop: 6,',
					'\t\topacity: 0.5,',
					'\t}}',
					'/>;',
					"const d = <div style={{padding: '0.5rem 1rem'}} />;",
				].join('\n'),
			),
		).toEqual([
			'src/Example.tsx:1: literal 12px',
			'src/Example.tsx:1: width: 16 (px)',
			'src/Example.tsx:2: literal 680px',
			'src/Example.tsx:6: marginTop: 6 (px)',
		]);
	});

	it('leaves numbers outside style objects alone, such as Floating UI options', () => {
		expect(tsx('const middleware = [flip({padding: 16}), shift({padding: 8}), offset(4)];')).toEqual([]);
	});

	it('accepts px-ok on the line or the line above', () => {
		expect(
			css(
				[
					'.edge {',
					'\t/* px-ok: a pointer hit zone. */',
					'\twidth: 15px;',
					'\theight: 8px; /* px-ok: same */',
					'}',
				].join('\n'),
			),
		).toEqual([]);
		expect(tsx("const margin = {rootMargin: '200px'}; // px-ok: an observer's margin in screen pixels")).toEqual([]);
	});

	it("checks only the fork's lines when given them", () => {
		expect(css(['.a {', '\twidth: 40px;', '\theight: 40px;', '}'].join('\n'), new Set([3]))).toEqual([
			'src/Example.module.css:3: height: 40px',
		]);
	});
});
