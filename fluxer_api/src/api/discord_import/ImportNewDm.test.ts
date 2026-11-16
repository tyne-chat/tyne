// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, UserID} from '@app/api/BrandedTypes';
import type {ChannelRow} from '@app/api/database/types/ChannelTypes';
import {createNewDm, markNewDmRead, type NewDmDeps, type PlanNewDm} from '@app/api/discord_import/ImportNewDm';
import {Channel} from '@app/api/models/Channel';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {ContentWarningLevel} from '@fluxer/constants/src/GuildConstants';
import {describe, expect, it} from 'vitest';

const SERAPHIM = 1523146531119562752n as UserID;
const LEMON = 1488416127540400127n as UserID;
const DM = 1488416127536205905n as ChannelID;

function dmChannel(channelId: ChannelID, a: UserID, b: UserID): Channel {
	const row: ChannelRow = {
		channel_id: channelId,
		guild_id: null,
		type: ChannelTypes.DM,
		name: null,
		topic: null,
		icon_hash: null,
		url: null,
		parent_id: null,
		position: null,
		owner_id: null,
		recipient_ids: new Set([a, b]),
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
	};
	return new Channel(row);
}

/** Users who exist, a DM the two may have already, and a record of every write and event. */
function fakes({
	exists = [SERAPHIM, LEMON],
	existing = null,
}: {
	exists?: Array<UserID>;
	existing?: Channel | null;
} = {}) {
	const calls: Array<string> = [];
	const deps = {
		userRepository: {
			findUnique: async (id: UserID) => (exists.includes(id) ? {id} : null),
			findExistingDmState: async () => existing,
			createDmChannelAndState: async (a: UserID, b: UserID, channelId: ChannelID) => {
				calls.push(`create ${a} ${b} ${channelId}`);
				return dmChannel(channelId, a, b);
			},
			openPrivateChannelForUser: async (userId: UserID, channel: Channel) => {
				calls.push(`open ${userId} ${channel.id}`);
			},
		},
		gatewayService: {
			dispatchPresence: async ({userId, event, data}: {userId: UserID; event: string; data: {id: string}}) => {
				calls.push(`${event} to ${userId} ${data.id}`);
			},
		},
		userCacheService: {
			getUserPartialResponses: async (ids: Array<UserID>) => new Map(ids.map((id) => [id, {id: id.toString()}])),
		},
	} as unknown as NewDmDeps;
	return {deps, calls};
}

const plan: PlanNewDm = {
	channel_id: DM.toString(),
	members: [SERAPHIM.toString(), LEMON.toString()],
	open_for: [SERAPHIM.toString()],
};

describe('createNewDm', () => {
	it('creates the DM with the plan’s id and opens it for the Tyne user alone, never the placeholder', async () => {
		const {deps, calls} = fakes();
		const result = await createNewDm(plan, deps, false);
		expect(result.created).toBe(true);
		expect(result.channel?.id).toBe(DM);
		expect(calls).toEqual([
			`create ${SERAPHIM} ${LEMON} ${DM}`,
			`open ${SERAPHIM} ${DM}`,
			`CHANNEL_CREATE to ${SERAPHIM} ${DM}`,
		]);
	});

	it('uses the DM an earlier run made', async () => {
		const {deps, calls} = fakes({existing: dmChannel(DM, SERAPHIM, LEMON)});
		const result = await createNewDm(plan, deps, false);
		expect(result).toMatchObject({created: false});
		expect(calls).toEqual([]);
	});

	it('stops when the two have a DM the plan does not name', async () => {
		const {deps, calls} = fakes({existing: dmChannel(999n as ChannelID, SERAPHIM, LEMON)});
		await expect(createNewDm(plan, deps, false)).rejects.toThrow(/refresh the snapshot and plan again/);
		expect(calls).toEqual([]);
	});

	it('in a dry run writes nothing, also before the run would make the placeholder', async () => {
		const {deps, calls} = fakes({exists: [SERAPHIM]});
		expect(await createNewDm(plan, deps, true)).toEqual({channel: null, created: true});
		expect(calls).toEqual([]);
	});
});

describe('markNewDmRead', () => {
	it('marks the history read for each Tyne user, with no mentions', async () => {
		const acks: Array<unknown> = [];
		await markNewDmRead(plan, '1488416127999999999', {
			readStateService: {
				ackMessage: async (params) => {
					acks.push(params);
					return {} as never;
				},
			},
		});
		expect(acks).toEqual([{userId: SERAPHIM, channelId: DM, messageId: 1488416127999999999n, mentionCount: 0}]);
	});
});
