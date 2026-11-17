// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: placeholder accounts the Discord history import makes for people not on Tyne (UserFlags.IMPORTED,
// tyne-chat/tyne#682): their profile is open to anyone signed in, and nobody can message or befriend them.
// A closed DM with one that holds messages (the imported conversation) opens again (tyne-chat/tyne#696).

import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {acceptFriendRequest, sendFriendRequest} from '@app/api/user/tests/RelationshipTestUtils';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {PublicUserFlags} from '@fluxer/constants/src/UserConstants';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('imported placeholder accounts', () => {
	let harness: ApiTestHarness;
	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});

	async function markImported(account: TestAccount): Promise<void> {
		await createBuilder(harness, '')
			.post(`/test/users/${account.userId}/security-flags`)
			.body({set_flags: ['IMPORTED']})
			.execute();
	}

	async function placeholder(): Promise<TestAccount> {
		const account = await createTestAccount(harness);
		await markImported(account);
		return account;
	}

	it('shows anyone signed in its whole profile, with the public flag and the bio', async () => {
		const viewer = await createTestAccount(harness);
		const target = await createTestAccount(harness);
		await createBuilder(harness, target.token)
			.patch('/users/@me')
			.body({bio: 'Placeholder account: messages imported from Discord.'})
			.execute();
		await markImported(target);
		const profile = await createBuilder<{
			user: {flags: number};
			user_profile: {bio: string | null};
			profile_limited?: boolean;
		}>(harness, viewer.token)
			.get(`/users/${target.userId}/profile`)
			.execute();
		expect(profile.user.flags & PublicUserFlags.IMPORTED).toBe(PublicUserFlags.IMPORTED);
		expect(profile.user_profile.bio).toBe('Placeholder account: messages imported from Discord.');
		expect(profile.profile_limited).toBeUndefined();
	});

	it("still keeps an ordinary stranger's profile to people who share something with them", async () => {
		const viewer = await createTestAccount(harness);
		const stranger = await createTestAccount(harness);
		await createBuilder(harness, viewer.token)
			.get(`/users/${stranger.userId}/profile`)
			.expect(HTTP_STATUS.FORBIDDEN, APIErrorCodes.MISSING_ACCESS)
			.execute();
	});

	it('refuses to open a DM with it', async () => {
		const viewer = await createTestAccount(harness);
		const target = await placeholder();
		await createBuilder(harness, viewer.token)
			.post('/users/@me/channels')
			.body({recipient_id: target.userId})
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.CANNOT_SEND_MESSAGES_TO_USER)
			.execute();
	});

	it('refuses messages in a DM that existed before the account was marked', async () => {
		const viewer = await createTestAccount(harness);
		const target = await createTestAccount(harness);
		await sendFriendRequest(harness, viewer.token, target.userId);
		await acceptFriendRequest(harness, target.token, viewer.userId);
		const dm = await createBuilder<{id: string}>(harness, viewer.token)
			.post('/users/@me/channels')
			.body({recipient_id: target.userId})
			.execute();
		await markImported(target);
		await createBuilder(harness, viewer.token)
			.post(`/channels/${dm.id}/messages`)
			.body({content: 'hello?'})
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.CANNOT_SEND_MESSAGES_TO_USER)
			.execute();
	});

	// A DM with history, the account then marked: what the import leaves behind.
	async function importedDm(withHistory: boolean): Promise<{viewer: TestAccount; target: TestAccount; dmId: string}> {
		const viewer = await createTestAccount(harness);
		const target = await createTestAccount(harness);
		await sendFriendRequest(harness, viewer.token, target.userId);
		await acceptFriendRequest(harness, target.token, viewer.userId);
		const dm = await createBuilder<{id: string}>(harness, viewer.token)
			.post('/users/@me/channels')
			.body({recipient_id: target.userId})
			.execute();
		if (withHistory) {
			await createBuilder(harness, viewer.token)
				.post(`/channels/${dm.id}/messages`)
				.body({content: 'from Discord'})
				.execute();
		}
		await markImported(target);
		await createBuilder(harness, viewer.token).delete(`/channels/${dm.id}`).expect(HTTP_STATUS.NO_CONTENT).execute();
		return {viewer, target, dmId: dm.id};
	}

	async function importedConversationOf(viewer: TestAccount, target: TestAccount): Promise<string | null> {
		const res = await createBuilder<{channel_id: string | null}>(harness, viewer.token)
			.get(`/users/@me/imported-conversations/${target.userId}`)
			.execute();
		return res.channel_id;
	}

	it('opens a closed DM with it again when the DM holds messages', async () => {
		const {viewer, target, dmId} = await importedDm(true);
		expect(await importedConversationOf(viewer, target)).toBe(dmId);
		const reopened = await createBuilder<{id: string}>(harness, viewer.token)
			.post('/users/@me/channels')
			.body({recipient_id: target.userId})
			.execute();
		expect(reopened.id).toBe(dmId);
		await createBuilder(harness, viewer.token)
			.post(`/channels/${dmId}/messages`)
			.body({content: 'still nobody there'})
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.CANNOT_SEND_MESSAGES_TO_USER)
			.execute();
	});

	it('does not open an empty DM with it, nor offer one', async () => {
		const {viewer, target} = await importedDm(false);
		expect(await importedConversationOf(viewer, target)).toBeNull();
		await createBuilder(harness, viewer.token)
			.post('/users/@me/channels')
			.body({recipient_id: target.userId})
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.CANNOT_SEND_MESSAGES_TO_USER)
			.execute();
	});

	it('offers no imported conversation with anyone else', async () => {
		const viewer = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		expect(await importedConversationOf(viewer, other)).toBeNull();
	});

	it('refuses friend requests by id and by username', async () => {
		const viewer = await createTestAccount(harness);
		const target = await placeholder();
		await createBuilder(harness, viewer.token)
			.post(`/users/@me/relationships/${target.userId}`)
			.body({})
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.FRIEND_REQUEST_BLOCKED)
			.execute();
		const me = await createBuilder<{username: string; discriminator: string}>(harness, target.token)
			.get('/users/@me')
			.execute();
		await createBuilder(harness, viewer.token)
			.post('/users/@me/relationships')
			.body({username: me.username, discriminator: me.discriminator})
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.FRIEND_REQUEST_BLOCKED)
			.execute();
	});
});
