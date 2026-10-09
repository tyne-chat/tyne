// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

installElectronStub({
	app: {isPackaged: false, getVersion: () => '1.4.0', getPath: () => '/tmp/fluxer-desktop-test'},
	net: {fetch: () => Promise.reject(new Error('outbound network is not available in tests'))},
	shell: {openExternal: () => Promise.resolve()},
});

const {createForkShellUpdateController, isNewerShellVersion} = await import('./ForkShellUpdate.ts');

const VELOPACK = {capability: 'self-update', updater: 'velopack'};
const MACOS = {capability: 'self-update', updater: 'electron'};

function controller(overrides = {}) {
	const calls = [];
	const dependencies = {
		plan: VELOPACK,
		currentVersion: '1.4.0',
		fetchLatestVersion: async () => '1.4.1',
		runSelfUpdate: async (plan) => {
			calls.push(['runSelfUpdate', plan.updater]);
			return {reason: 'download-failed', detail: 'connection reset'};
		},
		reportFailure: async (failure) => {
			calls.push(['reportFailure', failure.reason]);
		},
		openReleasesPage: async () => {
			calls.push(['openReleasesPage']);
		},
		...overrides,
	};
	return {calls, controller: createForkShellUpdateController(dependencies)};
}

describe('comparing release versions', () => {
	test('only a higher version counts as newer', () => {
		assert.equal(isNewerShellVersion('1.4.1', '1.4.0'), true);
		assert.equal(isNewerShellVersion('1.10.0', '1.9.9'), true);
		assert.equal(isNewerShellVersion('1.4.0', '1.4.0'), false);
		assert.equal(isNewerShellVersion('1.3.9', '1.4.0'), false);
	});

	test('a release document with a malformed version is an error, not an update', () => {
		assert.throws(() => isNewerShellVersion('latest', '1.4.0'));
	});
});

describe('checking the fork releases for a shell update', () => {
	test('a newer release is reported as a shell update, never as a module change', async () => {
		const {controller: update} = controller();
		assert.deepEqual(await update.check(), {shellNewer: true, modulesChanged: false});
	});

	test('the same or an older release is not an update', async () => {
		for (const latest of ['1.4.0', '1.3.2']) {
			const {controller: update} = controller({fetchLatestVersion: async () => latest});
			assert.deepEqual(await update.check(), {shellNewer: false, modulesChanged: false});
		}
	});

	test('a failed lookup is passed on, so the prompt can say the check failed', async () => {
		const {controller: update} = controller({
			fetchLatestVersion: async () => {
				throw new Error('Latest release request failed: 404');
			},
		});
		await assert.rejects(update.check(), /404/);
	});
});

describe('installing a shell update', () => {
	test('a self-updating build runs the installer and reports it if that does not go through', async () => {
		const {calls, controller: update} = controller();
		await update.start();
		assert.deepEqual(calls, [
			['runSelfUpdate', 'velopack'],
			['reportFailure', 'download-failed'],
		]);
	});

	test('a feed that turns out to hold nothing newer is not shown as a failure', async () => {
		const {calls, controller: update} = controller({
			runSelfUpdate: async () => ({reason: 'no-update', detail: null}),
		});
		await update.start();
		assert.deepEqual(calls, []);
	});

	test('the unsigned macOS build opens the releases page instead of trying to replace itself', async () => {
		const {calls, controller: update} = controller({plan: MACOS});
		await update.start();
		assert.deepEqual(calls, [['openReleasesPage']]);
	});
});
