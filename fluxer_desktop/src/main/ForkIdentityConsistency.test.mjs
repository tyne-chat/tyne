// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the app's name and IDs are written down in several places that cannot import one another
// (the app, the packaging config, the release scripts, the release workflow). A release in which
// they disagree builds, installs and then cannot update itself. This holds them together.

import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

installElectronStub();

function read(relativePath) {
	return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');
}

function capture(source, pattern, description) {
	const match = pattern.exec(source);
	assert.ok(match, `Could not find ${description}`);
	return match[1];
}

process.env.FLUXER_FORK_IDENTITY = '1';
const {BUILD_CHANNEL} = await import('../common/BuildChannel.ts');
const identity = await import('../common/DesktopIdentity.ts');
const {APP_PROTOCOL} = await import('../common/Constants.ts');

const builderConfig = read('electron-builder.config.cjs');
const builderForkBlock = capture(
	builderConfig,
	/process\.env\.FLUXER_FORK_IDENTITY !== '0'\) \{\s*Object\.assign\(CHANNELS\.stable, \{([\s\S]*?)\}\);/u,
	'the fork block of electron-builder.config.cjs',
);
function builderValue(key) {
	return capture(builderForkBlock, new RegExp(`\\b${key}: '([^']*)'`, 'u'), `${key} in the fork packaging block`);
}

const workflow = read('../.github/workflows/fork-desktop-release.yaml');
function vpkArgument(name) {
	return capture(
		workflow,
		new RegExp(`--${name} "?([^"\\s\\\\]+(?: [^"\\\\]+)?)"? \\\\`, 'u'),
		`--${name} in the workflow`,
	);
}

const releaseAssets = read('scripts/fork-release-assets.mjs');
const verifyFeed = read('scripts/fork-verify-update-feed.cjs');

describe('the fork identity', {skip: BUILD_CHANNEL !== 'stable' && 'the fork ships the stable channel only'}, () => {
	test('the packaging config installs the app under the name and IDs the app itself uses', () => {
		assert.equal(builderValue('productName'), identity.DESKTOP_APP_NAME);
		assert.equal(builderValue('artifactProductName'), identity.DESKTOP_ARTIFACT_PRODUCT_NAME);
		assert.equal(builderValue('appId'), identity.MACOS_BUNDLE_ID);
		assert.equal(builderValue('packageName'), identity.WINDOWS_VELOPACK_ID);
		assert.equal(builderValue('linuxDesktopId'), identity.LINUX_DESKTOP_ENTRY_ID);
		assert.equal(builderValue('linuxPackageName'), identity.LEGACY_LINUX_DESKTOP_ENTRY_ID);
	});

	test('the packages declare the link scheme the app registers when it runs', () => {
		assert.match(builderForkBlock, /protocolScheme: process\.env\.FLUXER_FORK_LINK_SCHEME\b/u);
		assert.equal(
			capture(workflow, /^ {2}FLUXER_FORK_LINK_SCHEME: (\S+)$/mu, 'FLUXER_FORK_LINK_SCHEME in the workflow'),
			APP_PROTOCOL,
		);
	});

	test('the Windows installer is packed for the app the updater expects', () => {
		assert.equal(vpkArgument('packId'), identity.WINDOWS_VELOPACK_ID);
		assert.equal(vpkArgument('packTitle'), identity.DESKTOP_APP_NAME);
		assert.equal(vpkArgument('mainExe'), `${identity.DESKTOP_APP_NAME}.exe`);
		assert.equal(vpkArgument('packAuthors'), identity.WINDOWS_SHORTCUT_AUTHOR);
		assert.equal(
			capture(verifyFeed, /<id>([^<]+)<\/id>/u, 'the package id in the feed check'),
			identity.WINDOWS_VELOPACK_ID,
		);
		assert.equal(
			capture(verifyFeed, /<mainExe>([^<]+)<\/mainExe>/u, 'the executable in the feed check'),
			`${identity.DESKTOP_APP_NAME}.exe`,
		);
	});

	test('release files are named after the product the updater asks for', () => {
		assert.equal(
			capture(releaseAssets, /const PRODUCT_NAME = '([^']+)';/u, 'PRODUCT_NAME in fork-release-assets.mjs'),
			identity.DESKTOP_ARTIFACT_PRODUCT_NAME,
		);
	});

	test('the icons the installer and the app are given exist', () => {
		const iconDirectory = builderValue('iconDirectory');
		assert.equal(vpkArgument('icon'), `build_resources/${iconDirectory}/icon.ico`);
		for (const file of [
			'icon.ico',
			'icon.png',
			'1024x1024.png',
			'16x16.png',
			'FluxerTrayTemplate.png',
			'FluxerTrayTemplate@2x.png',
			'_compiled/AppIcon.icns',
			'badges/badge-1.ico',
		]) {
			const relativePath = `build_resources/${iconDirectory}/${file}`;
			assert.ok(
				existsSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url))),
				`${relativePath} is missing`,
			);
		}
	});

	// Upstream's name and marks policy: a fork with functional changes uses its own name and logo.
	test('nothing the user or the system sees of the app carries the Fluxer name', () => {
		const visible = {
			DESKTOP_APP_NAME: identity.DESKTOP_APP_NAME,
			DESKTOP_ARTIFACT_PRODUCT_NAME: identity.DESKTOP_ARTIFACT_PRODUCT_NAME,
			MACOS_BUNDLE_ID: identity.MACOS_BUNDLE_ID,
			LINUX_DESKTOP_ENTRY_ID: identity.LINUX_DESKTOP_ENTRY_ID,
			LEGACY_LINUX_DESKTOP_ENTRY_ID: identity.LEGACY_LINUX_DESKTOP_ENTRY_ID,
			LINUX_PORTAL_SESSION_TOKEN: identity.LINUX_PORTAL_SESSION_TOKEN,
			WINDOWS_VELOPACK_ID: identity.WINDOWS_VELOPACK_ID,
			WINDOWS_APP_USER_MODEL_ID: identity.WINDOWS_APP_USER_MODEL_ID,
			WINDOWS_SHORTCUT_AUTHOR: identity.WINDOWS_SHORTCUT_AUTHOR,
			linuxOptDirName: builderValue('linuxOptDirName'),
			iconDirectory: builderValue('iconDirectory'),
			APP_PROTOCOL,
		};
		for (const [name, value] of Object.entries(visible)) {
			assert.doesNotMatch(value, /fluxer/iu, `${name} is "${value}"`);
		}
	});
});
