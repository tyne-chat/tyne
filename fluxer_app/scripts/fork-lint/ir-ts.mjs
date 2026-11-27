// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 3 of the monorepo custom compiler-pipeline linter — single `@babel/parser` parse
// and shared TypeScript/JSX module Intermediate Representation (`TsModuleIR`).

import {parse} from '@babel/parser';

const ACTION_VERB_RE =
	/^(set|toggle|clear|reset|add|remove|delete|update|open|close|mark|record|track|bump|notify|register|unregister|subscribe|unsubscribe|fetch|load|ensure|dismiss|persist)[A-Z]/;
const HANDLER_PROP_RE = /^(on|handle)[A-Z]/;
const CONSTANT_PROP_RE = /^[A-Z0-9_]+$/;
const SYNC_COLLECTION_CALLBACK_RE = /^(map|filter|find|findIndex|some|every|reduce|reduceRight|flatMap|forEach|sort)$/;
const EFFECT_HOOK_RE = /^(useEffect|useLayoutEffect)$/;
const COMPONENT_WRAPPER_RE = /^(observer|memo|forwardRef)$/;
const DOM_RECT_EDGE_RE = /^(?:top|bottom|left|right|x|y|width|height)$/;
const DOM_RECT_TYPE_RE = /^(?:DOMRect|DOMRectReadOnly)$/;

export const SNAPSHOT_PROP_RE = /(?:List|Map|Set|Version|Snapshot|All|ById)$/;

/** @param {any} node */
export function identName(node) {
	if (!node) return undefined;
	if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
	if (node.type === 'StringLiteral') return node.value;
	if (node.type === 'JSXNamespacedName') return `${node.namespace.name}:${node.name.name}`;
	if (
		node.type === 'MemberExpression' ||
		node.type === 'OptionalMemberExpression' ||
		node.type === 'JSXMemberExpression'
	) {
		return identName(node.property);
	}
	return undefined;
}

/** @param {any} node */
export function rootIdentName(node) {
	let cur = node;
	while (cur && (cur.type === 'MemberExpression' || cur.type === 'OptionalMemberExpression')) {
		cur = cur.object;
	}
	return identName(cur);
}

/** @param {any} node */
export function isFunctionNode(node) {
	return (
		node?.type === 'FunctionDeclaration' ||
		node?.type === 'FunctionExpression' ||
		node?.type === 'ArrowFunctionExpression' ||
		node?.type === 'ClassMethod' ||
		node?.type === 'ObjectMethod'
	);
}

/** @param {any} node */
export function isCoreFunctionNode(node) {
	return (
		node?.type === 'FunctionDeclaration' ||
		node?.type === 'FunctionExpression' ||
		node?.type === 'ArrowFunctionExpression'
	);
}

/** @param {any} node */
export function unwrapTsExpr(node) {
	let cur = node;
	while (
		cur &&
		(cur.type === 'TSAsExpression' ||
			cur.type === 'TSTypeAssertion' ||
			cur.type === 'TSNonNullExpression' ||
			cur.type === 'TSSatisfiesExpression')
	) {
		cur = cur.expression;
	}
	return cur;
}

function isReactComponentOrHookName(name) {
	if (!name) return false;
	return /^[A-Z][A-Za-z0-9]*$/.test(name) || /^use[A-Z][A-Za-z0-9]*$/.test(name);
}

function isRenderFetchComponentFn(fnNode, parent, grandParent) {
	if (fnNode.id?.type === 'Identifier' && isReactComponentOrHookName(fnNode.id.name)) {
		return true;
	}
	if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
		if (isReactComponentOrHookName(parent.id.name)) return true;
	}
	if (parent?.type === 'CallExpression') {
		const wrapperName = identName(parent.callee);
		if (wrapperName && COMPONENT_WRAPPER_RE.test(wrapperName)) {
			if (grandParent?.type === 'VariableDeclarator' && grandParent.id?.type === 'Identifier') {
				return isReactComponentOrHookName(grandParent.id.name);
			}
			return true;
		}
	}
	return false;
}

function isEffectCallbackWithoutDeps(fnNode, parent) {
	if (parent?.type !== 'CallExpression') return false;
	if (parent.arguments[0] !== fnNode) return false;
	const hookName = identName(parent.callee);
	if (!hookName || !EFFECT_HOOK_RE.test(hookName)) return false;
	return parent.arguments.length < 2;
}

function isImmediatelyInvoked(fnNode, parent) {
	return (parent?.type === 'CallExpression' || parent?.type === 'OptionalCallExpression') && parent.callee === fnNode;
}

