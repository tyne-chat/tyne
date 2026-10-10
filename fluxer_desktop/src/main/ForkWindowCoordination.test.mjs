// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, test} from 'node:test';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

installElectronStub();

const {ForkNotificationClaims, ForkWindowAccountSync, ForkWindowLoadQueue, ForkWindowRestingBounds} = await import(
	'./ForkWindowCoordination.ts'
);

const MAIN = 1;
const EXTRA = 2;
const THIRD = 3;

describe('one window announces each new message', () => {
	test('the first window to ask may announce, the others may not', () => {
		const claims = new ForkNotificationClaims();
		const request = {key: 'message-1', channelId: 'channel-1', focusedWindowId: null};
		assert.equal(claims.claim({...request, windowId: MAIN}), true);
		assert.equal(claims.claim({...request, windowId: EXTRA}), false);
		assert.equal(claims.claim({...request, windowId: THIRD}), false);
	});

	test('different messages are claimed independently', () => {
		const claims = new ForkNotificationClaims();
		assert.equal(claims.claim({windowId: MAIN, key: 'a', channelId: 'c', focusedWindowId: null}), true);
		assert.equal(claims.claim({windowId: EXTRA, key: 'b', channelId: 'c', focusedWindowId: null}), true);
	});

	test('a background window stays quiet when the focused window is showing that channel', () => {
		const claims = new ForkNotificationClaims();
		claims.setViewedChannel(MAIN, 'channel-1');
		const fromBackground = {windowId: EXTRA, key: 'message-1', channelId: 'channel-1', focusedWindowId: MAIN};
		assert.equal(claims.claim(fromBackground), false);
		// It did not use up the claim: the focused window still records the message as its own.
		assert.equal(claims.claim({...fromBackground, windowId: MAIN}), true);
	});

	test('a message in another channel is still announced while a window has focus', () => {
		const claims = new ForkNotificationClaims();
		claims.setViewedChannel(MAIN, 'channel-1');
		assert.equal(claims.claim({windowId: EXTRA, key: 'm', channelId: 'channel-2', focusedWindowId: MAIN}), true);
	});

	test('a window that lost focus or closed no longer silences its channel', () => {
		const claims = new ForkNotificationClaims();
		claims.setViewedChannel(MAIN, 'channel-1');
		claims.setViewedChannel(MAIN, null);
		assert.equal(claims.claim({windowId: EXTRA, key: 'm1', channelId: 'channel-1', focusedWindowId: MAIN}), true);
		claims.setViewedChannel(MAIN, 'channel-1');
		claims.releaseWindow(MAIN);
		assert.equal(claims.claim({windowId: EXTRA, key: 'm2', channelId: 'channel-1', focusedWindowId: MAIN}), true);
	});

	test('events without a channel, such as friend requests, are claimed once', () => {
		const claims = new ForkNotificationClaims();
		const request = {key: 'relationship_1_42', channelId: null, focusedWindowId: MAIN};
		assert.equal(claims.claim({...request, windowId: EXTRA}), true);
		assert.equal(claims.claim({...request, windowId: MAIN}), false);
	});

	test('old claims are forgotten so the record cannot grow without bound', () => {
		const claims = new ForkNotificationClaims();
		for (let index = 0; index < 2000; index += 1) {
			claims.claim({windowId: MAIN, key: `message-${index}`, channelId: null, focusedWindowId: null});
		}
		assert.equal(claims.claim({windowId: EXTRA, key: 'message-0', channelId: null, focusedWindowId: null}), true);
		assert.equal(claims.claim({windowId: EXTRA, key: 'message-1999', channelId: null, focusedWindowId: null}), false);
	});
});

