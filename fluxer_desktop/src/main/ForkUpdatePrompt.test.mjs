// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {beforeEach, describe, test} from 'node:test';
import {installElectronStub} from './ForkLocalAppTestSupport.test.mjs';

class FakeContents extends EventEmitter {
	setWindowOpenHandler() {}
	executeJavaScript() {
		return Promise.resolve(150);
	}
}

class FakeWindow extends EventEmitter {
	static all = [];
	static focused = null;
	static getAllWindows = () => FakeWindow.all;
	static getFocusedWindow = () => FakeWindow.focused;

	constructor(options = {}) {
		super();
		this.options = options;
		this.webContents = new FakeContents();
		this.calls = [];
		this.visible = options.show !== false;
		this.destroyed = false;
		FakeWindow.all.push(this);
	}
	isDestroyed = () => this.destroyed;
	isVisible = () => this.visible;
	isMinimized = () => false;
	isFocusable = () => true;
	getBounds = () => ({x: 0, y: 0, width: 800, height: 600});
	setMenuBarVisibility() {}
	setPosition() {}
	setContentSize() {}
	flashFrame(on) {
		this.calls.push(`flashFrame:${on}`);
	}
	setParentWindow(parent) {
		this.parent = parent;
	}
	showInactive() {
		this.calls.push('showInactive');
		this.visible = true;
	}
	show() {
		this.calls.push('show');
		this.visible = true;
	}
	focus() {
		this.calls.push('focus');
	}
	hide() {
		this.visible = false;
	}
	loadURL(url) {
		this.page = decodeURIComponent(url);
		return Promise.resolve();
	}
	destroy() {
		this.destroyed = true;
		FakeWindow.all = FakeWindow.all.filter((window) => window !== this);
		this.emit('closed');
	}
}

const shownNotifications = [];
class FakeNotification extends EventEmitter {
	static isSupported = () => true;
	constructor(options) {
		super();
		this.options = options;
	}
	show() {
		shownNotifications.push(this.options);
	}
}

const app = new EventEmitter();
Object.assign(app, {accessibilitySupportEnabled: false, getName: () => 'Tyne', isPackaged: false});

installElectronStub({
	app,
	BrowserWindow: FakeWindow,
	Notification: FakeNotification,
	screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 0, width: 1920, height: 1080}})},
});

const {askQuietly, focusQuietWindow, promptDocument} = await import('./ForkUpdatePrompt.ts');

