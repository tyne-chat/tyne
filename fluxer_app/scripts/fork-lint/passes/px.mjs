// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 4 pass `px` consuming shared `CssStylesheetIR` (`.css`) and `TsModuleIR` (`.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`)
// instead of running a separate regex/character-array lexer.

import {identName, unwrapTsExpr} from '../ir-ts.mjs';
import {findPositivePxMatches} from '../source-unit.mjs';

export const ALL_PX_RULES = new Set(['px-lint']);

const STYLE_KEY_RE =
	/^(width|height|(?:min|max)(?:Width|Height|InlineSize|BlockSize)|inlineSize|blockSize|top|right|bottom|left|inset\w*|margin\w*|padding\w*|gap|rowGap|columnGap|fontSize|letterSpacing|textIndent|border\w*Radius|border\w*Width|outlineWidth|outlineOffset|flexBasis)$/;

function isStyleObjectExpression(node, parent, parentMap) {
	if (node.type !== 'ObjectExpression' || !parent) return false;
	if (parent.type === 'JSXExpressionContainer') {
		const attr = parentMap.get(parent);
		return attr?.type === 'JSXAttribute' && identName(attr.name) === 'style';
	}
	if (parent.type === 'ObjectProperty' && !parent.computed && parent.value === node) {
		return identName(parent.key) === 'style';
	}
	if (parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression') {
		const idx = parent.arguments.indexOf(node);
		if (idx > 0) {
			const prev = parent.arguments[idx - 1];
			return (
				(prev?.type === 'MemberExpression' || prev?.type === 'OptionalMemberExpression') &&
				!prev.computed &&
				identName(prev.property) === 'style'
			);
		}
	}
	return false;
}

function collectStyleNumbersFromExpr(expr, keyName, out) {
	if (!expr) return;
	let cur = expr;
	while (
		cur &&
		(cur.type === 'ParenthesizedExpression' ||
			cur.type === 'TSAsExpression' ||
			cur.type === 'TSTypeAssertion' ||
			cur.type === 'TSNonNullExpression' ||
			cur.type === 'TSSatisfiesExpression')
	) {
		cur = cur.expression;
	}
	if (!cur) return;
	if (cur.type === 'NumericLiteral') {
		if (cur.value > 0) {
			out.push({offset: cur.start, problem: `${keyName}: ${cur.value} (px)`});
		}
		return;
	}
	if (cur.type === 'UnaryExpression' && (cur.operator === '-' || cur.operator === '+')) {
		const inner = unwrapTsExpr(cur.argument);
		if (inner?.type === 'NumericLiteral' && inner.value > 0) {
			out.push({offset: inner.start, problem: `${keyName}: ${inner.value} (px)`});
		}
		return;
	}
	if (cur.type === 'ConditionalExpression') {
		collectStyleNumbersFromExpr(cur.consequent, keyName, out);
		collectStyleNumbersFromExpr(cur.alternate, keyName, out);
		return;
	}
	if (cur.type === 'LogicalExpression') {
		collectStyleNumbersFromExpr(cur.left, keyName, out);
		collectStyleNumbersFromExpr(cur.right, keyName, out);
	}
}

/**
 * Checks CSS files for `px` sizes using shared `CssStylesheetIR`.
 * @param {{
 *   sourceUnit: import('../source-unit.mjs').SourceUnit;
 *   rules?: Set<string>;
 *   reviewed: import('../../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   report: (linter: string, message: string) => void;
 * }} ctx
 */
export function runPxCssPass({sourceUnit, rules = ALL_PX_RULES, reviewed, report}) {
	if (!rules.has('px-lint')) return;
	const directives = sourceUnit.getDirectives();
	const cssIR = sourceUnit.getCssIR();

	for (const entry of cssIR.entries) {
		if (entry.inMarkedPxOkRule) continue;
		if (!sourceUnit.isLineEnabled(entry.line) || directives.pxOkLines.has(entry.line)) continue;
		if (entry.isMediaQuery) continue;
		for (const match of findPositivePxMatches(entry.code)) {
			const problem = entry.declProperty ? `${entry.declProperty}: ${match.label}` : match.label;
			if (
				reviewed?.matches({
					linter: 'px',
					rule: 'px-lint',
					file: sourceUnit.repoFile,
					enclosing: '',
					target: problem,
					sourceLine: entry.trimmedRaw,
				})
			) {
				continue;
			}
			report('px', `${sourceUnit.displayFile}:${entry.line}: ${problem}`);
		}
	}
}

/**
 * Creates Stage 4 AST hooks for `px-lint` on JS/TS/JSX/TSX using shared `TsModuleIR`.
 * @param {{
 *   tsIR: ReturnType<import('../ir-ts.mjs').parseAndBuildTsModuleIR>;
 *   rules?: Set<string>;
 *   reviewed: import('../../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   report: (linter: string, message: string) => void;
 * }} ctx
 */
export function createPxAstPass({tsIR, rules = ALL_PX_RULES, reviewed, report}) {
	if (!rules.has('px-lint')) return {};
	const {sourceUnit, directives, parentMap} = tsIR;
	const {source, displayFile, repoFile} = sourceUnit;
	const found = [];

	return {
		enter(node) {
			if (node.type === 'StringLiteral' && typeof node.start === 'number' && typeof node.end === 'number') {
				const rawInner = node.end - node.start >= 2 ? source.slice(node.start + 1, node.end - 1) : '';
				for (const m of findPositivePxMatches(rawInner)) {
					found.push({offset: node.start + 1 + m.index, problem: `literal ${m.label}`});
				}
				return;
			}
			if (node.type === 'TemplateElement' && typeof node.start === 'number') {
				const rawText = node.value?.raw ?? '';
				for (const m of findPositivePxMatches(rawText)) {
					found.push({offset: node.start + m.index, problem: `literal ${m.label}`});
				}
				return;
			}
			if (node.type === 'ObjectExpression' && isStyleObjectExpression(node, parentMap.get(node), parentMap)) {
				for (const prop of node.properties) {
					if (prop.type !== 'ObjectProperty' || prop.computed) continue;
					const keyName = identName(prop.key);
					if (keyName && STYLE_KEY_RE.test(keyName)) {
						collectStyleNumbersFromExpr(prop.value, keyName, found);
					}
				}
			}
		},
		afterAst() {
			found.sort((a, b) => a.offset - b.offset);
			for (const {offset, problem} of found) {
				const {line} = sourceUnit.lineColOf(offset);
				if (!sourceUnit.isLineEnabled(line) || directives.pxOkLines.has(line)) continue;
				if (
					reviewed?.matches({
						linter: 'px',
						rule: 'px-lint',
						file: repoFile,
						enclosing: '',
						target: problem,
						sourceLine: sourceUnit.sourceLineAt(line).trim(),
					})
				) {
					continue;
				}
				report('px', `${displayFile}:${line}: ${problem}`);
			}
		},
	};
}
