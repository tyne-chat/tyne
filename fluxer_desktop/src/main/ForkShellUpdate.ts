// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream checks for and installs shell updates from inside its module system, which fork
// builds leave off because the whole app ships in the installer. Nothing then tells upstream's
// update gate (DesktopUpdateGate.ts) that a newer release exists, and "Check for updates" would
// always answer "up to date". This arms the gate with a controller for the fork's GitHub
// releases (see the note at the end of ShellDownloadFormats.ts). The tray and menu entries and
// the installing itself stay upstream's.
//
// Two things upstream's module system does around an update are done here in its place, since
// both live in code a fork build never runs: telling the user when a background check finds a
// release (upstream only adds a tray menu entry outside the module system, which is easy to
// miss), and showing the download's progress. Upstream shows progress on its splash window,
// which belongs to the bootstrap bundle and must not be loaded from this one
// (SplashBundleOwnership.test.mjs), so the progress here has a small window of its own.

import {createChildLogger} from '@electron/common/Logger';
import {MODULE_SYSTEM_BUILD_ENABLED} from '@electron/common/ModuleSystem';
import {armDesktopUpdate, checkDesktopUpdateNow, type DesktopUpdateCheck} from '@electron/main/DesktopUpdateGate';
import {t} from '@electron/main/MainI18n';
import {compareModuleVersions, parseModuleVersion} from '@electron/main/ModuleVersion';
import {openExternalDeduped} from '@electron/main/OpenExternal';
import {forkLatestInfoUrl, forkReleasesPageUrl} from '@electron/main/ShellDownloadFormats';
import {
	resolveShellUpdatePlan,
	ShellUpdateCapability,
	type ShellUpdatePlan,
} from '@electron/main/ShellUpdateCapability';
import {app, BrowserWindow, dialog, type MessageBoxOptions, net} from 'electron';

const logger = createChildLogger('ForkShellUpdate');
const FIRST_CHECK_DELAY_MS = 2 * 60_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

type ForkSelfUpdatePlan = Extract<ShellUpdatePlan, {capability: typeof ShellUpdateCapability.SELF_UPDATE}>;

interface ForkShellUpdateFailure {
	readonly reason: string;
	readonly detail: string | null;
}

interface ForkShellUpdateDependencies {
	readonly plan: ForkSelfUpdatePlan;
	readonly currentVersion: string;
	readonly fetchLatestVersion: () => Promise<string>;
	// Resolves only if the update did not go through. On success the app quits to install it.
	readonly runSelfUpdate: (plan: ForkSelfUpdatePlan) => Promise<ForkShellUpdateFailure>;
	readonly reportFailure: (failure: ForkShellUpdateFailure) => Promise<void>;
	readonly openReleasesPage: () => Promise<void>;
}

interface ForkShellUpdateController {
	readonly check: () => Promise<DesktopUpdateCheck>;
	readonly start: () => Promise<void>;
}

export function isNewerShellVersion(latest: string, current: string): boolean {
	return (
		compareModuleVersions(parseModuleVersion(latest, 'latest release'), parseModuleVersion(current, 'shell version')) >
		0
	);
}

export function createForkShellUpdateController(dependencies: ForkShellUpdateDependencies): ForkShellUpdateController {
	return {
		check: async () => ({
			shellNewer: isNewerShellVersion(await dependencies.fetchLatestVersion(), dependencies.currentVersion),
			modulesChanged: false,
		}),
		start: async () => {
			// The macOS builds are unsigned, and macOS only lets a signed app replace itself.
			if (dependencies.plan.updater === 'electron') {
				await dependencies.openReleasesPage();
				return;
			}
			const failure = await dependencies.runSelfUpdate(dependencies.plan);
			if (failure.reason === 'no-update') {
				logger.info('The release feed had nothing newer to install after all');
				return;
			}
			if (failure.reason === 'postponed') {
				logger.info('The update is downloaded and waits for a restart the user put off');
				return;
			}
			await dependencies.reportFailure(failure);
		},
	};
}

// Decides when a release found by a background check is put in front of the user. Once per
// version for as long as the app runs: someone who answers "Later" is not asked again every six
// hours, but is asked the next time the app starts, and straight away if a still newer release
// comes out. The tray menu keeps its "update available" entry in the meantime.
export class ForkUpdateAnnouncements {
	private announced: string | null = null;

	shouldAnnounce(version: string | null, state: {readonly available: boolean; readonly updating?: boolean}): boolean {
		if (version == null || !state.available || state.updating === true) return false;
		if (this.announced === version) return false;
		this.announced = version;
		return true;
	}
}

interface ForkUpdateProgressSurface {
	readonly open: () => void;
	readonly downloading: (percent: number | null) => void;
	readonly restarting: () => void;
	readonly close: () => void;
}

interface ForkUpdateProgress {
	readonly onDownloading: (percent: number | null) => void;
	readonly onRestarting: () => void;
	readonly close: () => void;
	// Whether this run downloaded anything, as opposed to finding the update already on disk.
	readonly downloaded: () => boolean;
}