const OPTIONS = {
	message: 'Tyne 2.0 is available.',
	detail: 'It will restart.',
	buttons: ['Update now', 'Later'],
	cancelId: 1,
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function openPrompt(options = OPTIONS) {
	const answer = askQuietly(options);
	await settle();
	const prompt = FakeWindow.all.at(-1);
	prompt.webContents.emit('did-finish-load');
	await settle();
	return {answer, prompt};
}

const choose = (prompt, title) => prompt.webContents.emit('page-title-updated', {preventDefault() {}}, title);

describe('the update prompt', () => {
	let tyne;

	beforeEach(() => {
		for (const window of [...FakeWindow.all]) window.destroy();
		shownNotifications.length = 0;
		app.accessibilitySupportEnabled = false;
		tyne = new FakeWindow();
		FakeWindow.focused = tyne;
	});

	test('opens without focus, as a child of the focused window', async () => {
		const {answer, prompt} = await openPrompt();

		assert.ok(prompt.calls.includes('showInactive'));
		assert.ok(!prompt.calls.includes('show'));
		assert.ok(!prompt.calls.includes('focus'));
		assert.equal(prompt.parent, tyne);
		assert.equal(prompt.options.alwaysOnTop, undefined);

		choose(prompt, 'choice:1');
		assert.equal(await answer, 1);
	});

	test('a pressed button is the answer, and only a real button counts', async () => {
		const {answer, prompt} = await openPrompt();

		choose(prompt, 'Tyne 2.0 is available.');
		assert.ok(!prompt.isDestroyed());
		choose(prompt, 'choice:0');

		assert.equal(await answer, 0);
		assert.ok(prompt.isDestroyed());
	});

	test('a choice past the last button is the cancel button', async () => {
		const {answer, prompt} = await openPrompt();

		choose(prompt, 'choice:7');

		assert.equal(await answer, 1);
	});

	test('closing it is the cancel button', async () => {
		const {answer, prompt} = await openPrompt();

		prompt.destroy();

		assert.equal(await answer, 1);
	});

	test('with no cancel button, closing it is the first button', async () => {
		const {answer, prompt} = await openPrompt({message: 'Up to date.', buttons: ['OK']});

		prompt.destroy();

		assert.equal(await answer, 0);
	});

	test('only one prompt at a time, the next when the first is answered', async () => {
		const {answer, prompt} = await openPrompt();
		const second = askQuietly({...OPTIONS, message: 'Second'});
		await settle();
		assert.equal(FakeWindow.all.length, 2);

		choose(prompt, 'choice:1');
		await answer;
		await settle();
		assert.equal(FakeWindow.all.length, 2);
		assert.ok(FakeWindow.all.at(-1).page.includes('Second'));

		FakeWindow.all.at(-1).destroy();
		await second;
	});

	test('F6 in Tyne reaches the prompt, and F6 there goes back', async () => {
		const {answer, prompt} = await openPrompt();
		let prevented = 0;
		const event = {
			preventDefault() {
				prevented += 1;
			},
		};
		const f6 = {type: 'keyDown', key: 'F6', control: false, alt: false, meta: false};

		tyne.webContents.emit('before-input-event', event, f6);
		assert.ok(prompt.calls.includes('focus'));

		prompt.webContents.emit('before-input-event', event, f6);
		assert.ok(tyne.calls.includes('focus'));
		assert.equal(prevented, 2);

		prompt.destroy();
		await answer;
	});

	test('F6 with a modifier stays with the app', async () => {
		const {answer, prompt} = await openPrompt();

		tyne.webContents.emit(
			'before-input-event',
			{preventDefault: () => assert.fail('not ours')},
			{type: 'keyDown', key: 'F6', control: true, alt: false, meta: false},
		);

		assert.ok(!prompt.calls.includes('focus'));
		prompt.destroy();
		await answer;
	});

	test('focus that nobody asked for goes straight back to Tyne', async () => {
		const {answer, prompt} = await openPrompt();

		prompt.emit('focus');

		assert.ok(tyne.calls.includes('focus'));
		prompt.destroy();
		await answer;
	});

	test('focus reached on purpose stays in the prompt', async () => {
		const {answer, prompt} = await openPrompt();

		assert.equal(focusQuietWindow(), true);
		prompt.emit('focus');

		assert.ok(!tyne.calls.includes('focus'));
		prompt.destroy();
		await answer;
	});

	test('the menu falls through to a normal check with nothing open', () => {
		assert.equal(focusQuietWindow(), false);
	});

	test('moves to the Tyne window that comes to the front', async () => {
		const {answer, prompt} = await openPrompt();
		const other = new FakeWindow();

		app.emit('browser-window-focus', {}, other);

		assert.equal(prompt.parent, other);
		prompt.destroy();
		await answer;
	});

	test('moves off a parent that is closing', async () => {
		const {answer, prompt} = await openPrompt();
		const other = new FakeWindow();
		FakeWindow.focused = null;

		tyne.emit('close');

		assert.equal(prompt.parent, other);
		prompt.destroy();
		await answer;
	});

	test('waits for a window when Tyne is hidden, and appears with it', async () => {
		tyne.visible = false;
		FakeWindow.focused = null;
		const {answer, prompt} = await openPrompt();
		assert.ok(!prompt.isVisible());

		tyne.visible = true;
		FakeWindow.focused = tyne;
		app.emit('browser-window-focus', {}, tyne);

		assert.ok(prompt.isVisible());
		assert.ok(!prompt.calls.includes('show'));
		prompt.destroy();
		await answer;
	});

	test('flashes the taskbar when Tyne is in the background, until it comes back', async () => {
		FakeWindow.focused = null;
		const {answer, prompt} = await openPrompt();
		assert.ok(tyne.calls.includes('flashFrame:true'));

		FakeWindow.focused = tyne;
		app.emit('browser-window-focus', {}, tyne);

		assert.ok(tyne.calls.includes('flashFrame:false'));
		prompt.destroy();
		await answer;
	});

	describe('the announcement a screen reader can hear', () => {
		test('none with Tyne in front and no screen reader', async () => {
			const {answer, prompt} = await openPrompt();

			assert.equal(shownNotifications.length, 0);
			prompt.destroy();
			await answer;
		});

		test('one when a screen reader is running', async () => {
			app.accessibilitySupportEnabled = true;
			const {answer, prompt} = await openPrompt();

			assert.equal(shownNotifications.length, 1);
			assert.match(shownNotifications[0].body, /Tyne 2\.0 is available\./);
			assert.equal(shownNotifications[0].silent, true);
			prompt.destroy();
			await answer;
		});

		test('one when Tyne is in the background', async () => {
			FakeWindow.focused = null;
			const {answer, prompt} = await openPrompt();

			assert.equal(shownNotifications.length, 1);
			prompt.destroy();
			await answer;
		});
	});
});

describe('the prompt page', () => {
	const page = (overrides = {}) =>
		promptDocument({
			message: 'Tyne 2.0 is available.',
			detail: 'It will restart.',
			hint: 'Press F6.',
			buttons: ['Update now', 'Later'],
			defaultId: 0,
			cancelId: 1,
			locale: 'en-US',
			...overrides,
		});

	test('is a labelled dialog in the person’s language', () => {
		const html = page({locale: 'de'});

		assert.match(html, /<html lang="de" dir="ltr">/);
		assert.match(html, /role="alertdialog" aria-labelledby="message" aria-describedby="detail hint"/);
		assert.match(html, /<h1 id="message">/);
	});

	test('reads right to left where the language does', () => {
		assert.match(page({locale: 'ar'}), /dir="rtl"/);
		assert.match(page({locale: 'he'}), /dir="rtl"/);
	});

	test('takes focus only when asked to, so Enter cannot press a button by accident', () => {
		const html = page();

		assert.ok(!html.includes('autofocus'));
		assert.ok(!/\.focus\(\)[^}]*\}\s*\)/u.test(html.split('window.focusButtons')[0]));
		assert.match(html, /window\.focusButtons=/);
	});

	test('honours Escape, a visible focus ring and high contrast', () => {
		const html = page({cancelId: 2});

		assert.match(html, /event\.key==='Escape'/);
		assert.match(html, /choose\(2\)/);
		assert.match(html, /button:focus-visible/);
		assert.match(html, /forced-colors:active/);
	});

	test('escapes its text', () => {
		const html = page({message: '<img src=x>', detail: '"quoted" & more', buttons: ['<b>Go</b>']});

		assert.ok(!html.includes('<img'));
		assert.ok(!html.includes('<b>Go'));
		assert.ok(html.includes('&#60;img src=x&#62;'));
		assert.ok(html.includes('&#34;quoted&#34; &#38; more'));
	});

	test('marks only the default button as primary', () => {
		const html = page({defaultId: 1});

		assert.match(html, /data-choice="0">Update now/);
		assert.match(html, /data-choice="1" class="primary">Later/);
	});
});
