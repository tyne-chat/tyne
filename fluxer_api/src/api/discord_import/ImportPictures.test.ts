// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: a Tyne emoji's or sticker's own picture replaced by a custom one during a Discord import (tyne-chat/tyne#608).
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {EmojiID, GuildID, StickerID, UserID} from '@app/api/BrandedTypes';
import type {GuildEmojiRow, GuildStickerRow} from '@app/api/database/types/GuildTypes';
import {applyPictures, type PicturesDeps, type PlanPicture} from '@app/api/discord_import/ImportPictures';
import {GuildEmoji} from '@app/api/models/GuildEmoji';
import {GuildSticker} from '@app/api/models/GuildSticker';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const emojiRow = (id: bigint, animated: boolean): GuildEmojiRow => ({
	guild_id: 10n as GuildID,
	emoji_id: id as EmojiID,
	name: 'NodNod',
	creator_id: 1n as UserID,
	animated,
	version: 1,
});
const stickerRow = (id: bigint, animated: boolean): GuildStickerRow => ({
	guild_id: 20n as GuildID,
	sticker_id: id as StickerID,
	name: 'hug',
	description: null,
	animated,
	tags: null,
	creator_id: 1n as UserID,
	version: 1,
});
const picture = (kind: 'emoji' | 'sticker', id: string): PlanPicture => ({
	kind,
	tyne_id: id,
	file: {path: `${kind}/x.png`, name: 'x.png', root: 'custom'},
	sha256: 'abc',
	animated: true,
});

function fakes(stored: Record<string, Uint8Array>) {
	const calls: Array<string> = [];
	const emojis = new Map([[501n, emojiRow(501n, false)]]);
	const stickers = new Map([[701n, stickerRow(701n, true)]]);
	const deps: PicturesDeps = {
		guildRepository: {
			findUnique: async () => null,
			getEmojiById: async (id) => (emojis.has(id) ? new GuildEmoji(emojis.get(id)!) : null),
			upsertEmoji: async (r) => {
				calls.push(`row emoji ${r.emoji_id} animated=${r.animated}`);
				emojis.set(r.emoji_id, r);
				return new GuildEmoji(r);
			},
			getStickerById: async (id) => (stickers.has(id) ? new GuildSticker(stickers.get(id)!) : null),
			upsertSticker: async (r) => {
				calls.push(`row sticker ${r.sticker_id} animated=${r.animated}`);
				stickers.set(r.sticker_id, r);
				return new GuildSticker(r);
			},
		},
		avatarService: {
			processEmoji: async ({base64Image}) => ({
				imageBuffer: Buffer.from(base64Image, 'base64'),
				animated: true,
				format: 'gif',
			}),
			processSticker: async ({base64Image}) => ({
				imageBuffer: Buffer.from(base64Image, 'base64'),
				animated: true,
				format: 'gif',
			}),
			uploadEmoji: async ({emojiId}) => {
				calls.push(`upload emojis/${emojiId}`);
			},
			uploadSticker: async ({stickerId}) => {
				calls.push(`upload stickers/${stickerId}`);
			},
		},
		storageService: {
			readObject: async (_bucket, key) => {
				if (!stored[key]) throw new Error('no such key');
				return stored[key];
			},
			copyObject: async ({sourceKey, destinationKey}) => {
				calls.push(`copy ${sourceKey} -> ${destinationKey}`);
			},
		},
	};
	return {deps, calls};
}

describe('applyPictures', () => {
	let keepDir: string;
	beforeEach(() => {
		keepDir = mkdtempSync(join(tmpdir(), 'pictures-'));
	});
	afterEach(() => rmSync(keepDir, {recursive: true, force: true}));
	const options = (dryRun = false) => ({
		dryRun,
		bucket: 'cdn',
		read: () => Buffer.from('new').toString('base64'),
		keepDir,
		stamp: '20261118T120000Z',
	});

	it('keeps the old picture, then puts up the new one, and the row follows its animation', async () => {
		const {deps, calls} = fakes({'emojis/501': Buffer.from('old')});
		const result = await applyPictures([picture('emoji', '501')], deps, options());
		expect(calls).toEqual([
			'copy emojis/501 -> discord-import-replaced/emojis/501-20261118T120000Z',
			'upload emojis/501',
			'row emoji 501 animated=true',
		]);
		expect(readFileSync(join(keepDir, 'emoji-501-20261118T120000Z'), 'utf8')).toBe('old');
		expect(result).toMatchObject({done: ['emoji:501'], missing: [], emojiGuilds: ['10'], stickerGuilds: []});
	});

	it('replaces a sticker the same way, leaving its row when the animation stays', async () => {
		const {deps, calls} = fakes({'stickers/701': Buffer.from('old')});
		const result = await applyPictures([picture('sticker', '701')], deps, options());
		expect(calls).toEqual([
			'copy stickers/701 -> discord-import-replaced/stickers/701-20261118T120000Z',
			'upload stickers/701',
		]);
		expect(result.stickerGuilds).toEqual(['20']);
	});

	it('still replaces one whose old picture cannot be read, and says nothing was kept', async () => {
		const {deps, calls} = fakes({});
		const result = await applyPictures([picture('emoji', '501')], deps, options());
		expect(calls).toContain('upload emojis/501');
		expect(result.kept).toEqual([{picture: 'emoji:501', bucket_key: null, file: null}]);
	});

	it('skips one no longer on Tyne, and in a dry run checks the picture but writes nothing', async () => {
		const {deps, calls} = fakes({'emojis/501': Buffer.from('old')});
		const result = await applyPictures([picture('emoji', '999'), picture('emoji', '501')], deps, options(true));
		expect(calls).toEqual([]);
		expect(result).toMatchObject({done: ['emoji:501'], missing: ['emoji:999'], kept: []});
	});
});
