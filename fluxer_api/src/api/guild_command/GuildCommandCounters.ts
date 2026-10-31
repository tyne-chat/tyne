// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildCommandInputError} from '@app/api/guild_command/GuildCommandErrors';
import type {GuildCommandMentionDrop, GuildCommandScope} from '@app/api/guild_command/GuildCommandTemplateEngine';
import {
	GUILD_COMMAND_COUNTER_NAME_PATTERN,
	type GuildCommandCounterIdentity,
	type GuildCommandCounterInput,
	type GuildCommandCounterPart,
	type GuildCommandInputMode,
	MAX_GUILD_COMMAND_COUNTERS,
	RESERVED_GUILD_COMMAND_COUNTER_NAMES,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';

// Fork: a command's counters (docs/design/server-commands.md, "Counters"). A count is kept against
// ids, never text: a nickname can change and it is still the same count.

export interface GuildCommandCounter {
	id: string;
	name: string;
	per: Array<GuildCommandCounterPart>;
	identity: GuildCommandCounterIdentity;
}

export function parseCounters(stored: string | null | undefined): Array<GuildCommandCounter> {
	return stored ? (JSON.parse(stored) as Array<GuildCommandCounter>) : [];
}

export function countersNeedTarget(counters: ReadonlyArray<GuildCommandCounter>): boolean {
	return counters.some((counter) => counter.per.includes('target'));
}

/** Checks a command's new counters. A kept id keeps its counts; anything else is a new counter. */
export async function checkCounters(
	requested: ReadonlyArray<GuildCommandCounterInput>,
	existing: ReadonlyArray<GuildCommandCounter>,
	inputMode: GuildCommandInputMode,
	nextId: () => Promise<bigint>,
): Promise<Array<GuildCommandCounter>> {
	if (requested.length > MAX_GUILD_COMMAND_COUNTERS) {
		throw new GuildCommandInputError(`A command can have at most ${MAX_GUILD_COMMAND_COUNTERS} counters`);
	}
	const names = new Set<string>();
	const counters: Array<GuildCommandCounter> = [];
	for (const counter of requested) {
		if (
			!GUILD_COMMAND_COUNTER_NAME_PATTERN.test(counter.name) ||
			RESERVED_GUILD_COMMAND_COUNTER_NAMES.has(counter.name)
		) {
			throw new GuildCommandInputError(`A counter cannot be called ${counter.name}`);
		}
		if (names.has(counter.name)) throw new GuildCommandInputError(`Two counters are called ${counter.name}`);
		names.add(counter.name);
		const known = existing.find((row) => row.id === counter.id);
		counters.push({
			id: known?.id ?? (await nextId()).toString(),
			name: counter.name,
			per: [...new Set(counter.per)].sort(),
			identity: counter.identity,
		});
	}
	if (inputMode === 'none' && countersNeedTarget(counters)) {
		throw new GuildCommandInputError('A counter kept per recipient needs a command that takes input');
	}
	return counters;
}

function who(person: GuildCommandMentionDrop, identity: GuildCommandCounterIdentity): string {
	const match = /^<@!?(\d+)(?::(\d+))?>$/.exec(person.mention);
	if (!match) return person.mention;
	return identity === 'persona' && match[2] ? `${match[1]}:${match[2]}` : match[1]!;
}

/** Where a run's count is kept, or null when the run has no recipient for this counter. */
export function counterScopeKey(
	counter: GuildCommandCounter,
	scope: GuildCommandScope,
	channelId: string,
): string | null {
	const parts: Array<string> = [];
	for (const part of counter.per) {
		if (part === 'channel') parts.push(`channel=${channelId}`);
		else if (part === 'person') parts.push(`person=${who(scope.person, counter.identity)}`);
		else if (scope.target) parts.push(`target=${who(scope.target, counter.identity)}`);
		else return null;
	}
	return parts.join('|') || 'all';
}
