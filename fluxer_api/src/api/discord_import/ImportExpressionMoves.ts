// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: moving an emoji's or sticker's row to another community during a Discord import (tyne-chat/tyne#608). Each
// is stored twice, by community and by id; the repository's delete and upsert are separate writes, so a run stopped
// between them left the emoji in neither, and the next run found it gone (Gemini Carbon's review). Here the old row
// goes and the new one comes in one atomic batch. The picture is stored by id, so it stays where it is. The row is
// new under its new community, so it starts at version 1, as the repository's upsert would start it.
import type {GuildID} from '@app/api/BrandedTypes';
import {BatchBuilder} from '@app/api/database/CassandraQueryExecution';
import type {GuildEmojiRow, GuildStickerRow} from '@app/api/database/types/GuildTypes';
import {GuildEmojis, GuildEmojisByEmojiId, GuildStickers, GuildStickersByStickerId} from '@app/api/Tables';

/** Moves an emoji from community `from` to `row.guild_id`, as `row` says (name, version and the rest). */
export async function moveEmojiRow(from: GuildID, row: GuildEmojiRow): Promise<void> {
	const batch = new BatchBuilder();
	batch.addPrepared(GuildEmojis.deleteByPk({guild_id: from, emoji_id: row.emoji_id}));
	batch.addPrepared(GuildEmojis.insert(row));
	batch.addPrepared(GuildEmojisByEmojiId.insert(row));
	await batch.execute(true);
}

/** Moves a sticker from community `from` to `row.guild_id`, as `row` says. */
export async function moveStickerRow(from: GuildID, row: GuildStickerRow): Promise<void> {
	const batch = new BatchBuilder();
	batch.addPrepared(GuildStickers.deleteByPk({guild_id: from, sticker_id: row.sticker_id}));
	batch.addPrepared(GuildStickers.insert(row));
	batch.addPrepared(GuildStickersByStickerId.insert(row));
	await batch.execute(true);
}
