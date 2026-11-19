// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: a Tyne emoji's or sticker's own picture replaced by a custom one made on the review page
// (tyne-chat/tyne#608, 2026-11-18). Same id, so every message that shows it, past and future, shows the new
// picture, and its reactions and place in "recently used" stay. The picture goes through the API's own checks
// (processEmoji, processSticker) and is written over emojis/<id> or stickers/<id>, as an upload is; the row's
// `animated` follows the new picture. The old picture is kept first, in the same bucket under
// discord-import-replaced/ and in the plans folder the review tool backs up, so it can be put back. The media
// proxy serves the new picture at once (its cache is keyed by content); apps that cached the old one may show
// it for a while longer.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {EmojiID, GuildID, StickerID} from '@app/api/BrandedTypes';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import type {AvatarService} from '@app/api/infrastructure/AvatarService';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';

/** A replacement in the plan: which Tyne emoji or sticker, and the custom picture's file (root "custom"). */
export interface PlanPicture {
	kind: 'emoji' | 'sticker';
	tyne_id: string;
	file: {path: string; name: string; root?: string};
	sha256: string;
	animated: boolean;
}

export interface PicturesDeps {
	guildRepository: Pick<
		GuildRepository,
		'findUnique' | 'getEmojiById' | 'upsertEmoji' | 'getStickerById' | 'upsertSticker'
	>;
	avatarService: Pick<AvatarService, 'processEmoji' | 'uploadEmoji' | 'processSticker' | 'uploadSticker'>;
	storageService: Pick<IStorageService, 'readObject' | 'copyObject'>;
}

export interface PicturesOptions {
	dryRun: boolean;
	bucket: string;
	/** The picture's file as base64. */
	read: (file: PlanPicture['file']) => string;
	/** Where the old pictures are saved on the host (the plans folder), with the time in their names. */
	keepDir: string | null;
	stamp: string;
}

export interface PicturesResult {
	/** "<kind>:<id>" of each replaced. */
	done: Array<string>;
	missing: Array<string>;
	emojiGuilds: Array<string>;
	stickerGuilds: Array<string>;
	/** Where each old picture was kept. */
	kept: Array<{picture: string; bucket_key: string | null; file: string | null}>;
}

/** A Tyne emoji or sticker as a replacement needs it: where it is, and how its picture and row are written. */
interface Target {
	guildId: GuildID;
	name: string;
	animated: boolean;
	process: PicturesDeps['avatarService']['processEmoji'];
	upload: (imageBuffer: Uint8Array, animated: boolean) => Promise<void>;
	setAnimated: (animated: boolean) => Promise<unknown>;
}

async function loadTarget(p: PlanPicture, deps: PicturesDeps): Promise<Target | null> {
	const {guildRepository: guilds, avatarService: avatars} = deps;
	if (p.kind === 'emoji') {
		const emoji = await guilds.getEmojiById(BigInt(p.tyne_id) as EmojiID);
		return emoji
			? {
					guildId: emoji.guildId,
					name: emoji.name,
					animated: emoji.isAnimated,
					process: (params) => avatars.processEmoji(params),
					upload: (imageBuffer) => avatars.uploadEmoji({prefix: 'emojis', emojiId: emoji.id, imageBuffer}),
					setAnimated: (animated) => guilds.upsertEmoji({...emoji.toRow(), animated}),
				}
			: null;
	}
	const sticker = await guilds.getStickerById(BigInt(p.tyne_id) as StickerID);
	return sticker
		? {
				guildId: sticker.guildId,
				name: sticker.name,
				animated: sticker.animated,
				process: (params) => avatars.processSticker(params),
				upload: (imageBuffer, animated) =>
					avatars.uploadSticker({prefix: 'stickers', stickerId: sticker.id, imageBuffer, animated}),
				setAnimated: (animated) => guilds.upsertSticker({...sticker.toRow(), animated}),
			}
		: null;
}

export async function applyPictures(
	pictures: Array<PlanPicture>,
	deps: PicturesDeps,
	options: PicturesOptions,
): Promise<PicturesResult> {
	const result: PicturesResult = {done: [], missing: [], emojiGuilds: [], stickerGuilds: [], kept: []};
	const emojiGuilds = new Set<string>();
	const stickerGuilds = new Set<string>();
	for (const p of pictures) {
		const key = `${p.kind}:${p.tyne_id}`;
		const target = await loadTarget(p, deps);
		if (!target) {
			result.missing.push(key);
			continue;
		}
		const guild = await deps.guildRepository.findUnique(target.guildId);
		// The API's own checks, a dry run included: a picture Tyne would refuse stops here.
		const processed = await target.process({
			errorPath: 'image',
			base64Image: options.read(p.file),
			guildFeatures: guild ? [...guild.features] : [],
		});
		console.log(
			`${options.dryRun ? 'would replace' : 'replacing'} the picture of the ${p.kind} ${target.name} (${p.tyne_id})`,
		);
		(p.kind === 'emoji' ? emojiGuilds : stickerGuilds).add(target.guildId.toString());
		if (!options.dryRun) {
			result.kept.push(await keepOld(p, deps, options));
			await target.upload(processed.imageBuffer, processed.animated);
			if (target.animated !== processed.animated) await target.setAnimated(processed.animated);
		}
		result.done.push(key);
	}
	result.emojiGuilds = [...emojiGuilds];
	result.stickerGuilds = [...stickerGuilds];
	return result;
}

/** The picture about to be replaced, kept in the bucket and on the host; a missing one is noted, not fatal. */
async function keepOld(
	p: PlanPicture,
	deps: PicturesDeps,
	options: PicturesOptions,
): Promise<PicturesResult['kept'][number]> {
	const objectKey = `${p.kind === 'emoji' ? 'emojis' : 'stickers'}/${p.tyne_id}`;
	const kept = {picture: `${p.kind}:${p.tyne_id}`, bucket_key: null as string | null, file: null as string | null};
	try {
		const old = await deps.storageService.readObject(options.bucket, objectKey);
		const bucketKey = `discord-import-replaced/${objectKey}-${options.stamp}`;
		await deps.storageService.copyObject({
			sourceBucket: options.bucket,
			sourceKey: objectKey,
			destinationBucket: options.bucket,
			destinationKey: bucketKey,
		});
		kept.bucket_key = bucketKey;
		if (options.keepDir) {
			mkdirSync(options.keepDir, {recursive: true});
			const file = join(options.keepDir, `${p.kind}-${p.tyne_id}-${options.stamp}`);
			writeFileSync(file, old);
			kept.file = file;
		}
	} catch (error) {
		console.warn(`no old picture kept for ${kept.picture}: ${error instanceof Error ? error.message : String(error)}`);
	}
	return kept;
}