describe('every window stays on the same account', () => {
	test('windows that load and restore the same account are left alone', () => {
		const sync = new ForkWindowAccountSync();
		assert.deepEqual(sync.report(MAIN, null), []);
		assert.deepEqual(sync.report(MAIN, 'account-a'), []);
		assert.deepEqual(sync.report(EXTRA, null), []);
		assert.deepEqual(sync.report(EXTRA, 'account-a'), []);
	});

	test('signing in from one window reloads the windows still on the sign-in page', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, null);
		sync.report(EXTRA, null);
		assert.deepEqual(sync.report(MAIN, 'account-a'), [EXTRA]);
		// The reloaded window loads, restores the account, and nothing further happens.
		assert.deepEqual(sync.report(EXTRA, null), []);
		assert.deepEqual(sync.report(EXTRA, 'account-a'), []);
	});

	test('signing out from one window reloads the windows still signed in', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.report(EXTRA, 'account-a');
		sync.report(THIRD, 'account-a');
		assert.deepEqual(sync.report(EXTRA, null).sort(), [MAIN, THIRD]);
		assert.deepEqual(sync.report(MAIN, null), []);
		assert.deepEqual(sync.report(THIRD, null), []);
	});

	test('switching account in one window reloads the others onto it', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.report(EXTRA, 'account-a');
		assert.deepEqual(sync.report(MAIN, 'account-b'), [EXTRA]);
		assert.deepEqual(sync.report(EXTRA, 'account-b'), []);
	});

	test('a window that is still loading is left to finish', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.forget(EXTRA);
		assert.deepEqual(sync.report(MAIN, 'account-b'), []);
		assert.deepEqual(sync.report(EXTRA, null), []);
		assert.deepEqual(sync.report(EXTRA, 'account-b'), []);
	});

	test('a window that loaded during a switch and restored the old account reloads itself', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.forget(EXTRA);
		sync.report(MAIN, 'account-b');
		sync.report(EXTRA, null);
		// It read the account store before the switch was saved. The up-to-date window stays.
		assert.deepEqual(sync.report(EXTRA, 'account-a'), [EXTRA]);
		assert.deepEqual(sync.report(EXTRA, null), []);
		assert.deepEqual(sync.report(EXTRA, 'account-b'), []);
	});

	test('signing in again after signing out everywhere is a sign-in, not a stale window', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.report(EXTRA, 'account-a');
		assert.deepEqual(sync.report(MAIN, null), [EXTRA]);
		sync.forget(EXTRA);
		assert.deepEqual(sync.report(EXTRA, null), []);
		assert.deepEqual(sync.report(EXTRA, 'account-b'), [MAIN]);
	});

	test('a sign-out that reaches a window before it is reloaded causes no further reloads', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.report(EXTRA, 'account-a');
		sync.report(THIRD, 'account-a');
		// EXTRA is thrown out by the server before MAIN, which signed out, has reported.
		assert.deepEqual(sync.report(EXTRA, null).sort(), [MAIN, THIRD]);
		assert.deepEqual(sync.report(MAIN, null), []);
	});

	test('repeating the same account changes nothing', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.report(EXTRA, 'account-a');
		assert.deepEqual(sync.report(MAIN, 'account-a'), []);
		assert.deepEqual(sync.report(EXTRA, 'account-a'), []);
	});

	test('a closed window is never asked to reload', () => {
		const sync = new ForkWindowAccountSync();
		sync.report(MAIN, 'account-a');
		sync.report(EXTRA, 'account-a');
		sync.releaseWindow(EXTRA);
		assert.deepEqual(sync.report(MAIN, null), []);
	});

	test('two windows that keep disagreeing stop reloading each other', () => {
		let now = 0;
		const sync = new ForkWindowAccountSync(() => now);
		let reloads = 0;
		for (let round = 0; round < 20; round += 1) {
			now += 100;
			reloads += sync.report(MAIN, 'account-a').length;
			reloads += sync.report(EXTRA, 'account-b').length;
		}
		assert.ok(reloads <= 6, `${reloads} reloads`);
		// After a quiet spell a real change is acted on again.
		now += 60_000;
		sync.report(MAIN, 'account-a');
		sync.report(EXTRA, 'account-a');
		assert.deepEqual(sync.report(MAIN, 'account-c'), [EXTRA]);
	});
});

describe('app windows load one at a time', () => {
	test('a window starts at once when nothing is loading', () => {
		const queue = new ForkWindowLoadQueue();
		const started = [];
		queue.enqueue(EXTRA, () => started.push(EXTRA));
		assert.deepEqual(started, [EXTRA]);
		assert.equal(queue.isLoading(EXTRA), true);
	});

	test('windows wait for the one ahead and start in order', () => {
		const queue = new ForkWindowLoadQueue();
		const started = [];
		queue.markLoading(MAIN);
		queue.enqueue(EXTRA, () => started.push(EXTRA));
		queue.enqueue(THIRD, () => started.push(THIRD));
		assert.deepEqual(started, []);
		queue.settle(MAIN);
		assert.deepEqual(started, [EXTRA]);
		queue.settle(EXTRA);
		assert.deepEqual(started, [EXTRA, THIRD]);
	});

	test('a window that closes while waiting is skipped', () => {
		const queue = new ForkWindowLoadQueue();
		const started = [];
		queue.markLoading(MAIN);
		queue.enqueue(EXTRA, () => started.push(EXTRA));
		queue.enqueue(THIRD, () => started.push(THIRD));
		queue.settle(EXTRA);
		queue.settle(MAIN);
		assert.deepEqual(started, [THIRD]);
	});

	test('settling a window that is not loading does not let two load together', () => {
		const queue = new ForkWindowLoadQueue();
		const started = [];
		queue.markLoading(MAIN);
		queue.enqueue(EXTRA, () => started.push(EXTRA));
		queue.settle(THIRD);
		queue.settle(THIRD);
		assert.deepEqual(started, []);
	});

	test('a window that gives up as it starts lets the next one go', () => {
		const queue = new ForkWindowLoadQueue();
		const started = [];
		queue.markLoading(MAIN);
		queue.enqueue(EXTRA, () => queue.settle(EXTRA));
		queue.enqueue(THIRD, () => started.push(THIRD));
		queue.settle(MAIN);
		assert.deepEqual(started, [THIRD]);
	});

	test('a start that throws does not block the queue', () => {
		const queue = new ForkWindowLoadQueue();
		const started = [];
		queue.markLoading(MAIN);
		queue.enqueue(EXTRA, () => {
			throw new Error('window is gone');
		});
		queue.enqueue(THIRD, () => started.push(THIRD));
		queue.settle(MAIN);
		assert.deepEqual(started, [THIRD]);
	});
});

