// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 4 pass `web-safety` consuming `SourceUnit`, `CssStylesheetIR`, and `TsModuleIR`.

import {
	identName,
	isCoreFunctionNode,
	isObservableStorePropCandidate,
	nodeInBindingTarget,
	SNAPSHOT_PROP_RE,
	traverseAst,
	unwrapTsExpr,
} from '../ir-ts.mjs';

export const ALL_WEB_SAFETY_RULES = new Set([
	'missing-observer',
	'mobx-stale-memo',
	'uncaptured-timer',
	'effect-missing-cleanup',
	'raw-web-storage',
	'messages-untracked-read',
	'zoom-blind-viewport',
]);

const REACTIVITY_DEP_RE = /(version|epoch|revision|tick|count)/i;
const CSS_MEDIA_PX_RE = /^\s*@media\b.*\b(min|max)-(width|height)\s*:\s*\d+(?:\.\d+)?px\b/i;

function depsHasIdentifier(depsNode, targetIdent) {
	let found = false;
	traverseAst(depsNode, (n) => {
		if (found) return;
		if (n.type === 'Identifier' && n.name === targetIdent) {
			found = true;
		}
	});
	return found;
}

function isDepsTrackingStore(depsNode, depsSrc, storeIdent) {
	if (REACTIVITY_DEP_RE.test(depsSrc)) return true;
	return depsHasIdentifier(depsNode, storeIdent);
}

function isPhysicalDeviceCheck(expr) {
	if (!expr) return false;
	if (
		(expr.type === 'MemberExpression' || expr.type === 'OptionalMemberExpression') &&
		!expr.computed &&
		expr.object?.type === 'Identifier' &&
		expr.object.name === 'Platform' &&
		expr.property?.type === 'Identifier' &&
		(expr.property.name === 'isMobileDevice' || expr.property.name === 'isTabletDevice')
	) {
		return true;
	}
	if (expr.type === 'LogicalExpression') {
		if (expr.operator === '&&') {
			return isPhysicalDeviceCheck(expr.left) || isPhysicalDeviceCheck(expr.right);
		}
		if (expr.operator === '||') {
			return isPhysicalDeviceCheck(expr.left) && isPhysicalDeviceCheck(expr.right);
		}
	}
	return false;
}

function isInsidePhysicalDeviceGuard(parentMap, node) {
	let child = node;
	let anc = parentMap.get(node);
	while (anc) {
		if (isCoreFunctionNode(anc)) break;
		if (
			(anc.type === 'IfStatement' || anc.type === 'ConditionalExpression') &&
			anc.consequent === child &&
			isPhysicalDeviceCheck(anc.test)
		) {
			return true;
		}
		if (
			anc.type === 'LogicalExpression' &&
			anc.operator === '&&' &&
			anc.right === child &&
			isPhysicalDeviceCheck(anc.left)
		) {
			return true;
		}
		child = anc;
		anc = parentMap.get(anc);
	}
	return false;
}

/**
 * Checks CSS `@media` pixel queries using shared `CssStylesheetIR`.
 * @param {{
 *   sourceUnit: import('../source-unit.mjs').SourceUnit;
 *   rules: Set<string>;
 *   reviewed: import('../../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   report: (linter: string, message: string) => void;
 * }} ctx
 */
export function runWebSafetyCssPass({sourceUnit, rules, reviewed, report}) {
	if (!rules.has('zoom-blind-viewport')) return;
	const directives = sourceUnit.getDirectives();
	const cssIR = sourceUnit.getCssIR();
	for (const entry of cssIR.entries) {
		if (!sourceUnit.isLineEnabled(entry.line)) continue;
		if (directives.webSafetyIgnored.has(entry.line) || directives.pxOkLines.has(entry.line)) continue;
		if (CSS_MEDIA_PX_RE.test(entry.rawLine)) {
			const trimmed = entry.trimmedRaw;
			if (
				reviewed?.matches({
					linter: 'web-safety',
					rule: 'zoom-blind-viewport',
					file: sourceUnit.repoFile,
					enclosing: '',
					symbol: trimmed,
					target: '@media',
					sourceLine: trimmed,
				})
			) {
				continue;
			}
			report(
				'web-safety',
				`${sourceUnit.displayFile}:${entry.line}:1: [zoom-blind-viewport] CSS @media pixel query \`${trimmed}\` ignores desktop zoom (use @container in rem or mark with \`/* px-ok: <reason> */\`; tyne-chat/tyne#639)`,
			);
		}
	}
}

