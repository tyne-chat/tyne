// SPDX-License-Identifier: AGPL-3.0-or-later

import {BUILD_CHANNEL, type BuildChannel} from '@electron/common/BuildChannel';

export type DesktopDownloadArch = 'x64' | 'arm64';

export function getDesktopDownloadArch(arch: NodeJS.Architecture): DesktopDownloadArch {
	return arch === 'arm64' ? 'arm64' : 'x64';
}

export const DESKTOP_DOWNLOAD_ARCH = getDesktopDownloadArch(process.arch);
const PACKAGE_ORIGIN_ENV = 'FLUXER_DESKTOP_PACKAGE_ORIGIN';
const CHANNEL_PACKAGE_ORIGINS: Record<BuildChannel, string> = {
	stable: 'https://pkgs.fluxer.com',
	canary: 'https://pkgs.fluxer.com',
	development: 'http://localhost:48780',
};

export function resolveDesktopPackageOrigin(): string {
	const override = process.env?.[PACKAGE_ORIGIN_ENV];
	if (override == null || override.trim().length === 0) {
		return CHANNEL_PACKAGE_ORIGINS[BUILD_CHANNEL];
	}
	return override.trim().replace(/\/+$/u, '');
}

export function getUpdateBaseUrl(platform: NodeJS.Platform = process.platform): string {
	// Fork: a fork build never asks upstream's package origin for updates (see the note below).
	const forkBaseUrl = forkLatestAssetBaseUrl();
	if (forkBaseUrl != null) return forkBaseUrl;
	return `${resolveDesktopPackageOrigin()}/desktop/${BUILD_CHANNEL}/${platform}/${DESKTOP_DOWNLOAD_ARCH}`;
}

export const MANUAL_DESKTOP_FORMATS = ['setup', 'dmg', 'zip', 'appimage', 'deb', 'rpm', 'tar_gz'] as const;

export type ManualDesktopFormat = (typeof MANUAL_DESKTOP_FORMATS)[number];

export type LinuxManualDesktopFormat = Extract<ManualDesktopFormat, 'appimage' | 'deb' | 'rpm' | 'tar_gz'>;

export const LINUX_MANUAL_FORMAT_EXTENSIONS: Record<LinuxManualDesktopFormat, string> = {
	appimage: '.AppImage',
	deb: '.deb',
	rpm: '.rpm',
	tar_gz: '.tar.gz',
};

export const LINUX_MANUAL_ARCH_TOKENS: Record<LinuxManualDesktopFormat, Record<DesktopDownloadArch, string>> = {
	appimage: {x64: 'x86_64', arm64: 'arm64'},
	deb: {x64: 'amd64', arm64: 'arm64'},
	rpm: {x64: 'x86_64', arm64: 'aarch64'},
	tar_gz: {x64: 'x64', arm64: 'arm64'},
};

export const SPLASH_LINUX_FORMAT_ORDER: ReadonlyArray<LinuxManualDesktopFormat> = ['deb', 'rpm', 'appimage', 'tar_gz'];

export const SPLASH_LINUX_FORMAT_LABELS: Record<LinuxManualDesktopFormat, string> = {
	deb: 'Debian (deb)',
	rpm: 'Fedora (rpm)',
	appimage: 'Linux (AppImage)',
	tar_gz: 'Linux (tar.gz)',
};

export function isLinuxManualDesktopFormat(format: ManualDesktopFormat): format is LinuxManualDesktopFormat {
	return format === 'appimage' || format === 'deb' || format === 'rpm' || format === 'tar_gz';
}

export function buildManualLatestDownloadUrl(format: ManualDesktopFormat): string {
	return `${getUpdateBaseUrl()}/latest/${format}`;
}

