// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {PersonaSettingsResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {createUserID, type UserID} from '../../BrandedTypes';
import {Config} from '../../Config';
import {ensureSessionStarted, getMessages} from '../../message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';
import {PersonaRepository} from '../PersonaRepository';

// The display tag icon is the hash of an image stored under the account, like a persona's avatar.
// A link would make every app that shows the account's messages load it from wherever it points.

const MEDIA = 'https://media.tyne.test/media';

describe('Display tag icon', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;
	let userId: UserID;
	const repo = new PersonaRepository();
	const originalMediaEndpoint = Config.endpoints.media;

	beforeAll(async () => {
		harness = await createApiTestHarness();
		Config.endpoints.media = MEDIA;
	});
	afterAll(async () => {
		Config.endpoints.media = originalMediaEndpoint;
		await harness?.shutdown();
	});
	beforeEach(async () => {
		await harness.reset();
		account = await createTestAccount(harness);
		userId = createUserID(BigInt(account.userId));
	});

	const patchSettings = (body: Record<string, unknown>, status: number = HTTP_STATUS.OK) =>
		createBuilder<PersonaSettingsResponse>(harness, account.token)
			.patch('/users/@me/personas/settings')
			.body(body)
			.expect(status)
			.execute();
	const getSettings = () =>
		createBuilder<PersonaSettingsResponse>(harness, account.token)
			.get('/users/@me/personas/settings')
			.expect(HTTP_STATUS.OK)
			.execute();
	// What a row written before the settings route checked the icon can hold.
	const storeRawIcon = (icon: string) =>
		repo.upsertSettings({
			user_id: userId,
			active_persona_id: null,
			active_persona_mode: 'manual',
			active_persona_scope: 'global',
			is_latched: false,
			display_tag_text: 'SYS',
			display_tag_icon: icon,
			updated_at: new Date(),
			version: 1,
		});
	const ownAvatarLink = (hash: string) => `${MEDIA}/avatars/${account.userId}/${hash}.png`;

	describe('the settings route', () => {
		it.each([
			['a link to another server', 'https://tracker.example/pixel.png'],
			['a plain http link', 'http://tracker.example/pixel.png'],
			['a link to an image on this instance', 'https://media.tyne.test/media/avatars/1/1a2b3c4d.png'],
			['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
			['a file name', 'system_badge.png'],
			['an emoji', '🦊'],
			['a hash in capitals', '1A2B3C4D'],
			['a hash that is too short', '1a2b3c4'],
		])('refuses %s', async (_what, icon) => {
			await patchSettings({display_tag_icon: icon}, HTTP_STATUS.BAD_REQUEST);
			expect((await getSettings()).display_tag_icon).toBeNull();
		});

		it.each([
			['a hash', '1a2b3c4d'],
			['an animated hash', 'a_1a2b3c4d'],
		])('stores %s', async (_what, icon) => {
			expect((await patchSettings({display_tag_icon: icon})).display_tag_icon).toBe(icon);
			expect((await getSettings()).display_tag_icon).toBe(icon);
		});

		it.each([
			['null', null],
			['an empty string', ''],
		])('clears the icon with %s', async (_what, icon) => {
			await patchSettings({display_tag_icon: '1a2b3c4d'});
			expect((await patchSettings({display_tag_icon: icon})).display_tag_icon).toBeNull();
			expect((await getSettings()).display_tag_icon).toBeNull();
		});
	});

	describe('a row stored before the route checked the icon', () => {
		it('never hands out a link to another server', async () => {
			await storeRawIcon('https://tracker.example/pixel.png');

			expect((await getSettings()).display_tag_icon).toBeNull();
			expect((await repo.findSettings(userId))?.display_tag_icon).toBeNull();
			expect((await repo.findSettingsByUserIds([userId])).get(account.userId)?.display_tag_icon).toBeNull();
		});

		it.each(['data:image/png;base64,iVBORw0KGgo=', 'icon.png', '🦊', `${MEDIA}/avatars/123456789/1a2b3c4d.png`])(
			'drops %s',
			async (icon) => {
				await storeRawIcon(icon);
				expect((await getSettings()).display_tag_icon).toBeNull();
			},
		);

		it("drops a link even to one of the account's own avatars here (the migration turned those into hashes)", async () => {
			await storeRawIcon(ownAvatarLink('5b236d99'));

			expect((await getSettings()).display_tag_icon).toBeNull();
			expect((await repo.findSettingsByUserIds([userId])).get(account.userId)?.display_tag_icon).toBeNull();
		});

		it('writes no icon back on the next save', async () => {
			await storeRawIcon('https://tracker.example/pixel.png');
			const upsert = vi.spyOn(PersonaRepository.prototype, 'upsertSettings');
			try {
				const saved = await patchSettings({display_tag_text: 'NEW'});
				expect(saved.display_tag_icon).toBeNull();
				expect(upsert).toHaveBeenCalledWith(expect.objectContaining({display_tag_icon: null}));
			} finally {
				upsert.mockRestore();
			}
		});

		it("shows no icon on the account's persona messages", async () => {
			await ensureSessionStarted(harness, account.token);
			const persona = await createBuilder<{id: string}>(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'Fox'})
				.expect(HTTP_STATUS.CREATED)
				.execute();
			const sent = await createBuilder<MessageResponse>(harness, account.token)
				.post(`/channels/${account.userId}/messages`)
				.body({content: 'hello', persona_id: persona.id})
				.expect(HTTP_STATUS.OK)
				.execute();

			await storeRawIcon('https://tracker.example/pixel.png');
			const linked = (await getMessages(harness, account.token, account.userId)).find((m) => m.id === sent.id);
			expect(linked?.subprofile?.id).toBe(persona.id);
			expect(linked?.subprofile?.display_tag_text).toBe('SYS');
			expect(linked?.subprofile?.display_tag_icon).toBeNull();

			await storeRawIcon('5b236d99');
			const hashed = (await getMessages(harness, account.token, account.userId)).find((m) => m.id === sent.id);
			expect(hashed?.subprofile?.display_tag_icon).toBe('5b236d99');
		});
	});
});
