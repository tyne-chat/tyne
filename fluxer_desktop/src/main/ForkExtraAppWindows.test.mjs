// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the extra app windows block at the end of Window.ts (more than one app window, the saved
// window layout, and the IPC between windows), run through upstream's createWindow with Electron
// stubbed out. The pure parts are tested in ForkWindowSession.test.mjs and
// ForkWindowCoordination.test.mjs; these tests cover the glue that ties them to real windows.

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, mock, test} from 'node:test';
import {installElectronStub} from './ForkLocalAppTestSupport.test.mjs';

const WINDOW_MODULE_URL = new URL('./Window.ts', import.meta.url).href;
const {FORK_APP_WINDOW_CHANNELS} = await import('@fluxer/desktop_ipc/src/ForkAppWindowContract');
const {DESKTOP_APP_URL} = await import('@electron/common/Constants');
const {FORK_EXTRA_APP_WINDOWS_MAX, FORK_WINDOW_SESSION_FILE_NAME} = await import('./ForkWindowSession.ts');

const SESSION_SAVE_DELAY_MS = 500;
const WORK_AREA = {x: 0, y: 0, width: 1920, height: 1080};
const CHANNEL_ROUTE = '/channels/100/200';
// WebContents ids stay unique across tests: upstream's local app authorization outlives each
// test's copy of Window.ts and refuses a second WebContents with an id it already knows.
let nextContentsId = 1;
const OTHER_CHANNEL_ROUTE = '/channels/100/300';

// Anything Electron hands out that a test does not look at: callable, and every property is
// another such stub.
function anyStub() {
	return new Proxy(() => undefined, {
		get: (_target, property) => (property === 'then' || typeof property === 'symbol' ? undefined : anyStub()),
	});
}

// A fake whose missing members are stubs, so upstream's setup code can call whatever it likes.
function lenient(target) {
	return new Proxy(target, {
		get: (object, property, receiver) => {
			if (property in object || property === 'then' || typeof property === 'symbol') {
				return Reflect.get(object, property, receiver);
			}
			return anyStub();
		},
	});
}

