// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Stage 4 pass `backend-desktop` consuming shared `SourceUnit`, `MaskedBracedIR` (Rust/Gleam),
// and `TsModuleIR` (`functionList`, `allCallableInitializers`, `directDbWrites`, `directAwaitStmtIndices`).

import {TEST_FILE_RE} from '../discovery.mjs';
import {isFunctionNode} from '../ir-ts.mjs';

export const ALL_BACKEND_DESKTOP_RULES = new Set([
	'non-atomic-index-write',
	'zod-schema-trap',
	'promise-race-timeout-leak',
	'desktop-ipc-sender',
	'desktop-window-safety',
	'api-controller-hygiene',
	'rust-async-blocking-fs',
	'gleam-fork-test-sleep',
]);

const READONLY_SAFE_IPC_CHANNELS = new Set([
	'get-desktop-info',
	'get-gpu-info',
	'get-app-metrics',
	'streamer-mode:get-capture-app-status',
	'system-idle-time-ms',
	'desktop-window-behavior-get',
	'desktop-troubleshooting-get',
	'get-accessibility-support-enabled',
	'system-locale-get',
	'linux-appearance-get',
	'streaming-priority-get-diagnostics',
]);

const READONLY_SAFE_IPC_IDENTIFIERS = new Set([
	'DESKTOP_CAPABILITY_MANIFEST_CHANNEL',
	'ACCOUNT_ENGINE_CHANNELS.isAvailable',
]);

const IPC_SENDER_GUARD_RE =
	/\b(requirePrivilegedRendererDocumentSender|isPrivilegedRendererDocumentSender|requireMainAppDocument|rendererDocuments\.|ensureClient|appWindowForIpcSender|isSplashSender|isTopFrameOfCreatedWindow|isTrustedOrigin|senderFrame|BrowserWindow\.fromWebContents|pending\.senderId|resolutions\.|transactions\.|isMainWindowWebContents|requireTrustedRenderer|validateIpcSender)\b|event\.sender\s*[!=]==\s*[A-Za-z0-9_.]+\.webContents/;

const ISOLATED_API_TEST_FILES = new Set([
	'fluxer_api/src/api/operator_pass/OperatorPassFulfilmentService.test.ts',
	'fluxer_api/src/api/voice/tests/VoiceAvailabilityService.test.ts',
	'fluxer_api/src/api/billing_documents/BillingDocuments.test.ts',
	'fluxer_api/src/api/database/CassandraDriverPath.test.ts',
	'fluxer_api/src/api/admin/tests/InstanceConfigPendingRegistrationApproval.test.ts',
	'fluxer_api/src/api/utils/AgeUtils.test.ts',
]);

const WINDOW_METHOD_CALL_RE =
	/^(win|window|mainWindow|targetWindow|browserWindow|webContents)(\.webContents)?\.(send|loadURL|executeJavaScript|focus|show|close|setBounds|setTitle)$/;

function areSiblingIndexTables(tables) {
	if (tables.length < 2) return false;
	for (let i = 0; i < tables.length; i++) {
		for (let j = i + 1; j < tables.length; j++) {
			const a = tables[i];
			const b = tables[j];
			if (a === b) continue;
			const aRoot = a.split('By')[0];
			const bRoot = b.split('By')[0];
			if (
				aRoot === bRoot ||
				aRoot.replace(/s$/, '') === bRoot.replace(/s$/, '') ||
				b.startsWith(`${a}By`) ||
				a.startsWith(`${b}By`)
			) {
				return true;
			}
		}
	}
	return false;
}

function hasSenderGuardWithHops(initialSrc, fileFns, maxHops = 2) {
	if (IPC_SENDER_GUARD_RE.test(initialSrc)) return true;
	const visited = new Set();
	let frontier = [initialSrc];
	for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
		const nextFrontier = [];
		for (const body of frontier) {
			for (const match of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
				const fn = match[1];
				if (visited.has(fn) || !fileFns.has(fn)) continue;
				visited.add(fn);
				const fnSrc = fileFns.get(fn);
				if (IPC_SENDER_GUARD_RE.test(fnSrc)) return true;
				nextFrontier.push(fnSrc);
			}
		}
		frontier = nextFrontier;
	}
	return false;
}

