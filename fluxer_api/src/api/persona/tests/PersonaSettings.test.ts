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
			expect(res.active_persona_mode).toBe('manual');
			expect(res.active_persona_id).toBeNull();
			expect(res.is_latched).toBe(false);
			expect(res.display_tag_text).toBe('');
			expect(res.display_tag_icon).toBeNull();
			expect(res.multi_persona_reactions).toBe(true);
		});
	});

	describe('PATCH /users/@me/personas/settings', () => {
		test('updates display tag text and icon', async () => {
			const res = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({
					display_tag_text: 'SYS',
					display_tag_icon: '1a2b3c4d',
				})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(res.display_tag_text).toBe('SYS');
			expect(res.display_tag_icon).toBe('1a2b3c4d');
			expect(res.active_persona_mode).toBe('manual');

			// Check persistence via subsequent GET
			const getRes = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.get('/users/@me/personas/settings')
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(getRes.display_tag_text).toBe('SYS');
			expect(getRes.display_tag_icon).toBe('1a2b3c4d');
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
					display_tag_icon: 'a_1a2b3c4d',
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

	// tyne-chat/tyne#86: reacting with one emoji as several of the account's identities.
	describe('multi_persona_reactions', () => {
		const patch = (body: Record<string, unknown>) =>
			createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body(body)
				.expect(HTTP_STATUS.OK)
				.execute();
		const get = () =>
			createBuilder<PersonaSettingsResponse>(harness, account.token)
				.get('/users/@me/personas/settings')
				.expect(HTTP_STATUS.OK)
				.execute();

		test('is on for a saved row that predates it', async () => {
			await patch({display_tag_text: 'SYS'});
			expect((await get()).multi_persona_reactions).toBe(true);
		});

		test('turns off, stays off through other saves, and turns back on', async () => {
			expect((await patch({multi_persona_reactions: false})).multi_persona_reactions).toBe(false);
			expect((await get()).multi_persona_reactions).toBe(false);

			await patch({active_persona_mode: 'last', display_tag_text: 'SYS'});
			expect((await get()).multi_persona_reactions).toBe(false);

			expect((await patch({multi_persona_reactions: true})).multi_persona_reactions).toBe(true);
			expect((await get()).multi_persona_reactions).toBe(true);
		});

		test('refuses a value that is not a boolean', async () => {
			await createBuilder(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({multi_persona_reactions: 'no'})
				.expect(HTTP_STATUS.BAD_REQUEST)
				.execute();
		});
	});
});