function createWorld() {
	const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-extra-app-windows-'));
	const windows = [];
	const ipcHandlers = new Map();
	const ipcMain = new EventEmitter();
	ipcMain.handle = (channel, handler) => ipcHandlers.set(channel, handler);
	ipcMain.removeHandler = (channel) => ipcHandlers.delete(channel);
	const world = {userData, windows, ipcMain, ipcHandlers, focused: null};

	class FakeWebContents extends EventEmitter {
		constructor() {
			super();
			this.id = nextContentsId++;
			this.url = '';
			this.sent = [];
			this.reloads = 0;
			this.session = lenient(new EventEmitter());
		}
		getURL() {
			return this.url;
		}
		loadURL(url) {
			this.url = url;
			return Promise.resolve();
		}
		send(channel, ...args) {
			this.sent.push({channel, args});
		}
		reload() {
			this.reloads += 1;
			// As Electron does once the reload commits; upstream's reloadMainWindowForUpdate waits for it.
			queueMicrotask(() => this.emit('did-navigate'));
		}
		isDestroyed() {
			return false;
		}
		setWindowOpenHandler() {}
	}

	class FakeWindow extends EventEmitter {
		constructor(options = {}) {
			super();
			this.options = options;
			this.bounds = {
				x: options.x ?? 100,
				y: options.y ?? 100,
				width: options.width ?? 1280,
				height: options.height ?? 800,
			};
			this.visible = false;
			this.minimized = false;
			this.maximized = false;
			this.destroyed = false;
			this.webContents = lenient(new FakeWebContents());
			world.registry.contents.set(this.webContents.id, this.webContents);
		}
		getNormalBounds() {
			return {...this.bounds};
		}
		getBounds() {
			return {...this.bounds};
		}
		setBounds(bounds) {
			this.bounds = {...this.bounds, ...bounds};
		}
		isVisible() {
			return this.visible;
		}
		isMinimized() {
			return this.minimized;
		}
		isMaximized() {
			return this.maximized;
		}
		isFullScreen() {
			return false;
		}
		isDestroyed() {
			return this.destroyed;
		}
		show() {
			this.visible = true;
			this.emit('show');
		}
		showInactive() {
			this.visible = true;
			this.emit('show');
		}
		focus() {
			world.focused = this.self;
			this.emit('focus');
		}
		maximize() {
			this.maximized = true;
			this.emit('maximize');
		}
		moveTo(x, y) {
			this.bounds = {...this.bounds, x, y};
			this.emit('move');
		}
		close() {
			const event = {defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true)};
			this.emit('close', event);
			if (event.defaultPrevented) return;
			this.destroyed = true;
			this.visible = false;
			if (world.focused === this.self) world.focused = null;
			this.emit('closed');
		}
		destroy() {
			this.destroyed = true;
			this.emit('closed');
		}
		isClosable() {
			return true;
		}
		setMinimumSize() {}
		setMenuBarVisibility() {}
	}

	// Called with `new` by upstream's code; hands back the lenient fake in place of `this`.
	function BrowserWindow(options) {
		const fake = new FakeWindow(options);
		const window = lenient(fake);
		fake.self = window;
		windows.push(window);
		return window;
	}
	BrowserWindow.getFocusedWindow = () => world.focused;
	BrowserWindow.getAllWindows = () => windows.filter((window) => !window.isDestroyed());
	BrowserWindow.fromWebContents = (contents) => windows.find((window) => window.webContents === contents) ?? null;

	// Set by Electron; the main window looks for its Linux icon there.
	process.resourcesPath = userData;
	const display = {
		id: 1,
		workArea: WORK_AREA,
		workAreaSize: {width: WORK_AREA.width, height: WORK_AREA.height},
		bounds: WORK_AREA,
	};
	world.registry = installElectronStub({
		app: lenient({getPath: () => userData, getLocale: () => 'en-US', getVersion: () => '0.0.0', isPackaged: false}),
		BrowserWindow,
		ipcMain,
		screen: lenient({
			getPrimaryDisplay: () => display,
			getAllDisplays: () => [display],
			getDisplayMatching: () => display,
		}),
		dialog: lenient({}),
		Menu: lenient({}),
		shell: lenient({}),
		Notification: lenient({}),
		Tray: lenient({}),
		nativeImage: lenient({}),
		powerMonitor: lenient(new EventEmitter()),
		// Upstream's MainWindowBootFrame listens for theme changes on every main window.
		nativeTheme: lenient(Object.assign(new EventEmitter(), {themeSource: 'system', shouldUseDarkColors: false})),
		protocol: lenient({}),
	});
	return world;
}

let caseNumber = 0;

// Each test gets its own copy of Window.ts, so the module's window bookkeeping starts empty.
async function loadWindowModule() {
	caseNumber += 1;
	return import(`${WINDOW_MODULE_URL}?case=${caseNumber}`);
}

// Sent through the IPC handlers the way a window's own top-level app document sends them.
function ipcEventFrom(window) {
	return {sender: window.webContents, senderFrame: {detached: false, parent: null, url: DESKTOP_APP_URL}};
}

function savedSession(world) {
	return JSON.parse(fs.readFileSync(path.join(world.userData, FORK_WINDOW_SESSION_FILE_NAME), 'utf8'));
}

function sessionEntries(world) {
	const session = savedSession(world);
	return Array.isArray(session) ? session : session.windows;
}