/**
 * Creates Stage 4 AST hooks for all `web-safety` rules using `TsModuleIR`.
 * @param {{
 *   tsIR: ReturnType<import('../ir-ts.mjs').parseAndBuildTsModuleIR>;
 *   rules: Set<string>;
 *   reviewed: import('../../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   report: (linter: string, message: string) => void;
 * }} ctx
 */
export function createWebSafetyAstPass({tsIR, rules, reviewed, report}) {
	const {sourceUnit, directives, mobxImports, messagesIdent, mobxReactiveHelpers, parentMap} = tsIR;
	const {source, displayFile, repoFile} = sourceUnit;
	const ignored = directives.webSafetyIgnored;
	const allowRawStorage = displayFile.includes('src/features/platform/state/');
	const isChannelMessagesCacheHost = displayFile.endsWith('src/features/channel/components/ChannelMessages.tsx');

	const fnStack = [];
	const compStack = [];

	const pushProblem = (rule, line, col, message, meta = {}) => {
		const sourceLine = sourceUnit.sourceLineAt(line).trim();
		if (
			reviewed?.matches({
				linter: 'web-safety',
				rule,
				file: repoFile,
				enclosing: meta.enclosing ?? '',
				symbol: meta.symbol,
				target: meta.target,
				sourceLine,
			})
		) {
			return;
		}
		report('web-safety', `${displayFile}:${line}:${col}: [${rule}] ${message}`);
	};

	const enter = (node) => {
		const parent = parentMap.get(node);
		const grandParent = parent ? parentMap.get(parent) : undefined;
		const line = node.loc?.start.line;
		const col = (node.loc?.start.column ?? 0) + 1;

		// Rule: raw-web-storage
		if (
			rules.has('raw-web-storage') &&
			!allowRawStorage &&
			node.type === 'Identifier' &&
			(node.name === 'localStorage' || node.name === 'sessionStorage') &&
			sourceUnit.isLineEnabled(line) &&
			!ignored.has(line)
		) {
			const isGlobalMemberProp =
				(parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') &&
				parent.property === node &&
				!parent.computed &&
				parent.object.type === 'Identifier' &&
				(parent.object.name === 'window' || parent.object.name === 'globalThis');
			const isNonGlobalProp =
				(parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') &&
				parent.property === node &&
				!parent.computed &&
				!isGlobalMemberProp;
			const isObjKey = parent?.type === 'ObjectProperty' && parent.key === node && !parent.computed;
			const isParamOrBinding =
				parent?.type === 'VariableDeclarator' && parent.id === node
					? true
					: tsIR.hasAncestor(
							node,
							(a) =>
								(a.type === 'VariableDeclarator' && nodeInBindingTarget(a.id, node)) ||
								(isCoreFunctionNode(a) && a.params.some((p) => nodeInBindingTarget(p, node))) ||
								(a.type === 'CatchClause' && nodeInBindingTarget(a.param, node)),
						);
			const isTypePos = tsIR.hasAncestor(node, (a) => a.type.startsWith('TS'));
			const isShadowedRef = !isGlobalMemberProp && tsIR.isLexicallyShadowed(node, node.name);
			if (!isNonGlobalProp && !isObjKey && !isParamOrBinding && !isTypePos && !isShadowedRef) {
				pushProblem(
					'raw-web-storage',
					line,
					col,
					`direct \`${node.name}\` usage fails in production builds where storage is stripped (use AppStorage / makePersistent; tyne-chat/tyne#140)`,
					{enclosing: tsIR.enclosingSymbol(node), symbol: node.name},
				);
			}
		}

		// Rule: zoom-blind-viewport (JS/TS)
		if (
			rules.has('zoom-blind-viewport') &&
			!tsIR.importsZoomScale &&
			sourceUnit.isLineEnabled(line) &&
			!ignored.has(line)
		) {
			if (
				node.type === 'MemberExpression' &&
				node.object.type === 'Identifier' &&
				node.object.name === 'window' &&
				node.property.type === 'Identifier' &&
				(node.property.name === 'innerWidth' || node.property.name === 'innerHeight') &&
				parent?.type === 'BinaryExpression' &&
				(parent.operator === '<' || parent.operator === '<=' || parent.operator === '>' || parent.operator === '>=')
			) {
				const otherOperand = parent.left === node ? parent.right : parent.left;
				if (!tsIR.isDomRectEdgeExpr(otherOperand, node) && !isInsidePhysicalDeviceGuard(parentMap, node)) {
					pushProblem(
						'zoom-blind-viewport',
						line,
						col,
						`\`window.${node.property.name}\` comparison without \`getAppRemScale()\` ignores desktop zoom (tyne-chat/tyne#639)`,
						{enclosing: tsIR.enclosingSymbol(node), target: `window.${node.property.name}`},
					);
				}
			} else if (
				(node.type === 'CallExpression' || node.type === 'OptionalCallExpression') &&
				identName(node.callee) === 'matchMedia' &&
				node.arguments[0]
			) {
				const argSrc = source.slice(node.arguments[0].start, node.arguments[0].end);
				if (/\b(min|max)-(width|height)\s*:\s*\d+(?:\.\d+)?px\b/i.test(argSrc)) {
					pushProblem(
						'zoom-blind-viewport',
						line,
						col,
						`\`matchMedia(${argSrc})\` without \`getAppRemScale()\` ignores desktop zoom (tyne-chat/tyne#639)`,
						{enclosing: tsIR.enclosingSymbol(node), target: 'matchMedia()'},
					);
				}
			}
		}

		if (isCoreFunctionNode(node)) {
			const fnIR = tsIR.functionIRMap.get(node);
			const state = {
				fnIR,
				hasJSX: false,
				renderStoreReads: [],
				memoStoreReads: [],
				storeSnapshotBindings: [],
				readsMessagesGet: null,
				readsMessagesVersion: false,
				hasCleanupReturn: node.body?.type !== 'BlockStatement',
				effectResources: [],
			};
			fnStack.push(state);
			if (fnIR.isTopComp) compStack.push(state);
		}

		const curFn = fnStack.at(-1);
		const curComp = compStack.at(-1);
		if (curComp && (node.type === 'JSXElement' || node.type === 'JSXFragment')) {
			curComp.hasJSX = true;
		}

		if (curFn && node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
			const initUnwrapped = unwrapTsExpr(node.init);
			let initMember = null;
			if (
				initUnwrapped &&
				(initUnwrapped.type === 'MemberExpression' || initUnwrapped.type === 'OptionalMemberExpression')
			) {
				initMember = initUnwrapped;
			} else if (
				(initUnwrapped?.type === 'CallExpression' || initUnwrapped?.type === 'OptionalCallExpression') &&
				initUnwrapped.arguments.length === 0
			) {
				initMember = unwrapTsExpr(initUnwrapped.callee);
			}
			if (
				initMember &&
				(initMember.type === 'MemberExpression' || initMember.type === 'OptionalMemberExpression') &&
				initMember.object?.type === 'Identifier' &&
				initMember.property?.type === 'Identifier' &&
				mobxImports.has(initMember.object.name) &&
				SNAPSHOT_PROP_RE.test(initMember.property.name)
			) {
				let block = curFn.fnIR.node.body;
				let anc = parentMap.get(node);
				while (anc) {
					if (anc.type === 'BlockStatement' || anc.type === 'Program') {
						block = anc;
						break;
					}
					anc = parentMap.get(anc);
				}
				curFn.storeSnapshotBindings.push({
					name: node.id.name,
					store: initMember.object.name,
					blockStart: block?.start ?? curFn.fnIR.node.start,
					blockEnd: block?.end ?? curFn.fnIR.node.end,
				});
			}
		}

		// Track MobX store reads and MessagingMessages reads.
		if (
			curFn &&
			(node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
			node.object.type === 'Identifier' &&
			!tsIR.hasAncestor(node, (a) => a.type.startsWith('TS'))
		) {
			const obj = node.object.name;
			const prop = node.property.type === 'Identifier' ? node.property.name : '';
			if (isObservableStorePropCandidate(prop) && mobxImports.has(obj) && !STATIC_STORES.has(obj)) {
				const isEventPropRef =
					parent?.type === 'JSXExpressionContainer' &&
					grandParent?.type === 'JSXAttribute' &&
					grandParent.name?.type === 'JSXIdentifier' &&
					/^on[A-Z]/.test(grandParent.name.name);
				if (!isEventPropRef) {
					const enclosing = tsIR.enclosingSymbol(node);
					if (curFn.fnIR.runsInRender && curComp) {
						curComp.renderStoreReads.push({store: obj, prop, line, col, enclosing});
					}
					if (curFn.fnIR.runsInMemo) {
						const overrideArg =
							prop === 'getFrecentEmojis' &&
							(parent?.type === 'CallExpression' || parent?.type === 'OptionalCallExpression') &&
							parent.callee === node &&
							parent.arguments.length >= 3
								? unwrapTsExpr(parent.arguments[2])
								: null;
						const overrideDepIdent = overrideArg?.type === 'Identifier' ? overrideArg.name : undefined;
						for (let i = fnStack.length - 1; i >= 0; i--) {
							if (fnStack[i].fnIR.hookCall?.hook === 'useMemo') {
								fnStack[i].memoStoreReads.push({store: obj, prop, line, col, enclosing, overrideDepIdent});
								break;
							}
						}
					}
				}
			}

			if (messagesIdent && obj === messagesIdent && curComp && curFn.fnIR.runsInRender) {
				if (prop === 'getMessage' || prop === 'getMessages' || prop === 'getCachedMessages') {
					curComp.readsMessagesGet ??= {prop, line, col, enclosing: tsIR.enclosingSymbol(node)};
				}
				if (prop === 'version') {
					curComp.readsMessagesVersion = true;
				}
			}
		}

		// Rule: uncaptured-timer
		if (
			rules.has('uncaptured-timer') &&
			node.type === 'CallExpression' &&
			sourceUnit.isLineEnabled(line) &&
			!ignored.has(line)
		) {
			const isExprStmt =
				parent?.type === 'ExpressionStatement' ||
				(parent?.type === 'UnaryExpression' &&
					parent.operator === 'void' &&
					grandParent?.type === 'ExpressionStatement');
			if (isExprStmt) {
				let timerName;
				if (node.callee.type === 'Identifier') {
					timerName = node.callee.name;
				} else if (
					node.callee.type === 'MemberExpression' &&
					node.callee.object.type === 'Identifier' &&
					(node.callee.object.name === 'window' || node.callee.object.name === 'globalThis') &&
					node.callee.property.type === 'Identifier'
				) {
					timerName = node.callee.property.name;
				}
				if (timerName === 'setTimeout' || timerName === 'setInterval') {
					const inReactBody = Boolean(curFn?.fnIR.inReactBody);
					const inEffectBody =
						curFn?.fnIR.hookCall?.hook === 'useEffect' || curFn?.fnIR.hookCall?.hook === 'useLayoutEffect';
					const cb = node.arguments[0];
					if (inReactBody && cb) {
						const cbSrc = source.slice(cb.start, cb.end);
						const callsSetter = [...tsIR.stateSetterNames].some((s) => new RegExp(`\\b${s}\\s*\\(`).test(cbSrc));
						if ((timerName === 'setInterval' && !inEffectBody) || callsSetter) {
							const msg =
								`uncaptured \`${timerName}\` ${timerName === 'setInterval' ? '' : 'calling React state setter '}cannot be cleared on unmount (store timer ID in a ref and clear in useEffect cleanup; tyne-chat/tyne#861)`.replace(
									'  ',
									' ',
								);
							pushProblem('uncaptured-timer', line, col, msg, {
								enclosing: tsIR.enclosingSymbol(node),
								target: `${timerName}()`,
							});
						}
					}
				}
			}
		}

		// Track resources & cleanup inside useEffect / useLayoutEffect.
		if (
			curFn?.fnIR.hookCall &&
			(curFn.fnIR.hookCall.hook === 'useEffect' || curFn.fnIR.hookCall.hook === 'useLayoutEffect')
		) {
			if (node.type === 'ReturnStatement' && node.argument) {
				curFn.hasCleanupReturn = true;
			}
			if (node.type === 'CallExpression') {
				const calleeProp = identName(node.callee);
				const isDirectTimer =
					calleeProp === 'setInterval' &&
					(node.callee.type === 'Identifier' ||
						(node.callee.type === 'MemberExpression' &&
							node.callee.object.type === 'Identifier' &&
							(node.callee.object.name === 'window' || node.callee.object.name === 'globalThis')));
				const isListener =
					calleeProp === 'addEventListener' &&
					node.callee.type === 'MemberExpression' &&
					!/\bonce\s*:\s*true\b/.test(source.slice(node.start, node.end)) &&
					!/\bsignal\b/.test(source.slice(node.start, node.end));
				const isMobxReaction = node.callee.type === 'Identifier' && mobxReactiveHelpers.has(node.callee.name);
				if (isDirectTimer || isListener || isMobxReaction) {
					curFn.effectResources.push({kind: calleeProp, line, col, enclosing: tsIR.enclosingSymbol(node)});
				}
			}
		}
	};

	const leave = (node) => {
		if (!isCoreFunctionNode(node)) return;
		const popped = fnStack.pop();
		const {fnIR} = popped;
		if (fnIR.isTopComp) compStack.pop();

		if (
			rules.has('mobx-stale-memo') &&
			fnIR.hookCall?.hook === 'useMemo' &&
			popped.memoStoreReads.length > 0 &&
			fnIR.hookCall.call.arguments.length >= 2
		) {
			const depsNode = fnIR.hookCall.call.arguments[1];
			const depsSrc = source.slice(depsNode.start, depsNode.end);
			for (const read of popped.memoStoreReads) {
				let trackedBySnapshot = false;
				for (const fn of fnStack) {
					for (const binding of fn.storeSnapshotBindings) {
						if (
							binding.store === read.store &&
							fnIR.node.start >= binding.blockStart &&
							fnIR.node.end <= binding.blockEnd &&
							depsHasIdentifier(depsNode, binding.name)
						) {
							trackedBySnapshot = true;
							break;
						}
					}
					if (trackedBySnapshot) break;
				}
				const trackedByOverrideArg = Boolean(
					read.overrideDepIdent && depsHasIdentifier(depsNode, read.overrideDepIdent),
				);
				if (
					sourceUnit.isLineEnabled(read.line) &&
					!ignored.has(read.line) &&
					!isDepsTrackingStore(depsNode, depsSrc, read.store) &&
					!trackedBySnapshot &&
					!trackedByOverrideArg
				) {
					pushProblem(
						'mobx-stale-memo',
						read.line,
						read.col,
						`\`useMemo\` reads \`${read.store}.${read.prop}\` without listing \`${read.store}\` or a reactive dep in its dependency array (breaks MobX updates once memoized; tyne-chat/tyne#937)`,
						{enclosing: read.enclosing, symbol: `${read.store}.${read.prop}`, target: 'useMemo'},
					);
				}
			}
		}

		if (
			rules.has('missing-observer') &&
			fnIR.isTopComp &&
			popped.hasJSX &&
			!fnIR.isObs &&
			popped.renderStoreReads.length > 0
		) {
			const relevant = popped.renderStoreReads.filter(
				(read) => sourceUnit.isLineEnabled(read.line) && !ignored.has(read.line),
			);
			if (relevant.length > 0) {
				const first = relevant[0];
				pushProblem(
					'missing-observer',
					first.line,
					first.col,
					`component \`${fnIR.name}\` reads \`${first.store}.${first.prop}\` during render without \`observer()\` (never re-renders on store changes)`,
					{enclosing: fnIR.name, symbol: `${first.store}.${first.prop}`},
				);
			}
		}

		if (
			rules.has('messages-untracked-read') &&
			!isChannelMessagesCacheHost &&
			fnIR.isTopComp &&
			fnIR.isObs &&
			popped.readsMessagesGet &&
			!popped.readsMessagesVersion &&
			sourceUnit.isLineEnabled(popped.readsMessagesGet.line) &&
			!ignored.has(popped.readsMessagesGet.line)
		) {
			const read = popped.readsMessagesGet;
			pushProblem(
				'messages-untracked-read',
				read.line,
				read.col,
				`\`${fnIR.name}\` calls \`${messagesIdent}.${read.prop}()\` during render without reading \`${messagesIdent}.version\` (Messages is not deep-observable)`,
				{enclosing: fnIR.name, symbol: `${messagesIdent}.${read.prop}()`},
			);
		}

		if (
			rules.has('effect-missing-cleanup') &&
			fnIR.hookCall &&
			(fnIR.hookCall.hook === 'useEffect' || fnIR.hookCall.hook === 'useLayoutEffect') &&
			popped.effectResources.length > 0 &&
			!popped.hasCleanupReturn
		) {
			for (const res of popped.effectResources) {
				if (sourceUnit.isLineEnabled(res.line) && !ignored.has(res.line)) {
					pushProblem(
						'effect-missing-cleanup',
						res.line,
						res.col,
						`\`${fnIR.hookCall.hook}\` registers \`${res.kind}()\` without returning a cleanup function`,
						{enclosing: res.enclosing, symbol: `${res.kind}()`, target: fnIR.hookCall.hook},
					);
				}
			}
		}
	};

	return {enter, leave};
}

const STATIC_STORES = new Set(['RuntimeConfig', 'Experiments', 'DeveloperOptions', 'LayoutState']);