/**
 * Checks Rust files (`rust-async-blocking-fs`) via shared `MaskedBracedIR`.
 * @param {{
 *   sourceUnit: import('../source-unit.mjs').SourceUnit;
 *   rules: Set<string>;
 *   pushProblem: (rule: string, line: number, col: number, msg: string, meta?: any) => void;
 * }} ctx
 */
export function runBackendRustPass({sourceUnit, rules, pushProblem}) {
	if (!rules.has('rust-async-blocking-fs')) return;
	const file = sourceUnit.repoFile;
	if (/(\/tests\/|\/benches\/|tests\.rs$|_test\.rs$|_tests\.rs$|\/examples\/|\/build\.rs$|^tools\/)/.test(file)) {
		return;
	}
	const ignored = sourceUnit.getDirectives().safetyIgnored;
	const {masked, callables} = sourceUnit.getMaskedIR('rust');
	for (const {name, bodyStart, bodyMasked} of callables) {
		const blockingClosureRanges = [];
		for (const bm of bodyMasked.matchAll(/\b(?:spawn_blocking|blocking)\s*\(\s*(?:move\s*)?\|/g)) {
			const openParen = bodyMasked.indexOf('(', bm.index);
			let parenDepth = 1;
			let q = openParen + 1;
			while (q < bodyMasked.length && parenDepth > 0) {
				if (bodyMasked[q] === '(') parenDepth++;
				else if (bodyMasked[q] === ')') parenDepth--;
				q++;
			}
			blockingClosureRanges.push([openParen, q]);
		}
		for (const fsMatch of bodyMasked.matchAll(/\bstd::fs::([A-Za-z_][A-Za-z0-9_]*)/g)) {
			if (blockingClosureRanges.some(([start, end]) => fsMatch.index >= start && fsMatch.index < end)) {
				continue;
			}
			const absOffset = bodyStart + fsMatch.index;
			const line = masked.slice(0, absOffset).split('\n').length;
			const lastNl = masked.lastIndexOf('\n', absOffset);
			const col = absOffset - lastNl;
			if (sourceUnit.isLineEnabled(line) && !ignored.has(line)) {
				pushProblem(
					'rust-async-blocking-fs',
					line,
					col,
					`blocking \`std::fs::${fsMatch[1]}\` inside \`async fn ${name}\` (use \`tokio::fs\` or \`spawn_blocking\`)`,
					{enclosing: name, symbol: `std::fs::${fsMatch[1]}`},
				);
			}
		}
	}
}

/**
 * Checks Gleam fork tests (`gleam-fork-test-sleep`) via shared `MaskedBracedIR`.
 * @param {{
 *   sourceUnit: import('../source-unit.mjs').SourceUnit;
 *   rules: Set<string>;
 *   pushProblem: (rule: string, line: number, col: number, msg: string, meta?: any) => void;
 * }} ctx
 */
export function runBackendGleamPass({sourceUnit, rules, pushProblem}) {
	if (!rules.has('gleam-fork-test-sleep')) return;
	const file = sourceUnit.repoFile;
	if (!file.startsWith('fluxer_gateway/test/') || !file.includes('fork') || !file.endsWith('.gleam')) {
		return;
	}
	const ignored = sourceUnit.getDirectives().safetyIgnored;
	const {masked, callables} = sourceUnit.getMaskedIR('gleam');
	for (const {name, bodyStart, bodyMasked} of callables) {
		for (const sleepMatch of bodyMasked.matchAll(/\bprocess\.sleep\s*\(/g)) {
			const absOffset = bodyStart + sleepMatch.index;
			const line = masked.slice(0, absOffset).split('\n').length;
			const lastNl = masked.lastIndexOf('\n', absOffset);
			const col = absOffset - lastNl;
			if (sourceUnit.isLineEnabled(line) && !ignored.has(line)) {
				pushProblem(
					'gleam-fork-test-sleep',
					line,
					col,
					`\`process.sleep()\` inside fork test \`${name}\` makes tests slow/flaky (synchronize on actor/monitor state instead)`,
					{enclosing: name, symbol: 'process.sleep'},
				);
			}
		}
	}
}

/**
 * Creates Stage 4 AST hooks for TypeScript/JS `backend-desktop` rules using shared `TsModuleIR`.
 * @param {{
 *   tsIR: ReturnType<import('../ir-ts.mjs').parseAndBuildTsModuleIR>;
 *   rules: Set<string>;
 *   reviewed: import('../../fork-lint-reviewed.mjs').ReviewedLintCatalog | null;
 *   forkGuardedIpcChannels?: Set<string>;
 *   rawProblems: Array<string>;
 * }} ctx
 */
export function createBackendDesktopAstPass({tsIR, rules, reviewed, forkGuardedIpcChannels, rawProblems}) {
	const {sourceUnit, ast, directives, parentMap} = tsIR;
	const file = sourceUnit.repoFile;
	const {source} = sourceUnit;
	const ignored = directives.safetyIgnored;
	const isTest = TEST_FILE_RE.test(file);

	const inApi = file.startsWith('fluxer_api/src/');
	const inSchema = file.startsWith('packages/schema/src/domains/');
	const inDesktop = file.startsWith('fluxer_desktop/src/');
	const inDesktopMain = file.startsWith('fluxer_desktop/src/main/');

	const checkRace = (inApi || inDesktop) && !isTest && rules.has('promise-race-timeout-leak');
	const checkApiMock = inApi && isTest && !ISOLATED_API_TEST_FILES.has(file) && rules.has('api-controller-hygiene');
	const checkApiCtrl = inApi && !isTest && file.endsWith('Controller.ts') && rules.has('api-controller-hygiene');
	const checkApiViewPerm =
		inApi && !isTest && rules.has('api-controller-hygiene') && source.includes('Permissions.VIEW_CHANNEL');
	const checkZod = inSchema && !isTest && rules.has('zod-schema-trap');
	const checkIpc = inDesktopMain && !isTest && rules.has('desktop-ipc-sender');
	const checkWin = inDesktopMain && !isTest && rules.has('desktop-window-safety');
	const isUpdateFile = /(Update|ShellSelfUpdate)\.ts$/.test(file);

	const pushProblem = (rule, line, col, message, meta = {}) => {
		const sourceLine = sourceUnit.sourceLineAt(line).trim();
		if (
			reviewed?.matches({
				linter: 'backend-desktop',
				rule,
				file,
				enclosing: meta.enclosing ?? '',
				symbol: meta.symbol,
				target: meta.target,
				sourceLine,
			})
		) {
			return;
		}
		rawProblems.push(`${file}:${line}:${col}: [${rule}] ${message}`);
	};

	const seenRoutes = [];
	const schemaStack = [];

	const enter = (node) => {
		const line = node.loc?.start.line;
		const col = (node.loc?.start.column ?? 0) + 1;

		// Track top-level schema declarators for zod-schema-trap.
		if (checkZod && node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
			const varDecl = parentMap.get(node);
			const varParent = varDecl ? parentMap.get(varDecl) : undefined;
			const isTopLevel =
				varParent === ast.program ||
				(varParent?.type === 'ExportNamedDeclaration' && parentMap.get(varParent) === ast.program);
			if (isTopLevel) {
				const schemaName = node.id.name;
				const isQuery = /Query(Schema)?$/i.test(schemaName);
				const isPatch = /(Update|Patch).*RequestSchema$/i.test(schemaName) || /^Patch.*Schema$/i.test(schemaName);
				if (isQuery || isPatch) {
					schemaStack.push({decl: node, schemaName, isQuery, isPatch});
				}
			}
		}

		// Rule: promise-race-timeout-leak
		if (
			checkRace &&
			node.type === 'CallExpression' &&
			node.callee.type === 'MemberExpression' &&
			node.callee.object.type === 'Identifier' &&
			node.callee.object.name === 'Promise' &&
			node.callee.property.type === 'Identifier' &&
			node.callee.property.name === 'race' &&
			sourceUnit.isLineEnabled(line) &&
			!ignored.has(line)
		) {
			let fnAnc = parentMap.get(node);
			while (fnAnc && !isFunctionNode(fnAnc)) fnAnc = parentMap.get(fnAnc);
			const scopeSrc = fnAnc ? source.slice(fnAnc.start, fnAnc.end) : source.slice(node.start, node.end);
			if (
				/\bsetTimeout\s*\(/.test(scopeSrc) &&
				!/\bclearTimeout\s*\(/.test(scopeSrc) &&
				!/\.unref\s*\(/.test(scopeSrc)
			) {
				pushProblem(
					'promise-race-timeout-leak',
					line,
					col,
					'`Promise.race` with `setTimeout` without `clearTimeout` leaks a refed timer on early completion',
					{enclosing: tsIR.enclosingSymbol(node), target: 'Promise.race'},
				);
			}
		}

		// Rule: api-controller-hygiene (non-isolated test vi.mock)
		if (
			checkApiMock &&
			node.type === 'CallExpression' &&
			node.callee.type === 'MemberExpression' &&
			node.callee.object.type === 'Identifier' &&
			node.callee.object.name === 'vi' &&
			node.callee.property.type === 'Identifier' &&
			(node.callee.property.name === 'mock' || node.callee.property.name === 'doMock') &&
			sourceUnit.isLineEnabled(line) &&
			!ignored.has(line) &&
			!directives.forkCommentPrevLines.has(line)
		) {
			pushProblem(
				'api-controller-hygiene',
				line,
				col,
				`\`vi.${node.callee.property.name}()\` in non-isolated \`fluxer_api\` test leaks across shared module registry (use \`vi.spyOn\`; tyne-chat/tyne#126)`,
				{enclosing: tsIR.enclosingSymbol(node), target: `vi.${node.callee.property.name}()`},
			);
		}

		// Rule: api-controller-hygiene (Controller routes / OpenAPI / scopes)
		if (
			checkApiCtrl &&
			node.type === 'CallExpression' &&
			node.callee.type === 'MemberExpression' &&
			node.callee.property.type === 'Identifier'
		) {
			const method = node.callee.property.name;
			if (['get', 'post', 'put', 'patch', 'delete'].includes(method) && node.arguments[0]?.type === 'StringLiteral') {
				const routePath = node.arguments[0].value;
				const segs = routePath.split('/').filter(Boolean);
				const callSrc = source.slice(node.start, node.end);
				const routeTarget = `${method.toUpperCase()} "${routePath}"`;
				const enclosing = tsIR.enclosingSymbol(node);

				if (sourceUnit.isLineEnabled(line) && !ignored.has(line)) {
					for (const prev of seenRoutes) {
						if (prev.method !== method || prev.segs.length !== segs.length) continue;
						let shadowed = false;
						let samePrefix = true;
						for (let i = 0; i < segs.length; i++) {
							if (prev.segs[i] === segs[i]) continue;
							if (prev.segs[i].startsWith(':') && !segs[i].startsWith(':')) {
								shadowed = true;
							} else if (!prev.segs[i].startsWith(':') && !segs[i].startsWith(':')) {
								samePrefix = false;
								break;
							}
						}
						if (samePrefix && shadowed) {
							pushProblem(
								'api-controller-hygiene',
								line,
								col,
								`${method.toUpperCase()} "${routePath}" is shadowed by earlier "${prev.raw}" at line ${prev.line}`,
								{enclosing, target: routeTarget},
							);
							break;
						}
					}

					if (callSrc.includes('OpenAPI(') && !callSrc.includes('responseSchema') && !callSrc.includes('rawResponse')) {
						pushProblem(
							'api-controller-hygiene',
							line,
							col,
							`${method.toUpperCase()} "${routePath}" has \`OpenAPI()\` without \`responseSchema\` (dropped from openapi.json)`,
							{enclosing, target: routeTarget},
						);
					}

					if (
						/scopes\s*:\s*\[[^\]]+\]/.test(callSrc) &&
						routePath.includes('@me') &&
						!callSrc.includes('requireOAuth2Scope') &&
						!source.includes('requireOAuth2Scope')
					) {
						pushProblem(
							'api-controller-hygiene',
							line,
							col,
							`${method.toUpperCase()} "${routePath}" declares OpenAPI scopes without \`requireOAuth2ScopeForBearer\``,
							{enclosing, target: routeTarget},
						);
					}
				}
				seenRoutes.push({method, segs, raw: routePath, line});
			}
		}

		// Rule: api-controller-hygiene (VIEW_CHANNEL 403 -> 404)
		if (checkApiViewPerm && node.type === 'IfStatement' && sourceUnit.isLineEnabled(line) && !ignored.has(line)) {
			const ifSrc = source.slice(node.start, node.end);
			if (ifSrc.includes('Permissions.VIEW_CHANNEL') && ifSrc.includes('MissingPermissionsError')) {
				pushProblem(
					'api-controller-hygiene',
					line,
					col,
					'`Permissions.VIEW_CHANNEL` failure throws `MissingPermissionsError` (403) instead of `UnknownChannelError` (404)',
					{enclosing: tsIR.enclosingSymbol(node), target: 'Permissions.VIEW_CHANNEL'},
				);
			}
		}

		// Rule: zod-schema-trap
		const activeSchema = schemaStack.at(-1);
		if (activeSchema && sourceUnit.isLineEnabled(line) && !ignored.has(line)) {
			const {schemaName, isQuery, isPatch} = activeSchema;
			if (
				isQuery &&
				node.type === 'CallExpression' &&
				node.callee.type === 'MemberExpression' &&
				node.callee.property.type === 'Identifier' &&
				node.callee.object.type === 'MemberExpression' &&
				node.callee.object.object.type === 'Identifier' &&
				node.callee.object.object.name === 'z' &&
				node.callee.object.property.type === 'Identifier' &&
				node.callee.object.property.name === 'coerce'
			) {
				if (node.callee.property.name === 'boolean') {
					pushProblem(
						'zod-schema-trap',
						line,
						col,
						`\`z.coerce.boolean()\` in \`${schemaName}\` turns \`"false"\` into \`true\` (use \`QueryBooleanType\`)`,
						{enclosing: schemaName, symbol: schemaName, target: 'z.coerce.boolean()'},
					);
				} else if (node.callee.property.name === 'number') {
					let propAnc = parentMap.get(node);
					while (propAnc && propAnc.type !== 'ObjectProperty') propAnc = parentMap.get(propAnc);
					const propSrc = propAnc ? source.slice(propAnc.start, propAnc.end) : '';
					const hasPositiveMin =
						/\.positive\s*\(\s*\)/.test(propSrc) ||
						[...propSrc.matchAll(/\.min\s*\(\s*([+-]?\d+)/g)].some((m) => Number(m[1]) >= 1);
					const hasEmptyGuard = /\bz\.preprocess\s*\(/.test(propSrc);
					if (!hasPositiveMin && !hasEmptyGuard) {
						pushProblem(
							'zod-schema-trap',
							line,
							col,
							`\`z.coerce.number()\` without \`min(>=1)\` in \`${schemaName}\` turns empty \`?k=\` (null) into 0 (use \`createQueryIntegerType\` or positive \`min\`; tyne-chat/tyne#200)`,
							{enclosing: schemaName, symbol: schemaName, target: 'z.coerce.number()'},
						);
					}
				}
			}

			if (
				isQuery &&
				node.type === 'CallExpression' &&
				node.callee.type === 'MemberExpression' &&
				node.callee.property.type === 'Identifier' &&
				node.callee.property.name === 'default'
			) {
				const innerSrc = source.slice(node.callee.object.start, node.callee.object.end);
				if (/\.register\(\s*schemaMetadata\s*,\s*\{[^}]*preserveEmptyValues\s*:\s*true/.test(innerSrc)) {
					pushProblem(
						'zod-schema-trap',
						line,
						col,
						`\`preserveEmptyValues: true\` registered before \`.default()\` in \`${schemaName}\` is hidden from Validator.ts (place \`.register()\` after \`.default()\`; tyne-chat/tyne#200)`,
						{enclosing: schemaName, symbol: schemaName, target: 'preserveEmptyValues'},
					);
				}
			}

			if (
				isPatch &&
				node.type === 'CallExpression' &&
				node.callee.type === 'MemberExpression' &&
				node.callee.property.type === 'Identifier' &&
				node.callee.property.name === 'default'
			) {
				pushProblem(
					'zod-schema-trap',
					line,
					col,
					`\`.default()\` in Update/Patch schema \`${schemaName}\` overwrites stored values when fields are omitted`,
					{enclosing: schemaName, symbol: schemaName, target: '.default()'},
				);
			}
		}

		// Rule: desktop-ipc-sender
		if (
			checkIpc &&
			node.type === 'CallExpression' &&
			node.callee.type === 'MemberExpression' &&
			node.callee.object.type === 'Identifier' &&
			node.callee.object.name === 'ipcMain' &&
			node.callee.property.type === 'Identifier' &&
			(node.callee.property.name === 'handle' || node.callee.property.name === 'on') &&
			sourceUnit.isLineEnabled(line) &&
			!ignored.has(line)
		) {
			const channelNode = node.arguments[0];
			const handlerNode = node.arguments[1];
			if (handlerNode) {
				const isReadonlyStr =
					channelNode?.type === 'StringLiteral' && READONLY_SAFE_IPC_CHANNELS.has(channelNode.value);
				const chLabel = channelNode ? source.slice(channelNode.start, channelNode.end) : '<unknown>';
				const isReadonlyIdent = READONLY_SAFE_IPC_IDENTIFIERS.has(chLabel);
				const isForkGuarded =
					forkGuardedIpcChannels &&
					((channelNode?.type === 'StringLiteral' && forkGuardedIpcChannels.has(channelNode.value)) ||
						forkGuardedIpcChannels.has(chLabel));
				if (!isReadonlyStr && !isReadonlyIdent && !isForkGuarded) {
					let handlerSrc = '';
					if (handlerNode.type === 'Identifier') {
						handlerSrc =
							tsIR.topLevelCallables.get(handlerNode.name) ?? tsIR.allCallableInitializers.get(handlerNode.name) ?? '';
					} else {
						handlerSrc = source.slice(handlerNode.start, handlerNode.end);
					}
					if (handlerSrc && !hasSenderGuardWithHops(handlerSrc, tsIR.topLevelCallables)) {
						pushProblem(
							'desktop-ipc-sender',
							line,
							col,
							`\`ipcMain.${node.callee.property.name}(${chLabel})\` lacks renderer sender validation`,
							{enclosing: tsIR.enclosingSymbol(node), target: chLabel},
						);
					}
				}
			}
		}

		// Rule: desktop-window-safety (dialog + broadcasts)
		if (checkWin && sourceUnit.isLineEnabled(line) && !ignored.has(line)) {
			if (
				isUpdateFile &&
				node.type === 'CallExpression' &&
				node.callee.type === 'MemberExpression' &&
				node.callee.object.type === 'Identifier' &&
				node.callee.object.name === 'dialog' &&
				node.callee.property.type === 'Identifier' &&
				(node.callee.property.name === 'showMessageBox' || node.callee.property.name === 'showMessageBoxSync')
			) {
				pushProblem(
					'desktop-window-safety',
					line,
					col,
					`\`dialog.${node.callee.property.name}\` in update path steals focus (use \`askQuietly\`; tyne-chat/tyne#299)`,
					{enclosing: tsIR.enclosingSymbol(node), target: `dialog.${node.callee.property.name}`},
				);
			}

			if (
				node.type === 'CallExpression' &&
				node.callee.type === 'MemberExpression' &&
				node.callee.object.type === 'Identifier' &&
				node.callee.object.name === 'app' &&
				node.callee.property.type === 'Identifier' &&
				node.callee.property.name === 'on'
			) {
				const cb = node.arguments[1];
				if (cb) {
					const cbSrc = source.slice(cb.start, cb.end);
					if (
						cbSrc.includes('getMainWindow()') &&
						/\.webContents\.send\(/.test(cbSrc) &&
						!cbSrc.includes('getAppWindows')
					) {
						pushProblem(
							'desktop-window-safety',
							line,
							col,
							'`app.on` broadcast targets only `getMainWindow()` and skips extra windows (tyne-chat/tyne#331)',
							{enclosing: tsIR.enclosingSymbol(node), target: 'app.on'},
						);
					}
				}
			}

			if (
				node.type === 'CallExpression' &&
				node.callee.type === 'Identifier' &&
				/^observe[A-Z]/.test(node.callee.name)
			) {
				const cb = node.arguments[0];
				if (cb) {
					const cbSrc = source.slice(cb.start, cb.end);
					if (
						cbSrc.includes('getMainWindow()') &&
						/\.webContents\.send\(/.test(cbSrc) &&
						!cbSrc.includes('getAppWindows')
					) {
						pushProblem(
							'desktop-window-safety',
							line,
							col,
							`\`${node.callee.name}\` broadcast targets only \`getMainWindow()\` and skips extra windows (tyne-chat/tyne#331)`,
							{enclosing: tsIR.enclosingSymbol(node), target: node.callee.name},
						);
					}
				}
			}
		}
	};

	const leave = (node) => {
		if (schemaStack.length > 0 && schemaStack.at(-1).decl === node) {
			schemaStack.pop();
		}
	};

	const afterAst = () => {
		// Rule: non-atomic-index-write via shared FunctionIR.
		if (inApi && !isTest && rules.has('non-atomic-index-write')) {
			for (const fnIR of tsIR.functionList) {
				if (!fnIR.isAsync || !fnIR.node.body || fnIR.directDbWrites.length < 2) continue;
				const bodySrc = source.slice(fnIR.node.body.start, fnIR.node.body.end);
				if (bodySrc.includes('BatchBuilder') || bodySrc.includes('executeGroupedBatches')) continue;
				const uniqueTables = [...new Set(fnIR.directDbWrites.map((w) => w.table))];
				if (areSiblingIndexTables(uniqueTables)) {
					const target =
						fnIR.directDbWrites.find((w) => w.table !== fnIR.directDbWrites[0].table) ?? fnIR.directDbWrites[1];
					if (sourceUnit.isLineEnabled(target.line) && !ignored.has(target.line)) {
						pushProblem(
							'non-atomic-index-write',
							target.line,
							target.col,
							`separate awaited writes to [${uniqueTables.join(', ')}] without BatchBuilder risk index desync`,
							{enclosing: tsIR.enclosingSymbol(fnIR.node, true), symbol: uniqueTables.join(',')},
						);
					}
				}
			}
		}

		// Rule: desktop-window-safety post-await checks via shared FunctionIR.
		if (checkWin) {
			for (const fnIR of tsIR.functionList) {
				if (!fnIR.isAsync || fnIR.node.body?.type !== 'BlockStatement' || fnIR.directAwaitStmtIndices.size === 0) {
					continue;
				}
				const fnEnclosing = tsIR.enclosingSymbol(fnIR.node, true);
				const stmts = fnIR.node.body.body;
				let firstAwaitEnd = -1;
				for (let idx = 0; idx < stmts.length; idx++) {
					const st = stmts[idx];
					if (firstAwaitEnd !== -1 && st.type !== 'TryStatement') {
						const betweenAwaitAndStmt = source.slice(firstAwaitEnd, st.end);
						if (!/\b(isDestroyed|isAliveWindow)\s*\(/.test(betweenAwaitAndStmt)) {
							const scanWindowCalls = (inner) => {
								if (!inner || typeof inner.type !== 'string') return;
								if (
									inner !== st &&
									(inner.type === 'ArrowFunctionExpression' ||
										inner.type === 'FunctionExpression' ||
										inner.type === 'FunctionDeclaration' ||
										inner.type === 'TryStatement')
								) {
									return;
								}
								if (inner.type === 'CallExpression' && inner.callee.type === 'MemberExpression') {
									const callText = source.slice(inner.callee.start, inner.callee.end);
									if (WINDOW_METHOD_CALL_RE.test(callText)) {
										const cLine = inner.loc?.start.line;
										const cCol = (inner.loc?.start.column ?? 0) + 1;
										if (sourceUnit.isLineEnabled(cLine) && !ignored.has(cLine)) {
											pushProblem(
												'desktop-window-safety',
												cLine,
												cCol,
												`post-await \`${callText}()\` without \`isDestroyed()\` / \`isAliveWindow()\` guard`,
												{enclosing: fnEnclosing, target: callText},
											);
										}
									}
								}
								for (const key of Object.keys(inner)) {
									if (key === 'loc' || key.endsWith('Comments')) continue;
									const val = inner[key];
									if (Array.isArray(val)) val.forEach(scanWindowCalls);
									else if (val && typeof val === 'object' && typeof val.type === 'string') scanWindowCalls(val);
								}
							};
							scanWindowCalls(st);
						}
					}
					if (firstAwaitEnd === -1 && fnIR.directAwaitStmtIndices.has(idx)) {
						firstAwaitEnd = st.end;
					}
				}
			}
		}
	};

	return {enter, leave, afterAst};
}
