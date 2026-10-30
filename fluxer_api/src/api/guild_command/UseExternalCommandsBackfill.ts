// SPDX-License-Identifier: AGPL-3.0-or-later

import {type GuildID, guildIdToRoleId} from '@app/api/BrandedTypes';
import {mapGuildRoleToResponse} from '@app/api/guild/GuildModel';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {InstanceConfigRepository} from '@app/api/instance/InstanceConfigRepository';
import {Logger} from '@app/api/Logger';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';

// Fork: Use External Commands is on by default for @everyone, like Use External Emojis, but a new
// permission bit is off in every role stored before it existed. This turns it on once for every
// community's @everyone role, through the role repository and GUILD_ROLE_UPDATE so the gateway's
// copy of the role changes too (docs/design/server-commands.md, "Permissions"). A marker in the
// instance configuration makes it run once: a community that turns the bit off afterwards keeps it
// off.

const USE_EXTERNAL_COMMANDS_BACKFILL_KEY = 'fork_use_external_commands_backfill';
const PAGE_SIZE = 100;

interface BackfillDeps {
	guildRepository: GuildRepository;
	gatewayService: IGatewayService;
	instanceConfigRepository: InstanceConfigRepository;
	now?: () => Date;
}

export interface BackfillResult {
	ran: boolean;
	updated: number;
}

export async function backfillUseExternalCommands(deps: BackfillDeps): Promise<BackfillResult> {
	if (await deps.instanceConfigRepository.getConfig(USE_EXTERNAL_COMMANDS_BACKFILL_KEY)) {
		return {ran: false, updated: 0};
	}
	let updated = 0;
	let lastGuildId: GuildID | undefined;
	for (;;) {
		const guilds = await deps.guildRepository.listAllGuildsPaginated(PAGE_SIZE, lastGuildId);
		for (const guild of guilds) {
			const role = await deps.guildRepository.getRole(guildIdToRoleId(guild.id), guild.id);
			if (!role || (role.permissions & Permissions.USE_EXTERNAL_COMMANDS) !== 0n) continue;
			const before = role.toRow();
			const saved = await deps.guildRepository.upsertRole(
				{...before, permissions: before.permissions | Permissions.USE_EXTERNAL_COMMANDS},
				before,
			);
			await deps.gatewayService
				.dispatchGuild({guildId: guild.id, event: 'GUILD_ROLE_UPDATE', data: {role: mapGuildRoleToResponse(saved)}})
				.catch((error) => Logger.warn({err: error, guildId: guild.id}, 'Failed to dispatch @everyone role update'));
			updated++;
		}
		if (guilds.length < PAGE_SIZE) break;
		lastGuildId = guilds[guilds.length - 1]!.id;
	}
	const at = (deps.now?.() ?? new Date()).toISOString();
	await deps.instanceConfigRepository.setConfig(USE_EXTERNAL_COMMANDS_BACKFILL_KEY, JSON.stringify({at, updated}));
	Logger.info({updated}, 'Turned on Use External Commands for @everyone');
	return {ran: true, updated};
}
