// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChildLogger} from '@electron/common/Logger';
import {getNativeLocale, t} from '@electron/main/MainI18n';
import {app, BrowserWindow, type MessageBoxOptions, Notification, screen} from 'electron';

// Update prompts must not take input from the composer (tyne-chat/tyne#299): a box that grabs focus
// mid-sentence can also receive the next Enter, on a default button that restarts the app. So these
// are small windows shown without focus. Each is a child of the focused Tyne window, which keeps it
// above Tyne and not above other apps, and it moves to whichever Tyne window comes to the front.
//
// A window without focus is out of reach of the keyboard and silent to a screen reader, so: F6 moves
// focus into it and back, as does "Check for updates" in the menu; once in, it is an ordinary dialog
// (Tab, Enter, Escape); and a system notification announces it when Tyne is in the background or a
// screen reader is running, which a window nobody has focused cannot do by itself.
//
// Platforms differ in how far they honour this. Windows, macOS and X11 show a window without focus
// on request. A Wayland compositor decides for itself, and may also ignore where the window is put.
// So no button takes focus until someone reaches the window on purpose: if a compositor hands it
// focus anyway, Enter and Space press nothing, and focus goes straight back to the parent.

const logger = createChildLogger('ForkUpdatePrompt');

const REACH_KEY = 'F6';
const UNINVITED_FOCUS_MS = 1000;
const PROMPT_WIDTH = 440;
const PROMPT_MIN_HEIGHT = 150;
const PROMPT_MAX_HEIGHT = 480;
const CHOICE_TITLE = /^choice:(\d+)$/u;
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

const quietWindows = new Set<BrowserWindow>();
const reachedWindows = new WeakSet<BrowserWindow>();
const notifications = new Set<Notification>();
let asking: Promise<unknown> = Promise.resolve();

function isFloatableOver(window: BrowserWindow, except: BrowserWindow | null): boolean {
	return (
		window !== except &&
		!window.isDestroyed() &&
		!quietWindows.has(window) &&
		window.isVisible() &&
		!window.isMinimized() &&
		window.isFocusable()
	);
}

function findTyneWindow(except: BrowserWindow | null = null): BrowserWindow | null {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused != null && isFloatableOver(focused, except)) {
		return focused;
	}
	return BrowserWindow.getAllWindows().find((window) => isFloatableOver(window, except)) ?? null;
}

function isReachKey(input: Electron.Input): boolean {
	return input.type === 'keyDown' && input.key === REACH_KEY && !input.control && !input.alt && !input.meta;
}

function reach(window: BrowserWindow): void {
	reachedWindows.add(window);
	window.focus();
	window.webContents.executeJavaScript('window.focusButtons?.()').catch((error: unknown) => {
		logger.warn('Could not move focus into the update prompt', error);
	});
}

