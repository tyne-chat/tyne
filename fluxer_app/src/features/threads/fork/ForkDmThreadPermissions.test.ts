// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: what the permission store answers for a DM thread (tyne-chat/tyne#699). Without it a DM thread's composer
// was read-only: upstream skips the store only for DMs themselves.

import Permission from '@app/features/permissions/state/Permission';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {ThreadPermissionFlags} from '@fluxer/constants/src/ThreadPermissionUtils';
import {describe, expect, it, vi} from 'vitest';

const channels = vi.hoisted(
	() =>
		new Map<string, {id: string; type: number; guildId: string | null}>([
			['dm-thread', {id: 'dm-thread', type: 11, guildId: null}],
			['guild-thread', {id: 'guild-thread', type: 11, guildId: 'g'}],
			['dm', {id: 'dm', type: 1, guildId: null}],
		]),
);

vi.mock('@app/features/channel/state/Channels', () => ({
	default: {getChannel: (id: string) => channels.get(id), channels: []},
}));

describe('permissions in a DM thread', () => {
	it('lets its members write, react, attach and pin, as in the DM', () => {
		const thread = channels.get('dm-thread')!;
		for (const permission of [
			Permissions.SEND_MESSAGES,
			Permissions.ADD_REACTIONS,
			Permissions.ATTACH_FILES,
			Permissions.EMBED_LINKS,
			Permissions.PIN_MESSAGES,
			ThreadPermissionFlags.SEND_MESSAGES_IN_THREADS,
		]) {
			expect(Permission.can(permission, thread as never)).toBe(true);
			expect(Permission.can(permission, {channelId: thread.id})).toBe(true);
		}
	});

	it('gives no moderation, and leaves guild threads and DMs to upstream', () => {
		expect(Permission.can(ThreadPermissionFlags.MANAGE_THREADS, channels.get('dm-thread') as never)).toBe(false);
		expect(Permission.can(Permissions.MANAGE_MESSAGES, {channelId: 'dm-thread'})).toBe(false);
		expect(Permission.can(Permissions.SEND_MESSAGES, channels.get('guild-thread') as never)).toBe(false);
		expect(Permission.can(Permissions.SEND_MESSAGES, channels.get('dm') as never)).toBe(false);
	});
});
