// SPDX-License-Identifier: AGPL-3.0-or-later

import {buildNamedFluxerEnvOverrides} from '@fluxer/config/src/config_loader/EnvironmentOverrides';
import {describe, expect, test} from 'vitest';

describe('buildNamedFluxerEnvOverrides: fork settings', () => {
	test('parses FLUXER_APP_DESKTOP_APP_PROMPT_ENABLED into instance.branding.desktop_app_prompt_enabled', () => {
		const overridesTrue = buildNamedFluxerEnvOverrides({
			FLUXER_APP_DESKTOP_APP_PROMPT_ENABLED: 'true',
		});
		expect(
			(overridesTrue.instance as {branding: {desktop_app_prompt_enabled: boolean}}).branding.desktop_app_prompt_enabled,
		).toBe(true);

		const overridesFalse = buildNamedFluxerEnvOverrides({
			FLUXER_APP_DESKTOP_APP_PROMPT_ENABLED: 'false',
		});
		expect(
			(overridesFalse.instance as {branding: {desktop_app_prompt_enabled: boolean}}).branding
				.desktop_app_prompt_enabled,
		).toBe(false);
	});
});