function resolveImportToAppPath(appFile, specifier) {
	const stripped = specifier.replace(/\.(ts|tsx|js|jsx|mjs)$/, '').replace(/\/index$/, '');
	if (stripped.startsWith('@app/')) return stripped;
	if (stripped.startsWith('./') || stripped.startsWith('../')) {
		const normalizedFile = appFile.replace(/\\/g, '/');
		const resolved = normalizedFile.includes('/')
			? `${normalizedFile.slice(0, normalizedFile.lastIndexOf('/'))}/${stripped}`
			: stripped;
		// Normalize POSIX segments cleanly without importing node:path twice.
		const parts = [];
		for (const seg of resolved.split('/')) {
			if (!seg || seg === '.') continue;
			if (seg === '..') parts.pop();
			else parts.push(seg);
		}
		const joined = parts.join('/');
		if (joined.startsWith('src/')) {
			return `@app/${joined.slice('src/'.length)}`;
		}
	}
	return stripped;
}

function nodeInside(container, node) {
	return Boolean(
		container &&
			node &&
			typeof container.start === 'number' &&
			typeof node.start === 'number' &&
			node.start >= container.start &&
			node.end <= container.end,
	);
}

const NON_VALUE_PARENT_LABELS = new Set(['LabeledStatement', 'BreakStatement', 'ContinueStatement']);

/** @param {any} pat @param {string} targetName */
function patternBindsIdentifier(pat, targetName) {
	if (!pat) return false;
	if (pat.type === 'Identifier') return pat.name === targetName;
	if (pat.type === 'AssignmentPattern') return patternBindsIdentifier(pat.left, targetName);
	if (pat.type === 'RestElement') return patternBindsIdentifier(pat.argument, targetName);
	if (pat.type === 'ArrayPattern') {
		return pat.elements.some((el) => el && patternBindsIdentifier(el, targetName));
	}
	if (pat.type === 'ObjectPattern') {
		return pat.properties.some((prop) =>
			prop.type === 'RestElement'
				? patternBindsIdentifier(prop.argument, targetName)
				: patternBindsIdentifier(prop.value, targetName),
		);
	}
	return false;
}

/** @param {any} pat @param {any} targetNode */
export function nodeInBindingTarget(pat, targetNode) {
	if (!pat) return false;
	if (pat === targetNode) return pat.type === 'Identifier';
	if (pat.type === 'AssignmentPattern') return nodeInBindingTarget(pat.left, targetNode);
	if (pat.type === 'RestElement') return nodeInBindingTarget(pat.argument, targetNode);
	if (pat.type === 'ArrayPattern') {
		return pat.elements.some((el) => el && nodeInBindingTarget(el, targetNode));
	}
	if (pat.type === 'ObjectPattern') {
		return pat.properties.some((prop) =>
			prop.type === 'RestElement'
				? nodeInBindingTarget(prop.argument, targetNode)
				: nodeInBindingTarget(prop.value, targetNode),
		);
	}
	return false;
}

function isNonValueIdentifier(id, parent) {
	if (!parent) return false;
	if (
		(parent.type === 'MemberExpression' ||
			parent.type === 'OptionalMemberExpression' ||
			parent.type === 'JSXMemberExpression') &&
		!parent.computed &&
		parent.property === id
	) {
		return true;
	}
	if (parent.type === 'ObjectProperty' && !parent.computed && parent.key === id) return true;
	if (
		(parent.type === 'ObjectMethod' ||
			parent.type === 'ClassMethod' ||
			parent.type === 'ClassProperty' ||
			parent.type === 'JSXAttribute') &&
		(parent.key === id || parent.name === id)
	) {
		return true;
	}
	if (NON_VALUE_PARENT_LABELS.has(parent.type) && parent.label === id) return true;
	if (
		parent.type.startsWith('TS') &&
		parent.type !== 'TSAsExpression' &&
		parent.type !== 'TSNonNullExpression' &&
		parent.type !== 'TSSatisfiesExpression' &&
		parent.type !== 'TSTypeAssertion'
	) {
		return true;
	}
	return false;
}

function isDomRectTypeAnnotation(typeAnnotation) {
	const tsType = typeAnnotation?.typeAnnotation;
	return (
		tsType?.type === 'TSTypeReference' &&
		tsType.typeName?.type === 'Identifier' &&
		DOM_RECT_TYPE_RE.test(tsType.typeName.name)
	);
}

