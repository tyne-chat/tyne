// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests of the stock-Electron switch in addLinuxHardwareVideoDecodeFeatures, kept out of
// upstream's tests.
import assert from 'node:assert/strict';
import {afterEach, describe, test} from 'node:test';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

installElectronStub({
	app: {isPackaged: false, getVersion: () => '1.0.0', getPath: () => '/tmp/fluxer-desktop-test'},
});

const {addLinuxHardwareVideoDecodeFeatures} = await import('./ChromiumRuntime.ts');

describe('addLinuxHardwareVideoDecodeFeatures', {skip: process.platform !== 'linux'}, () => {
	afterEach(() => {
		delete process.env.FLUXER_FORK_STOCK_LINUX_ELECTRON;
	});

	test('turns on NVIDIA decoding with upstream patched Electron', () => {
		const features = new Set();
		addLinuxHardwareVideoDecodeFeatures(features);
		assert.ok(features.has('VaapiOnNvidiaGPUs'));
	});

	test('leaves NVIDIA decoding off in a stock-Electron build', () => {
		process.env.FLUXER_FORK_STOCK_LINUX_ELECTRON = '1';
		const features = new Set();
		addLinuxHardwareVideoDecodeFeatures(features);
		assert.equal(features.has('VaapiOnNvidiaGPUs'), false);
	});
});
