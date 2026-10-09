// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

installElectronStub();

const {
	FORK_EXTRA_APP_WINDOWS_MAX,
	cascadeForkWindowBounds,
	fitForkWindowBounds,
	forkAppWindowRouteFromUrl,
	forkAppWindowUrl,
	isForkAppWindowRoute,
	parseForkWindowSession,
	planForkWindowRestore,
	serializeForkWindowSession,
} = await import('./ForkWindowSession.ts');

const APP_URL = 'fluxer-app://app/';
const BOUNDS = {x: 100, y: 80, width: 1200, height: 800};

function entry(overrides = {}) {
	return {
		route: '/channels/1/2',
		bounds: BOUNDS,
		isMaximized: false,
		isMainWindow: false,
		isFocused: false,
		...overrides,
	};
}

function sessionFile(windows, version = 1) {
	return JSON.stringify({version, windows});
}

describe('routes an app window may open on', () => {
	test('in-app routes are accepted', () => {
		assert.equal(isForkAppWindowRoute('/channels/@me'), true);
		assert.equal(isForkAppWindowRoute('/channels/123/456'), true);
		assert.equal(isForkAppWindowRoute('/channels/123/456?jump=789'), true);
	});

	test('anything that could leave the app document is rejected', () => {
		for (const route of [
			'',
			'channels/1',
			'//evil.example/channels/1',
			'/channels/../../etc/passwd',
			'/x?next=https://evil.example',
			'/channels\\1',
			'https://evil.example/',
			null,
			42,
		]) {
			assert.equal(isForkAppWindowRoute(route), false, String(route));
		}
	});

	test('the reserved proxy paths of the local app are rejected', () => {
		assert.equal(isForkAppWindowRoute('/api/key/v1/users/@me'), false);
		assert.equal(isForkAppWindowRoute('/proxy/key?url=x'), false);
		assert.equal(isForkAppWindowRoute('/api'), false);
	});

	test('a route becomes a url inside the app origin and back', () => {
		assert.equal(forkAppWindowUrl('/channels/1/2', APP_URL), 'fluxer-app://app/channels/1/2');
		assert.equal(forkAppWindowRouteFromUrl('fluxer-app://app/channels/1/2#x', APP_URL), '/channels/1/2');
		assert.equal(forkAppWindowUrl('//evil.example/x', APP_URL), null);
		assert.equal(forkAppWindowRouteFromUrl('https://evil.example/channels/1', APP_URL), null);
		assert.equal(forkAppWindowRouteFromUrl('fluxer-app://app/api/key/v1', APP_URL), null);
	});
});

describe('the saved window layout', () => {
	test('a layout survives being written and read back', () => {
		const windows = [
			entry({isMainWindow: true, route: '/channels/@me'}),
			entry({route: '/channels/9/8', isMaximized: true, isFocused: true}),
		];
		assert.deepEqual(parseForkWindowSession(serializeForkWindowSession(windows)), windows);
	});

	test('a damaged file gives no windows instead of throwing', () => {
		for (const raw of ['', 'not json', 'null', '[]', '{"version":1}', sessionFile([entry()], 2)]) {
			assert.deepEqual(parseForkWindowSession(raw), [], raw);
		}
	});

	test('windows that cannot be restored safely are dropped, the rest are kept', () => {
		const parsed = parseForkWindowSession(
			sessionFile([
				entry({route: 'https://evil.example/'}),
				entry({route: '/api/key/v1/users/@me'}),
				entry({bounds: {x: 0, y: 0, width: 'wide', height: 600}}),
				entry({bounds: null}),
				'window',
				entry({route: '/channels/5/6'}),
			]),
		);
		assert.deepEqual(
			parsed.map((window) => window.route),
			['/channels/5/6'],
		);
	});

	test('the main window may have no route, an extra window may not', () => {
		const parsed = parseForkWindowSession(
			sessionFile([entry({isMainWindow: true, route: null}), entry({route: null})]),
		);
		assert.equal(parsed.length, 1);
		assert.equal(parsed[0].isMainWindow, true);
	});

	test('only one main window and a bounded number of extra windows are read', () => {
		const windows = [entry({isMainWindow: true}), entry({isMainWindow: true})];
		for (let index = 0; index < FORK_EXTRA_APP_WINDOWS_MAX + 5; index += 1) {
			windows.push(entry({route: `/channels/1/${index}`}));
		}
		const parsed = parseForkWindowSession(sessionFile(windows));
		assert.equal(parsed.filter((window) => window.isMainWindow).length, 1);
		assert.equal(parsed.filter((window) => !window.isMainWindow).length, FORK_EXTRA_APP_WINDOWS_MAX);
	});

	test('a window saved smaller than is usable comes back at a usable size', () => {
		const [parsed] = parseForkWindowSession(sessionFile([entry({bounds: {x: 5, y: 5, width: 12, height: 3}})]));
		assert.ok(parsed.bounds.width >= 100);
		assert.ok(parsed.bounds.height >= 100);
	});
});

