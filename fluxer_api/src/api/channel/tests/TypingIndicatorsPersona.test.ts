// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createFriendship} from '@app/api/channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {afterEach, beforeEach, describe, test} from 'vitest';

async function createDmChannel(harness: ApiTestHarness, token: string, recipientId: string): Promise<{id: string}> {
	return createBuilder<{id: string}>(harness, token)
		.post('/users/@me/channels')
		.body({recipient_id: recipientId})
		.execute();
}

describe('Typing indicators as a persona', () => {
	let harness: ApiTestHarness;
	beforeEach(async () => {
		harness = await createApiTestHarness();
	});
	afterEach(async () => {
		await harness?.shutdown();
	});
	test('should send typing indicator with subprofile in DM channel', async () => {
		const user1 = await createTestAccount(harness);
		const user2 = await createTestAccount(harness);
		await createFriendship(harness, user1, user2);
		const dmChannel = await createDmChannel(harness, user1.token, user2.userId);
		await createBuilder<void>(harness, user1.token)
			.post(`/channels/${dmChannel.id}/typing`)
			.body({
				subprofile: {
					id: 'persona_test_1',
					name: 'Persona Alice',
					avatar: 'https://example.com/avatar.png',
					avatar_color: 123456,
					display_tag_text: 'System Alpha',
					color: 654321,
				},
			})
			.expect(204)
			.execute();
	});
});
