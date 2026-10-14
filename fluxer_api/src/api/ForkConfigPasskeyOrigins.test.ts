// SPDX-License-Identifier: AGPL-3.0-or-later

import {TYNE_ANDROID_PASSKEY_ORIGIN} from '@app/api/auth/ForkPasskeyOrigins';
import {buildAPIConfigFromMaster} from '@app/api/Config';
import {loadConfig, resetConfig} from '@fluxer/config/src/ConfigLoader';
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';

async function allowedOriginsFromEnv(env: Record<string, string>): Promise<Array<string>> {
	for (const [key, value] of Object.entries(env)) {
		vi.stubEnv(key, value);
	}
	resetConfig();
	return buildAPIConfigFromMaster(await loadConfig()).auth.passkeys.allowedOrigins;
}

afterEach(() => {
	vi.unstubAllEnvs();
	resetConfig();
});

afterAll(async () => {
	await loadConfig();
});

describe('passkey origins for the Tyne Android app', () => {
	it('is the canonical form of the release certificate fingerprint', () => {
		const fingerprint =
			'22:1C:16:E5:A4:B5:68:A4:D1:88:03:DE:9B:0E:F9:15:EE:CD:BB:F1:C0:CE:F3:6C:78:31:E3:A7:25:A1:6B:7B';
		const hash = Buffer.from(fingerprint.replaceAll(':', ''), 'hex').toString('base64url');
		expect(TYNE_ANDROID_PASSKEY_ORIGIN).toBe(`android:apk-key-hash:${hash}`);
	});

	it('is accepted next to an operator-supplied origin list', async () => {
		const origins = await allowedOriginsFromEnv({
			FLUXER_PASSKEY_ADDITIONAL_ALLOWED_ORIGINS: 'https://chat.example',
		});
		expect(origins).toEqual(['https://chat.example', TYNE_ANDROID_PASSKEY_ORIGIN]);
	});

	it('is listed once when the operator lists it too', async () => {
		const origins = await allowedOriginsFromEnv({
			FLUXER_PASSKEY_ADDITIONAL_ALLOWED_ORIGINS: `https://chat.example,${TYNE_ANDROID_PASSKEY_ORIGIN}`,
		});
		expect(origins).toEqual(['https://chat.example', TYNE_ANDROID_PASSKEY_ORIGIN]);
	});
});