describe('restoring the layout', () => {
	test('extra windows are created back to front and the saved focus is kept', () => {
		const plan = planForkWindowRestore([
			entry({route: '/channels/1/back'}),
			entry({isMainWindow: true}),
			entry({route: '/channels/1/front', isFocused: true}),
		]);
		assert.deepEqual(
			plan.extraWindows.map((window) => window.route),
			['/channels/1/back', '/channels/1/front'],
		);
		assert.deepEqual(plan.stackingOrder, [0, 'main', 1]);
		assert.equal(plan.focused, 1);
	});

	test('with no focused window recorded, the frontmost one gets focus', () => {
		const plan = planForkWindowRestore([entry(), entry({isMainWindow: true})]);
		assert.equal(plan.focused, 'main');
	});

	test('a layout without a main window still places the main window, at the back', () => {
		const plan = planForkWindowRestore([entry(), entry()]);
		assert.deepEqual(plan.stackingOrder, ['main', 0, 1]);
		assert.equal(plan.focused, 1);
	});

	test('an empty layout restores nothing', () => {
		const plan = planForkWindowRestore([]);
		assert.deepEqual(plan.extraWindows, []);
		assert.deepEqual(plan.stackingOrder, ['main']);
		assert.equal(plan.focused, 'main');
	});
});

describe('placing windows', () => {
	const display = {x: 0, y: 0, width: 1920, height: 1080};
	const secondDisplay = {x: 1920, y: 0, width: 1920, height: 1080};

	test('a window still on a connected display stays where it was', () => {
		const onSecond = {x: 2100, y: 100, width: 800, height: 600};
		assert.deepEqual(fitForkWindowBounds(onSecond, [display, secondDisplay]), onSecond);
	});

	test('a window from an unplugged display moves onto the first display and fits it', () => {
		const onSecond = {x: 2100, y: 100, width: 2500, height: 600};
		const fitted = fitForkWindowBounds(onSecond, [display]);
		assert.ok(fitted.x >= display.x && fitted.x + fitted.width <= display.x + display.width);
		assert.ok(fitted.y >= display.y && fitted.y + fitted.height <= display.y + display.height);
	});

	test('a window that only touches a display by a sliver counts as off screen', () => {
		const sliver = {x: 1915, y: 100, width: 800, height: 600};
		assert.notDeepEqual(fitForkWindowBounds(sliver, [display]), sliver);
	});

	test('with no display information the saved place is kept', () => {
		assert.deepEqual(fitForkWindowBounds(BOUNDS, []), BOUNDS);
	});

	test('a new window steps down and right from the one it was opened from', () => {
		const next = cascadeForkWindowBounds(BOUNDS, display);
		assert.equal(next.width, BOUNDS.width);
		assert.equal(next.height, BOUNDS.height);
		assert.ok(next.x > BOUNDS.x && next.y > BOUNDS.y);
	});

	test('a new window wraps back onto the display instead of running off its edge', () => {
		const nearEdge = {x: 1000, y: 500, width: 900, height: 560};
		const next = cascadeForkWindowBounds(nearEdge, display);
		assert.ok(next.x + next.width <= display.x + display.width);
		assert.ok(next.y + next.height <= display.y + display.height);
	});
});
