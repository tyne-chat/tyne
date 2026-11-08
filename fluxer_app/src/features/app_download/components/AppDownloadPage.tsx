// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the public `/download` page (tyne-chat/tyne#242). It guesses the visitor's platform, offers
// that app first and shows how to install it, with the warnings Windows and macOS show for builds
// that are not code-signed or notarized. The buttons are the app proxy's fixed links, which
// redirect to the newest release's file; the page itself sends no request.
//
// `?get=<target>` (from the "Get the Tyne app" panel) starts that download once on arrival and
// shows its platform. `?platform=<platform>` only picks the platform shown.

import {
	APP_PLATFORMS,
	type AppDownloadTarget,
	type AppPlatform,
	appDownloadLink,
	detectBrowserAppPlatform,
	IOS_TESTFLIGHT_URL,
	isPhonePlatform,
	mainTargetOf,
	OLDER_VERSIONS_URLS,
	parseAppDownloadTarget,
	parseAppPlatform,
	phoneQrCodeUrl,
	platformOfTarget,
} from '@app/features/app_download/utils/AppDownloadPlatform';
import {QRCodeCanvas} from '@app/features/ui/components/QRCodeCanvas';
import type {MessageDescriptor} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {
	AndroidLogoIcon,
	AppleLogoIcon,
	DeviceMobileIcon,
	DownloadSimpleIcon,
	LinuxLogoIcon,
	WindowsLogoIcon,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import type React from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import styles from './AppDownloadPage.module.css';

const PAGE_TITLES: Record<AppPlatform, MessageDescriptor> = {
	windows: msg({message: 'Get Tyne for Windows', comment: 'Heading of the download page for Windows.'}),
	mac: msg({message: 'Get Tyne for Mac', comment: 'Heading of the download page for macOS.'}),
	linux: msg({message: 'Get Tyne for Linux', comment: 'Heading of the download page for Linux.'}),
	android: msg({message: 'Get Tyne for Android', comment: 'Heading of the download page for Android.'}),
	ios: msg({message: 'Get Tyne for iPhone', comment: 'Heading of the download page for iPhone and iPad.'}),
};

const MAIN_BUTTONS: Record<'windows' | 'mac' | 'android', MessageDescriptor> = {
	windows: msg({message: 'Download for Windows', comment: 'Button that downloads the Tyne app for Windows.'}),
	mac: msg({message: 'Download for Mac', comment: 'Button that downloads the Tyne app for macOS.'}),
	android: msg({message: 'Download for Android', comment: 'Button that downloads the Tyne app for Android.'}),
};

const REQUIREMENTS: Record<AppPlatform, MessageDescriptor> = {
	windows: msg({message: 'Windows 10 or 11', comment: 'Which Windows versions the Tyne app needs.'}),
	mac: msg({
		message: 'Apple silicon (M1 or newer)',
		comment: 'Which Macs the Tyne app runs on: Macs with an Apple processor, M1 or newer.',
	}),
	linux: msg({
		message: 'Ubuntu, Fedora and more',
		comment: 'Under "Linux" in the list of platforms: Linux distributions the Tyne app installs on.',
	}),
	android: msg({message: 'Phones and tablets', comment: 'Under "Android" in the list of platforms.'}),
	ios: msg({message: 'iOS 16 or newer', comment: 'Which iPhone and iPad system versions the Tyne app needs.'}),
};

const QR_CODE_LABEL = msg({
	message: 'QR code that opens the Tyne download page',
	comment: 'Screen reader description of the QR code in the "Get the Tyne app" panel.',
});

// i18n-ignore: platform names are the same in every language.
const PLATFORM_NAMES: Record<AppPlatform, string> = {
	windows: 'Windows',
	mac: 'Mac',
	linux: 'Linux',
	android: 'Android',
	ios: 'iPhone',
};

function PlatformIcon({platform, className}: {platform: AppPlatform; className: string}): React.ReactElement {
	const props = {weight: 'fill', 'aria-hidden': true, className} as const;
	switch (platform) {
		case 'windows':
			return <WindowsLogoIcon {...props} data-flx="app-download.page.icon.windows" />;
		case 'mac':
			return <AppleLogoIcon {...props} data-flx="app-download.page.icon.mac" />;
		case 'linux':
			return <LinuxLogoIcon {...props} data-flx="app-download.page.icon.linux" />;
		case 'android':
			return <AndroidLogoIcon {...props} data-flx="app-download.page.icon.android" />;
		case 'ios':
			return <DeviceMobileIcon {...props} data-flx="app-download.page.icon.ios" />;
	}
}

function readInitialChoice(): {platform: AppPlatform | null; startTarget: AppDownloadTarget | null} {
	const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
	const startTarget = parseAppDownloadTarget(params.get('get'));
	const platform =
		(startTarget == null ? null : platformOfTarget(startTarget)) ??
		parseAppPlatform(params.get('platform')) ??
		detectBrowserAppPlatform();
	return {platform, startTarget};
}

function useStartDownloadOnce(target: AppDownloadTarget | null): void {
	const started = useRef(false);
	useEffect(() => {
		if (target == null || started.current) {
			return;
		}
		started.current = true;
		// Drop `?get=` so that reloading the page does not download the file again.
		window.history.replaceState(window.history.state, '', window.location.pathname);
		// The link answers with a redirect to a file the browser saves; the page stays.
		window.location.assign(appDownloadLink(target));
	}, [target]);
}

function LinuxButtons(): React.ReactElement {
	return (
		<div className={styles.linuxButtons} data-flx="app-download.page.linux-buttons">
			<a className={styles.mainButton} href={appDownloadLink('linux-deb')} data-flx="app-download.page.linux-deb">
				<span className={styles.buttonLabel} data-flx="app-download.app-download-page.linux-buttons.button-label">
					<DownloadSimpleIcon
						weight="bold"
						aria-hidden
						className={styles.buttonIcon}
						data-flx="app-download.app-download-page.linux-buttons.button-icon"
					/>
					<Trans comment="Button that downloads the Tyne app as a .deb package for Linux.">Download .deb</Trans>
				</span>
				<span className={styles.buttonHint} data-flx="app-download.app-download-page.linux-buttons.button-hint">
					<Trans comment="Under the .deb download button: the Linux distributions that use .deb packages.">
						Ubuntu, Debian, Linux Mint
					</Trans>
				</span>
			</a>
			<a className={styles.secondaryButton} href={appDownloadLink('linux-rpm')} data-flx="app-download.page.linux-rpm">
				<span className={styles.buttonLabel} data-flx="app-download.app-download-page.linux-buttons.button-label--2">
					<DownloadSimpleIcon
						weight="bold"
						aria-hidden
						className={styles.buttonIcon}
						data-flx="app-download.app-download-page.linux-buttons.button-icon--2"
					/>
					<Trans comment="Button that downloads the Tyne app as an .rpm package for Linux.">Download .rpm</Trans>
				</span>
				<span className={styles.buttonHint} data-flx="app-download.app-download-page.linux-buttons.button-hint--2">
					<Trans comment="Under the .rpm download button: the Linux distributions that use .rpm packages.">
						Fedora, openSUSE
					</Trans>
				</span>
			</a>
			<a
				className={styles.secondaryButton}
				href={appDownloadLink('linux-appimage')}
				data-flx="app-download.page.linux-appimage"
			>
				<span className={styles.buttonLabel} data-flx="app-download.app-download-page.linux-buttons.button-label--3">
					<DownloadSimpleIcon
						weight="bold"
						aria-hidden
						className={styles.buttonIcon}
						data-flx="app-download.app-download-page.linux-buttons.button-icon--3"
					/>
					<Trans comment="Button that downloads the Tyne app as an AppImage for Linux.">Download AppImage</Trans>
				</span>
				<span className={styles.buttonHint} data-flx="app-download.app-download-page.linux-buttons.button-hint--3">
					<Trans comment="Under the AppImage download button: it works on every other Linux distribution.">
						Any other Linux
					</Trans>
				</span>
			</a>
		</div>
	);
}

function MainAction({platform}: {platform: AppPlatform}): React.ReactElement {
	const {i18n} = useLingui();
	if (platform === 'linux') {
		return <LinuxButtons data-flx="app-download.app-download-page.main-action.linux-buttons" />;
	}
	if (platform === 'ios') {
		return (
			<div className={styles.mainAction} data-flx="app-download.page.main-action">
				<a
					className={styles.mainButton}
					href={IOS_TESTFLIGHT_URL}
					target="_blank"
					rel="noopener noreferrer"
					data-flx="app-download.page.testflight"
				>
					<span className={styles.buttonLabel} data-flx="app-download.app-download-page.main-action.button-label">
						<DeviceMobileIcon
							weight="fill"
							aria-hidden
							className={styles.buttonIcon}
							data-flx="app-download.app-download-page.main-action.button-icon"
						/>
						<Trans comment="Button that opens the Tyne beta in Apple's TestFlight app.">Get Tyne in TestFlight</Trans>
					</span>
				</a>
				<p className={styles.requirement} data-flx="app-download.app-download-page.main-action.requirement">
					{i18n._(REQUIREMENTS.ios)}
				</p>
			</div>
		);
	}
	const target = mainTargetOf(platform) as AppDownloadTarget;
	return (
		<div className={styles.mainAction} data-flx="app-download.page.main-action">
			<a className={styles.mainButton} href={appDownloadLink(target)} data-flx="app-download.page.main-button">
				<span className={styles.buttonLabel} data-flx="app-download.app-download-page.main-action.button-label--2">
					<PlatformIcon
						platform={platform}
						className={styles.buttonIcon}
						data-flx="app-download.app-download-page.main-action.button-icon--2"
					/>
					{i18n._(MAIN_BUTTONS[platform as keyof typeof MAIN_BUTTONS])}
				</span>
			</a>
			{platform === 'android' ? null : (
				<p className={styles.requirement} data-flx="app-download.app-download-page.main-action.requirement--2">
					{i18n._(REQUIREMENTS[platform])}
				</p>
			)}
		</div>
	);
}

function Step({number, warning, children}: {number: number; warning?: boolean; children: React.ReactNode}) {
	return (
		<li className={clsx(styles.step, warning && styles.warningStep)} data-flx="app-download.page.step">
			<span className={styles.stepNumber} aria-hidden="true" data-flx="app-download.app-download-page.step.step-number">
				{number}
			</span>
			{children}
		</li>
	);
}

function WindowsSteps(): React.ReactElement {
	return (
		<ol className={styles.steps} data-flx="app-download.page.steps.windows">
			<Step number={1} data-flx="app-download.app-download-page.windows-steps.step">
				<p className={styles.stepText} data-flx="app-download.app-download-page.windows-steps.step-text">
					<Trans comment="Install step: open the installer that was just downloaded.">
						Open the file you downloaded.
					</Trans>
				</p>
			</Step>
			<Step number={2} warning data-flx="app-download.app-download-page.windows-steps.step--2">
				<p className={styles.stepText} data-flx="app-download.app-download-page.windows-steps.step-text--2">
					<Trans comment="Install step on Windows. 'More info' and 'Run anyway' are the links and buttons of Windows' SmartScreen warning: use Windows' own wording in this language.">
						If Windows shows this warning, click{' '}
						<strong data-flx="app-download.app-download-page.windows-steps.strong">More info</strong>, then{' '}
						<strong data-flx="app-download.app-download-page.windows-steps.strong--2">Run anyway</strong>.
					</Trans>
				</p>
				<div
					className={clsx(styles.sketch, styles.windowsSketch)}
					aria-hidden="true"
					data-flx="app-download.app-download-page.windows-steps.sketch"
				>
					<span className={styles.sketchTitle} data-flx="app-download.app-download-page.windows-steps.sketch-title">
						<Trans comment="Title of Windows' SmartScreen warning, drawn on the download page: use Windows' own wording in this language.">
							Windows protected your PC
						</Trans>
					</span>
					<span
						className={clsx(styles.sketchLink, styles.highlight)}
						data-flx="app-download.app-download-page.windows-steps.sketch-link"
					>
						<Trans comment="Link in Windows' SmartScreen warning: use Windows' own wording in this language.">
							More info
						</Trans>
					</span>
					<span
						className={clsx(styles.sketchButton, styles.sketchEnd, styles.highlight)}
						data-flx="app-download.app-download-page.windows-steps.sketch-button"
					>
						<Trans comment="Button in Windows' SmartScreen warning: use Windows' own wording in this language.">
							Run anyway
						</Trans>
					</span>
				</div>
			</Step>
			<Step number={3} data-flx="app-download.app-download-page.windows-steps.step--3">
				<p className={styles.stepText} data-flx="app-download.app-download-page.windows-steps.step-text--3">
					<Trans comment="Last install step: the app starts after installing.">
						Tyne opens by itself. Sign in and you're done.
					</Trans>
				</p>
			</Step>
		</ol>
	);
}

function MacSteps(): React.ReactElement {
	return (
		<ol className={styles.steps} data-flx="app-download.page.steps.mac">
			<Step number={1} data-flx="app-download.app-download-page.mac-steps.step">
				<p className={styles.stepText} data-flx="app-download.app-download-page.mac-steps.step-text">
					<Trans comment="Install step on macOS. 'Applications' is the Mac's Applications folder: use macOS' own name for it.">
						Open the file you downloaded and drag Tyne into{' '}
						<strong data-flx="app-download.app-download-page.mac-steps.strong">Applications</strong>. Then open Tyne.
					</Trans>
				</p>
			</Step>
			<Step number={2} warning data-flx="app-download.app-download-page.mac-steps.step--2">
				<p className={styles.stepText} data-flx="app-download.app-download-page.mac-steps.step-text--2">
					<Trans comment="Install step on macOS. 'Done' is the button of macOS' warning that an app was not opened: use macOS' own wording.">
						When macOS says Tyne wasn't opened, click{' '}
						<strong data-flx="app-download.app-download-page.mac-steps.strong--2">Done</strong>.
					</Trans>
				</p>
				<div
					className={clsx(styles.sketch, styles.macSketch)}
					aria-hidden="true"
					data-flx="app-download.app-download-page.mac-steps.sketch"
				>
					<span className={styles.sketchTitle} data-flx="app-download.app-download-page.mac-steps.sketch-title">
						<Trans comment="Title of macOS' warning that an app was not opened, drawn on the download page: use macOS' own wording.">
							“Tyne” Not Opened
						</Trans>
					</span>
					<span className={styles.sketchButtons} data-flx="app-download.app-download-page.mac-steps.sketch-buttons">
						<span
							className={clsx(styles.sketchButton, styles.sketchPrimary, styles.highlight)}
							data-flx="app-download.app-download-page.mac-steps.sketch-button"
						>
							<Trans comment="Button in macOS' warning that an app was not opened: use macOS' own wording.">Done</Trans>
						</span>
						<span className={styles.sketchButton} data-flx="app-download.app-download-page.mac-steps.sketch-button--2">
							<Trans comment="Button in macOS' warning that an app was not opened: use macOS' own wording.">
								Move to Trash
							</Trans>
						</span>
					</span>
				</div>
			</Step>
			<Step number={3} warning data-flx="app-download.app-download-page.mac-steps.step--3">
				<p className={styles.stepText} data-flx="app-download.app-download-page.mac-steps.step-text--3">
					<Trans comment="Install step on macOS. 'System Settings', 'Privacy & Security' and 'Open Anyway' are macOS' own names: use macOS' wording in this language.">
						Open <strong data-flx="app-download.app-download-page.mac-steps.strong--3">System Settings</strong>, then{' '}
						<strong data-flx="app-download.app-download-page.mac-steps.strong--4">Privacy & Security</strong>. Scroll
						down and click <strong data-flx="app-download.app-download-page.mac-steps.strong--5">Open Anyway</strong>.
						You only do this once.
					</Trans>
				</p>
				<div
					className={clsx(styles.sketch, styles.macSketch, styles.sketchRow)}
					aria-hidden="true"
					data-flx="app-download.app-download-page.mac-steps.sketch--2"
				>
					<span data-flx="app-download.app-download-page.mac-steps.span">
						<Trans comment="Text in macOS' Privacy & Security settings after an app was blocked: use macOS' own wording.">
							“Tyne” was blocked.
						</Trans>
					</span>
					<span
						className={clsx(styles.sketchButton, styles.highlight)}
						data-flx="app-download.app-download-page.mac-steps.sketch-button--3"
					>
						<Trans comment="Button in macOS' Privacy & Security settings: use macOS' own wording.">Open Anyway</Trans>
					</span>
				</div>
			</Step>
		</ol>
	);
}

function LinuxSteps(): React.ReactElement {
	return (
		<ol className={styles.steps} data-flx="app-download.page.steps.linux">
			<Step number={1} data-flx="app-download.app-download-page.linux-steps.step">
				<p className={styles.stepText} data-flx="app-download.app-download-page.linux-steps.step-text">
					<Trans comment="Install step on Linux for .deb and .rpm packages.">
						<strong data-flx="app-download.app-download-page.linux-steps.strong">.deb or .rpm:</strong> open the file
						you downloaded and click{' '}
						<strong data-flx="app-download.app-download-page.linux-steps.strong--2">Install</strong>.
					</Trans>
				</p>
				<p className={styles.stepText} data-flx="app-download.app-download-page.linux-steps.step-text--2">
					<Trans comment="Install step on Linux for the AppImage.">
						<strong data-flx="app-download.app-download-page.linux-steps.strong--3">AppImage:</strong> right-click it,
						open <strong data-flx="app-download.app-download-page.linux-steps.strong--4">Properties</strong> and allow
						it to run as a program.
					</Trans>
				</p>
			</Step>
			<Step number={2} data-flx="app-download.app-download-page.linux-steps.step--2">
				<p className={styles.stepText} data-flx="app-download.app-download-page.linux-steps.step-text--3">
					<Trans comment="Last install step on Linux.">
						Open Tyne from your applications menu, or open the AppImage. Sign in and you're done.
					</Trans>
				</p>
			</Step>
		</ol>
	);
}

function AndroidSteps(): React.ReactElement {
	return (
		<ol className={styles.steps} data-flx="app-download.page.steps.android">
			<Step number={1} data-flx="app-download.app-download-page.android-steps.step">
				<p className={styles.stepText} data-flx="app-download.app-download-page.android-steps.step-text">
					<Trans comment="Install step: open the installer that was just downloaded.">
						Open the file you downloaded.
					</Trans>
				</p>
			</Step>
			<Step number={2} warning data-flx="app-download.app-download-page.android-steps.step--2">
				<p className={styles.stepText} data-flx="app-download.app-download-page.android-steps.step-text--2">
					<Trans comment="Install step on Android. 'Settings', 'Allow from this source' and 'Install' are Android's own words: use Android's wording in this language.">
						If your phone asks, tap{' '}
						<strong data-flx="app-download.app-download-page.android-steps.strong">Settings</strong>, turn on{' '}
						<strong data-flx="app-download.app-download-page.android-steps.strong--2">Allow from this source</strong>,
						go back and tap <strong data-flx="app-download.app-download-page.android-steps.strong--3">Install</strong>.
					</Trans>
				</p>
			</Step>
			<Step number={3} data-flx="app-download.app-download-page.android-steps.step--3">
				<p className={styles.stepText} data-flx="app-download.app-download-page.android-steps.step-text--3">
					<Trans comment="Last install step on a phone.">Open Tyne and sign in.</Trans>
				</p>
			</Step>
		</ol>
	);
}

function IosSteps(): React.ReactElement {
	return (
		<ol className={styles.steps} data-flx="app-download.page.steps.ios">
			<Step number={1} data-flx="app-download.app-download-page.ios-steps.step">
				<p className={styles.stepText} data-flx="app-download.app-download-page.ios-steps.step-text">
					<Trans comment="Install step on iPhone. TestFlight is the name of Apple's app for testing apps.">
						Install Apple's free <strong data-flx="app-download.app-download-page.ios-steps.strong">TestFlight</strong>{' '}
						app from the App Store.
					</Trans>
				</p>
			</Step>
			<Step number={2} data-flx="app-download.app-download-page.ios-steps.step--2">
				<p className={styles.stepText} data-flx="app-download.app-download-page.ios-steps.step-text--2">
					<Trans comment="Install step on iPhone. 'Get Tyne in TestFlight' is the button on this page; 'Install' is TestFlight's button.">
						Come back here and tap{' '}
						<strong data-flx="app-download.app-download-page.ios-steps.strong--2">Get Tyne in TestFlight</strong>, then{' '}
						<strong data-flx="app-download.app-download-page.ios-steps.strong--3">Install</strong>.
					</Trans>
				</p>
			</Step>
			<Step number={3} data-flx="app-download.app-download-page.ios-steps.step--3">
				<p className={styles.stepText} data-flx="app-download.app-download-page.ios-steps.step-text--3">
					<Trans comment="Last install step on a phone.">Open Tyne and sign in.</Trans>
				</p>
			</Step>
		</ol>
	);
}

function InstallSteps({platform}: {platform: AppPlatform}): React.ReactElement {
	switch (platform) {
		case 'windows':
			return <WindowsSteps data-flx="app-download.app-download-page.install-steps.windows-steps" />;
		case 'mac':
			return <MacSteps data-flx="app-download.app-download-page.install-steps.mac-steps" />;
		case 'linux':
			return <LinuxSteps data-flx="app-download.app-download-page.install-steps.linux-steps" />;
		case 'android':
			return <AndroidSteps data-flx="app-download.app-download-page.install-steps.android-steps" />;
		case 'ios':
			return <IosSteps data-flx="app-download.app-download-page.install-steps.ios-steps" />;
	}
}

export function AppDownloadPage(): React.ReactElement {
	const {i18n} = useLingui();
	const initial = useMemo(readInitialChoice, []);
	const visitorOnPhone = useMemo(() => isPhonePlatform(detectBrowserAppPlatform()), []);
	const [platform, setPlatform] = useState<AppPlatform | null>(initial.platform);
	const [highlightPlatforms, setHighlightPlatforms] = useState(false);
	const pageRef = useRef<HTMLDivElement>(null);
	const platformsRef = useRef<HTMLElement>(null);
	useStartDownloadOnce(initial.startTarget);
	const host = typeof window === 'undefined' ? '' : window.location.host;
	const olderVersionsUrl = OLDER_VERSIONS_URLS[platform ?? 'windows'];
	const downloadStartedHere = initial.startTarget != null && platform === platformOfTarget(initial.startTarget);

	// The list may already be in view, so besides scrolling to it, outline it and move focus there.
	const showPlatforms = () => {
		platformsRef.current?.scrollIntoView({behavior: 'smooth', block: 'center'});
		platformsRef.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true});
		setHighlightPlatforms(true);
	};
	const choosePlatform = (each: AppPlatform) => {
		setPlatform(each);
		pageRef.current?.scrollTo({top: 0, behavior: 'smooth'});
	};

	return (
		<div ref={pageRef} className={styles.page} data-flx="app-download.page">
			<header className={styles.header} data-flx="app-download.page.header">
				<div className={styles.headerInner} data-flx="app-download.app-download-page.header-inner">
					{/* i18n-ignore: the product name. */}
					<span className={styles.wordmark} data-flx="app-download.app-download-page.wordmark">
						Tyne
					</span>
					<span className={styles.host} dir="ltr" data-flx="app-download.app-download-page.host">
						{host}
					</span>
				</div>
			</header>
			<main className={styles.main} data-flx="app-download.page.main">
				<section className={styles.hero} aria-labelledby="app-download-title" data-flx="app-download.page.hero">
					<div className={styles.heroText} data-flx="app-download.app-download-page.hero-text">
						<h1
							id="app-download-title"
							className={styles.title}
							data-flx="app-download.app-download-page.app-download-title"
						>
							{platform == null ? (
								<Trans comment="Heading of the download page when the visitor's platform is not known.">
									Get the Tyne app
								</Trans>
							) : (
								i18n._(PAGE_TITLES[platform])
							)}
						</h1>
						{platform == null ? null : (
							<MainAction platform={platform} data-flx="app-download.app-download-page.main-action" />
						)}
						{downloadStartedHere ? (
							<p className={styles.note} role="status" data-flx="app-download.page.download-started">
								<Trans comment="On the download page after the visitor chose to download the app elsewhere.">
									Your download should start in a moment. If it doesn't, use the button above.
								</Trans>
							</p>
						) : null}
						<p className={styles.links} data-flx="app-download.app-download-page.links">
							<button
								type="button"
								className={styles.linkButton}
								onClick={showPlatforms}
								data-flx="app-download.page.choose-another"
							>
								<Trans comment="Link on the download page to the list of every platform.">
									Choose another platform
								</Trans>
							</button>
							{olderVersionsUrl == null ? null : (
								<a
									href={olderVersionsUrl}
									className={styles.link}
									target="_blank"
									rel="noopener noreferrer"
									data-flx="app-download.page.older-versions"
								>
									<Trans comment="Link on the download page to every earlier release of the app.">Older versions</Trans>
								</a>
							)}
						</p>
					</div>
					{visitorOnPhone ? null : (
						<aside className={styles.qrCard} aria-labelledby="app-download-phone" data-flx="app-download.page.qr-card">
							<h2
								id="app-download-phone"
								className={styles.qrTitle}
								data-flx="app-download.app-download-page.app-download-phone"
							>
								<Trans comment="Heading of the QR code box on the download page.">Also on your phone</Trans>
							</h2>
							<div
								className={styles.qrCode}
								role="img"
								aria-label={i18n._(QR_CODE_LABEL)}
								data-flx="app-download.app-download-page.qr-code"
							>
								<QRCodeCanvas
									data={phoneQrCodeUrl(platform)}
									size={148}
									data-flx="app-download.app-download-page.qr-code-canvas"
								/>
							</div>
							<p className={styles.qrHint} data-flx="app-download.app-download-page.qr-hint">
								<Trans comment="Under the QR code on the download page.">Scan with your phone's camera.</Trans>
							</p>
						</aside>
					)}
				</section>

				{platform == null ? null : (
					<section
						className={styles.section}
						aria-labelledby="app-download-install"
						data-flx="app-download.page.install"
					>
						<h2
							id="app-download-install"
							className={styles.sectionTitle}
							data-flx="app-download.app-download-page.app-download-install"
						>
							<Trans comment="Heading of the install steps on the download page.">How to install</Trans>
						</h2>
						<InstallSteps platform={platform} data-flx="app-download.app-download-page.install-steps" />
					</section>
				)}

				<section
					ref={platformsRef}
					className={clsx(styles.section, highlightPlatforms && styles.highlightPlatforms)}
					onAnimationEnd={() => setHighlightPlatforms(false)}
					aria-labelledby="app-download-all"
					data-flx="app-download.page.platforms"
				>
					<h2
						id="app-download-all"
						className={styles.sectionTitle}
						data-flx="app-download.app-download-page.app-download-all"
					>
						<Trans comment="Heading of the list of every platform on the download page.">All platforms</Trans>
					</h2>
					<div className={styles.platformGrid} data-flx="app-download.app-download-page.platform-grid">
						{APP_PLATFORMS.map((each) => (
							<button
								key={each}
								type="button"
								className={clsx(styles.platformCard, each === platform && styles.platformCardSelected)}
								aria-pressed={each === platform}
								onClick={() => choosePlatform(each)}
								data-flx={`app-download.page.platform.${each}`}
							>
								<PlatformIcon
									platform={each}
									className={styles.platformIcon}
									data-flx="app-download.app-download-page.platform-icon"
								/>
								<span className={styles.platformName} data-flx="app-download.app-download-page.platform-name">
									{PLATFORM_NAMES[each]}
								</span>
								<span className={styles.platformDetail} data-flx="app-download.app-download-page.platform-detail">
									{i18n._(REQUIREMENTS[each])}
								</span>
							</button>
						))}
					</div>
				</section>
			</main>
		</div>
	);
}
