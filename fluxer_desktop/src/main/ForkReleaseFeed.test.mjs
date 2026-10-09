// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

function transform(name) {
	const path = fileURLToPath(new URL(`./${name}`, import.meta.url));
	return {
		path,
		code: esbuild.transformSync(readFileSync(path, 'utf8'), {
			loader: 'ts',
			format: 'cjs',
			platform: 'node',
			target: 'node20',
		}).code,
	};
}

const shellDownloadFormatsSource = transform('ShellDownloadFormats.ts');
const updaterDownloadsSource = transform('UpdaterDownloads.ts');

const REPOSITORY = 'example/fluxer-fork';
const RELEASES = `https://github.com/${REPOSITORY}/releases`;

function load({repository = REPOSITORY, platform = 'linux', arch = 'x64'} = {}) {
	const stubs = {
		'@electron/common/BuildChannel': {BUILD_CHANNEL: 'stable'},
		'@electron/common/Constants': {DOWNLOAD_PAGE_URLS: {stable: 'https://fluxer.app/download'}},
		'@electron/common/DesktopIdentity': {DESKTOP_ARTIFACT_PRODUCT_NAME: 'Fluxer'},
	};
	function evaluate({path, code}) {
		const module = {exports: {}};
		const env = repository === null ? {} : {FLUXER_FORK_RELEASES: repository};
		const context = vm.createContext({
			require: (specifier) => {
				if (specifier in stubs) return stubs[specifier];
				throw new Error(`Unexpected import: ${specifier}`);
			},
			module,
			exports: module.exports,
			process: {platform, arch, env},
			encodeURIComponent,
		});
		vm.runInContext(code, context, {filename: path});
		return module.exports;
	}
	const formats = evaluate(shellDownloadFormatsSource);
	stubs['@electron/main/ShellDownloadFormats'] = formats;
	return {formats, downloads: evaluate(updaterDownloadsSource)};
}

describe('fork release feed', () => {
	test('a build without a releases repository keeps every upstream URL', () => {
		for (const repository of [null, '', 'not a repository', 'https://github.com/example/fluxer-fork']) {
			const {formats, downloads} = load({repository});
			assert.equal(formats.forkReleaseRepository(), null);
			assert.equal(formats.forkLatestAssetBaseUrl(), null);
			assert.equal(formats.forkLatestInfoUrl(), null);
			assert.equal(formats.forkVelopackSourceUrl(), null);
			assert.equal(formats.forkVersionDownloadUrl('Fluxer', '1.4.0', 'appimage'), null);
			assert.equal(formats.getUpdateBaseUrl(), 'https://pkgs.fluxer.com/desktop/stable/linux/x64');
			assert.equal(downloads.UPDATE_BASE_URL, 'https://pkgs.fluxer.com/desktop/stable/linux/x64');
			assert.equal(downloads.DOWNLOAD_PAGE_URL, 'https://fluxer.app/download');
			assert.equal(
				downloads.buildManualVersionDownloadUrl('1.4.0', 'appimage'),
				'https://pkgs.fluxer.com/desktop/stable/linux/x64/1.4.0/appimage',
			);
		}
	});

	test('the updater reads its feed from the newest release and never from the package origin', () => {
		const {formats, downloads} = load({platform: 'win32'});
		// Everything upstream downloads for a shell update starts from this one function, so a
		// consumer upstream adds later is covered without a change here.
		assert.equal(formats.getUpdateBaseUrl(), `${RELEASES}/latest/download`);
		assert.equal(formats.getUpdateBaseUrl('linux'), `${RELEASES}/latest/download`);
		assert.equal(downloads.UPDATE_BASE_URL, `${RELEASES}/latest/download`);
		assert.equal(downloads.DOWNLOAD_PAGE_URL, `${RELEASES}/latest`);
		assert.equal(formats.forkLatestInfoUrl(), `${RELEASES}/latest/download/latest-win32-x64.json`);
		assert.equal(formats.forkLatestInfoUrl('linux', 'arm64'), `${RELEASES}/latest/download/latest-linux-arm64.json`);
	});

	test('the Windows updater is given the bare repository, which is what Velopack reads GitHub through', () => {
		const {formats} = load({platform: 'win32'});
		// Not the latest/download base: Velopack switches to the GitHub API for any github.com URL
		// and takes extra path segments for part of the repository name (HTTP 404 on every check).
		assert.equal(formats.forkVelopackSourceUrl(), `https://github.com/${REPOSITORY}`);
		assert.notEqual(formats.forkVelopackSourceUrl(), formats.getUpdateBaseUrl());
		assert.equal(new URL(formats.forkVelopackSourceUrl()).pathname.split('/').filter(Boolean).length, 2);
	});

	test('a versioned download points at the asset of that release', () => {
		const {downloads: linux} = load({platform: 'linux', arch: 'x64'});
		assert.equal(
			linux.buildManualVersionDownloadUrl('1.4.0', 'appimage'),
			`${RELEASES}/download/desktop-v1.4.0/Fluxer-1.4.0-linux-x86_64.AppImage`,
		);
		assert.equal(
			linux.buildManualVersionDownloadUrl('1.4.0', 'deb'),
			`${RELEASES}/download/desktop-v1.4.0/Fluxer-1.4.0-linux-amd64.deb`,
		);
		const {downloads: windows} = load({platform: 'win32', arch: 'x64'});
		assert.equal(
			windows.buildManualVersionDownloadUrl('1.4.0', 'setup'),
			`${RELEASES}/download/desktop-v1.4.0/Fluxer-Setup-1.4.0-win-x64.exe`,
		);
		const {downloads: mac} = load({platform: 'darwin', arch: 'arm64'});
		assert.equal(
			mac.buildManualVersionDownloadUrl('1.4.0', 'dmg'),
			`${RELEASES}/download/desktop-v1.4.0/Fluxer-1.4.0-mac-arm64.dmg`,
		);
	});

	test('the Linux download options offered for an update come from the release', () => {
		const {downloads} = load({platform: 'linux', arch: 'x64'});
		const [appimage] = downloads.getManualDownloadOptions({version: '1.4.0', pubDate: null, files: {}});
		assert.equal(appimage.format, 'appimage');
		assert.equal(appimage.url, `${RELEASES}/download/desktop-v1.4.0/Fluxer-1.4.0-linux-x86_64.AppImage`);
		assert.equal(appimage.suggestedName, 'Fluxer-1.4.0-linux-x86_64.AppImage');
	});
});
