// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: regression tests verifying ForkPrivilegedIpcGuard startup wiring, untrusted-sender
// rejection across real upstream IPC handlers, VoiceDebugEventSinkPopout self-pinning boundaries,
// and FORK_GUARDED_IPC_CHANNELS parity against fluxer_desktop/src/main/*.ts registrations.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DESKTOP_APP_LANDING_URL, DESKTOP_APP_ORIGIN} from '@electron/common/Constants';
import {FORK_GUARDED_IPC_CHANNELS} from '@electron/main/ForkPrivilegedIpcGuard';
import {VOICE_DEBUG_EVENT_SINK_POPOUT_KEY} from '@electron/main/VoiceDebugEventSinkPopout';
import {DESKTOP_LAST_ROUTE_CHANNEL} from '@fluxer/desktop_ipc/src/LastRouteContract';
import {VOICE_ENGINE_V2_HARDWARE_ENCODER_IPC_CHANNEL} from '@fluxer/voice_engine_v2/bridge';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const MAIN_DIR = path.dirname(fileURLToPath(import.meta.url));

type MockHandleListener = (event: unknown, ...args: Array<unknown>) => unknown;
type MockOnListener = (event: unknown, ...args: Array<unknown>) => void;

interface MockSenderFrame {
	readonly url: string;
	readonly origin: string;
	readonly parent: object | null;
	readonly detached: boolean;
}

const mocks = vi.hoisted(() => {
	(globalThis as {__FLUXER_BUILD_CHANNEL__?: string}).__FLUXER_BUILD_CHANNEL__ ??=
		process.env.BUILD_CHANNEL || 'stable';
	const handleMap = new Map<string, MockHandleListener>();
	const onMap = new Map<string, Array<MockOnListener>>();
	const createdPopoutWindows: Array<{
		webContents: {
			isDestroyed: () => boolean;
			isLoadingMainFrame: () => boolean;
			send: ReturnType<typeof vi.fn>;
			on: ReturnType<typeof vi.fn>;
			once: ReturnType<typeof vi.fn>;
		};
		isDestroyed: () => boolean;
		isMinimized: () => boolean;
		restore: ReturnType<typeof vi.fn>;
		show: ReturnType<typeof vi.fn>;
		focus: ReturnType<typeof vi.fn>;
		loadURL: ReturnType<typeof vi.fn>;
		setAlwaysOnTop: ReturnType<typeof vi.fn>;
		once: ReturnType<typeof vi.fn>;
	}> = [];

	const mockIpcMain = {
		handle: vi.fn((channel: string, listener: MockHandleListener) => {
			handleMap.set(channel, listener);
		}),
		handleOnce: vi.fn(),
		removeHandler: vi.fn((channel: string) => {
			handleMap.delete(channel);
		}),
		on: vi.fn((channel: string, listener: MockOnListener) => {
			const list = onMap.get(channel) ?? [];
			list.push(listener);
			onMap.set(channel, list);
			return mockIpcMain;
		}),
		once: vi.fn(),
		off: vi.fn(),
		removeListener: vi.fn(),
		removeAllListeners: vi.fn((channel?: string) => {
			if (channel) onMap.delete(channel);
			else onMap.clear();
			return mockIpcMain;
		}),
	};

	class MockBrowserWindow {
		public webContents = {
			isDestroyed: () => false,
			isLoadingMainFrame: () => false,
			send: vi.fn(),
			on: vi.fn(),
			once: vi.fn(),
			executeJavaScript: vi.fn(async () => undefined),
		};
		public setAlwaysOnTop = vi.fn();
		public once = vi.fn();
		public show = vi.fn();
		public focus = vi.fn();
		public restore = vi.fn();
		public isDestroyed = () => false;
		public isMinimized = () => false;
		public loadURL = vi.fn(async () => undefined);
		public constructor() {
			createdPopoutWindows.push(this);
		}
		public static fromWebContents = vi.fn(() => null);
		public static getFocusedWindow = vi.fn(() => null);
		public static getAllWindows = vi.fn(() => []);
	}

	return {
		handleMap,
		onMap,
		createdPopoutWindows,
		mockIpcMain,
		MockBrowserWindow,
		openExternalDeduped: vi.fn(async () => undefined),
		clipboardReadText: vi.fn(async () => 'secret-clipboard'),
		clipboardWriteText: vi.fn(async () => undefined),
		relaunchAndExit: vi.fn(),
		clearAllowedThemeLocalFiles: vi.fn(),
		getThemeFolders: vi.fn(() => []),
		setNativeStrings: vi.fn(),
		recordAppWindowRoute: vi.fn(() => true),
		recordDesktopLastRoute: vi.fn(),
		passkeyAuthenticate: vi.fn(async () => ({id: 'cred-1'})),
		enableAutostart: vi.fn(async () => undefined),
		shellOpenExternal: vi.fn(async () => undefined),
		readdir: vi.fn(async () => []),
		writeFile: vi.fn(async () => undefined),
		mkdir: vi.fn(async () => undefined),
	};
});

