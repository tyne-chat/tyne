// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests of scripts/fork-backend-desktop-lint.mjs (tyne-chat/tyne#947).

import {describe, expect, it} from 'vitest';
import {lintBackendDesktopFile} from '../../../../scripts/fork-backend-desktop-lint.mjs';
import {ReviewedLintCatalog, ReviewedLintEntry} from '../../../../scripts/fork-lint-reviewed.mjs';

const lint = (
	relFile: string,
	source: string,
	lines: 'all' | Set<number> = 'all',
	reviewed?: ReviewedLintCatalog,
	forkGuardedIpcChannels?: Set<string>,
): Array<string> => lintBackendDesktopFile(relFile, source, lines, {reviewed, forkGuardedIpcChannels});

describe('fork-backend-desktop-lint', () => {
	it('flags non-atomic-index-write across base and *By* index tables without BatchBuilder', () => {
		const problems = lint(
			'fluxer_api/src/api/user/ExampleRepo.ts',
			[
				'export class ExampleRepo {',
				'\tasync bad(id: string) {',
				'\t\tawait upsertOne(Users.upsertAll({id}));',
				'\t\tawait upsertOne(UsersByName.upsertAll({id}));',
				'\t}',
				'\tasync good(id: string) {',
				'\t\tconst batch = new BatchBuilder();',
				'\t\tbatch.addPrepared(Users.upsertAll({id}));',
				'\t\tbatch.addPrepared(UsersByName.upsertAll({id}));',
				'\t\tawait batch.execute();',
				'\t}',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'fluxer_api/src/api/user/ExampleRepo.ts:4:3: [non-atomic-index-write] separate awaited writes to [Users, UsersByName] without BatchBuilder risk index desync',
		]);
	});

	it('flags zod-schema-trap for coercive query traps, metadata order, and patch defaults', () => {
		const problems = lint(
			'packages/schema/src/domains/persona/ExampleSchemas.ts',
			[
				'export const BadQuerySchema = z.object({',
				'\toffset: z.coerce.number().int().min(0).optional().default(0),',
				'\tflag: z.coerce.boolean().optional(),',
				"\tq: z.string().register(schemaMetadata, {preserveEmptyValues: true}).optional().default(''),",
				'});',
				'export const BadUpdateRequestSchema = z.object({',
				"\tvisibility: z.enum(['public', 'private']).optional().default('private'),",
				'});',
				'export const GoodQuerySchema = z.object({',
				'\tlimit: createQueryIntegerType({defaultValue: 10, minValue: 1, maxValue: 100}),',
				'\tbounded: z.coerce.number().int().min(1).max(1000).optional().default(100),',
				"\tq: z.string().optional().default('').register(schemaMetadata, {preserveEmptyValues: true}),",
				'});',
			].join('\n'),
		);
		expect(problems).toEqual([
			'packages/schema/src/domains/persona/ExampleSchemas.ts:2:10: [zod-schema-trap] `z.coerce.number()` without `min(>=1)` in `BadQuerySchema` turns empty `?k=` (null) into 0 (use `createQueryIntegerType` or positive `min`; tyne-chat/tyne#200)',
			'packages/schema/src/domains/persona/ExampleSchemas.ts:3:8: [zod-schema-trap] `z.coerce.boolean()` in `BadQuerySchema` turns `"false"` into `true` (use `QueryBooleanType`)',
			'packages/schema/src/domains/persona/ExampleSchemas.ts:4:5: [zod-schema-trap] `preserveEmptyValues: true` registered before `.default()` in `BadQuerySchema` is hidden from Validator.ts (place `.register()` after `.default()`; tyne-chat/tyne#200)',
			'packages/schema/src/domains/persona/ExampleSchemas.ts:7:14: [zod-schema-trap] `.default()` in Update/Patch schema `BadUpdateRequestSchema` overwrites stored values when fields are omitted',
		]);
	});

	it('flags promise-race-timeout-leak unless clearTimeout or .unref() is used', () => {
		const problems = lint(
			'fluxer_api/src/api/search/ExampleTracker.ts',
			[
				'export async function bad(p: Promise<void>) {',
				'\tawait Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("t")), 5000))]);',
				'}',
				'export async function goodCleared(p: Promise<void>) {',
				'\tlet t: NodeJS.Timeout | undefined;',
				'\ttry {',
				'\t\tawait Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("t")), 5000); })]);',
				'\t} finally { clearTimeout(t); }',
				'}',
				'export async function goodUnref(p: Promise<void>) {',
				'\tawait Promise.race([p, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error("t")), 5000); t.unref(); })]);',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'fluxer_api/src/api/search/ExampleTracker.ts:2:8: [promise-race-timeout-leak] `Promise.race` with `setTimeout` without `clearTimeout` leaks a refed timer on early completion',
		]);
	});

	it('flags desktop-ipc-sender and desktop-window-safety patterns', () => {
		const ipcProblems = lint(
			'fluxer_desktop/src/main/ExampleIpc.ts',
			[
				'export function reg() {',
				"\tipcMain.handle('get-desktop-info', () => ({}));",
				"\tipcMain.handle('danger-relaunch', () => relaunch());",
				"\tipcMain.handle('safe-op', (event) => { requirePrivilegedRendererDocumentSender(event, 'safe-op'); });",
				'}',
			].join('\n'),
		);
		expect(ipcProblems).toEqual([
			"fluxer_desktop/src/main/ExampleIpc.ts:3:2: [desktop-ipc-sender] `ipcMain.handle('danger-relaunch')` lacks renderer sender validation",
		]);

		const winProblems = lint(
			'fluxer_desktop/src/main/ForkShellUpdate.ts',
			[
				'export async function run(window: BrowserWindow) {',
				'\tawait dialog.showMessageBox(window, {});',
				"\twindow.webContents.send('done');",
				'}',
				'export function wire() {',
				"\tobserveDesktopUpdateState((s) => { const mw = getMainWindow(); if (mw && !mw.isDestroyed()) mw.webContents.send('u', s); });",
				'}',
			].join('\n'),
		);
		expect(winProblems).toEqual([
			'fluxer_desktop/src/main/ForkShellUpdate.ts:2:8: [desktop-window-safety] `dialog.showMessageBox` in update path steals focus (use `askQuietly`; tyne-chat/tyne#299)',
			'fluxer_desktop/src/main/ForkShellUpdate.ts:3:2: [desktop-window-safety] post-await `window.webContents.send()` without `isDestroyed()` / `isAliveWindow()` guard',
			'fluxer_desktop/src/main/ForkShellUpdate.ts:6:2: [desktop-window-safety] `observeDesktopUpdateState` broadcast targets only `getMainWindow()` and skips extra windows (tyne-chat/tyne#331)',
		]);
	});

	it('flags api-controller-hygiene (shadowing, missing responseSchema, 403 VIEW_CHANNEL, non-isolated vi.mock)', () => {
		expect(
			lint(
				'fluxer_api/src/api/persona/ExampleController.ts',
				[
					"app.get('/:id', handler);",
					"app.get('/search', OpenAPI({scopes: ['personas.read']}), handler);",
					'export async function check(hasPermission: (p: bigint) => Promise<boolean>) {',
					'\tif (!(await hasPermission(Permissions.VIEW_CHANNEL))) throw new MissingPermissionsError();',
					'}',
				].join('\n'),
			),
		).toEqual([
			'fluxer_api/src/api/persona/ExampleController.ts:2:1: [api-controller-hygiene] GET "/search" is shadowed by earlier "/:id" at line 1',
			'fluxer_api/src/api/persona/ExampleController.ts:2:1: [api-controller-hygiene] GET "/search" has `OpenAPI()` without `responseSchema` (dropped from openapi.json)',
			'fluxer_api/src/api/persona/ExampleController.ts:4:2: [api-controller-hygiene] `Permissions.VIEW_CHANNEL` failure throws `MissingPermissionsError` (403) instead of `UnknownChannelError` (404)',
		]);

		expect(
			lint(
				'fluxer_api/src/api/persona/Example.test.ts',
				["vi.mock('@app/api/Logger');", '// Fork: intentionally tested under spy', "vi.spyOn(obj, 'fn');"].join('\n'),
			),
		).toEqual([
			'fluxer_api/src/api/persona/Example.test.ts:1:1: [api-controller-hygiene] `vi.mock()` in non-isolated `fluxer_api` test leaks across shared module registry (use `vi.spyOn`; tyne-chat/tyne#126)',
		]);
	});

	it('flags rust-async-blocking-fs only in async fn and ignores sync fn and #[cfg(test)]', () => {
		const problems = lint(
			'fluxer_app_proxy/src/example.rs',
			[
				'fn sync_helper(p: &str) { let _ = std::fs::read(p); }',
				'async fn bad_handler(p: &str) {',
				'    let _ = std::fs::read(p);',
				'}',
				'#[cfg(test)]',
				'mod tests {',
				'    async fn ok_test() { let _ = std::fs::read("x"); }',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'fluxer_app_proxy/src/example.rs:3:13: [rust-async-blocking-fs] blocking `std::fs::read` inside `async fn bad_handler` (use `tokio::fs` or `spawn_blocking`)',
		]);
	});

	it('allows std::fs inside blocking(move || ...) and spawn_blocking closures while flagging async eager args', () => {
		const problems = lint(
			'fluxer_media_proxy/src/example.rs',
			[
				'async fn ok_blocking(root: PathBuf) {',
				'    let _ = blocking(move || {',
				'        let f = std::fs::File::open(&root);',
				'        std::fs::read(&root)',
				'    }).await;',
				'}',
				'async fn ok_spawn_blocking(p: PathBuf) {',
				'    let _ = tokio::task::spawn_blocking(move || std::fs::read(&p)).await;',
				'}',
				'async fn bad_eager_arg(p: PathBuf) {',
				'    let _ = blocking(std::fs::read(&p)).await;',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'fluxer_media_proxy/src/example.rs:11:22: [rust-async-blocking-fs] blocking `std::fs::read` inside `async fn bad_eager_arg` (use `tokio::fs` or `spawn_blocking`)',
		]);
	});

	it('flags gleam-fork-test-sleep inside fork *_test() while allowing mock helper functions', () => {
		const problems = lint(
			'fluxer_gateway/test/fluxer_gateway/fork/example_test.gleam',
			[
				'fn slow_api_helper() {',
				'  process.sleep(500)',
				'}',
				'pub fn bad_wait_test() {',
				'  process.sleep(50)',
				'  // safety-lint-ignore: intentional fake clock probe',
				'  process.sleep(10)',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'fluxer_gateway/test/fluxer_gateway/fork/example_test.gleam:5:3: [gleam-fork-test-sleep] `process.sleep()` inside fork test `bad_wait_test` makes tests slow/flaky (synchronize on actor/monitor state instead)',
		]);
	});

	it('suppresses reviewed backend/desktop exceptions across line shifts without affecting unreviewed ones', () => {
		const catalog = ReviewedLintCatalog.fromEntries([
			new ReviewedLintEntry({
				linter: 'backend-desktop',
				rule: 'desktop-ipc-sender',
				file: 'fluxer_desktop/src/main/ExampleIpc.ts',
				enclosing: 'registerHandlers',
				target: "'reviewed-channel'",
				reason: 'audited channel',
			}),
		]);

		const source = [
			'export function registerHandlers() {',
			"\tipcMain.handle('reviewed-channel', () => doReviewed());",
			"\tipcMain.handle('unreviewed-channel', () => doOther());",
			'}',
		].join('\n');

		expect(lint('fluxer_desktop/src/main/ExampleIpc.ts', `\n\n${source}`, 'all', catalog)).toEqual([
			"fluxer_desktop/src/main/ExampleIpc.ts:5:2: [desktop-ipc-sender] `ipcMain.handle('unreviewed-channel')` lacks renderer sender validation",
		]);
		expect(catalog.unmatchedEntries('backend-desktop')).toEqual([]);
	});

	it('recognizes 2-hop IPC sender helpers, webContents equality, read-only identifiers, and ForkPrivilegedIpcGuard coverage', () => {
		const problems = lint(
			'fluxer_desktop/src/main/ExampleGuards.ts',
			[
				'function innerCheck(event: Electron.IpcMainEvent) {',
				'\treturn isPrivilegedRendererDocumentSender(event);',
				'}',
				'function middleCheck(event: Electron.IpcMainEvent) {',
				'\treturn innerCheck(event);',
				'}',
				'export function reg(harvestWindow: BrowserWindow) {',
				"\tipcMain.on('two-hop', (event) => { if (!middleCheck(event)) return; });",
				"\tipcMain.handle('harvest', (event) => { if (event.sender !== harvestWindow.webContents) throw new Error(); });",
				'\tipcMain.on(DESKTOP_CAPABILITY_MANIFEST_CHANNEL, () => {});',
				"\tipcMain.handle('guarded-by-fork', () => {});",
				"\tipcMain.handle('unguarded-custom', () => {});",
				'}',
			].join('\n'),
			'all',
			undefined,
			new Set(['guarded-by-fork']),
		);
		expect(problems).toEqual([
			"fluxer_desktop/src/main/ExampleGuards.ts:12:2: [desktop-ipc-sender] `ipcMain.handle('unguarded-custom')` lacks renderer sender validation",
		]);
	});

	it('allows z.coerce.number().min(0) when wrapped in z.preprocess while flagging unguarded coerce', () => {
		const problems = lint(
			'packages/schema/src/domains/guild/ExampleSchemas.ts',
			[
				'export const QuerySchema = z.object({',
				'\tsafeOffset: z.preprocess(rejectEmptyQueryNumber, z.coerce.number().int().min(0).optional()),',
				'\tbadOffset: z.coerce.number().int().min(0).optional(),',
				'});',
			].join('\n'),
			'all',
		);
		expect(problems).toEqual([
			'packages/schema/src/domains/guild/ExampleSchemas.ts:3:13: [zod-schema-trap] `z.coerce.number()` without `min(>=1)` in `QuerySchema` turns empty `?k=` (null) into 0 (use `createQueryIntegerType` or positive `min`; tyne-chat/tyne#200)',
		]);
	});
});