function keepAboveTyne(window: BrowserWindow): {show: () => void} {
	let parent: BrowserWindow | null = null;
	let wantsToShow = false;
	let shownAt = 0;

	const centre = (): void => {
		if (parent == null || parent.isDestroyed() || window.isDestroyed()) return;
		const over = parent.getBounds();
		const {width, height} = window.getBounds();
		const area = screen.getDisplayMatching(over).workArea;
		const x = over.x + Math.round((over.width - width) / 2);
		const y = over.y + Math.round((over.height - height) / 2);
		window.setPosition(
			Math.max(area.x, Math.min(x, area.x + area.width - width)),
			Math.max(area.y, Math.min(y, area.y + area.height - height)),
		);
	};
	const onParentKey = (event: Electron.Event, input: Electron.Input): void => {
		if (isReachKey(input)) {
			event.preventDefault();
			reach(window);
		}
	};
	const detach = (): void => {
		if (parent == null) return;
		if (!parent.isDestroyed()) {
			parent.flashFrame(false);
			parent.removeListener('move', centre);
			parent.removeListener('resize', centre);
			parent.removeListener('close', onParentClosing);
			parent.removeListener('hide', onParentGone);
			parent.removeListener('minimize', onParentGone);
			parent.webContents.removeListener('before-input-event', onParentKey);
		}
		parent = null;
	};
	const attach = (next: BrowserWindow): void => {
		if (next !== parent) {
			detach();
			parent = next;
			window.setParentWindow(next);
			// macOS moves a child window with its parent by itself.
			if (process.platform !== 'darwin') next.on('move', centre);
			next.on('resize', centre);
			next.on('close', onParentClosing);
			next.on('hide', onParentGone);
			next.on('minimize', onParentGone);
			next.webContents.on('before-input-event', onParentKey);
			centre();
		}
		if (wantsToShow && !window.isVisible()) {
			shownAt = Date.now();
			window.showInactive();
			if (BrowserWindow.getFocusedWindow() == null) {
				next.flashFrame(true);
			}
		}
	};
	// Closing a parent takes its children with it, so the prompt moves first if it can.
	function onParentClosing(): void {
		const next = findTyneWindow(parent);
		if (next != null) attach(next);
	}
	function onParentGone(): void {
		const next = findTyneWindow(parent);
		if (next != null) {
			attach(next);
		} else if (!window.isDestroyed()) {
			window.hide();
		}
	}
	const onTyneFocused = (_event: Electron.Event, focused: BrowserWindow): void => {
		if (!quietWindows.has(focused) && !focused.isDestroyed()) {
			attach(focused);
			focused.flashFrame(false);
		}
	};

	app.on('browser-window-focus', onTyneFocused);
	window.webContents.on('before-input-event', (event, input) => {
		if (isReachKey(input) && parent != null && !parent.isDestroyed()) {
			event.preventDefault();
			reachedWindows.delete(window);
			parent.focus();
		}
	});
	window.on('focus', () => {
		if (reachedWindows.has(window) || Date.now() - shownAt > UNINVITED_FOCUS_MS) return;
		if (parent != null && !parent.isDestroyed()) {
			logger.info('The window system focused an update prompt anyway, handing focus back');
			parent.focus();
		}
	});
	window.once('closed', () => {
		app.removeListener('browser-window-focus', onTyneFocused);
		detach();
		quietWindows.delete(window);
	});
	return {
		// With Tyne hidden in the tray there is nothing to float over: it waits for a window to appear.
		show: () => {
			wantsToShow = true;
			const next = parent ?? findTyneWindow();
			if (next != null) attach(next);
		},
	};
}

