// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream checks for and installs shell updates from inside its module system, which fork
// builds leave off because the whole app ships in the installer. Nothing then tells upstream's
// update gate (DesktopUpdateGate.ts) that a newer release exists, and "Check for updates" would
// always answer "up to date". This arms the gate with a controller for the fork's GitHub
// releases (see the note at the end of ShellDownloadFormats.ts). The prompts, the tray and menu
// entries, and the installing itself all stay upstream's.

import {createChildLogger} from '@electron/common/Logger';
import {MODULE_SYSTEM_BUILD_ENABLED} from '@electron/common/ModuleSystem';
import {armDesktopUpdate, checkDesktopUpdateNow, type DesktopUpdateCheck} from '@electron/main/DesktopUpdateGate';
import {compareModuleVersions, parseModuleVersion} from '@electron/main/ModuleVersion';
import {openExternalDeduped} from '@electron/main/OpenExternal';
import {forkLatestInfoUrl, forkReleasesPageUrl} from '@electron/main/ShellDownloadFormats';
import {
	resolveShellUpdatePlan,
	ShellUpdateCapability,
	type ShellUpdatePlan,
} from '@electron/main/ShellUpdateCapability';
import {app, net} from 'electron';

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
			await dependencies.reportFailure(failure);
		},
	};
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
	armDesktopUpdate(
		createForkShellUpdateController({
			plan,
			currentVersion: app.getVersion(),
			fetchLatestVersion: () => fetchLatestReleaseVersion(latestInfoUrl),
			runSelfUpdate: async (selfUpdatePlan) => {
				const {runShellSelfUpdate} = await import('@electron/main/ShellSelfUpdate');
				return await runShellSelfUpdate(selfUpdatePlan, {
					onDownloading: () => undefined,
					onRestarting: () => undefined,
				});
			},
			reportFailure: async (failure) => {
				const {reportDesktopUpdateFailure} = await import('@electron/main/DesktopUpdatePrompt');
				await reportDesktopUpdateFailure(failure);
			},
			openReleasesPage: () => openExternalDeduped(releasesPageUrl),
		}),
	);
	const checkInBackground = (): void => {
		checkDesktopUpdateNow().catch((error: unknown) => {
			logger.warn('The background update check failed', error);
		});
	};
	setTimeout(checkInBackground, FIRST_CHECK_DELAY_MS).unref();
	setInterval(checkInBackground, CHECK_INTERVAL_MS).unref();
	logger.info('Watching the fork releases for shell updates', {updater: plan.updater});
}
