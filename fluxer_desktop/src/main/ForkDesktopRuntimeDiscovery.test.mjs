// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

installElectronStub();
const {desktopRuntimeInitialInput} = await import('@electron/main/DesktopRuntimeDiscovery');

describe('the instance the sign-in flow starts on', () => {
	test('a launch without an instance override starts on the fork homeserver', () => {
		assert.equal(desktopRuntimeInitialInput(), 'https://temple.hypersystem.xyz');
	});
});