export function openQuietWindow(
	page: string,
	size: {width: number; height: number},
	prepare: (window: BrowserWindow) => Promise<void> = () => Promise.resolve(),
): BrowserWindow {
	const window = new BrowserWindow({
		...size,
		useContentSize: true,
		resizable: false,
		maximizable: false,
		minimizable: false,
		fullscreenable: false,
		show: false,
		title: app.getName(),
		autoHideMenuBar: true,
		webPreferences: {
			partition: 'fork-update-progress',
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			spellcheck: false,
		},
	});
	quietWindows.add(window);
	window.setMenuBarVisibility(false);
	window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
	window.webContents.on('will-navigate', (event) => {
		event.preventDefault();
	});
	const placement = keepAboveTyne(window);
	window.webContents.once('did-finish-load', () => {
		void prepare(window).finally(() => {
			if (!window.isDestroyed()) placement.show();
		});
	});
	void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`).catch((error: unknown) => {
		logger.warn('Could not load an update window', error);
	});
	return window;
}

/** Moves focus into the open prompt, for the menu and the notification. False with none open. */
export function focusQuietWindow(): boolean {
	const window = [...quietWindows].at(-1);
	if (window == null || window.isDestroyed()) {
		return false;
	}
	if (window.isVisible()) {
		reach(window);
		return true;
	}
	// Hidden because Tyne is: showing Tyne brings the prompt back, then it can take focus.
	void import('@electron/main/Window').then(({showWindow}) => {
		showWindow();
		if (!window.isDestroyed()) reach(window);
	});
	return true;
}

function announce(text: string): void {
	const inFront = BrowserWindow.getFocusedWindow() != null;
	if ((inFront && !app.accessibilitySupportEnabled) || !Notification.isSupported()) {
		return;
	}
	try {
		const notification = new Notification({title: app.getName(), body: text, silent: true});
		notifications.add(notification);
		notification.on('click', () => {
			focusQuietWindow();
		});
		notification.on('close', () => {
			notifications.delete(notification);
		});
		notification.show();
	} catch (error) {
		logger.warn('Could not announce the update prompt', error);
	}
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

export function promptDocument(prompt: {
	message: string;
	detail: string;
	hint: string;
	buttons: ReadonlyArray<string>;
	defaultId: number;
	cancelId: number;
	locale: string;
}): string {
	const language = prompt.locale.split('-')[0] ?? 'en';
	const buttons = prompt.buttons
		.map(
			(label, index) =>
				`<button type="button" data-choice="${index}"${index === prompt.defaultId ? ' class="primary"' : ''}>${escapeHtml(label)}</button>`,
		)
		.join('');
	return `<!doctype html><html lang="${escapeHtml(prompt.locale)}" dir="${RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escapeHtml(prompt.message)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#1d1d1f}
main{padding:20px 24px;border-top:4px solid #4e5fe4}
h1{margin:0 0 6px;font-size:16px;font-weight:600}
p{margin:0 0 12px}
.hint{font-size:12px;color:#55565c}
.buttons{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:4px}
button{min-height:36px;padding:0 16px;border:1px solid #8a8b92;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
button.primary{background:#3f4fd6;border-color:#3f4fd6;color:#fff}
button:focus-visible{outline:3px solid #4e5fe4;outline-offset:2px}
@media (prefers-color-scheme:dark){body{background:#1e1f24;color:#f2f2f4}.hint{color:#b9bac1}button:focus-visible{outline-color:#aab4ff}}
@media (forced-colors:active){main{border-top-color:CanvasText}button,button.primary{background:ButtonFace;color:ButtonText;border-color:ButtonText}button:focus-visible{outline-color:Highlight}}
</style></head><body>
<main role="alertdialog" aria-labelledby="message" aria-describedby="detail hint">
<h1 id="message">${escapeHtml(prompt.message)}</h1>
<p id="detail">${escapeHtml(prompt.detail)}</p>
<p id="hint" class="hint">${escapeHtml(prompt.hint)}</p>
<div class="buttons">${buttons}</div>
</main>
<script>
function choose(index){document.title='choice:'+index;}
var buttons=Array.prototype.slice.call(document.querySelectorAll('button'));
buttons.forEach(function(button){button.addEventListener('click',function(){choose(button.dataset.choice);});});
addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();choose(${prompt.cancelId});}});
window.focusButtons=function(){(document.querySelector('.primary')||buttons[0]).focus();};
</script></body></html>`;
}

// Translations differ in length, and a person may have large text set.
async function fitToText(window: BrowserWindow): Promise<void> {
	try {
		const height: unknown = await window.webContents.executeJavaScript('document.documentElement.scrollHeight');
		if (typeof height !== 'number' || window.isDestroyed()) return;
		window.setContentSize(PROMPT_WIDTH, Math.max(PROMPT_MIN_HEIGHT, Math.min(Math.ceil(height), PROMPT_MAX_HEIGHT)));
	} catch (error) {
		logger.warn('Could not fit the update prompt to its text', error);
	}
}

function showPrompt(options: MessageBoxOptions): Promise<number> {
	const hint = t('desktop.update.keyboardHint');
	const buttons = options.buttons ?? [t('desktop.update.ok')];
	const cancelId = options.cancelId ?? 0;
	const page = promptDocument({
		message: options.message,
		detail: options.detail ?? '',
		hint,
		buttons,
		defaultId: options.defaultId ?? 0,
		cancelId,
		locale: getNativeLocale(),
	});
	return new Promise((resolve) => {
		const window = openQuietWindow(page, {width: PROMPT_WIDTH, height: PROMPT_MIN_HEIGHT}, fitToText);
		window.webContents.on('page-title-updated', (event, title) => {
			event.preventDefault();
			const choice = CHOICE_TITLE.exec(title);
			if (choice == null) return;
			const index = Number(choice[1]);
			resolve(index < buttons.length ? index : cancelId);
			window.destroy();
		});
		window.webContents.once('did-finish-load', () => {
			if (!window.isDestroyed()) announce(`${options.message} ${hint}`);
		});
		// The close button, and quitting: both mean "not now".
		window.once('closed', () => {
			resolve(cancelId);
		});
	});
}

/** A native message box's answer, from a window that never takes focus. One prompt at a time. */
export function askQuietly(options: MessageBoxOptions): Promise<number> {
	const answer = asking.then(() => showPrompt(options));
	asking = answer.catch(() => undefined);
	return answer;
}