function isGetBoundingClientRectCall(expr) {
	const unwrapped = unwrapTsExpr(expr);
	return (
		(unwrapped?.type === 'CallExpression' || unwrapped?.type === 'OptionalCallExpression') &&
		identName(unwrapped.callee) === 'getBoundingClientRect'
	);
}

/** @param {string} prop */
export function isObservableStorePropCandidate(prop) {
	return Boolean(prop) && !ACTION_VERB_RE.test(prop) && !HANDLER_PROP_RE.test(prop) && !CONSTANT_PROP_RE.test(prop);
}

/**
 * Walks an AST using precomputed `parentMap`, passing `node` and invoking callbacks.
 * @param {any} node
 * @param {(node: any) => void} enter
 * @param {(node: any) => void} [leave]
 */
export function traverseAst(node, enter, leave = undefined) {
	if (!node || typeof node.type !== 'string') return;
	enter(node);
	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
		const val = node[key];
		if (Array.isArray(val)) {
			for (const child of val) traverseAst(child, enter, leave);
		} else if (val && typeof val === 'object' && typeof val.type === 'string') {
			traverseAst(val, enter, leave);
		}
	}
	leave?.(node);
}

/**
 * Parses a JS/TS/JSX/TSX `SourceUnit` once and constructs a shared `TsModuleIR`.
 * @param {import('./source-unit.mjs').SourceUnit} sourceUnit
 * @param {{mobxStateModules?: Set<string>; onParse?: (displayFile: string) => void}} [options]
 */
