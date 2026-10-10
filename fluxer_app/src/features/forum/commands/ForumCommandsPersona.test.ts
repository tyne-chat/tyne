// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a forum post is created with one request that carries its first message, so the persona
// chosen in the post composer has to travel in that request.

import {Channel, type ChannelWire} from '@app/features/channel/models/Channel';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/app/state/RuntimeConfig', () => ({default: {localInstanceDomain: 'fluxer.test'}}));
vi.mock('@app/features/user/state/Users', () => ({default: {getUser: () => undefined, cacheUsers: () => {}}}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {getChannel: () => undefined, handleChannelCreate: () => {}},
}));
vi.mock('@app/features/forum/state/ForumPosts', () => ({default: {setFirstMessage: vi.fn()}}));
vi.mock('@app/features/messaging/state/MessageQueue', () => ({default: {prepareAttachmentsForSend: vi.fn()}}));
vi.mock('@app/features/messaging/upload/CloudUpload', () => ({
	CloudUpload: {updateSendingProgress: vi.fn(), removeMessageUpload: vi.fn(), restoreAttachmentsToTextarea: vi.fn()},
}));
vi.mock('@app/features/messaging/utils/MessageRequestUtils', () => ({
	normalizeMessageContent: (content: string) => ({content, flags: 0}),
}));
vi.mock('@app/features/threads/state/ThreadGuilds', () => ({default: {isActive: () => true}}));
vi.mock('@app/features/threads/state/ChannelThreads', () => ({
	default: {upsert: (wire: ChannelWire, guildId?: string) => new Channel({...wire, guild_id: guildId})},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn()},
}));

const {createForumPost} = await import('@app/features/forum/commands/ForumCommands');
const {default: ForumPosts} = await import('@app/features/forum/state/ForumPosts');
const {http} = await import('@app/features/platform/transport/RestTransport');

const GUILD = '1500000000000000001';
const FORUM = '1500000000000000002';
const POST = '1500000000000000003';
const FOX = {id: '1500000000000000009', name: 'Fox'};

function forum(): Channel {
	return new Channel({id: FORUM, type: ChannelTypes.GUILD_FORUM, guild_id: GUILD, name: 'forum'});
}

function sentMessage(): Record<string, unknown> {
	const body = vi.mocked(http.post).mock.calls[0]?.[1]?.body as {message: Record<string, unknown>};
	return body.message;
}

describe('createForumPost', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(http.post).mockResolvedValue({
			ok: true,
			status: 201,
			body: {
				id: POST,
				type: ChannelTypes.PUBLIC_THREAD,
				parent_id: FORUM,
				message: {id: POST, channel_id: POST, content: 'bao', subprofile: FOX},
			},
		} as never);
	});

	it('posts the first message as the given persona', async () => {
		const post = await createForumPost(forum(), {
			name: 'test',
			appliedTags: [],
			content: 'bao',
			nonce: '1',
			hasAttachments: false,
			stickerIds: [],
			subprofile: FOX,
		});
		expect(post?.id).toBe(POST);
		expect(sentMessage()).toEqual({content: 'bao', subprofile: FOX});
		expect(ForumPosts.setFirstMessage).toHaveBeenCalledWith(expect.objectContaining({subprofile: FOX}));
	});

	it('sends no persona when posting as the account', async () => {
		await createForumPost(forum(), {
			name: 'test',
			appliedTags: [],
			content: 'bao',
			nonce: '2',
			hasAttachments: false,
			stickerIds: [],
		});
		expect(sentMessage()).toEqual({content: 'bao'});
	});
});
