// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: regression tests for desktop main-process broadcasts across all alive app windows
// (main + extra windows) when update state or system accessibility support changes.

import {DESKTOP_APP_ORIGIN} from '@electron/common/Constants';
import {DESKTOP_UPDATE_EVENTS, type DesktopUpdateState} from '@fluxer/desktop_ipc/src/ModuleContract';
import {beforeEach, describe, expect, it, vi} from 'vitest';

type UpdateStateListener = (state: DesktopUpdateState) => void;
type AppEventListener = (event: unknown, ...args: Array<unknown>) => void;

const mocks = vi.hoisted(() => {
	(globalThis as {__FLUXER_BUILD_CHANNEL__?: string}).__FLUXER_BUILD_CHANNEL__ ??=
		process.env.BUILD_CHANNEL || 'stable';

	const updateStateListeners: Array<UpdateStateListener> = [];
	const appOnListeners = new Map<string, Array<AppEventListener>>();

	const makeMockWindow = () => ({
		isDestroyed: vi.fn(() => false),
		webContents: {
			send: vi.fn(),
			isDestroyed: vi.fn(() => false),
		},
	});

	const mainWindow = makeMockWindow();
	const extraWindow = makeMockWindow();

	const mockIpcMain = {
		handle: vi.fn(),
		handleOnce: vi.fn(),
		removeHandler: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		off: vi.fn(),
		removeListener: vi.fn(),
		removeAllListeners: vi.fn(),
	};

	return {
		updateStateListeners,
		appOnListeners,
		mainWindow,
		extraWindow,
		mockIpcMain,
		updateState: {status: 'available', version: '2.1.39'} as unknown as DesktopUpdateState,
	};
});

vi.mock('electron', () => ({
	ipcMain: mocks.mockIpcMain,
	BrowserWindow: {
		fromWebContents: vi.fn(() => null),
		getFocusedWindow: vi.fn(() => null),
		getAllWindows: vi.fn(() => [mocks.mainWindow, mocks.extraWindow]),
	},
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
		on: vi.fn((event: string, listener: AppEventListener) => {
			const list = mocks.appOnListeners.get(event) ?? [];
			list.push(listener);
			mocks.appOnListeners.set(event, list);
		}),
		once: vi.fn(),
		whenReady: () => Promise.resolve(),
		commandLine: {hasSwitch: () => false},
	},
	autoUpdater: {on: vi.fn()},
	clipboard: {readText: vi.fn(), writeText: vi.fn()},
	dialog: {showOpenDialog: vi.fn(), showSaveDialog: vi.fn()},
	netLog: {currentlyLogging: false},
	Notification: {isSupported: () => false},
	nativeImage: {createFromPath: vi.fn()},
	powerMonitor: {getSystemIdleTime: () => 0},
	session: {defaultSession: {protocol: {isProtocolHandled: () => false}}},
	shell: {openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn()},
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
	setNativeStrings: vi.fn(),
	t: (k: string) => k,
}));

vi.mock('@electron/main/OpenExternal', () => ({
	openExternalDeduped: vi.fn(async () => undefined),
}));

vi.mock('@electron/main/Troubleshooting', () => ({
	relaunchAndExit: vi.fn(),
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
		clearAllowedThemeLocalFiles: vi.fn(),
		getThemeFolders: vi.fn(() => []),
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
	recordDesktopLastRoute: vi.fn(),
}));

vi.mock('@electron/main/DesktopUpdateGate', () => ({
	getDesktopUpdateState: vi.fn(() => mocks.updateState),
	observeDesktopUpdateState: vi.fn((listener: UpdateStateListener) => {
		mocks.updateStateListeners.push(listener);
		return () => {};
	}),
	startDesktopUpdate: vi.fn(),
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

vi.mock('@electron/main/Passkeys', () => ({
	registerPasskeyHandlers: vi.fn(),
}));

vi.mock('@electron/main/Window', () => ({
	clearSavedWindowBounds: vi.fn(),
	desktopTransparencyPendingRestart: vi.fn(() => false),
	desktopUseNativeTitleBarPendingRestart: vi.fn(() => false),
	focusQuickCssEditorWindow: vi.fn(() => false),
	focusVoicePopoutWindow: vi.fn(() => false),
	getActiveAllowTransparency: vi.fn(() => false),
	getActiveUseNativeTitleBar: vi.fn(() => false),
	getAppWindows: vi.fn(() => [mocks.mainWindow, mocks.extraWindow]),
	getMainWindow: vi.fn(() => mocks.mainWindow),
	isAliveWindow: (w: {isDestroyed?: () => boolean} | null | undefined) => Boolean(w && !w.isDestroyed?.()),
	isTrustedOrigin: (url?: string) => typeof url === 'string' && url.startsWith(`${DESKTOP_APP_ORIGIN}/`),
	QUICK_CSS_EDITOR_WINDOW_KEY: 'fluxer_quick_css_editor',
	setQuickCssEditorAlwaysOnTop: vi.fn(() => false),
	setVoicePopoutAlwaysOnTop: vi.fn(() => false),
	showWindow: vi.fn(),
}));

describe('IpcHandlers multi-window broadcasts', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.updateStateListeners.length = 0;
		mocks.appOnListeners.clear();
		const {registerIpcHandlers} = await import('@electron/main/IpcHandlers');
		registerIpcHandlers();
	});

	it('broadcasts observeDesktopUpdateState updates to both main and extra app windows', () => {
		expect(mocks.updateStateListeners).toHaveLength(1);
		mocks.updateStateListeners[0](mocks.updateState);

		expect(mocks.mainWindow.webContents.send).toHaveBeenCalledWith(
			DESKTOP_UPDATE_EVENTS.stateChanged,
			mocks.updateState,
		);
		expect(mocks.extraWindow.webContents.send).toHaveBeenCalledWith(
			DESKTOP_UPDATE_EVENTS.stateChanged,
			mocks.updateState,
		);
	});

	it('broadcasts accessibility-support-changed to both main and extra app windows', () => {
		const listeners = mocks.appOnListeners.get('accessibility-support-changed') ?? [];
		expect(listeners).toHaveLength(1);
		listeners[0]({}, true);

		expect(mocks.mainWindow.webContents.send).toHaveBeenCalledWith('accessibility-support-changed', true);
		expect(mocks.extraWindow.webContents.send).toHaveBeenCalledWith('accessibility-support-changed', true);
	});
});