vi.mock('electron', () => ({
	ipcMain: mocks.mockIpcMain,
	BrowserWindow: mocks.MockBrowserWindow,
	app: {
		accessibilitySupportEnabled: false,
		getLocale: () => 'en-US',
		getSystemLocale: () => 'en-US',
		getAppPath: () => '/workspaces/fluxer/fluxer_desktop',
		getPath: () => '/tmp/fluxer-test-user-data',
		getVersion: () => '2.1.38',
		getName: () => 'Tyne',
		isPackaged: false,
		isReady: () => false,
		setName: vi.fn(),
		setPath: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		whenReady: () => Promise.resolve(),
		commandLine: {hasSwitch: () => false},
	},
	autoUpdater: {on: vi.fn()},
	clipboard: {
		readText: mocks.clipboardReadText,
		writeText: mocks.clipboardWriteText,
	},
	dialog: {showOpenDialog: vi.fn(), showSaveDialog: vi.fn()},
	netLog: {currentlyLogging: false},
	Notification: {isSupported: () => false},
	nativeImage: {createFromPath: vi.fn()},
	powerMonitor: {getSystemIdleTime: () => 0},
	session: {defaultSession: {protocol: {isProtocolHandled: () => false}}},
	shell: {openExternal: mocks.shellOpenExternal, openPath: vi.fn(), showItemInFolder: vi.fn()},
	systemPreferences: {getMediaAccessStatus: vi.fn(), askForMediaAccess: vi.fn()},
}));

vi.mock('electron-log', () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		transports: {file: {level: 'info', sync: false}, console: {level: 'debug'}},
	},
}));

vi.mock('@electron/common/Logger', () => ({
	createChildLogger: () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}),
}));

vi.mock('@electron/main/MainI18n', () => ({
	initializeMainI18n: vi.fn(),
	setNativeStrings: mocks.setNativeStrings,
	t: (k: string) => k,
}));

vi.mock('@electron/main/OpenExternal', () => ({
	openExternalDeduped: mocks.openExternalDeduped,
}));

vi.mock('@electron/main/Troubleshooting', () => ({
	relaunchAndExit: mocks.relaunchAndExit,
	setHardwareAccelerationDisabled: vi.fn(),
	setHardwareAccelerationDisabledAndRestart: vi.fn(),
	setModuleUpdatesDisabledAndRestart: vi.fn(),
}));

vi.mock('@electron/common/DesktopConfig', async () => {
	const actual = await vi.importActual<typeof import('@electron/common/DesktopConfig')>(
		'@electron/common/DesktopConfig',
	);
	return {
		...actual,
		clearAllowedThemeLocalFiles: mocks.clearAllowedThemeLocalFiles,
		getThemeFolders: mocks.getThemeFolders,
		getDesktopWindowBehaviorSettings: vi.fn(() => ({
			showTrayIcon: false,
			minimizeToTray: false,
			closeToTray: false,
			unreadLauncherBadge: true,
			rememberWindowState: true,
		})),
	};
});

vi.mock('@electron/main/DesktopLastRoute', () => ({
	recordDesktopLastRoute: mocks.recordDesktopLastRoute,
}));

vi.mock('@electron/main/ThemeFolderWatch', () => ({
	createThemeFolderWatch: vi.fn(),
	listThemeFolderCssFiles: vi.fn(async () => []),
	resolveThemeFolderFile: vi.fn(),
	stopWatchingThemeFolder: vi.fn(),
}));

