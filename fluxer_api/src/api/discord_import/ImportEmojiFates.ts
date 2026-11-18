// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: what a Discord import does to an existing Tyne emoji itself (tyne-chat/tyne#608, 2026-11-17). A Discord
// emoji can be decided to be a Tyne emoji, and that emoji renamed, moved to another community, or taken off its
// community's list (archive-only: its picture stays, so messages that show it keep showing it). The decision is
// one per Tyne emoji, whichever Discord emoji use it. The emoji keeps its id, so messages that show it, imported
// or not, keep showing it. Applied before the messages are written, and only to an emoji still as the review saw
// it: one changed on Tyne since is left as it is and reported. The review tool records what was done and does
// not plan it again, so a rename made on Tyne later stays.
import type {EmojiID, GuildID} from '@app/api/BrandedTypes';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';

/** A fate in the plan: what happens to the Tyne emoji, and how the review saw it. */
export interface PlanEmojiFate {
	emoji_id: string;
	action: 'move' | 'archive';
	/** For a move: the community it ends up in (its own for a rename) and its name there. */
	guild_id: string | null;
	name: string | null;
	from_guild_id: string;
	old_name: string;
}

export interface EmojiFatesDeps {
	guildRepository: Pick<GuildRepository, 'getEmojiById' | 'deleteEmoji' | 'upsertEmoji'>;
}

export interface EmojiFatesResult {
	/** Communities whose emoji list changed. */
	guilds: Array<string>;
	/** Done now, or found done already. */
	done: Array<string>;
	/** Renamed or moved on Tyne since the review: left as it is. */
	changed: Array<string>;
	/** No longer on Tyne: nothing to rename or move. */
	missing: Array<string>;
}

export async function applyEmojiFates(
	fates: Array<PlanEmojiFate>,
	deps: EmojiFatesDeps,
	dryRun: boolean,
): Promise<EmojiFatesResult> {
	const result: EmojiFatesResult = {guilds: [], done: [], changed: [], missing: []};
	const guilds = new Set<string>();
	for (const fate of fates) {
		const emojiId = BigInt(fate.emoji_id) as EmojiID;
		const existing = await deps.guildRepository.getEmojiById(emojiId);
		if (!existing) {
			// On no community's list: what archive-only asks for, and nothing a rename or move can find.
			(fate.action === 'archive' ? result.done : result.missing).push(fate.emoji_id);
			continue;
		}
		const guild = existing.guildId.toString();
		if (fate.action === 'move' && guild === fate.guild_id && existing.name === fate.name) {
			result.done.push(fate.emoji_id);
			continue;
		}
		if (guild !== fate.from_guild_id || existing.name !== fate.old_name) {
			console.warn(
				`:${existing.name}: (${fate.emoji_id}) was renamed or moved on Tyne since the review: left as it is`,
			);
			result.changed.push(fate.emoji_id);
			continue;
		}
		let what = `move :${existing.name}: from community ${guild} to ${fate.guild_id} as :${fate.name}:`;
		if (fate.action === 'archive') what = `take :${existing.name}: off community ${guild}'s list`;
		else if (guild === fate.guild_id) what = `rename :${existing.name}: to :${fate.name}: in community ${guild}`;
		console.log(`${dryRun ? 'would ' : ''}${what}`);
		if (!dryRun) {
			if (fate.action === 'archive' || guild !== fate.guild_id) {
				await deps.guildRepository.deleteEmoji(existing.guildId, emojiId);
			}
			if (fate.action === 'move') {
				await deps.guildRepository.upsertEmoji({
					...existing.toRow(),
					guild_id: BigInt(fate.guild_id!) as GuildID,
					name: fate.name!,
				});
			}
		}
		guilds.add(guild);
		if (fate.action === 'move') guilds.add(fate.guild_id!);
		result.done.push(fate.emoji_id);
	}
	result.guilds = [...guilds];
	return result;
}