export function parseAndBuildTsModuleIR(sourceUnit, options = {}) {
	const {source, displayFile} = sourceUnit;
	options.onParse?.(displayFile);
	let ast;
	try {
		ast = parse(source, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators'], errorRecovery: true});
	} catch (error) {
		return {parseError: error.message};
	}

	const directives = sourceUnit.getDirectives(ast.comments ?? []);
	const mobxStateModules = options.mobxStateModules ?? new Set();
	const mobxImports = new Map();
	const mobxReactiveHelpers = new Set();
	let messagesIdent = null;
	const importsZoomScale = /\bgetAppRemScale\b/.test(source);

	for (const stmt of ast.program.body) {
		if (stmt.type !== 'ImportDeclaration' || stmt.importKind === 'type') continue;
		const rawMod = stmt.source.value;
		const resolved = resolveImportToAppPath(displayFile, rawMod);
		if (mobxStateModules.has(resolved)) {
			for (const sp of stmt.specifiers) {
				if (sp.importKind !== 'type') mobxImports.set(sp.local.name, resolved);
			}
		}
		if (resolved === '@app/features/messaging/state/MessagingMessages') {
			for (const sp of stmt.specifiers) {
				if (sp.type === 'ImportDefaultSpecifier') messagesIdent = sp.local.name;
			}
		}
		if (rawMod === 'mobx') {
			for (const sp of stmt.specifiers) {
				if (
					sp.type === 'ImportSpecifier' &&
					sp.importKind !== 'type' &&
					(sp.imported.name === 'reaction' || sp.imported.name === 'autorun')
				) {
					mobxReactiveHelpers.add(sp.local.name);
				}
			}
		}
	}

	const parentMap = new WeakMap();
	const observerWrappedNames = new Set();
	const stateSetterNames = new Set();
	const topLevelCallables = new Map();
	const allCallableInitializers = new Map();
	const functionIRMap = new WeakMap();
	const functionList = [];
	const blockScopeDecls = new WeakMap();
	const blockDomRectVars = new WeakMap();
	const enclosingCache = new WeakMap();

	const coreFnStack = [];
	const allFnStack = [];
	const isTsx = displayFile.endsWith('.tsx');

	// Populate top-level callables from AST body directly (exact parity for collectSameFileFunctions).
	for (const stmt of ast.program.body) {
		const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
		if (decl?.type === 'FunctionDeclaration' && decl.id) {
			topLevelCallables.set(decl.id.name, source.slice(decl.start, decl.end));
		} else if (decl?.type === 'VariableDeclaration') {
			for (const d of decl.declarations) {
				if (
					d.id?.type === 'Identifier' &&
					d.init &&
					(d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')
				) {
					topLevelCallables.set(d.id.name, source.slice(d.init.start, d.init.end));
				}
			}
		}
	}

	const preVisit = (node, parent) => {
		if (!node || typeof node.type !== 'string') return;
		if (parent) parentMap.set(node, parent);
		const grandParent = parent ? parentMap.get(parent) : undefined;

		if (node.type === 'BlockStatement' || node.type === 'Program') {
			const varDecls = [];
			const fnNames = new Set();
			const rectVars = new Set();
			for (const stmt of node.body ?? []) {
				const declStmt =
					stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration'
						? stmt.declaration
						: stmt;
				if (declStmt.type === 'VariableDeclaration') {
					for (const decl of declStmt.declarations) {
						varDecls.push(decl);
						if (
							decl.id?.type === 'Identifier' &&
							(isDomRectTypeAnnotation(decl.id.typeAnnotation) || isGetBoundingClientRectCall(decl.init))
						) {
							rectVars.add(decl.id.name);
						}
					}
				} else if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
					fnNames.add(stmt.id.name);
				}
			}
			if (varDecls.length > 0 || fnNames.size > 0) {
				blockScopeDecls.set(node, {varDecls, fnNames});
			}
			if (rectVars.size > 0) {
				blockDomRectVars.set(node, rectVars);
			}
		}

		if (node.type === 'CallExpression') {
			const cn = identName(node.callee);
			if ((cn === 'observer' || cn === 'Observer') && node.arguments[0]?.type === 'Identifier') {
				observerWrappedNames.add(node.arguments[0].name);
			}
		}

		if (node.type === 'VariableDeclarator') {
			if (
				node.id?.type === 'ArrayPattern' &&
				node.init?.type === 'CallExpression' &&
				identName(node.init.callee) === 'useState' &&
				node.id.elements[1]?.type === 'Identifier'
			) {
				stateSetterNames.add(node.id.elements[1].name);
			}
			if (node.id?.type === 'Identifier' && node.init) {
				allCallableInitializers.set(node.id.name, source.slice(node.init.start, node.init.end));
			}
		}

		const isFn = isFunctionNode(node);
		const isCoreFn = isCoreFunctionNode(node);
		let pushedFnIR = null;
		const topBlockStmtEnd = -1;

		if (isFn) {
			let name =
				node.id?.name ??
				(parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier' ? parent.id.name : '') ??
				(node.key?.type === 'Identifier' ? node.key.name : '');
			let isObs = false;
			// Inspect up to 4 ancestors for observer(...) wrapper.
			let anc = parent;
			let steps = 0;
			while (anc && steps < 4) {
				if (anc.type === 'CallExpression') {
					const cn = identName(anc.callee);
					if (cn === 'observer' || cn === 'Observer') isObs = true;
					const ancParent = parentMap.get(anc);
					if (!name && ancParent?.type === 'VariableDeclarator' && ancParent.id?.type === 'Identifier') {
						name = ancParent.id.name;
					}
				}
				anc = parentMap.get(anc);
				steps++;
			}

			let hookCall = null;
			if (parent?.type === 'CallExpression' && parent.arguments[0] === node) {
				const hname = identName(parent.callee);
				if (
					hname === 'useMemo' ||
					hname === 'useMobxMemo' ||
					hname === 'useEffect' ||
					hname === 'useLayoutEffect' ||
					hname === 'useCallback'
				) {
					hookCall = {hook: hname, call: parent};
				}
			}

			const parentCoreFn = coreFnStack.at(-1);
			const isIife = isImmediatelyInvoked(node, parent);
			const isSyncCollectionCallback =
				parent?.type === 'CallExpression' &&
				parent.arguments[0] === node &&
				parent.callee.type === 'MemberExpression' &&
				parent.callee.property.type === 'Identifier' &&
				SYNC_COLLECTION_CALLBACK_RE.test(parent.callee.property.name);
			const hasEnclosingCoreFn = coreFnStack.length > 0;
			const isTopComp = !hasEnclosingCoreFn && isCoreFn && /^[A-Z][A-Za-z0-9]*$/.test(name) && isTsx;
			const isRenderPhaseHook = !hasEnclosingCoreFn && isCoreFn && /^use[A-Z][A-Za-z0-9]*$/.test(name) && isTsx;
			const runsInRender =
				isTopComp ||
				isRenderPhaseHook ||
				(Boolean(parentCoreFn?.runsInRender) &&
					(hookCall?.hook === 'useMemo' || hookCall?.hook === 'useMobxMemo' || isIife || isSyncCollectionCallback));
			const runsInMemo =
				hookCall?.hook === 'useMemo' || (Boolean(parentCoreFn?.runsInMemo) && (isIife || isSyncCollectionCallback));

			let renderFetchMode = 'other';
			if (isCoreFn) {
				if (isEffectCallbackWithoutDeps(node, parent)) {
					renderFetchMode = 'effect-no-deps';
				} else if (isRenderFetchComponentFn(node, parent, grandParent)) {
					renderFetchMode = 'render';
				} else if (isIife) {
					renderFetchMode = parentCoreFn?.renderFetchMode ?? 'other';
				}
			}

			pushedFnIR = {
				node,
				parent,
				isCoreFn,
				name,
				isObs,
				isTopComp,
				isRenderPhaseHook,
				hookCall,
				runsInRender,
				runsInMemo,
				renderFetchMode,
				inReactBody: Boolean(parentCoreFn?.inReactBody) || /^[A-Z]/.test(name) || /^use[A-Z]/.test(name),
				isAsync: Boolean(node.async),
				directDbWrites: [],
				directAwaitStmtIndices: new Set(),
				currentBodyStmtIndex: -1,
			};
			functionIRMap.set(node, pushedFnIR);
			functionList.push(pushedFnIR);
			allFnStack.push(pushedFnIR);
			if (isCoreFn) coreFnStack.push(pushedFnIR);
		}

		// Record direct await / DB writes on the innermost enclosing function without crossing into inner fns.
		const curAnyFn = allFnStack.at(-1);
		if (!isFn && curAnyFn?.isAsync) {
			if (parent === curAnyFn.node.body && curAnyFn.node.body?.type === 'BlockStatement') {
				curAnyFn.currentBodyStmtIndex = curAnyFn.node.body.body.indexOf(node);
			}
			if (node.type === 'AwaitExpression') {
				if (curAnyFn.currentBodyStmtIndex >= 0) {
					curAnyFn.directAwaitStmtIndices.add(curAnyFn.currentBodyStmtIndex);
				}
				if (node.argument?.type === 'CallExpression') {
					const call = node.argument;
					const fnName = call.callee.type === 'Identifier' ? call.callee.name : undefined;
					if (fnName === 'upsertOne' || fnName === 'deleteOneOrMany' || fnName === 'executePrepared') {
						const arg = call.arguments[0];
						if (
							arg?.type === 'CallExpression' &&
							arg.callee.type === 'MemberExpression' &&
							arg.callee.object.type === 'Identifier' &&
							arg.callee.property.type === 'Identifier' &&
							/^(upsert|patch|delete)/.test(arg.callee.property.name)
						) {
							curAnyFn.directDbWrites.push({
								table: arg.callee.object.name,
								line: node.loc?.start.line,
								col: (node.loc?.start.column ?? 0) + 1,
							});
						}
					}
				}
			}
		}
		void topBlockStmtEnd;

		for (const key of Object.keys(node)) {
			if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
			const val = node[key];
			if (Array.isArray(val)) {
				for (const child of val) preVisit(child, node);
			} else if (val && typeof val === 'object' && typeof val.type === 'string') {
				preVisit(val, node);
			}
		}

		if (pushedFnIR) {
			allFnStack.pop();
			if (pushedFnIR.isCoreFn) coreFnStack.pop();
		}
	};

	preVisit(ast.program, undefined);

	for (const fn of functionList) {
		if (!fn.isObs && fn.name && observerWrappedNames.has(fn.name)) {
			fn.isObs = true;
		}
	}

	const enclosingSymbol = (node, includeSelf = false) => {
		if (!node) return '';
		if (!includeSelf && enclosingCache.has(node)) {
			return enclosingCache.get(node);
		}
		let memberName;
		let hasMember = false;
		let typeName;
		let cur = includeSelf ? node : parentMap.get(node);
		while (cur) {
			const parent = parentMap.get(cur);
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
			cur = parent;
		}
		const result = typeName && hasMember && memberName ? `${typeName}.${memberName}` : (typeName ?? memberName ?? '');
		if (!includeSelf) enclosingCache.set(node, result);
		return result;
	};

	const isLexicallyShadowed = (node, name) => {
		let cur = parentMap.get(node);
		while (cur) {
			if (
				isCoreFunctionNode(cur) &&
				nodeInside(cur.body, node) &&
				cur.params.some((p) => patternBindsIdentifier(p, name))
			) {
				return true;
			}
			if (cur.type === 'CatchClause' && nodeInside(cur.body, node) && patternBindsIdentifier(cur.param, name)) {
				return true;
			}
			if (cur.type === 'BlockStatement' || cur.type === 'Program') {
				const scope = blockScopeDecls.get(cur);
				if (scope) {
					if (scope.fnNames.has(name)) return true;
					for (const decl of scope.varDecls) {
						if (patternBindsIdentifier(decl.id, name) && !nodeInside(decl.init, node)) {
							return true;
						}
					}
				}
			}
			if (
				(cur.type === 'ForStatement' && cur.init?.type === 'VariableDeclaration') ||
				((cur.type === 'ForInStatement' || cur.type === 'ForOfStatement') && cur.left?.type === 'VariableDeclaration')
			) {
				const varDecl = cur.type === 'ForStatement' ? cur.init : cur.left;
				for (const decl of varDecl.declarations) {
					if (patternBindsIdentifier(decl.id, name) && !nodeInside(decl.init, node)) {
						return true;
					}
				}
			}
			cur = parentMap.get(cur);
		}
		return false;
	};

	const isDomRectVarInScope = (node, rectName) => {
		let cur = parentMap.get(node);
		while (cur) {
			if (isCoreFunctionNode(cur)) {
				for (const rawParam of cur.params) {
					const param = rawParam?.type === 'AssignmentPattern' ? rawParam.left : rawParam;
					if (
						param?.type === 'Identifier' &&
						param.name === rectName &&
						isDomRectTypeAnnotation(param.typeAnnotation)
					) {
						return true;
					}
				}
			}
			if (cur.type === 'BlockStatement' || cur.type === 'Program') {
				if (blockDomRectVars.get(cur)?.has(rectName)) return true;
			}
			cur = parentMap.get(cur);
		}
		return false;
	};

	const isDomRectEdgeExpr = (expr, refNode) => {
		const unwrapped = unwrapTsExpr(expr);
		if (
			!unwrapped ||
			(unwrapped.type !== 'MemberExpression' && unwrapped.type !== 'OptionalMemberExpression') ||
			unwrapped.computed ||
			unwrapped.property?.type !== 'Identifier' ||
			!DOM_RECT_EDGE_RE.test(unwrapped.property.name)
		) {
			return false;
		}
		if (isGetBoundingClientRectCall(unwrapped.object)) return true;
		return unwrapped.object?.type === 'Identifier' && isDomRectVarInScope(refNode, unwrapped.object.name);
	};

	const hasAncestor = (node, predicate) => {
		let cur = parentMap.get(node);
		while (cur) {
			if (predicate(cur)) return true;
			cur = parentMap.get(cur);
		}
		return false;
	};

	const localVarFlowsOnlyTo = (declarator, isSafeRead) => {
		const declStmt = parentMap.get(declarator);
		const block = declStmt?.type === 'VariableDeclaration' ? parentMap.get(declStmt) : null;
		if (block?.type !== 'BlockStatement' || declarator?.id?.type !== 'Identifier') return false;

		const name = declarator.id.name;
		let readCount = 0;
		let unsafe = false;

		traverseAst(block, (node) => {
			if (unsafe) return;
			if (node !== declarator && node.type === 'VariableDeclarator' && patternBindsIdentifier(node.id, name)) {
				unsafe = true;
				return;
			}
			if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
				unsafe = true;
				return;
			}
			if (isFunctionNode(node) && node.params?.some((param) => patternBindsIdentifier(param, name))) {
				unsafe = true;
				return;
			}
			if (node.type === 'CatchClause' && node.param && patternBindsIdentifier(node.param, name)) {
				unsafe = true;
				return;
			}
			if (node.type !== 'Identifier' || node.name !== name || node === declarator.id) return;

			const parent = parentMap.get(node);
			if (
				(parent?.type === 'AssignmentExpression' && nodeInBindingTarget(parent.left, node)) ||
				(parent?.type === 'UpdateExpression' && parent.argument === node)
			) {
				unsafe = true;
				return;
			}
			if (isNonValueIdentifier(node, parent)) return;

			readCount++;
			if (!isSafeRead(node)) {
				unsafe = true;
			}
		});

		return !unsafe && readCount >= 1;
	};

	return {
		sourceUnit,
		ast,
		parseError: null,
		directives,
		mobxImports,
		messagesIdent,
		mobxReactiveHelpers,
		importsZoomScale,
		parentMap,
		observerWrappedNames,
		stateSetterNames,
		topLevelCallables,
		allCallableInitializers,
		functionIRMap,
		functionList,
		enclosingSymbol,
		isLexicallyShadowed,
		isDomRectVarInScope,
		isDomRectEdgeExpr,
		hasAncestor,
		localVarFlowsOnlyTo,
	};
}
