// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 4 pass `render-fetch` consuming `TsModuleIR` (`renderFetchMode`) in the shared walk.

import {identName, isCoreFunctionNode, rootIdentName} from '../ir-ts.mjs';

export const ALL_RENDER_FETCH_RULES = new Set(['render-fetch', 'effect-no-deps-fetch']);

const HTTP_OBJECT_RE = /^(http|instanceHttp|restClient|apiClient)$/i;
const HTTP_METHOD_RE = /^(get|post|put|patch|delete|head|request)$/;
const FETCH_METHOD_RE = /^fetch[A-Z]\w*$/;

function describeNetworkCall(callNode) {
	const callee = callNode.callee;
	if (!callee) return undefined;
	if (callee.type === 'Identifier') {
		if (callee.name === 'fetch' || FETCH_METHOD_RE.test(callee.name)) {
			return `${callee.name}()`;
		}
		return undefined;
	}
	if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
		const obj = rootIdentName(callee);
		const prop = identName(callee.property);
		if (!obj || !prop) return undefined;
		if (HTTP_OBJECT_RE.test(obj) && HTTP_METHOD_RE.test(prop)) {
			return `${obj}.${prop}()`;
		}
		if (FETCH_METHOD_RE.test(prop) && /(Commands|Store|Service|Client|API|Directory)$/.test(obj)) {
			return `${obj}.${prop}()`;
		}
	}
	return undefined;
}

/**
 * Creates Stage 4 AST hooks for `render-fetch` and `effect-no-deps-fetch`.
 * @param {{
 *   tsIR: ReturnType<import('../ir-ts.mjs').parseAndBuildTsModuleIR>;
 *   rules?: Set<string>;
 *   reviewed: import('../../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   report: (linter: string, message: string) => void;
 * }} ctx
 */
export function createRenderFetchAstPass({tsIR, rules = ALL_RENDER_FETCH_RULES, reviewed, report}) {
	const {sourceUnit, directives} = tsIR;
	const {displayFile, repoFile} = sourceUnit;
	const ignored = directives.renderFetchIgnored;
	const modeStack = ['other'];

	return {
		enter(node) {
			if (isCoreFunctionNode(node)) {
				modeStack.push(tsIR.functionIRMap.get(node)?.renderFetchMode ?? 'other');
			}
			if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
				const mode = modeStack.at(-1);
				if (
					(mode === 'render' || mode === 'effect-no-deps') &&
					rules.has(mode === 'render' ? 'render-fetch' : 'effect-no-deps-fetch')
				) {
					const desc = describeNetworkCall(node);
					const line = node.loc?.start.line;
					if (desc && sourceUnit.isLineEnabled(line) && !ignored.has(line)) {
						const col = (node.loc?.start.column ?? 0) + 1;
						const rule = mode === 'render' ? 'render-fetch' : 'effect-no-deps-fetch';
						if (
							reviewed?.matches({
								linter: 'render-fetch',
								rule,
								file: repoFile,
								enclosing: tsIR.enclosingSymbol(node),
								target: desc,
								sourceLine: sourceUnit.sourceLineAt(line).trim(),
							})
						) {
							return;
						}
						if (mode === 'render') {
							report(
								'render-fetch',
								`${displayFile}:${line}:${col}: [render-fetch] network call \`${desc}\` inside React render/hook body (move into useEffect with deps or an event handler; tyne-chat/tyne#114)`,
							);
						} else {
							report(
								'render-fetch',
								`${displayFile}:${line}:${col}: [effect-no-deps-fetch] network call \`${desc}\` inside useEffect without a dependency array (runs after every render; tyne-chat/tyne#114)`,
							);
						}
					}
				}
			}
		},
		leave(node) {
			if (isCoreFunctionNode(node)) {
				modeStack.pop();
			}
		},
	};
}
