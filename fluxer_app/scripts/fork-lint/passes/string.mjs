// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 4 pass `string` consuming shared `TsModuleIR` (`parentMap`, `enclosingSymbol`, directives).

import {identName, isFunctionNode, rootIdentName} from '../ir-ts.mjs';

export const ALL_STRING_RULES = new Set(['string-lint']);

const UI_NAME_RE =
	/^(children|title|subtitle|label|placeholder|alt|description|tooltip|text|caption|heading|hint|helperText|emptyText|displayName|aria-label|aria-description|aria-valuetext|aria-roledescription|aria-placeholder)$|(Label|Title|Text|Message|Msg|Description|Placeholder|Tooltip|Hint|Caption|Heading)$/;
const NOT_UI_NAME_RE = /^(debug|log|diagnostic|persistFailure|statusText$)/;
const UI_CALL_RE =
	/^(toast|alert|confirm|prompt|announce|createSystemMessage|setError|set\w*(Error|Message|Text|Label|Title|Status))$/;
const TOAST_OBJECT_RE = /^(Toast|toast)\w*$/;
const TOAST_METHOD_RE = /^(error|success|info|warning|warn|show|message)$/;
const TRANSLATED_CALL_RE = /^(msg|t|defineMessage|plural|select|selectOrdinal|_)$/;
const NOT_SHOWN_OBJECT_RE = /^(console|logger|log|Logger|LOG|Sentry)$/;
const NOT_SHOWN_CALL_RE =
	/^(runWithResponseDeadline|cancelResponseBodyAndThrow|readBoundedResponseBlob|readBoundedResponseArrayBuffer|runAndWait|syncScreenSharePublication|refreshScreenSharePublicationSubscription|resubscribeScreenSharePublication|applyScreenShareViewerDemand|releaseScreenShareViewerDemand|mixTrackWithSelfWindowScreenShareAudio)$/;
const TRANSLATED_ELEMENTS = new Set(['Trans', 'Plural', 'Select', 'SelectOrdinal']);
const TRANSPARENT = new Set([
	'ConditionalExpression',
	'LogicalExpression',
	'BinaryExpression',
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'ParenthesizedExpression',
	'TemplateLiteral',
	'ArrayExpression',
	'SequenceExpression',
]);

function isUiName(name) {
	return UI_NAME_RE.test(name) && !NOT_UI_NAME_RE.test(name);
}

function textOf(node) {
	if (node.type === 'StringLiteral') return node.value;
	if (node.type === 'JSXText') return node.value;
	return node.quasis.map((quasi) => quasi.value.cooked ?? '').join('');
}

function looksLikeProse(text) {
	const trimmed = text.trim();
	if (!/\p{L}{2,}/u.test(trimmed)) return false;
	if (/^(https?:|mailto:|\/|#|\.)/.test(trimmed)) return false;
	if (/^\p{Lu}\p{Ll}+(\p{Lu}\p{Ll}*)+$/u.test(trimmed)) return false;
	return /\s/.test(trimmed) || /^\p{Lu}\p{Ll}/u.test(trimmed);
}

function isTechnicalToken(text) {
	const trimmed = text.trim();
	if (/^@(everyone|here)$/.test(trimmed)) return true;
	if (/^(https?:|mailto:|\/)/.test(trimmed)) return true;
	if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed)) return true;
	return false;
}

function isConstantIdentityMap(objExpr) {
	if (objExpr?.type !== 'ObjectExpression' || objExpr.properties.length < 2) return false;
	for (const prop of objExpr.properties) {
		if (
			prop.type !== 'ObjectProperty' ||
			prop.computed ||
			prop.key?.type !== 'Identifier' ||
			prop.value?.type !== 'StringLiteral' ||
			prop.value.value !== prop.key.name
		) {
			return false;
		}
	}
	return true;
}

function holderLine(node, line, parentMap) {
	let cur = parentMap.get(node);
	while (cur) {
		if (
			/(Statement|Declaration|Declarator)$/.test(cur.type) ||
			cur.type === 'ObjectProperty' ||
			cur.type === 'JSXAttribute' ||
			cur.type === 'ClassProperty'
		) {
			return line - cur.loc.start.line <= 3 ? cur.loc.start.line : -1;
		}
		cur = parentMap.get(cur);
	}
	return -1;
}

function isExcluded(literal, parentMap, {stopAtFunction = false} = {}) {
	const chain = [];
	let anc = parentMap.get(literal);
	while (anc) {
		if (stopAtFunction && isFunctionNode(anc)) break;
		chain.push(anc);
		anc = parentMap.get(anc);
	}
	// Walk top-down (Program -> literal's parent) so `<Trans>` inner container slicing matches.
	chain.reverse();
	for (let index = 0; index < chain.length; index++) {
		const node = chain[index];
		if (!stopAtFunction && node.type === 'JSXElement' && TRANSLATED_ELEMENTS.has(identName(node.openingElement.name))) {
			const containers = chain.slice(index + 1).filter((inner) => inner.type === 'JSXExpressionContainer');
			if (containers.length === 0) return true;
			if (containers.length === 1 && chain.at(-1) === containers[0]) return true;
			continue;
		}
		if (node.type === 'TaggedTemplateExpression') return true;
		if (node.type === 'CallExpression' || node.type === 'NewExpression' || node.type === 'OptionalCallExpression') {
			const callee = identName(node.callee);
			if (TRANSLATED_CALL_RE.test(callee ?? '')) return true;
			if (NOT_SHOWN_OBJECT_RE.test(rootIdentName(node.callee) ?? '')) return true;
			if (NOT_SHOWN_CALL_RE.test(callee ?? '')) return true;
			if (node.type === 'NewExpression' && /Error$/.test(callee ?? '')) return true;
		}
		if (node.type === 'TSLiteralType' || node.type === 'TSEnumMember' || node.type === 'ImportDeclaration') return true;
	}
	return false;
}

