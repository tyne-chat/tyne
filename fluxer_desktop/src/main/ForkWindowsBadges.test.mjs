// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Tyne packages the Windows taskbar badges from upstream's icon folder (the block at the end of
// electron-builder.config.cjs). Tyne's own copy fell out of step when upstream changed the badge
// format, and from 2.1.3 on Tyne showed no badge at all (tyne-chat/tyne#461). This loads the badges
// the Tyne package ships through the real WindowsBadge.ts and checks that each one gives an image.

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {installElectronStub, installTestModuleStub} from './ForkLocalAppTestSupport.test.mjs';

const DESKTOP_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));
const UNREAD_DOT = -1;

process.env.FLUXER_FORK_IDENTITY = '1';
process.env.BUILD_CHANNEL = 'stable';
const builderConfig = createRequire(import.meta.url)('../../electron-builder.config.cjs');
const badgeResource = builderConfig.extraResources.find((resource) => resource.to === 'badges');
const packagedBadges = path.join(DESKTOP_DIRECTORY, badgeResource.from);

const resourcesPath = mkdtempSync(path.join(tmpdir(), 'fork-windows-badges-'));
symlinkSync(packagedBadges, path.join(resourcesPath, 'badges'), 'dir');
after(() => rmSync(resourcesPath, {recursive: true, force: true}));

installElectronStub({
	nativeImage: {
		createFromBuffer: (buffer) => ({isEmpty: () => buffer.length === 0, size: buffer.length}),
	},
	screen: {getDisplayMatching: () => ({scaleFactor: globalThis.__forkBadgeScaleFactor ?? 1})},
});
installTestModuleStub(
	'@electron/common/DesktopConfig',
	'export const getDesktopWindowBehaviorSettings = () => ({darkTaskbarBadge: globalThis.__forkDarkBadge === true});',
);

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', {value: 'win32'});
process.resourcesPath = resourcesPath;
const {refreshWindowsBadgeOverlay, setWindowsBadgeOverlay} = await import('@electron/main/WindowsBadge');
Object.defineProperty(process, 'platform', realPlatform);

function overlayFor(count) {
	const calls = [];
	const win = {
		isDestroyed: () => false,
		getBounds: () => ({x: 0, y: 0, width: 800, height: 600}),
		setOverlayIcon: (icon, description) => calls.push({icon, description}),
	};
	Object.defineProperty(process, 'platform', {value: 'win32'});
	try {
		setWindowsBadgeOverlay(win, count);
		refreshWindowsBadgeOverlay(win);
	} finally {
		Object.defineProperty(process, 'platform', realPlatform);
	}
	return calls.at(-1);
}

describe('the Windows taskbar badges Tyne ships', () => {
	test('are upstream’s, not a copy in icons-tyne', () => {
		assert.equal(badgeResource.from, 'build_resources/icons-stable/badges/');
		assert.ok(existsSync(packagedBadges), `${packagedBadges} is missing`);
		assert.ok(!existsSync(path.join(DESKTOP_DIRECTORY, 'build_resources/icons-tyne/badges')));
	});

	for (const dark of [false, true]) {
		for (const scaleFactor of [1, 1.5, 2]) {
			test(`give an image for every count and the unread dot (${dark ? 'dark' : 'red'}, ${scaleFactor * 100}%)`, () => {
				globalThis.__forkDarkBadge = dark;
				globalThis.__forkBadgeScaleFactor = scaleFactor;
				for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 250, UNREAD_DOT]) {
					const call = overlayFor(count);
					assert.ok(call?.icon, `no badge image for ${count}`);
					assert.equal(call.icon.isEmpty(), false, `an empty badge image for ${count}`);
				}
			});
		}
	}

	test('clear the badge when nothing is unread', () => {
		globalThis.__forkDarkBadge = false;
		assert.equal(overlayFor(0)?.icon, null);
	});
});
