// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaSettingsResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {Config} from '../../Config';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

describe('PersonaSettingsController', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;

	beforeEach(async () => {
		harness = await createApiTestHarness();
		account = await createTestAccount(harness);
	});

	afterEach(() => {
		Config.dev.validateResponses = true;
	});

	describe('GET /users/@me/personas/settings', () => {
		test('returns default settings when none exist', async () => {
			const res = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.get('/users/@me/personas/settings')
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(res.user_id).toBe(account.userId.toString());
			expect(res.active_persona_mode).toBe('off');
			expect(res.active_persona_id).toBeNull();
			expect(res.is_latched).toBe(false);
			expect(res.display_tag_text).toBe('');
			expect(res.display_tag_icon).toBeNull();
		});
	});

	describe('PATCH /users/@me/personas/settings', () => {
		test('updates display tag text and icon', async () => {
			const res = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({
					display_tag_text: 'SYS',
					display_tag_icon: 'system_badge.png',
				})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(res.display_tag_text).toBe('SYS');
			expect(res.display_tag_icon).toBe('system_badge.png');
			expect(res.active_persona_mode).toBe('off');

			// Check persistence via subsequent GET
			const getRes = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.get('/users/@me/personas/settings')
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(getRes.display_tag_text).toBe('SYS');
			expect(getRes.display_tag_icon).toBe('system_badge.png');
		});

		test('updates active persona mode and latching', async () => {
			const res = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({
					active_persona_mode: 'last',
					is_latched: true,
				})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(res.active_persona_mode).toBe('last');
			expect(res.is_latched).toBe(true);

			// Partial update retains existing values
			const partialRes = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({
					display_tag_text: 'CORE',
				})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(partialRes.display_tag_text).toBe('CORE');
			expect(partialRes.active_persona_mode).toBe('last');
			expect(partialRes.is_latched).toBe(true);
		});

		test('can clear display tag icon with null', async () => {
			await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({
					display_tag_icon: 'icon.png',
				})
				.expect(HTTP_STATUS.OK)
				.execute();

			const clearedRes = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({
					display_tag_icon: null,
				})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(clearedRes.display_tag_icon).toBeNull();
		});
	});
});