// Fork: desktop builds of this fork are published as GitHub releases, not on the package origin
// above. Everything below is the whole mapping from what the updater asks for to where a release
// keeps it, so the updater itself stays upstream's. It is switched on by FLUXER_FORK_RELEASES
// ("owner/repository"), which scripts/build.mjs compiles into every build; without it each
// function returns null and its caller falls back to the URLs above.
//
// A release is tagged desktop-v<version> and carries, per platform and architecture:
//   - on Windows, the Velopack feed and package (releases.<channel>.json, *-full.nupkg),
//   - tyne-latest-<platform>-<arch>.json, the document the package origin serves at <base>/latest,
//   - the installers named by forkReleaseAssetName.
// scripts/fork-release-assets.mjs produces those files under the same names.

const FORK_RELEASE_REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/u;
const FORK_RELEASE_TAG_PREFIX = 'desktop-v';
// Not plain "latest": builds from before the rename to Tyne ("Fluxer Temple") read the same
// releases and ask for latest-<platform>-<arch>.json. They must not find it in a Tyne release, or
// they would try to install a Tyne package over themselves. Not finding it, they stay as they are.
const FORK_LATEST_INFO_PREFIX = 'tyne-latest';

export function forkReleaseRepository(): string | null {
	const repository = typeof process.env === 'object' ? process.env.FLUXER_FORK_RELEASES?.trim() : undefined;
	if (repository == null || !FORK_RELEASE_REPOSITORY_PATTERN.test(repository)) {
		return null;
	}
	return repository;
}

function forkReleasesUrl(): string | null {
	const repository = forkReleaseRepository();
	return repository === null ? null : `https://github.com/${repository}/releases`;
}

export function forkReleasesPageUrl(): string | null {
	const releases = forkReleasesUrl();
	return releases === null ? null : `${releases}/latest`;
}

export function forkLatestAssetBaseUrl(): string | null {
	const releases = forkReleasesUrl();
	return releases === null ? null : `${releases}/latest/download`;
}

// What the Windows updater (Velopack) is given as its update source. It has to be the bare
// repository URL: Velopack does not treat a github.com URL as a plain file server but reads
// the repository's releases through the GitHub API, taking the feed and the package from the
// newest release that has them. Given forkLatestAssetBaseUrl() it takes ".../releases/latest/
// download" for part of the repository name and every check fails with HTTP 404, which is what
// 2.0.0 to 2.0.2 did.
export function forkVelopackSourceUrl(): string | null {
	const repository = forkReleaseRepository();
	return repository === null ? null : `https://github.com/${repository}`;
}

export function forkLatestInfoUrl(
	platform: NodeJS.Platform = process.platform,
	arch: DesktopDownloadArch = getDesktopDownloadArch(process.arch),
): string | null {
	const base = forkLatestAssetBaseUrl();
	return base === null ? null : `${base}/${FORK_LATEST_INFO_PREFIX}-${platform}-${arch}.json`;
}

export function forkReleaseAssetName(
	productName: string,
	version: string,
	format: ManualDesktopFormat,
	arch: DesktopDownloadArch = getDesktopDownloadArch(process.arch),
): string {
	if (isLinuxManualDesktopFormat(format)) {
		const archToken = LINUX_MANUAL_ARCH_TOKENS[format][arch];
		return `${productName}-${version}-linux-${archToken}${LINUX_MANUAL_FORMAT_EXTENSIONS[format]}`;
	}
	if (format === 'setup') {
		return `${productName}-Setup-${version}-win-${arch}.exe`;
	}
	return `${productName}-${version}-mac-${arch}.${format}`;
}

export function forkVersionDownloadUrl(
	productName: string,
	version: string,
	format: ManualDesktopFormat,
	arch: DesktopDownloadArch = getDesktopDownloadArch(process.arch),
): string | null {
	const releases = forkReleasesUrl();
	if (releases === null) {
		return null;
	}
	const tag = encodeURIComponent(`${FORK_RELEASE_TAG_PREFIX}${version}`);
	const asset = encodeURIComponent(forkReleaseAssetName(productName, version, format, arch));
	return `${releases}/download/${tag}/${asset}`;
}