vi.mock('@electron/main/ThemeLinkedFileWatch', () => ({
	createThemeLinkedFileWatchSet: vi.fn(),
	readThemeCssFile: vi.fn(),
}));

vi.mock('@electron/common/UserDataPath', () => ({
	configureUserDataPath: () => ({
		channel: 'stable',
		directoryName: 'fluxer-test',
		base: '/tmp/fluxer-test-user-data',
		portable: false,
	}),
	isPortableMode: () => false,
}));

vi.mock('@electron/main/Spellcheck', () => ({
	cleanupLinuxChromiumSpellcheckDictionaries: vi.fn(),
	registerSpellcheck: vi.fn(),
}));

vi.mock('@electron/main/Passkeys', () => {
	// Keep the real Passkeys registration behavior while avoiding native addon loading if needed,
	// OR re-export actual registerPasskeyHandlers if loadFluxerWebAuthnAddon isn't invoked at registration time.
	return vi.importActual<typeof import('@electron/main/Passkeys')>('@electron/main/Passkeys');
});

vi.mock('@electron/main/Window', async () => {
	return {
		clearSavedWindowBounds: vi.fn(),
		createWindow: vi.fn(),
		desktopTransparencyPendingRestart: vi.fn(() => false),
		desktopUseNativeTitleBarPendingRestart: vi.fn(() => false),
		focusQuickCssEditorWindow: vi.fn(() => false),
		focusVoicePopoutWindow: vi.fn(() => false),
		focusWindow: vi.fn(),
		getActiveAllowTransparency: vi.fn(() => false),
		getActiveUseNativeTitleBar: vi.fn(() => false),
		getMainWindow: vi.fn(() => null),
		hideWindow: vi.fn(),
		isAliveWindow: (w: {isDestroyed?: () => boolean} | null | undefined) => Boolean(w && !w.isDestroyed?.()),
		isAppDocumentWindowContents: vi.fn(() => true),
		isForkExtraAppWindowContents: vi.fn(() => false),
		isTrustedOrigin: (url?: string) =>
			typeof url === 'string' &&
			url.startsWith(`${DESKTOP_APP_ORIGIN}/`) &&
			!url.startsWith(`${DESKTOP_APP_ORIGIN}/api`) &&
			!url.startsWith(`${DESKTOP_APP_ORIGIN}/proxy`),
		prepareMainWindowBootFrame: vi.fn(),
		QUICK_CSS_EDITOR_WINDOW_KEY: 'fluxer_quick_css_editor',
		recordAppWindowRoute: mocks.recordAppWindowRoute,
		setQuickCssEditorAlwaysOnTop: vi.fn(() => false),
		setQuitting: vi.fn(),
		setVoicePopoutAlwaysOnTop: vi.fn(() => false),
		showWindow: vi.fn(),
		takeMainWindowBootFrame: vi.fn(),
	};
});

function makeEvent(
	senderFrame: MockSenderFrame | null,
	sender: unknown = {id: 1, getURL: () => senderFrame?.url ?? ''},
) {
	return {senderFrame, sender};
}

function untrustedSenders(): Array<{name: string; event: ReturnType<typeof makeEvent>}> {
	return [
		{
			name: 'third-party subframe',
			event: makeEvent({
				url: 'https://evil.example/embed.html',
				origin: 'https://evil.example',
				parent: {url: DESKTOP_APP_LANDING_URL},
				detached: false,
			}),
		},
		{
			name: 'detached frame',
			event: makeEvent({
				url: DESKTOP_APP_LANDING_URL,
				origin: DESKTOP_APP_ORIGIN,
				parent: null,
				detached: true,
			}),
		},
		{
			name: 'untrusted top-level external origin',
			event: makeEvent({
				url: 'https://evil.example/',
				origin: 'https://evil.example',
				parent: null,
				detached: false,
			}),
		},
	];
}

function invokeHandle(channel: string, event: unknown, ...args: Array<unknown>): unknown {
	const listener = mocks.handleMap.get(channel);
	if (!listener) throw new Error(`Missing handle registration for ${channel}`);
	return listener(event, ...args);
}