describe('each window goes back to its own place after fullscreen', () => {
	const MAIN_PLACE = {x: 100, y: 100, width: 1200, height: 800};
	const EXTRA_PLACE = {x: 2600, y: 150, width: 900, height: 700};
	const SECOND_MONITOR = {x: 1920, y: 0, width: 2560, height: 1440};
	const DELAY_MS = 500;

	test('a second window on another monitor is not sent to the main window', () => {
		const resting = new ForkWindowRestingBounds();
		resting.record(MAIN, MAIN_PLACE);
		resting.record(EXTRA, EXTRA_PLACE);
		assert.deepEqual(resting.get(EXTRA), EXTRA_PLACE);
		assert.deepEqual(resting.get(MAIN), MAIN_PLACE);
	});

	test('a window that was moved goes back to where it was moved to', (t) => {
		t.mock.timers.enable({apis: ['setTimeout']});
		const resting = new ForkWindowRestingBounds();
		resting.record(EXTRA, MAIN_PLACE);
		resting.noteChange(EXTRA, () => EXTRA_PLACE, DELAY_MS);
		t.mock.timers.tick(DELAY_MS);
		assert.deepEqual(resting.get(EXTRA), EXTRA_PLACE);
	});

	test('the move into fullscreen does not replace the place to go back to', (t) => {
		t.mock.timers.enable({apis: ['setTimeout']});
		const resting = new ForkWindowRestingBounds();
		resting.record(EXTRA, EXTRA_PLACE);
		let fullscreen = false;
		const read = () => (fullscreen ? null : SECOND_MONITOR);
		// The window reports its fullscreen size before anything says it is fullscreen.
		resting.noteChange(EXTRA, read, DELAY_MS);
		fullscreen = true;
		t.mock.timers.tick(DELAY_MS);
		assert.deepEqual(resting.get(EXTRA), EXTRA_PLACE);
	});

	test('a window still being dragged is read once, when it stops', (t) => {
		t.mock.timers.enable({apis: ['setTimeout']});
		const resting = new ForkWindowRestingBounds();
		let reads = 0;
		const read = () => {
			reads += 1;
			return EXTRA_PLACE;
		};
		resting.noteChange(EXTRA, read, DELAY_MS);
		t.mock.timers.tick(DELAY_MS - 1);
		resting.noteChange(EXTRA, read, DELAY_MS);
		t.mock.timers.tick(DELAY_MS - 1);
		assert.equal(reads, 0);
		t.mock.timers.tick(1);
		assert.equal(reads, 1);
	});

	test('a closed window is forgotten, along with a read that was still waiting', (t) => {
		t.mock.timers.enable({apis: ['setTimeout']});
		const resting = new ForkWindowRestingBounds();
		resting.record(EXTRA, EXTRA_PLACE);
		resting.noteChange(EXTRA, () => MAIN_PLACE, DELAY_MS);
		resting.releaseWindow(EXTRA);
		t.mock.timers.tick(DELAY_MS);
		assert.equal(resting.get(EXTRA), null);
	});

	test("upstream's fullscreen guard asks for the bounds of the window it is given", () => {
		const source = readFileSync(new URL('./Window.ts', import.meta.url), 'utf-8');
		const guard = source.slice(
			source.indexOf('function enterWindowsHtmlFullscreenChromeGuard('),
			source.indexOf('function restoreWindowsHtmlFullscreenBounds('),
		);
		assert.match(guard, /const bounds = forkBoundsBeforeHtmlFullscreen\(window\);/);
		assert.doesNotMatch(guard, /lastGoodWindowBounds/);
	});
});
