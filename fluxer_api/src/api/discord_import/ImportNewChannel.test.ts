// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, RoleID} from '@app/api/BrandedTypes';
import type {ChannelRow} from '@app/api/database/types/ChannelTypes';
import {createNewChannel, type NewChannelDeps, type PlanNewChannel} from '@app/api/discord_import/ImportNewChannel';
import type {UserCacheService} from '@app/api/infrastructure/UserCacheService';
import {Channel} from '@app/api/models/Channel';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {ContentWarningLevel, GuildFeatures} from '@fluxer/constants/src/GuildConstants';
import {describe, expect, it} from 'vitest';

const ARCHIVE = 1571309688694243328n as GuildID;
const MEMBERS = 1571309688694243329n as RoleID;

function row(
	fields: Partial<ChannelRow> & {channel_id: ChannelID; type: number; name: string; position: number},
): ChannelRow {
	return {
		guild_id: ARCHIVE,
		topic: null,
		icon_hash: null,
		url: null,
		parent_id: null,
		owner_id: null,
		recipient_ids: null,
		nsfw: null,
		content_warning_level: ContentWarningLevel.INHERIT,
		content_warning_text: null,
		rate_limit_per_user: 0,
		bitrate: null,
		user_limit: null,
		voice_connection_limit: null,
		rtc_region: null,
		rtc_p2p: null,
		last_message_id: null,
		last_pin_timestamp: null,
		permission_overwrites: null,
		nicks: null,
		soft_deleted: false,
		indexed_at: null,
		version: 1,
		...fields,
	};
}

/** A community holding the given channels, whose repository keeps what is created and whose gateway records events. */
function fakes(existing: Array<Channel>, features: Array<string> = []) {
	const created: Array<Channel> = [];
	const sent: Array<{event: string; data: {id: string; name?: string; parent_id?: string | null; position?: number}}> =
		[];
	const deps = {
		channelRepository: {
			channelData: {
				listGuildChannels: async () => [...existing],
				create: async (data: ChannelRow) => {
					const channel = new Channel(data);
					created.push(channel);
					return channel;
				},
			},
			threads: {getParentConfig: async () => null},
		},
		guildRepository: {findUnique: async () => ({features: new Set(features)})},
		gatewayService: {
			dispatchGuild: async ({event, data}: {event: string; data: unknown}) => {
				sent.push({event, data: data as (typeof sent)[number]['data']});
			},
		},
		userCacheService: {} as UserCacheService,
	} as unknown as NewChannelDeps;
	return {deps, created, sent};
}

const plan = (fields: Partial<PlanNewChannel> = {}): PlanNewChannel => ({
	guild_id: ARCHIVE.toString(),
	channel_id: '1293755317015810001',
	name: '✍🏻 Renders',
	topic: 'Finished renders',
	category: {channel_id: '1293755317015810002', name: '⛩️ Archive ⛩️'},
	...fields,
});

describe('createNewChannel', () => {
	it('creates the category and then the channel with the plan’s ids, and tells the gateway about both', async () => {
		const {deps, created, sent} = fakes([]);
		const result = await createNewChannel(plan(), deps, false);
		expect(created.map((c) => [c.id.toString(), c.type, c.name, c.parentId?.toString() ?? null])).toEqual([
			['1293755317015810002', ChannelTypes.GUILD_CATEGORY, '⛩️ Archive ⛩️', null],
			['1293755317015810001', ChannelTypes.GUILD_TEXT, '✍🏻-renders', '1293755317015810002'],
		]);
		expect(created[1].topic).toBe('Finished renders');
		expect(sent.map((s) => [s.event, s.data.id, s.data.parent_id ?? null])).toEqual([
			['CHANNEL_CREATE', '1293755317015810002', null],
			['CHANNEL_CREATE', '1293755317015810001', '1293755317015810002'],
		]);
		expect(result).toMatchObject({
			createdCategory: '1293755317015810002',
			categoryId: '1293755317015810002',
			name: '✍🏻-renders',
		});
	});

	it('puts the channel at the end of a category of that name the community has already, with its overwrites', async () => {
		const category = new Channel(
			row({
				channel_id: 50n as ChannelID,
				type: ChannelTypes.GUILD_CATEGORY,
				name: '⛩️ Archive ⛩️',
				position: 3,
				permission_overwrites: new Map([[MEMBERS, {type: 0, allow_: 1024n, deny_: 0n}]]),
			}),
		);
		const earlier = new Channel(
			row({
				channel_id: 51n as ChannelID,
				type: ChannelTypes.GUILD_TEXT,
				name: 'reunion',
				position: 4,
				parent_id: 50n as ChannelID,
			}),
		);
		const {deps, created, sent} = fakes([category, earlier]);
		const result = await createNewChannel(plan(), deps, false);
		expect(created).toHaveLength(1);
		expect(created[0].parentId).toBe(50n);
		expect(created[0].position).toBeGreaterThan(4);
		expect(created[0].permissionOverwrites.get(MEMBERS)?.allow).toBe(1024n);
		expect(sent).toHaveLength(1);
		expect(result).toMatchObject({createdCategory: null, categoryId: '50'});
	});

	it('keeps the name as written where the community allows flexible names', async () => {
		const {deps, created} = fakes([], [GuildFeatures.TEXT_CHANNEL_FLEXIBLE_NAMES]);
		await createNewChannel(plan({category: null}), deps, false);
		expect(created.map((c) => [c.name, c.parentId])).toEqual([['✍🏻 Renders', null]]);
	});

	it('writes and sends nothing in a dry run, but says what it would create', async () => {
		const {deps, created, sent} = fakes([]);
		const result = await createNewChannel(plan(), deps, true);
		expect(created).toEqual([]);
		expect(sent).toEqual([]);
		expect(result).toEqual({
			channel: null,
			createdCategory: '1293755317015810002',
			categoryId: '1293755317015810002',
			name: '✍🏻-renders',
		});
	});
});
