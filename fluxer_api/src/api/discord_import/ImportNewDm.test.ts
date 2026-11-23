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
const CHIARA = 1523457069301104640n as UserID;
const MAYA = 1523438220849709056n as UserID;
const DM = 1488416127536205905n as ChannelID;
const GROUP = 1286467636733022300n as ChannelID;

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
	channel = null,
	openGroupDms = 0,
}: {
	exists?: Array<UserID>;
	existing?: Channel | null;
	/** A channel already on Tyne with the plan's id (a group DM is found by its id). */
	channel?: Channel | null;
	/** How many open group DMs each user has. */
	openGroupDms?: number;
} = {}) {
	const calls: Array<string> = [];
	const created: Array<ChannelRow> = [];
	const deps = {
		channelRepository: {
			channelData: {
				findUnique: async () => channel,
				create: async (row: ChannelRow) => {
					calls.push(`create group ${row.channel_id}`);
					created.push(row);
					return new Channel(row);
				},
			},
		},
		limitConfigService: {getConfigSnapshot: () => null},
		userRepository: {
			listPrivateChannelSummaries: async () =>
				Array.from({length: openGroupDms}, () => ({open: true, isGroupDm: true})),
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
	return {deps, calls, created};
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

describe('createNewDm for a group DM', () => {
	const group: PlanNewDm = {
		channel_id: GROUP.toString(),
		members: [SERAPHIM, CHIARA, MAYA].map(String),
		open_for: [SERAPHIM, CHIARA, MAYA].map(String),
		group: {owner_id: CHIARA.toString(), name: '💖hsys-famchat'},
	};
	const everyone = {exists: [SERAPHIM, CHIARA, MAYA]};

	it('creates it with the plan’s id, owner and name, and opens it for everyone in it, with no “added” notices', async () => {
		const {deps, calls, created} = fakes(everyone);
		const result = await createNewDm(group, deps, false);
		expect(result.created).toBe(true);
		expect(result.channel?.type).toBe(ChannelTypes.GROUP_DM);
		const [row] = created;
		expect([row.channel_id, row.owner_id, row.name, row.guild_id]).toEqual([GROUP, CHIARA, '💖hsys-famchat', null]);
		expect([...row.recipient_ids!]).toEqual([SERAPHIM, CHIARA, MAYA]);
		expect(calls).toEqual([
			`create group ${GROUP}`,
			...[SERAPHIM, CHIARA, MAYA].flatMap((u) => [`open ${u} ${GROUP}`, `CHANNEL_CREATE to ${u} ${GROUP}`]),
		]);
	});

	it('uses the group DM an earlier run made', async () => {
		const made = new Channel({...dmChannel(GROUP, SERAPHIM, CHIARA).toRow(), type: ChannelTypes.GROUP_DM});
		const {deps, calls} = fakes({...everyone, channel: made});
		expect(await createNewDm(group, deps, false)).toEqual({channel: made, created: false});
		expect(calls).toEqual([]);
	});

	it('stops when its id is another kind of channel', async () => {
		const {deps, calls} = fakes({...everyone, channel: dmChannel(GROUP, SERAPHIM, CHIARA)});
		await expect(createNewDm(group, deps, false)).rejects.toThrow(/not a group DM/);
		expect(calls).toEqual([]);
	});

	it('stops, in a dry run too, when someone in it is not on Tyne', async () => {
		for (const dryRun of [false, true]) {
			const {deps, calls} = fakes({exists: [SERAPHIM, CHIARA]});
			await expect(createNewDm(group, deps, dryRun)).rejects.toThrow(new RegExp(`not on Tyne.*${MAYA}`));
			expect(calls).toEqual([]);
		}
	});

	it('keeps to Tyne’s limits: its size, and each person’s open group DMs', async () => {
		const big = {...group, members: Array.from({length: 51}, (_, i) => String(9000n + BigInt(i)))};
		big.group = {owner_id: big.members[0], name: null};
		const {deps} = fakes({exists: big.members.map((m) => BigInt(m) as UserID)});
		await expect(createNewDm(big, deps, false)).rejects.toThrow(/at most 50 people/);
		const full = fakes({...everyone, openGroupDms: 150});
		await expect(createNewDm(group, full.deps, true)).rejects.toThrow(/as many open group DMs as Tyne allows/);
		expect(full.calls).toEqual([]);
	});

	it('needs its owner among its people, and three people at least', async () => {
		const {deps} = fakes(everyone);
		await expect(createNewDm({...group, group: {owner_id: LEMON.toString(), name: null}}, deps, false)).rejects.toThrow(
			/owner/,
		);
		await expect(createNewDm({...group, members: group.members.slice(0, 2)}, deps, false)).rejects.toThrow(
			/three people/,
		);
	});

	it('in a dry run writes nothing', async () => {
		const {deps, calls} = fakes(everyone);
		expect(await createNewDm(group, deps, true)).toEqual({channel: null, created: true});
		expect(calls).toEqual([]);
	});

	it('is left unnamed when the API would refuse its name (nothing left once tidied)', async () => {
		const {deps, created} = fakes(everyone);
		await createNewDm({...group, group: {owner_id: CHIARA.toString(), name: '   '}}, deps, false);
		expect(created[0].name).toBeNull();
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
