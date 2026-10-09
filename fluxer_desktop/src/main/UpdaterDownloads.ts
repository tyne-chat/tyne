// SPDX-License-Identifier: AGPL-3.0-or-later

import {BUILD_CHANNEL} from '@electron/common/BuildChannel';
import {DOWNLOAD_PAGE_URLS} from '@electron/common/Constants';
import {getUpdateBaseUrl, type ManualDesktopFormat} from '@electron/main/ShellDownloadFormats';

// Fork imports.

import {DESKTOP_ARTIFACT_PRODUCT_NAME} from '@electron/common/DesktopIdentity';
import {
	DESKTOP_DOWNLOAD_ARCH,
	forkLatestAssetBaseUrl,
	forkReleasesPageUrl,
	forkVersionDownloadUrl,
	isLinuxManualDesktopFormat,
	LINUX_MANUAL_ARCH_TOKENS,
	LINUX_MANUAL_FORMAT_EXTENSIONS,
	type LinuxManualDesktopFormat,
} from '@electron/main/ShellDownloadFormats';

export type UpdaterDownloadOption = {
	format: ManualDesktopFormat;
	label: string;
	url: string;
	suggestedName?: string;
	sha256?: string | null;
};

export const UPDATE_BASE_URL = forkLatestAssetBaseUrl() ?? getUpdateBaseUrl();
export const DOWNLOAD_PAGE_URL = forkReleasesPageUrl() ?? DOWNLOAD_PAGE_URLS[BUILD_CHANNEL];

export type ManualLatestFile = {url: string; sha256: string | null};

export type ManualLatestInfo = {
	version: string;
	pubDate: string | null;
	files: Partial<Record<ManualDesktopFormat, ManualLatestFile>>;
};

function getManualDownloadFormatPreference(): Array<ManualDesktopFormat> {
	if (process.platform === 'darwin') {
		return ['dmg', 'zip'];
	}
	if (process.platform === 'win32') {
		return ['setup'];
	}
	return [];
}

// Fork: helper functions for manual update options (used by fork release assets/tests).

const LINUX_MANUAL_FORMAT_LABELS: Record<LinuxManualDesktopFormat, string> = {
	appimage: 'AppImage',
	deb: 'DEB package',
	rpm: 'RPM package',
	tar_gz: 'tar.gz archive',
};

export function buildManualVersionDownloadUrl(version: string, format: ManualDesktopFormat): string {
	return (
		forkVersionDownloadUrl(DESKTOP_ARTIFACT_PRODUCT_NAME, version, format) ?? `${UPDATE_BASE_URL}/${version}/${format}`
	);
}

function getArtifactProductName(): string {
	return DESKTOP_ARTIFACT_PRODUCT_NAME;
}

function getManualUpdateSuggestedName(format: LinuxManualDesktopFormat, version: string): string {
	const archToken = LINUX_MANUAL_ARCH_TOKENS[format][DESKTOP_DOWNLOAD_ARCH];
	const extension = LINUX_MANUAL_FORMAT_EXTENSIONS[format];
	return `${getArtifactProductName()}-${version}-linux-${archToken}${extension}`;
}

export function getManualDownloadOptions(info: ManualLatestInfo): Array<UpdaterDownloadOption> {
	if (process.platform !== 'linux') {
		return [];
	}
	const formatPreference: Array<ManualDesktopFormat> = ['appimage', 'deb', 'rpm', 'tar_gz'];
	return formatPreference.filter(isLinuxManualDesktopFormat).map((format) => {
		const file = info.files[format];
		return {
			format,
			label: LINUX_MANUAL_FORMAT_LABELS[format],
			url: buildManualVersionDownloadUrl(info.version, format),
			suggestedName: getManualUpdateSuggestedName(format, info.version),
			sha256: file?.sha256 ?? null,
		};
	});
}
export function getManualDownloadUrl(info: ManualLatestInfo): string {
	for (const format of getManualDownloadFormatPreference()) {
		const url = info.files[format]?.url;
		if (url) {
			return url;
		}
	}
	return DOWNLOAD_PAGE_URL;
}
