// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: "Get the Tyne app": a download button for the visitor's platform, a link to every other
// one, and on a computer a QR code that opens the download page on a phone (tyne-chat/tyne#242).
// Shown on the login and invite pages (AuthGetAppPanel) and in the sidebar's dialog (GetAppModal).
// It sends no request: the button goes to the download page, which starts the download.

import {
	type AppPlatform,
	absoluteAppDownloadPageUrl,
	appDownloadPageLink,
	detectBrowserAppPlatform,
	isPhonePlatform,
	mainTargetOf,
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
import {useMemo} from 'react';
import styles from './GetAppPanel.module.css';

export const GET_THE_APP_DESCRIPTOR = msg({
	message: 'Get the Tyne app',
	comment: 'Heading of the panel (and title of the dialog) that offers the Tyne desktop and phone apps.',
});

const MAIN_BUTTON_LABELS: Record<AppPlatform, MessageDescriptor> = {
	windows: msg({message: 'Download for Windows', comment: 'Button that downloads the Tyne app for Windows.'}),
	mac: msg({message: 'Download for Mac', comment: 'Button that downloads the Tyne app for macOS.'}),
	linux: msg({message: 'Download for Linux', comment: 'Button that opens the Linux downloads of the Tyne app.'}),
	android: msg({message: 'Download for Android', comment: 'Button that downloads the Tyne app for Android.'}),
	ios: msg({
		message: 'Get Tyne for iPhone',
		comment: 'Button that shows how to install the Tyne app on an iPhone or iPad.',
	}),
};

const ANY_PLATFORM_LABEL = msg({
	message: 'Download Tyne',
	comment: "Button that opens the Tyne download page when the visitor's platform is not known.",
});

const QR_CODE_LABEL = msg({
	message: 'QR code that opens the Tyne download page',
	comment: 'Screen reader description of the QR code in the "Get the Tyne app" panel.',
});

function PlatformIcon({platform}: {platform: AppPlatform | null}): React.ReactElement {
	const props = {weight: 'fill', 'aria-hidden': true, className: styles.buttonIcon} as const;
	switch (platform) {
		case 'windows':
			return <WindowsLogoIcon {...props} data-flx="app-download.get-app-panel.icon.windows" />;
		case 'mac':
			return <AppleLogoIcon {...props} data-flx="app-download.get-app-panel.icon.mac" />;
		case 'linux':
			return <LinuxLogoIcon {...props} data-flx="app-download.get-app-panel.icon.linux" />;
		case 'android':
			return <AndroidLogoIcon {...props} data-flx="app-download.get-app-panel.icon.android" />;
		case 'ios':
			return <DeviceMobileIcon {...props} data-flx="app-download.get-app-panel.icon.ios" />;
		default:
			return <DownloadSimpleIcon {...props} data-flx="app-download.get-app-panel.icon.any" />;
	}
}

interface GetAppPanelProps {
	// The dialog has its own title.
	readonly showTitle: boolean;
	// From inside the app, the download page opens in a new tab so the chat stays open.
	readonly openInNewTab: boolean;
	readonly className?: string;
}

export function GetAppPanel({showTitle, openInNewTab, className}: GetAppPanelProps): React.ReactElement {
	const {i18n} = useLingui();
	const platform = useMemo(detectBrowserAppPlatform, []);
	const qrData = useMemo(() => absoluteAppDownloadPageUrl(), []);
	const target = platform == null ? null : mainTargetOf(platform);
	const linkProps = openInNewTab ? {target: '_blank', rel: 'noopener noreferrer'} : {};
	return (
		<section className={clsx(styles.panel, className)} data-flx="app-download.get-app-panel">
			{showTitle ? (
				<h2 className={styles.title} data-flx="app-download.get-app-panel.title">
					{i18n._(GET_THE_APP_DESCRIPTOR)}
				</h2>
			) : null}
			<div className={styles.actions} data-flx="app-download.get-app-panel.actions">
				<a
					className={styles.mainButton}
					href={appDownloadPageLink(target)}
					{...linkProps}
					data-flx="app-download.get-app-panel.main-button"
				>
					<PlatformIcon platform={platform} data-flx="app-download.get-app-panel.platform-icon" />
					<span data-flx="app-download.get-app-panel.span">
						{i18n._(platform == null ? ANY_PLATFORM_LABEL : MAIN_BUTTON_LABELS[platform])}
					</span>
				</a>
				{platform == null ? null : (
					<a
						className={styles.link}
						href={appDownloadPageLink()}
						{...linkProps}
						data-flx="app-download.get-app-panel.other-platforms"
					>
						<Trans comment="Link from the Tyne app download button to the downloads for every platform.">
							Other platforms
						</Trans>
					</a>
				)}
			</div>
			{isPhonePlatform(platform) ? null : (
				<>
					<div className={styles.divider} aria-hidden="true" data-flx="app-download.get-app-panel.divider" />
					<div className={styles.phone} data-flx="app-download.get-app-panel.phone">
						<div
							className={styles.qrCode}
							role="img"
							aria-label={i18n._(QR_CODE_LABEL)}
							data-flx="app-download.get-app-panel.qr-code"
						>
							<QRCodeCanvas data={qrData} size={88} data-flx="app-download.get-app-panel.qr-code-canvas" />
						</div>
						<div className={styles.phoneText} data-flx="app-download.get-app-panel.phone-text">
							<span className={styles.phoneTitle} data-flx="app-download.get-app-panel.phone-title">
								<Trans comment="Heading next to a QR code that opens the Tyne download page on a phone.">
									On your phone?
								</Trans>
							</span>
							<span className={styles.phoneHint} data-flx="app-download.get-app-panel.phone-hint">
								<Trans comment="Under 'On your phone?', next to the QR code.">Scan with your camera.</Trans>
							</span>
						</div>
					</div>
				</>
			)}
		</section>
	);
}