describe('extra app windows (Window.ts)', () => {
	let world;
	let windowModule;

	beforeEach(async () => {
		mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date']});
		world = createWorld();
		windowModule = await loadWindowModule();
	});

	afterEach(() => {
		mock.timers.reset();
		fs.rmSync(world.userData, {recursive: true, force: true});
	});

	test('no other window opens before the main window exists', () => {
		assert.equal(windowModule.openAppWindow({route: CHANNEL_ROUTE}), null);
		assert.equal(world.windows.length, 0);
	});

	test('another window opens on a channel next to the main one, and both count as app windows', () => {
		const main = windowModule.createWindow();
		const extra = windowModule.openAppWindow({route: CHANNEL_ROUTE});
		assert.ok(extra);
		assert.deepEqual(windowModule.getAppWindows(), [main, extra]);
		assert.notEqual(extra.options.x, main.getNormalBounds().x, 'the new window is cascaded off the main one');
	});

	test('a route a window may not open on, or one window too many, opens nothing', () => {
		windowModule.createWindow();
		assert.equal(windowModule.openAppWindow({route: 'https://example.com/'}), null);
		for (let index = 0; index < FORK_EXTRA_APP_WINDOWS_MAX; index += 1) {
			assert.ok(windowModule.openAppWindow({route: CHANNEL_ROUTE}));
		}
		assert.equal(windowModule.openAppWindow({route: CHANNEL_ROUTE}), null);
		assert.equal(windowModule.getAppWindows().length, FORK_EXTRA_APP_WINDOWS_MAX + 1);
	});

	test('windows load one at a time, and New window opens on the route of the window it was asked from', () => {
		const main = windowModule.createWindow();
		const extra = windowModule.openAppWindow({route: CHANNEL_ROUTE});
		assert.equal(extra.webContents.url, '', 'it waits until the main window has loaded');
		windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE);
		assert.ok(extra.webContents.url.endsWith(CHANNEL_ROUTE));
		windowModule.recordAppWindowRoute(extra.webContents, OTHER_CHANNEL_ROUTE);
		const copy = windowModule.openAppWindowLike(extra);
		assert.ok(copy.webContents.url.endsWith(OTHER_CHANNEL_ROUTE));
		const fromStranger = windowModule.openAppWindowLike(null);
		windowModule.recordAppWindowRoute(copy.webContents, OTHER_CHANNEL_ROUTE);
		assert.ok(fromStranger.webContents.url.endsWith(CHANNEL_ROUTE), 'with no app window given, it copies the main one');
	});

	test("an extra window's route is kept for the layout and not passed on as the last route", () => {
		const main = windowModule.createWindow();
		const extra = windowModule.openAppWindow({route: CHANNEL_ROUTE});
		assert.equal(windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE), true);
		assert.equal(windowModule.recordAppWindowRoute(extra.webContents, OTHER_CHANNEL_ROUTE), false);
		assert.equal(windowModule.recordAppWindowRoute(lenient(new EventEmitter()), CHANNEL_ROUTE), true);
	});

	test('the layout is saved once the windows settle, with each window where it is and what it shows', () => {
		const main = windowModule.createWindow();
		main.show();
		windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE);
		const extra = windowModule.openAppWindow({route: OTHER_CHANNEL_ROUTE});
		extra.moveTo(400, 300);
		extra.focus();
		mock.timers.tick(SESSION_SAVE_DELAY_MS);
		const entries = sessionEntries(world);
		assert.equal(entries.length, 2);
		const mainEntry = entries.find((entry) => entry.isMainWindow);
		const extraEntry = entries.find((entry) => !entry.isMainWindow);
		assert.equal(mainEntry.route, CHANNEL_ROUTE);
		assert.equal(extraEntry.route, OTHER_CHANNEL_ROUTE);
		assert.equal(extraEntry.bounds.x, 400);
		assert.equal(extraEntry.bounds.y, 300);
		assert.equal(extraEntry.isFocused, true);
		assert.equal(entries[entries.length - 1], extraEntry, 'the focused window is the front of the stack');
	});

	test('quitting saves the layout at once, and windows closing during the quit do not shrink it', () => {
		const main = windowModule.createWindow();
		main.show();
		windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE);
		const extra = windowModule.openAppWindow({route: OTHER_CHANNEL_ROUTE});
		mock.timers.tick(SESSION_SAVE_DELAY_MS);
		extra.moveTo(700, 500);
		windowModule.setQuitting(true);
		assert.ok(sessionEntries(world).some((entry) => entry.bounds.x === 700 && entry.bounds.y === 500));
		extra.close();
		mock.timers.tick(SESSION_SAVE_DELAY_MS);
		assert.equal(sessionEntries(world).length, 2);
	});

	test('the saved layout comes back once the main window is signed in and on screen', () => {
		fs.writeFileSync(
			path.join(world.userData, FORK_WINDOW_SESSION_FILE_NAME),
			JSON.stringify(
				sessionFixture([
					{route: CHANNEL_ROUTE, bounds: {x: 10, y: 10, width: 1200, height: 800}, isMainWindow: true},
					{route: OTHER_CHANNEL_ROUTE, bounds: {x: 300, y: 200, width: 900, height: 700}, isFocused: true},
				]),
			),
		);
		const main = windowModule.createWindow();
		assert.equal(world.windows.length, 1, 'nothing is restored before the main window shows');
		main.show();
		assert.equal(world.windows.length, 1, 'nothing is restored before the main window is signed in');
		windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE);
		assert.equal(world.windows.length, 2);
		const restored = world.windows[1];
		assert.equal(restored.options.x, 300);
		assert.equal(restored.options.y, 200);
		windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE);
		assert.equal(world.windows.length, 2, 'the layout comes back once');
	});

	test('closing windows for an update keeps the layout as it was, and it comes back after the reload', async () => {
		const main = windowModule.createWindow();
		main.show();
		windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE);
		const moved = windowModule.openAppWindow({route: OTHER_CHANNEL_ROUTE});
		windowModule.openAppWindow({route: CHANNEL_ROUTE});
		mock.timers.tick(SESSION_SAVE_DELAY_MS);
		// A save is still waiting when the update starts closing windows.
		moved.moveTo(500, 400);
		assert.equal(await windowModule.reloadMainWindowForUpdate(), true);
		mock.timers.tick(SESSION_SAVE_DELAY_MS);
		const entries = sessionEntries(world);
		assert.equal(entries.length, 3);
		assert.ok(entries.some((entry) => entry.bounds.x === 500 && entry.bounds.y === 400));
		assert.equal(windowModule.getAppWindows().length, 1);
		windowModule.recordAppWindowRoute(main.webContents, CHANNEL_ROUTE);
		assert.equal(windowModule.getAppWindows().length, 3);
	});

	describe('IPC from app windows', () => {
		test('an app window can open another, anything else cannot', async () => {
			const main = windowModule.createWindow();
			const open = world.ipcHandlers.get(FORK_APP_WINDOW_CHANNELS.open);
			assert.equal(await open(ipcEventFrom(main), CHANNEL_ROUTE), true);
			assert.equal(await open(ipcEventFrom(main), 42), false);
			const stranger = lenient(new EventEmitter());
			assert.equal(await open({sender: stranger, senderFrame: {parent: null, url: DESKTOP_APP_URL}}), false);
			const embedded = {sender: main.webContents, senderFrame: {detached: false, parent: {}, url: DESKTOP_APP_URL}};
			assert.equal(await open(embedded, CHANNEL_ROUTE), false);
			assert.equal(windowModule.getAppWindows().length, 2);
		});

		test('one window announces a notification every window hears about, and the others stay quiet', async () => {
			const main = windowModule.createWindow();
			const extra = windowModule.openAppWindow({route: CHANNEL_ROUTE});
			const claim = world.ipcHandlers.get(FORK_APP_WINDOW_CHANNELS.claimNotification);
			assert.equal(await claim(ipcEventFrom(main), 'message:1', '200'), true);
			assert.equal(await claim(ipcEventFrom(extra), 'message:1', '200'), false);
			assert.equal(await claim(ipcEventFrom(extra), 'message:2', '200'), true);
			assert.equal(await claim({sender: lenient(new EventEmitter()), senderFrame: null}, 'message:3', null), true);
		});

		test('a window that signs in to another account reloads the windows on the old one', () => {
			const main = windowModule.createWindow();
			const extra = windowModule.openAppWindow({route: CHANNEL_ROUTE});
			world.ipcMain.emit(FORK_APP_WINDOW_CHANNELS.account, ipcEventFrom(main), 'account-a');
			world.ipcMain.emit(FORK_APP_WINDOW_CHANNELS.account, ipcEventFrom(extra), 'account-a');
			mock.timers.tick(10_000);
			assert.equal(main.webContents.reloads + extra.webContents.reloads, 0);
			world.ipcMain.emit(FORK_APP_WINDOW_CHANNELS.account, ipcEventFrom(main), 'account-b');
			mock.timers.tick(10_000);
			assert.equal(extra.webContents.reloads, 1);
			assert.equal(main.webContents.reloads, 0);
		});
	});
});

function sessionFixture(windows) {
	return {
		version: 1,
		windows: windows.map((entry) => ({isMainWindow: false, isFocused: false, isMaximized: false, ...entry})),
	};
}
