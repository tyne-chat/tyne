// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests of the fork's switches in addLinuxHardwareVideoDecodeFeatures, kept out of upstream's tests.
import assert from 'node:assert/strict';
import {afterEach, describe, test} from 'node:test';
import {installElectronStub} from './ForkLocalAppTestSupport.test.mjs';

installElectronStub({
	app: {isPackaged: false, getVersion: () => '1.0.0', getPath: () => '/tmp/fluxer-desktop-test'},
});

const {addLinuxHardwareVideoDecodeFeatures} = await import('./ChromiumRuntime.ts');

function decodeFeatures() {
	const features = new Set();
	addLinuxHardwareVideoDecodeFeatures(features);
	return features;
}

describe('addLinuxHardwareVideoDecodeFeatures', {skip: process.platform !== 'linux'}, () => {
	afterEach(() => {
		delete process.env.FLUXER_FORK_STOCK_LINUX_ELECTRON;
		delete process.env.FLUXER_FORK_NVIDIA_VAAPI_DECODE;
	});

	test('leaves NVIDIA decoding off by default (black video on X11, tyne-chat/tyne#187)', () => {
		assert.equal(decodeFeatures().has('VaapiOnNvidiaGPUs'), false);
	});

	test('turns on NVIDIA decoding when the build asks for it', () => {
		process.env.FLUXER_FORK_NVIDIA_VAAPI_DECODE = '1';
		assert.ok(decodeFeatures().has('VaapiOnNvidiaGPUs'));
	});

	test('leaves NVIDIA decoding off in a stock-Electron build even when asked for', () => {
		process.env.FLUXER_FORK_NVIDIA_VAAPI_DECODE = '1';
		process.env.FLUXER_FORK_STOCK_LINUX_ELECTRON = '1';
		assert.equal(decodeFeatures().has('VaapiOnNvidiaGPUs'), false);
	});
});