function sinkOf(literal, tsIR) {
	const {parentMap} = tsIR;
	let child = literal;
	let parent = parentMap.get(literal);
	while (parent && TRANSPARENT.has(parent.type)) {
		if (parent.type === 'ConditionalExpression' && parent.test === child) return undefined;
		if (parent.type === 'BinaryExpression' && parent.operator !== '+') return undefined;
		child = parent;
		parent = parentMap.get(parent);
	}
	if (!parent) return undefined;
	const loose = literal.type === 'JSXText' || child !== literal;
	switch (parent.type) {
		case 'JSXElement':
		case 'JSXFragment':
			return 'JSX text';
		case 'JSXExpressionContainer': {
			const holder = parentMap.get(parent);
			if (holder?.type === 'JSXElement' || holder?.type === 'JSXFragment') return 'JSX child';
			if (holder?.type === 'JSXAttribute' && isUiName(identName(holder.name) ?? '')) {
				return `prop ${identName(holder.name)}`;
			}
			return undefined;
		}
		case 'JSXAttribute':
			return isUiName(identName(parent.name) ?? '') && (loose || looksLikeProse(textOf(literal)))
				? `prop ${identName(parent.name)}`
				: undefined;
		case 'VariableDeclarator':
			if (parent.init !== child || !isUiName(identName(parent.id) ?? '')) return undefined;
			if (tsIR.localVarFlowsOnlyTo(parent, (refNode) => isExcluded(refNode, parentMap, {stopAtFunction: true}))) {
				return undefined;
			}
			return `variable ${identName(parent.id)}`;
		case 'AssignmentExpression':
			return parent.right === child && parent.left.type === 'Identifier' && isUiName(parent.left.name)
				? `variable ${identName(parent.left)}`
				: undefined;
		case 'ObjectProperty':
			if (parent.value !== child || parent.computed) return undefined;
			if (isConstantIdentityMap(parentMap.get(parent))) return undefined;
			return isUiName(identName(parent.key) ?? '') ? `key ${identName(parent.key)}` : undefined;
		case 'CallExpression':
		case 'OptionalCallExpression': {
			if (!parent.arguments.includes(child)) return undefined;
			const callee = identName(parent.callee) ?? '';
			if (UI_CALL_RE.test(callee)) return `${callee}()`;
			if (TOAST_METHOD_RE.test(callee) && TOAST_OBJECT_RE.test(rootIdentName(parent.callee) ?? '')) {
				return `${rootIdentName(parent.callee)}.${callee}()`;
			}
			return undefined;
		}
		default:
			return undefined;
	}
}

/**
 * Creates Stage 4 AST hooks for `string-lint`.
 * @param {{
 *   tsIR: ReturnType<import('../ir-ts.mjs').parseAndBuildTsModuleIR>;
 *   rules?: Set<string>;
 *   reviewed: import('../../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   report: (linter: string, message: string) => void;
 * }} ctx
 */
export function createStringAstPass({tsIR, rules = ALL_STRING_RULES, reviewed, report}) {
	if (!rules.has('string-lint')) return {};
	const {sourceUnit, directives, parentMap} = tsIR;
	const {displayFile, repoFile} = sourceUnit;
	const ignored = directives.i18nIgnored;

	return {
		enter(node) {
			if (node.type !== 'StringLiteral' && node.type !== 'TemplateLiteral' && node.type !== 'JSXText') return;
			const parent = parentMap.get(node);
			const nested = node.type !== 'JSXText' && parent?.type === 'TemplateLiteral';
			const text = textOf(node);
			const line = node.loc?.start.line;
			if (
				!nested &&
				/\p{L}/u.test(text) &&
				!isTechnicalToken(text) &&
				sourceUnit.isLineEnabled(line) &&
				!ignored.has(line) &&
				!ignored.has(holderLine(node, line, parentMap))
			) {
				const sink = sinkOf(node, tsIR);
				const strict = sink?.startsWith('key ') || sink?.startsWith('variable ') || sink?.endsWith('()');
				if (sink && !(strict && !looksLikeProse(text)) && !isExcluded(node, parentMap)) {
					const shown = text.trim().replace(/\s+/g, ' ');
					if (
						reviewed?.matches({
							linter: 'string',
							rule: 'string-lint',
							file: repoFile,
							enclosing: tsIR.enclosingSymbol(node),
							symbol: shown,
							target: sink,
							sourceLine: sourceUnit.sourceLineAt(line).trim(),
						})
					) {
						return;
					}
					report('string', `${displayFile}:${line}:${node.loc.start.column + 1}: ${sink}: ${JSON.stringify(shown)}`);
				}
			}
		},
	};
}