function emitOn(channel: string, event: unknown, ...args: Array<unknown>): void {
	const listeners = mocks.onMap.get(channel) ?? [];
	if (listeners.length === 0) throw new Error(`Missing on registration for ${channel}`);
	for (const listener of listeners) {
		listener(event, ...args);
	}
}

describe('ForkPrivilegedIpcGuard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.handleMap.clear();
		mocks.onMap.clear();
		mocks.createdPopoutWindows.length = 0;
	});

	it('wires guard before main startup registrations and blocks untrusted/subframe/detached callers across real handlers', async () => {
		const mainIndex = await import('@electron/main/index');
		const {registerIpcHandlers} = await import('@electron/main/IpcHandlers');
		const {registerThemeLocalFileHandlers} = await import('@electron/main/ThemeLocalFiles');
		const {registerAutostartHandlers} = await import('@electron/main/Autostart');

		mainIndex.initializeMainWindowStartup();
		registerIpcHandlers();
		registerThemeLocalFileHandlers(() => null);
		registerAutostartHandlers();

		for (const {name, event} of untrustedSenders()) {
			await expect(
				Promise.resolve().then(() => invokeHandle('open-external', event, 'https://example.com')),
				`open-external should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			await expect(
				Promise.resolve().then(() => invokeHandle('clipboard-read-text', event)),
				`clipboard-read-text should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			await expect(
				Promise.resolve().then(() => invokeHandle('clipboard-write-text', event, 'pwn')),
				`clipboard-write-text should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			await expect(
				Promise.resolve().then(() => invokeHandle('desktop-app-relaunch', event)),
				`desktop-app-relaunch should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			await expect(
				Promise.resolve().then(() => invokeHandle('theme-local-files-clear', event)),
				`theme-local-files-clear should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			await expect(
				Promise.resolve().then(() => invokeHandle('voice-background-media-cache:read', event, 'bg-1')),
				`voice-background-media-cache:read should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			await expect(
				Promise.resolve().then(() => invokeHandle('autostart-is-initialized', event)),
				`autostart-is-initialized should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			await expect(
				Promise.resolve().then(() => invokeHandle('passkey-authenticate', event, {})),
				`passkey-authenticate should reject ${name}`,
			).rejects.toThrow(/only reachable from a trusted top-level renderer document/);

			emitOn('native-locale-set', event, {locale: 'en-US', strings: {hello: 'world'}});
			emitOn(DESKTOP_LAST_ROUTE_CHANNEL, event, '/channels/@me');
		}

		expect(mocks.openExternalDeduped).not.toHaveBeenCalled();
		expect(mocks.clipboardReadText).not.toHaveBeenCalled();
		expect(mocks.clipboardWriteText).not.toHaveBeenCalled();
		expect(mocks.relaunchAndExit).not.toHaveBeenCalled();
		expect(mocks.clearAllowedThemeLocalFiles).not.toHaveBeenCalled();
		expect(mocks.setNativeStrings).not.toHaveBeenCalled();
		expect(mocks.recordDesktopLastRoute).not.toHaveBeenCalled();
	});

	it('allows trusted top-level local-app and about:blank popout senders', async () => {
		const mainIndex = await import('@electron/main/index');
		const {registerIpcHandlers} = await import('@electron/main/IpcHandlers');
		const {registerThemeLocalFileHandlers} = await import('@electron/main/ThemeLocalFiles');

		mainIndex.initializeMainWindowStartup();
		registerIpcHandlers();
		registerThemeLocalFileHandlers(() => null);

		const trustedAppEvent = makeEvent({
			url: DESKTOP_APP_LANDING_URL,
			origin: DESKTOP_APP_ORIGIN,
			parent: null,
			detached: false,
		});
		const trustedBlankPopoutEvent = makeEvent({
			url: 'about:blank',
			origin: DESKTOP_APP_ORIGIN,
			parent: null,
			detached: false,
		});

		await invokeHandle('open-external', trustedAppEvent, 'https://tyne.chat');
		expect(mocks.openExternalDeduped).toHaveBeenCalledWith('https://tyne.chat');

		await expect(invokeHandle('clipboard-read-text', trustedBlankPopoutEvent)).resolves.toBe('secret-clipboard');
		await invokeHandle('clipboard-write-text', trustedBlankPopoutEvent, 'ok');
		expect(mocks.clipboardWriteText).toHaveBeenCalledWith('ok');

		invokeHandle('theme-local-files-clear', trustedAppEvent);
		expect(mocks.clearAllowedThemeLocalFiles).toHaveBeenCalledTimes(1);

		emitOn('native-locale-set', trustedAppEvent, {locale: 'en-US', strings: {ok: 'yes'}});
		expect(mocks.setNativeStrings).toHaveBeenCalledWith('en-US', {ok: 'yes'});

		emitOn(DESKTOP_LAST_ROUTE_CHANNEL, trustedAppEvent, '/channels/@me');
		expect(mocks.recordDesktopLastRoute).toHaveBeenCalledTimes(1);
	});

	it('permits VoiceDebugEventSinkPopout data: top-level self-pinning only for its own window and key', async () => {
		const mainIndex = await import('@electron/main/index');
		const {registerIpcHandlers} = await import('@electron/main/IpcHandlers');

		mainIndex.initializeMainWindowStartup();
		registerIpcHandlers();

		const trustedAppEvent = makeEvent({
			url: DESKTOP_APP_LANDING_URL,
			origin: DESKTOP_APP_ORIGIN,
			parent: null,
			detached: false,
		});
		await invokeHandle('voice-debug-event-sink:open', trustedAppEvent, []);
		expect(mocks.createdPopoutWindows).toHaveLength(1);
		const popoutWindow = mocks.createdPopoutWindows[0];

		const popoutSelfTopFrame = {
			url: 'data:text/html;charset=utf-8,debug',
			origin: 'null',
			parent: null,
			detached: false,
		};
		const popoutSelfEvent = makeEvent(popoutSelfTopFrame, popoutWindow.webContents);
		expect(invokeHandle('popout:set-always-on-top', popoutSelfEvent, VOICE_DEBUG_EVENT_SINK_POPOUT_KEY, true)).toBe(
			true,
		);
		expect(popoutWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(true);

		const popoutChildFrameEvent = makeEvent(
			{...popoutSelfTopFrame, parent: popoutSelfTopFrame},
			popoutWindow.webContents,
		);
		expect(() =>
			invokeHandle('popout:set-always-on-top', popoutChildFrameEvent, VOICE_DEBUG_EVENT_SINK_POPOUT_KEY, false),
		).toThrow(/only reachable from a trusted top-level renderer document/);

		expect(() => invokeHandle('popout:set-always-on-top', popoutSelfEvent, 'fluxer_quick_css_editor', true)).toThrow(
			/only reachable from a trusted top-level renderer document/,
		);

		await expect(
			Promise.resolve().then(() => invokeHandle('open-external', popoutSelfEvent, 'https://evil.example')),
		).rejects.toThrow(/only reachable from a trusted top-level renderer document/);
	});

	it('keeps FORK_GUARDED_IPC_CHANNELS free of unknown or unregistered channel names', () => {
		const registeredSource = fs
			.readdirSync(MAIN_DIR)
			.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
			.map((name) => fs.readFileSync(path.join(MAIN_DIR, name), 'utf8'))
			.join('\n');

		for (const channel of FORK_GUARDED_IPC_CHANNELS) {
			const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const hasLiteralRegistration = new RegExp(`ipcMain\\.(?:handle|on)\\(\\s*['"]${escaped}['"]`).test(
				registeredSource,
			);
			const hasConstantRegistration =
				(channel === DESKTOP_LAST_ROUTE_CHANNEL &&
					/ipcMain\.on\(\s*DESKTOP_LAST_ROUTE_CHANNEL\b/.test(registeredSource)) ||
				(channel === VOICE_ENGINE_V2_HARDWARE_ENCODER_IPC_CHANNEL &&
					registeredSource.includes('VOICE_ENGINE_V2_HARDWARE_ENCODER_IPC_CHANNEL'));
			expect(
				hasLiteralRegistration || hasConstantRegistration,
				`Expected ${channel} to match an actual ipcMain.handle/on registration in fluxer_desktop/src/main/`,
			).toBe(true);
		}
	});
});
