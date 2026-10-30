// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, beforeEach, describe, expect, it, type MockInstance, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

const permission = vi.hoisted(() => ({can: vi.fn(() => true)}));
vi.mock('@app/features/permissions/state/Permission', () => ({default: permission}));

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import type {Channel} from '@app/features/channel/models/Channel';
import GuildList from '@app/features/guild/state/GuildList';
import {handleGuildCommandsUpdate} from '@app/features/guild_commands/events/GuildCommandsEvents';
import GuildCommandsStore from '@app/features/guild_commands/state/GuildCommandsStore';
import {http} from '@app/features/platform/transport/RestTransport';
import type {GuildCommandResponse} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {runInAction} from 'mobx';

function command(id: string, guildId: string, name: string): GuildCommandResponse {
	return {
		id,
		guild_id: guildId,
		name,
		description: '',
		kind: 'basic',
		input_mode: 'required',
		input_type: 'text',
		input_hint: null,
		creator_id: '1',
		created_at: '2026-10-30T00:00:00.000Z',
		updated_at: '2026-10-30T00:00:00.000Z',
	};
}

const ALL = [command('1', 'g1', 'tuck'), command('2', 'g2', 'tuck'), command('3', 'g2', 'hug')];

function channel(guildId: string | null): Channel {
	return {id: 'c', guildId: guildId ?? undefined} as unknown as Channel;
}

describe('GuildCommandsStore', () => {
	let getMock: MockInstance;

	beforeEach(() => {
		getMock = vi.spyOn(http, 'get');
		permission.can.mockReturnValue(true);
		GuildCommandsStore.invalidate();
		runInAction(() => {
			GuildList.guilds = [{id: 'g1'}, {id: 'g2'}] as never;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('loads every community with one request, shared between callers, and then sends none', async () => {
		getMock.mockResolvedValue({ok: true, body: ALL} as never);
		await Promise.all([GuildCommandsStore.ensureLoaded(), GuildCommandsStore.ensureLoaded()]);
		await GuildCommandsStore.ensureLoaded();
		expect(getMock).toHaveBeenCalledTimes(1);
		expect(getMock).toHaveBeenCalledWith(ForkEndpoints.USER_GUILD_COMMANDS);
	});

	it('waits 30 seconds after a failure before asking again', async () => {
		vi.useFakeTimers();
		getMock.mockResolvedValue({ok: false, body: null} as never);
		await GuildCommandsStore.ensureLoaded();
		await GuildCommandsStore.ensureLoaded();
		expect(getMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(30_001);
		await GuildCommandsStore.ensureLoaded();
		expect(getMock).toHaveBeenCalledTimes(2);
	});

	it('fetches nothing on the event, and only that community on the next use', async () => {
		getMock.mockResolvedValue({ok: true, body: ALL} as never);
		await GuildCommandsStore.ensureLoaded();
		handleGuildCommandsUpdate({guild_id: 'g2'}, {} as never);
		expect(getMock).toHaveBeenCalledTimes(1);
		getMock.mockResolvedValue({ok: true, body: [command('3', 'g2', 'hug')]} as never);
		await GuildCommandsStore.ensureLoaded();
		expect(getMock).toHaveBeenLastCalledWith(ForkEndpoints.GUILD_COMMANDS('g2'));
		expect(getMock).toHaveBeenCalledTimes(2);
		expect(GuildCommandsStore.resolve(channel(null), 'tuck')?.id).toBe('1');
	});

	it('fetches a community joined after loading, and drops one left', async () => {
		getMock.mockResolvedValue({ok: true, body: ALL} as never);
		await GuildCommandsStore.ensureLoaded();
		runInAction(() => {
			GuildList.guilds = [{id: 'g1'}, {id: 'g3'}] as never;
		});
		expect(GuildCommandsStore.resolve(channel(null), 'hug')).toBeNull();
		getMock.mockResolvedValue({ok: true, body: [command('4', 'g3', 'wave')]} as never);
		await GuildCommandsStore.ensureLoaded();
		expect(getMock).toHaveBeenCalledTimes(2);
		expect(getMock).toHaveBeenLastCalledWith(ForkEndpoints.GUILD_COMMANDS('g3'));
		expect(GuildCommandsStore.resolve(channel(null), 'wave')?.id).toBe('4');
	});

	it('reloads everything with one request when more than three communities are stale', async () => {
		getMock.mockResolvedValue({ok: true, body: ALL} as never);
		await GuildCommandsStore.ensureLoaded();
		for (const guildId of ['g1', 'g2', 'g3', 'g4']) handleGuildCommandsUpdate({guild_id: guildId}, {} as never);
		await Promise.all([GuildCommandsStore.ensureLoaded(), GuildCommandsStore.ensureLoaded()]);
		expect(getMock).toHaveBeenCalledTimes(2);
		expect(getMock).toHaveBeenLastCalledWith(ForkEndpoints.USER_GUILD_COMMANDS);
		await GuildCommandsStore.ensureLoaded();
		expect(getMock).toHaveBeenCalledTimes(2);
	});

	it('prefers the channel community, then sidebar order, and honours Use External Commands', async () => {
		getMock.mockResolvedValue({ok: true, body: ALL} as never);
		await GuildCommandsStore.ensureLoaded();
		expect(GuildCommandsStore.resolve(channel('g2'), 'tuck')?.id).toBe('2');
		expect(GuildCommandsStore.resolve(channel('g1'), 'tuck')?.id).toBe('1');
		expect(GuildCommandsStore.resolve(channel(null), 'tuck')?.id).toBe('1');
		expect(GuildCommandsStore.resolve(channel('g1'), 'hug')?.id).toBe('3');
		permission.can.mockReturnValue(false);
		expect(GuildCommandsStore.resolve(channel('g1'), 'hug')).toBeNull();
		expect(GuildCommandsStore.resolve(channel(null), 'hug')?.id).toBe('3');
	});
});