// Shows nothing until the download starts, so a check that finds nothing or fails does not
// flash a window. A fault in showing progress must never stop the update itself.
export function createForkUpdateProgress(surface: ForkUpdateProgressSurface): ForkUpdateProgress {
	let opened = false;
	let downloaded = false;
	const guarded = (step: string, run: () => void): void => {
		try {
			run();
		} catch (error) {
			logger.warn('Could not show the update progress', {step, error});
		}
	};
	const ensureOpen = (): void => {
		if (opened) return;
		opened = true;
		guarded('open', surface.open);
	};
	return {
		onDownloading: (percent) => {
			downloaded = true;
			ensureOpen();
			guarded('downloading', () => surface.downloading(percent));
		},
		onRestarting: () => {
			ensureOpen();
			guarded('restarting', surface.restarting);
		},
		close: () => {
			if (!opened) return;
			opened = false;
			guarded('close', surface.close);
		},
		downloaded: () => downloaded,
	};
}

// The download can take minutes, and by its end the user may be in a call or halfway through a
// message, so closing the app is asked for once more. Not when nothing was downloaded: then the
// update was already on disk and the user has only just asked for it to be installed.
export function createRestartConfirmation(
	progress: Pick<ForkUpdateProgress, 'downloaded'>,
	ask: () => Promise<boolean>,
): () => Promise<boolean> {
	return async () => {
		if (!progress.downloaded()) return true;
		try {
			return await ask();
		} catch (error) {
			logger.warn('Could not ask about restarting for the update, leaving it for later', error);
			return false;
		}
	};
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

// The whole progress window: a sentence, a bar and a percentage. It runs no code but the two
// functions below, loads nothing, and uses a session of its own.
function progressDocument(heading: string, detail: string): string {
	return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root{color-scheme:light dark}
body{margin:0;padding:22px 24px;font:14px system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#1d1d1f;user-select:none;cursor:default}
h1{margin:0 0 6px;font-size:16px;font-weight:600}
p{margin:0 0 16px;opacity:.75;line-height:1.4}
.track{height:8px;border-radius:4px;background:rgba(127,127,127,.25);overflow:hidden}
.bar{height:100%;width:0;border-radius:4px;background:#4e5fe4;transition:width .3s ease}
.busy .bar{width:35%;animation:slide 1.4s ease-in-out infinite}
@keyframes slide{0%{margin-left:-35%}100%{margin-left:100%}}
#percent{margin-top:8px;text-align:right;font-variant-numeric:tabular-nums;opacity:.75;min-height:1.2em}
@media (prefers-color-scheme:dark){body{background:#1e1f24;color:#f2f2f4}}
</style></head><body>
<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p>
<div class="track" id="track"><div class="bar" id="bar"></div></div><div id="percent"></div>
<script>
function showProgress(percent){var known=typeof percent==='number';document.getElementById('track').className=known?'track':'track busy';document.getElementById('bar').style.width=known?Math.max(0,Math.min(100,percent))+'%':'';document.getElementById('percent').textContent=known?Math.round(percent)+'%':'';}
showProgress(0);
</script></body></html>`;
}

const PROGRESS_WINDOW_SIZE = {width: 440, height: 170} as const;

function openWindowProgressSurface(version: string | null): ForkUpdateProgressSurface {
	let window: BrowserWindow | null = null;
	let lastScript = 'showProgress(0)';
	const run = (script: string): void => {
		lastScript = script;
		if (window == null || window.isDestroyed() || window.webContents.isLoading()) return;
		window.webContents.executeJavaScript(script).catch((error: unknown) => {
			logger.warn('Could not update the update progress window', error);
		});
	};
	const setTaskbarProgress = (fraction: number, mode: 'normal' | 'indeterminate' | 'none'): void => {
		for (const candidate of BrowserWindow.getAllWindows()) {
			if (!candidate.isDestroyed()) candidate.setProgressBar(fraction, {mode});
		}
	};
	return {
		open: () => {
			const heading =
				version == null ? t('desktop.update.availableMessage') : t('desktop.update.manualMessage', {version});
			window = new BrowserWindow({
				...PROGRESS_WINDOW_SIZE,
				useContentSize: true,
				resizable: false,
				maximizable: false,
				fullscreenable: false,
				minimizable: true,
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
			window.setMenuBarVisibility(false);
			const opened = window;
			opened.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
			opened.webContents.on('will-navigate', (event) => {
				event.preventDefault();
			});
			opened.webContents.once('did-finish-load', () => {
				if (opened.isDestroyed()) return;
				opened.show();
				run(lastScript);
			});
			// Closing the window only hides the progress; the update carries on.
			opened.once('closed', () => {
				if (window === opened) window = null;
			});
			const page = progressDocument(heading, t('desktop.update.availableDetail'));
			void opened.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`).catch((error: unknown) => {
				logger.warn('Could not load the update progress window', error);
			});
		},
		downloading: (percent) => {
			run(percent == null ? 'showProgress(null)' : `showProgress(${Math.max(0, Math.min(100, percent))})`);
			if (percent == null) setTaskbarProgress(0, 'indeterminate');
			else setTaskbarProgress(Math.max(0, Math.min(1, percent / 100)), 'normal');
		},
		restarting: () => {
			run('showProgress(null)');
			setTaskbarProgress(0, 'indeterminate');
		},
		close: () => {
			setTaskbarProgress(0, 'none');
			const closing = window;
			window = null;
			if (closing != null && !closing.isDestroyed()) closing.destroy();
		},
	};
}

async function announceForkUpdate(version: string, plan: ForkSelfUpdatePlan): Promise<void> {
	// An unsigned macOS build cannot replace itself; there the update is a download by hand.
	const installsItself = plan.updater !== 'electron';
	const options: MessageBoxOptions = {
		type: 'info',
		title: app.getName(),
		message: t('desktop.update.manualMessage', {version}),
		detail: t(installsItself ? 'desktop.update.availableDetail' : 'desktop.update.manualDetail'),
		buttons: [t(installsItself ? 'desktop.update.install' : 'desktop.update.download'), t('desktop.update.later')],
		defaultId: 0,
		cancelId: 1,
	};
	const focused = BrowserWindow.getFocusedWindow();
	const parent = focused != null && !focused.isDestroyed() && focused.isVisible() ? focused : null;
	const {response} =
		parent == null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
	if (response !== 0) {
		logger.info('The user put off the update', {version});
		return;
	}
	const {startDesktopUpdateFromShell} = await import('@electron/main/DesktopUpdatePrompt');
	startDesktopUpdateFromShell();
}

async function askToRestartForUpdate(version: string | null): Promise<boolean> {
	const options: MessageBoxOptions = {
		type: 'info',
		title: app.getName(),
		message: version == null ? t('desktop.update.availableMessage') : t('desktop.update.readyMessage', {version}),
		detail: t('desktop.update.availableDetail'),
		buttons: [t('desktop.update.restartNow'), t('desktop.update.later')],
		defaultId: 0,
		cancelId: 1,
	};
	const focused = BrowserWindow.getFocusedWindow();
	const parent = focused != null && !focused.isDestroyed() && focused.isVisible() ? focused : null;
	const {response} =
		parent == null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
	return response === 0;
}

async function fetchLatestReleaseVersion(url: string): Promise<string> {
	const response = await net.fetch(url, {
		cache: 'no-store',
		headers: {Accept: 'application/json', 'Cache-Control': 'no-cache'},
	});
	if (!response.ok) {
		throw new Error(`Latest release request failed: ${response.status}`);
	}
	const payload = (await response.json()) as {version?: unknown};
	if (typeof payload.version !== 'string' || payload.version.length === 0) {
		throw new Error('Latest release document has no version');
	}
	return payload.version;
}

// Called once at startup. Does nothing unless this is a packaged fork build that can update itself;
// builds that cannot (portable, deb, rpm) already go through upstream's manual download check.
export function armForkShellUpdate(): void {
	const latestInfoUrl = forkLatestInfoUrl();
	const releasesPageUrl = forkReleasesPageUrl();
	if (latestInfoUrl == null || releasesPageUrl == null || MODULE_SYSTEM_BUILD_ENABLED) return;
	const plan = resolveShellUpdatePlan();
	if (plan.capability !== ShellUpdateCapability.SELF_UPDATE) return;
	let latestVersion: string | null = null;
	armDesktopUpdate(
		createForkShellUpdateController({
			plan,
			currentVersion: app.getVersion(),
			fetchLatestVersion: async () => {
				latestVersion = await fetchLatestReleaseVersion(latestInfoUrl);
				return latestVersion;
			},
			runSelfUpdate: async (selfUpdatePlan) => {
				const {runShellSelfUpdate} = await import('@electron/main/ShellSelfUpdate');
				const progress = createForkUpdateProgress(openWindowProgressSurface(latestVersion));
				try {
					return await runShellSelfUpdate(selfUpdatePlan, {
						onDownloading: progress.onDownloading,
						onRestarting: progress.onRestarting,
						confirmRestart: createRestartConfirmation(progress, () => askToRestartForUpdate(latestVersion)),
					});
				} finally {
					// Only reached when the update did not go through: on success the app quits
					// with the progress window still saying that it is restarting.
					progress.close();
				}
			},
			reportFailure: async (failure) => {
				const {reportDesktopUpdateFailure} = await import('@electron/main/DesktopUpdatePrompt');
				await reportDesktopUpdateFailure(failure);
			},
			openReleasesPage: () => openExternalDeduped(releasesPageUrl),
		}),
	);
	const announcements = new ForkUpdateAnnouncements();
	const checkInBackground = (): void => {
		checkDesktopUpdateNow()
			.then(async (state) => {
				if (latestVersion == null || !announcements.shouldAnnounce(latestVersion, state)) return;
				logger.info('A background check found a newer release, telling the user', {version: latestVersion});
				await announceForkUpdate(latestVersion, plan);
			})
			.catch((error: unknown) => {
				logger.warn('The background update check failed', error);
			});
	};
	setTimeout(checkInBackground, FIRST_CHECK_DELAY_MS).unref();
	setInterval(checkInBackground, CHECK_INTERVAL_MS).unref();
	logger.info('Watching the fork releases for shell updates', {updater: plan.updater});
}
