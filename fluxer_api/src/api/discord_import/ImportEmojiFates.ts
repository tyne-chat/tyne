// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: what a Discord import does to an existing Tyne emoji itself (tyne-chat/tyne#608, 2026-11-17). A Discord
// emoji can be decided to be a Tyne emoji, and that emoji renamed, moved to another community, or taken off its
// community's list (archive-only: its picture stays, so messages that show it keep showing it). The decision is
// one per Tyne emoji, whichever Discord emoji use it. The emoji keeps its id, so messages that show it, imported
// or not, keep showing it. Applied before the messages are written, and only to an emoji still as the review saw
// it: one changed on Tyne since is left as it is and reported. The review tool records what was done and does
// not plan it again, so a rename made on Tyne later stays. It can also be copied to more communities: each copy is
// an emoji of its own, with the same picture (Chiara, 2026-11-17).
import type {EmojiID, GuildID, UserID} from '@app/api/BrandedTypes';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import type {AvatarService} from '@app/api/infrastructure/AvatarService';

/** A fate in the plan: what happens to the Tyne emoji, and how the review saw it. */
export interface PlanEmojiFate {
	emoji_id: string;
	action: 'move' | 'archive';
	/** For a move: the community it ends up in (its own for a rename) and its name there. */
	guild_id: string | null;
	name: string | null;
	from_guild_id: string;
	old_name: string;
	/** New emoji with its picture in more communities, with the ids and names the plan gave them. */
	copies?: Array<{emoji_id: string; guild_id: string; name: string}>;
}

export interface EmojiFatesDeps {
	guildRepository: Pick<GuildRepository, 'getEmojiById' | 'deleteEmoji' | 'upsertEmoji'>;
	avatarService: Pick<AvatarService, 'cloneEmojiImage'>;
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
	/** Copies made now. */
	copied: Array<string>;
}

export async function applyEmojiFates(
	fates: Array<PlanEmojiFate>,
	deps: EmojiFatesDeps,
	dryRun: boolean,
	operatorUserId: string,
): Promise<EmojiFatesResult> {
	const result: EmojiFatesResult = {guilds: [], done: [], changed: [], missing: [], copied: []};
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
		const there = fate.action === 'move' && guild === fate.guild_id && existing.name === fate.name;
		if (!there && (guild !== fate.from_guild_id || existing.name !== fate.old_name)) {
			console.warn(
				`:${existing.name}: (${fate.emoji_id}) was renamed or moved on Tyne since the review: left as it is`,
			);
			result.changed.push(fate.emoji_id);
			continue;
		}
		if (!there) {
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
		}
		for (const copy of fate.copies ?? []) {
			const copyId = BigInt(copy.emoji_id) as EmojiID;
			if (await deps.guildRepository.getEmojiById(copyId)) continue; // made by an earlier run
			console.log(`${dryRun ? 'would ' : ''}copy :${existing.name}: to community ${copy.guild_id} as :${copy.name}:`);
			if (!dryRun) {
				await deps.avatarService.cloneEmojiImage({sourceEmojiId: emojiId, emojiId: copyId});
				await deps.guildRepository.upsertEmoji({
					guild_id: BigInt(copy.guild_id) as GuildID,
					emoji_id: copyId,
					name: copy.name,
					creator_id: BigInt(operatorUserId) as UserID,
					animated: existing.toRow().animated,
					version: 1,
				});
			}
			guilds.add(copy.guild_id);
			result.copied.push(copy.emoji_id);
		}
		result.done.push(fate.emoji_id);
	}
	result.guilds = [...guilds];
	return result;
}
