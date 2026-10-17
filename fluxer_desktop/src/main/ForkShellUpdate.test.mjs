// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

const NO_NETWORK = () => Promise.reject(new Error('outbound network is not available in tests'));
const net = {fetch: NO_NETWORK};

installElectronStub({
	app: {isPackaged: false, getVersion: () => '1.4.0', getPath: () => '/tmp/fluxer-desktop-test'},
	net,
	shell: {openExternal: () => Promise.resolve()},
});

const {
	createForkShellUpdateController,
	createForkUpdateProgress,
	createRestartConfirmation,
	fetchLatestReleaseVersion,
	ForkUpdateAnnouncements,
	isNewerShellVersion,
	progressDocument,
} = await import('./ForkShellUpdate.ts');

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

describe('announcing a release found by a background check', () => {
	const AVAILABLE = {available: true, updating: false};

	test('a release is announced once, however often the check runs', () => {
		const announcements = new ForkUpdateAnnouncements();
		assert.equal(announcements.shouldAnnounce('1.4.1', AVAILABLE), true);
		assert.equal(announcements.shouldAnnounce('1.4.1', AVAILABLE), false);
		assert.equal(announcements.shouldAnnounce('1.4.1', AVAILABLE), false);
	});

	test('a still newer release is announced again', () => {
		const announcements = new ForkUpdateAnnouncements();
		assert.equal(announcements.shouldAnnounce('1.4.1', AVAILABLE), true);
		assert.equal(announcements.shouldAnnounce('1.4.2', AVAILABLE), true);
		assert.equal(announcements.shouldAnnounce('1.4.2', AVAILABLE), false);
	});

	test('nothing is announced when there is no update, or one is already installing', () => {
		const announcements = new ForkUpdateAnnouncements();
		assert.equal(announcements.shouldAnnounce('1.4.1', {available: false, updating: false}), false);
		assert.equal(announcements.shouldAnnounce('1.4.1', {available: false, updating: true}), false);
		assert.equal(announcements.shouldAnnounce(null, AVAILABLE), false);
		// None of those counted as having announced it.
		assert.equal(announcements.shouldAnnounce('1.4.1', AVAILABLE), true);
	});
});

describe('showing the progress of an update', () => {
	function surface(failing = new Set()) {
		const calls = [];
		const step =
			(name) =>
			(...args) => {
				calls.push([name, ...args]);
				if (failing.has(name)) throw new Error(`${name} failed`);
			};
		return {
			calls,
			surface: {
				open: step('open'),
				downloading: step('downloading'),
				restarting: step('restarting'),
				close: step('close'),
			},
		};
	}

	test('nothing is shown until the download starts', () => {
		const {calls, surface: target} = surface();
		const progress = createForkUpdateProgress(target);
		progress.close();
		assert.deepEqual(calls, []);
	});

	test('the window opens once and follows the download to the restart', () => {
		const {calls, surface: target} = surface();
		const progress = createForkUpdateProgress(target);
		progress.onDownloading(0);
		progress.onDownloading(40);
		progress.onDownloading(null);
		progress.onRestarting();
		assert.deepEqual(calls, [['open'], ['downloading', 0], ['downloading', 40], ['downloading', null], ['restarting']]);
	});

	test('a failed update closes the window, and a retry opens it again', () => {
		const {calls, surface: target} = surface();
		const progress = createForkUpdateProgress(target);
		progress.onDownloading(10);
		progress.close();
		progress.close();
		progress.onDownloading(0);
		assert.deepEqual(calls, [['open'], ['downloading', 10], ['close'], ['open'], ['downloading', 0]]);
	});

	test('a fault in showing progress does not reach the update', () => {
		const {calls, surface: target} = surface(new Set(['open', 'downloading', 'restarting', 'close']));
		const progress = createForkUpdateProgress(target);
		assert.doesNotThrow(() => {
			progress.onDownloading(5);
			progress.onRestarting();
			progress.close();
		});
		assert.deepEqual(
			calls.map(([name]) => name),
			['open', 'downloading', 'restarting', 'close'],
		);
	});
});

describe('asking before the app closes to install a downloaded update', () => {
	const silentSurface = {open() {}, downloading() {}, restarting() {}, close() {}};

	test('after a download the user is asked, and the answer decides', async () => {
		for (const answer of [true, false]) {
			const progress = createForkUpdateProgress(silentSurface);
			progress.onDownloading(100);
			let asked = 0;
			const confirm = createRestartConfirmation(progress, async () => {
				asked += 1;
				return answer;
			});
			assert.equal(await confirm(), answer);
			assert.equal(asked, 1);
		}
	});

	test('an update that was already on disk installs without a second question', async () => {
		const progress = createForkUpdateProgress(silentSurface);
		const confirm = createRestartConfirmation(progress, async () => {
			throw new Error('must not be asked');
		});
		assert.equal(await confirm(), true);
	});

	test('if the question cannot be shown the app is not closed', async () => {
		const progress = createForkUpdateProgress(silentSurface);
		progress.onDownloading(100);
		const confirm = createRestartConfirmation(progress, async () => {
			throw new Error('no dialog');
		});
		assert.equal(await confirm(), false);
	});

	test('putting the restart off is not reported as a failure', async () => {
		const {calls, controller: update} = controller({
			runSelfUpdate: async () => ({reason: 'postponed', detail: null}),
		});
		await update.start();
		assert.deepEqual(calls, []);
	});
});

describe('the update progress window', () => {
	test('shows a version from the release feed as text, never as markup', () => {
		const page = progressDocument('Updating to <img src=x onerror=alert(1)>', 'Fish & "chips" \'n\' <b>');

		assert.ok(!page.includes('<img'));
		assert.ok(!page.includes('<b>'));
		assert.ok(page.includes('&#60;img src=x onerror=alert(1)&#62;'));
		assert.ok(page.includes('Fish &#38; &#34;chips&#34; &#39;n&#39; &#60;b&#62;'));
	});
});

describe('reading the latest fork release', () => {
	const respond = (status, body) => {
		net.fetch = async () => new Response(JSON.stringify(body), {status});
	};

	test('returns the version the release document names', async (t) => {
		t.after(() => {
			net.fetch = NO_NETWORK;
		});
		respond(200, {version: '1.5.0'});
		assert.equal(await fetchLatestReleaseVersion('https://releases.example.test/latest.json'), '1.5.0');
	});

	test('fails on an error response instead of reading it', async (t) => {
		t.after(() => {
			net.fetch = NO_NETWORK;
		});
		respond(503, {version: '9.9.9'});
		await assert.rejects(fetchLatestReleaseVersion('https://releases.example.test/latest.json'), /503/);
	});

	test('fails on a release document without a version', async (t) => {
		t.after(() => {
			net.fetch = NO_NETWORK;
		});
		for (const body of [{}, {version: ''}, {version: 15}]) {
			respond(200, body);
			await assert.rejects(fetchLatestReleaseVersion('https://releases.example.test/latest.json'), /no version/);
		}
	});
});
