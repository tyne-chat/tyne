// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: Discord history import (tyne-chat/tyne#608). Applies an import plan made by the operator's
// review tool (tyne-tools discord_import, plan.py): creates the placeholder accounts, personas,
// emoji and stickers it lists, then writes each message through the message repository, so every
// index row (history buckets, pins, attachment lookups, last message) is written as Tyne writes it,
// but nothing is sent: no gateway events, notifications or unread changes. Run by an operator, one
// plan at a time, in a container of the API's image:
//
//   tsx src/api/discord_import/ImportPlan.ts <plan.json> <exports dir> <ledger.json>
//   tsx src/api/discord_import/ImportPlan.ts <plan.json> <exports dir> <ledger.json> --copy-media <origin>
//
// Anything already written (same id) is skipped, so a stopped run can be started again. The ledger
// lists everything written, for undo. `--copy-media` (scratch copies only) first copies the avatars,
// persona avatars, emoji and stickers the plan's messages show from another instance's public media
// route, because a scratch copy of the database starts with empty storage.

import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {
	AttachmentID,
	ChannelID,
	EmojiID,
	GuildID,
	MessageID,
	PersonaID,
	StickerID,
	UserID,
} from '@app/api/BrandedTypes';
import {Config, initializeConfig} from '@app/api/Config';
import {fetchOne, setDatabaseQueryExecutor, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {Db} from '@app/api/database/CassandraTypes';
import {ensurePostgresKvSchema, PostgresKvQueryExecutor} from '@app/api/database/PostgresKvQueryExecutor';
import type {
	ChannelStateRow,
	MessageAttachment,
	MessageEmbed,
	MessageEmbedMedia,
	MessageRow,
} from '@app/api/database/types/MessageTypes';
import {EMPTY_USER_ROW} from '@app/api/database/types/UserTypes';
import {mediaProxyMetadataPolicy} from '@app/api/infrastructure/IMediaService';
import {JobLedgerRepository} from '@app/api/jobs/JobLedgerRepository';
import {initializeLogger, Logger} from '@app/api/Logger';
import {
	createSnowflakeService,
	getMediaService,
	setInjectedSnowflakeService,
	setInjectedWorkerService,
} from '@app/api/middleware/ServiceRegistry';
import {getCacheService, getEntityAssetService} from '@app/api/middleware/ServiceSingletons';
import {initializeSearch} from '@app/api/SearchFactory';
import {ChannelState, MessageReactions} from '@app/api/Tables';
import {JetStreamWorkerQueue} from '@app/api/worker/JetStreamWorkerQueue';
import {initializeWorkerDependencies} from '@app/api/worker/WorkerDependencies';
import {WorkerService} from '@app/api/worker/WorkerService';
import {Config as AppConfig} from '@app/Config';
import {Logger as AppLogger} from '@app/Logger';
import {normalizeFilename} from '@fluxer/schema/src/primitives/FileValidators';
import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
import {JetStreamConnectionManager} from '@pkgs/nats/src/JetStreamConnectionManager';
import {getDefaultPostgresClient, initPostgres} from '@pkgs/postgres/src/Client';

const FETCH_CHANNEL_STATE = ChannelState.select({where: ChannelState.where.eq('channel_id'), limit: 1});

interface PlanFile {
	path: string;
	name: string;
}
interface PlanAttachment extends PlanFile {
	attachment_id: string;
	filename: string;
	size: number | null;
	content_type: string;
}
interface PlanMedia {
	url: string | null;
	width?: number | null;
	height?: number | null;
}
interface PlanEmbed {
	type: string;
	title: string | null;
	url: string | null;
	description: string | null;
	color: number | null;
	timestamp: string | null;
	author: {name: string | null; url: string | null; icon_url: string | null} | null;
	footer: {text: string | null; icon_url: string | null} | null;
	fields: Array<{name: string; value: string; inline: boolean}>;
	thumbnail: PlanMedia | null;
	image: PlanMedia | null;
	video: PlanMedia | null;
}
interface PlanMessage {
	discord_id: string;
	message_id: string;
	type: number;
	author_id: string;
	persona_id: string | null;
	timestamp: string;
	edited_timestamp: string | null;
	pinned_timestamp: string | null;
	content: string | null;
	mention_user_ids: Array<string>;
	mention_everyone: boolean;
	reference: {message_id: string; channel_id: string; guild_id: string | null} | null;
	attachments: Array<PlanAttachment>;
	embeds: Array<PlanEmbed>;
	sticker_items: Array<{sticker_id: string; name: string; animated: boolean}>;
	reactions: Array<{
		emoji: {id: string | null; name: string; animated: boolean};
		users: Array<{user_id: string; persona_id: string | null}>;
	}>;
}
interface Plan {
	version: number;
	destination: {channel_id: string; path: string; dm: boolean};
	operator_user_id: string;
	placeholders: Array<{user_id: string; username: string; global_name: string; bot: boolean; avatar: PlanFile | null}>;
	personas: Array<{
		persona_id: string;
		user_id: string;
		name: string;
		tags: Array<{prefix: string | null; suffix: string | null}>;
		deleted: boolean;
		avatar: PlanFile | null;
	}>;
	emoji: Array<{emoji_id: string; name: string; guild_id: string | null; animated: boolean; file: PlanFile | null}>;
	stickers: Array<{sticker_id: string; name: string; guild_id: string; animated: boolean; file: PlanFile | null}>;
	messages: Array<PlanMessage>;
}
interface Ledger {
	plan: string;
	started_at: string;
	finished_at: string | null;
	destination: string;
	placeholders: Array<string>;
	personas: Array<{user_id: string; persona_id: string}>;
	emoji: Array<{emoji_id: string; guild_id: string | null}>;
	stickers: Array<{sticker_id: string; guild_id: string}>;
	messages: Array<string>;
	reactions: number;
	storage_keys: Array<string>;
	skipped_existing: number;
	copied_media: number;
}

const [planPath, exportsDir, ledgerPath, ...rest] = process.argv.slice(2);
if (!planPath || !exportsDir || !ledgerPath) {
	console.error('usage: ImportPlan.ts <plan.json> <exports dir> <ledger.json> [--copy-media <origin>]');
	process.exit(2);
}
const copyMediaFrom = rest[0] === '--copy-media' ? rest[1] : null;

const id = <T>(value: string) => BigInt(value) as unknown as T;
const readBase64 = (file: PlanFile) => readFileSync(join(exportsDir, file.path)).toString('base64');

function embedMedia(m: PlanMedia | null): MessageEmbedMedia | null {
	if (!m?.url) return null;
	return {
		url: m.url,
		width: m.width ?? null,
		height: m.height ?? null,
		description: null,
		content_type: null,
		content_hash: null,
		placeholder: null,
		flags: 0,
		duration: null,
	};
}

function toEmbed(e: PlanEmbed): MessageEmbed {
	return {
		type: e.type,
		title: e.title,
		description: e.description,
		url: e.url,
		timestamp: e.timestamp ? new Date(e.timestamp) : null,
		color: e.color,
		author: e.author ? {name: e.author.name, url: e.author.url, icon_url: e.author.icon_url} : null,
		provider: null,
		thumbnail: embedMedia(e.thumbnail),
		image: embedMedia(e.image),
		video: embedMedia(e.video),
		footer: e.footer ? {text: e.footer.text, icon_url: e.footer.icon_url} : null,
		fields: e.fields.length ? e.fields.map((f) => ({name: f.name, value: f.value, inline: f.inline})) : null,
		nsfw: null,
	};
}

async function main(): Promise<void> {
	initializeConfig(AppConfig);
	initializeLogger(AppLogger);
	const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;
	if (plan.version !== 1) throw new Error(`unknown plan version ${plan.version}`);

	// The worker's start-up (worker/WorkerMain.ts), without its consumers and schedules.
	await initPostgres(Config.postgres, (diagnostic) => Logger.error(diagnostic, 'Postgres connection error'));
	const postgres = getDefaultPostgresClient();
	await ensurePostgresKvSchema(postgres);
	setDatabaseQueryExecutor(new PostgresKvQueryExecutor(postgres));
	const snowflakeService = createSnowflakeService();
	await snowflakeService.initialize();
	setInjectedSnowflakeService(snowflakeService);
	const jetStream = new JetStreamConnectionManager({
		url: Config.nats.jetStreamUrl,
		token: Config.nats.authToken || undefined,
		name: 'discord-import',
	});
	await jetStream.connect();
	const workerService = new WorkerService(
		new JetStreamWorkerQueue(jetStream),
		snowflakeService,
		new JobLedgerRepository(),
	);
	setInjectedWorkerService(workerService);
	await initializeSearch(getCacheService());
	const deps = await initializeWorkerDependencies(snowflakeService);
	const media = getMediaService();
	const assets = getEntityAssetService();
	const cdn = Config.s3.buckets.cdn;

	const channelId = id<ChannelID>(plan.destination.channel_id);
	if (!(await deps.channelRepository.channelData.findUnique(channelId)))
		throw new Error(`destination channel ${channelId} does not exist`);
	const ledger: Ledger = {
		plan: planPath,
		started_at: new Date().toISOString(),
		finished_at: null,
		destination: plan.destination.channel_id,
		placeholders: [],
		personas: [],
		emoji: [],
		stickers: [],
		messages: [],
		reactions: 0,
		storage_keys: [],
		skipped_existing: 0,
		copied_media: 0,
	};
	const save = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));

	if (copyMediaFrom) ledger.copied_media = await copyMedia(plan, copyMediaFrom, deps, cdn);

	for (const p of plan.placeholders) {
		const userId = id<UserID>(p.user_id);
		if (await deps.userRepository.findUnique(userId)) {
			ledger.skipped_existing++;
			continue;
		}
		const {discriminator, available} = await deps.discriminatorService.generateDiscriminator({username: p.username});
		if (!available) throw new Error(`no free tag for username ${p.username}`);
		let avatarHash: string | null = null;
		if (p.avatar) {
			const prepared = await assets.prepareAssetUpload({
				assetType: 'avatar',
				entityType: 'user',
				entityId: userId,
				previousHash: null,
				base64Image: readBase64(p.avatar),
				errorPath: 'avatar',
			});
			avatarHash = prepared.newHash;
			if (prepared.newS3Key) ledger.storage_keys.push(prepared.newS3Key);
		}
		await deps.userRepository.create({
			...EMPTY_USER_ROW,
			user_id: userId,
			username: p.username,
			discriminator,
			global_name: p.global_name,
			bot: p.bot,
			system: false,
			email_verified: true,
			authenticator_types: new Set(),
			flags: 0n,
			avatar_hash: avatarHash,
			version: 1,
		});
		ledger.placeholders.push(p.user_id);
		save();
	}

	for (const p of plan.personas) {
		const userId = id<UserID>(p.user_id);
		const personaId = id<PersonaID>(p.persona_id);
		const found = await deps.personaRepository.findByUserAndPersonaIds([{userId, personaId}]);
		if (found.size) {
			ledger.skipped_existing++;
			continue;
		}
		let avatarHash: string | null = null;
		if (p.avatar) {
			const prepared = await assets.prepareAssetUpload({
				assetType: 'avatar',
				entityType: 'user',
				entityId: userId,
				previousHash: null,
				base64Image: readBase64(p.avatar),
				errorPath: 'avatar',
			});
			avatarHash = prepared.newHash;
			if (prepared.newS3Key) ledger.storage_keys.push(prepared.newS3Key);
		}
		await deps.personaRepository.create({
			user_id: userId,
			persona_id: personaId,
			name: p.name,
			avatar_hash: avatarHash,
			persona_tags: p.tags.map((t) => ({
				...(t.prefix ? {prefix: t.prefix} : {}),
				...(t.suffix ? {suffix: t.suffix} : {}),
			})),
			visibility: 'unlisted',
		});
		if (p.deleted) await deps.personaRepository.delete(userId, personaId);
		ledger.personas.push({user_id: p.user_id, persona_id: p.persona_id});
		save();
	}

	for (const e of plan.emoji) {
		if (!e.file) {
			Logger.warn({emoji: e.name}, 'emoji has no image in the export; skipped');
			continue;
		}
		if (e.guild_id && (await deps.guildRepository.getEmojiById(id<EmojiID>(e.emoji_id)))) {
			ledger.skipped_existing++;
			continue;
		}
		const guild = e.guild_id ? await deps.guildRepository.findUnique(id<GuildID>(e.guild_id)) : null;
		const {imageBuffer} = await deps.avatarService.processEmoji({
			errorPath: 'image',
			base64Image: readBase64(e.file),
			guildFeatures: guild ? [...guild.features] : [],
		});
		await deps.avatarService.uploadEmoji({prefix: 'emojis', emojiId: BigInt(e.emoji_id), imageBuffer});
		ledger.storage_keys.push(`emojis/${e.emoji_id}`);
		if (e.guild_id) {
			await deps.guildRepository.upsertEmoji({
				guild_id: id<GuildID>(e.guild_id),
				emoji_id: id<EmojiID>(e.emoji_id),
				name: e.name,
				creator_id: id<UserID>(plan.operator_user_id),
				animated: e.animated,
				version: 1,
			});
		}
		ledger.emoji.push({emoji_id: e.emoji_id, guild_id: e.guild_id});
		save();
	}

	for (const s of plan.stickers) {
		if (!s.file) {
			Logger.warn({sticker: s.name}, 'sticker has no image in the export; skipped');
			continue;
		}
		if (await deps.guildRepository.getStickerById(id<StickerID>(s.sticker_id))) {
			ledger.skipped_existing++;
			continue;
		}
		const guild = await deps.guildRepository.findUnique(id<GuildID>(s.guild_id));
		const processed = await deps.avatarService.processSticker({
			errorPath: 'image',
			base64Image: readBase64(s.file),
			guildFeatures: guild ? [...guild.features] : [],
		});
		await deps.avatarService.uploadSticker({
			prefix: 'stickers',
			stickerId: BigInt(s.sticker_id),
			imageBuffer: processed.imageBuffer,
		});
		ledger.storage_keys.push(`stickers/${s.sticker_id}`);
		await deps.guildRepository.upsertSticker({
			guild_id: id<GuildID>(s.guild_id),
			sticker_id: id<StickerID>(s.sticker_id),
			name: s.name,
			description: null,
			animated: processed.animated,
			tags: [],
			creator_id: id<UserID>(plan.operator_user_id),
			version: 1,
		});
		ledger.stickers.push({sticker_id: s.sticker_id, guild_id: s.guild_id});
		save();
	}

	let minBucket = BucketUtils.makeBucket(channelId);
	let n = 0;
	for (const m of plan.messages) {
		const messageId = id<MessageID>(m.message_id);
		const bucket = BucketUtils.makeBucket(messageId);
		minBucket = Math.min(minBucket, bucket);
		if (await deps.channelRepository.messages.getMessage(channelId, messageId)) {
			ledger.skipped_existing++;
			continue;
		}

		const attachments: Array<MessageAttachment> = [];
		for (const a of m.attachments) {
			let body: Uint8Array = readFileSync(join(exportsDir, a.path));
			if (a.content_type.startsWith('image/')) body = (await media.stripImageMetadata(body)) ?? body;
			const filename = normalizeFilename(a.filename) || 'file';
			const key = `attachments/${channelId}/${a.attachment_id}/${filename}`;
			await deps.storageService.uploadObject({bucket: cdn, key, body, contentType: a.content_type});
			ledger.storage_keys.push(key);
			const meta = await media.getMetadata({type: 's3', bucket: cdn, key, ...mediaProxyMetadataPolicy('flag')});
			attachments.push({
				attachment_id: id<AttachmentID>(a.attachment_id),
				filename,
				size: BigInt(meta?.size ?? body.length),
				title: null,
				description: null,
				width: meta?.width ?? null,
				height: meta?.height ?? null,
				content_type: meta?.content_type ?? a.content_type,
				content_hash: meta?.content_hash ?? null,
				placeholder: meta?.placeholder ?? null,
				flags: (meta?.animated ? 1 << 5 : 0) | (meta?.nsfw ? 1 << 4 : 0),
				duration: meta?.duration ?? null,
				nsfw: meta?.nsfw ?? null,
				waveform: null,
			});
		}

		const row: MessageRow = {
			channel_id: channelId,
			bucket,
			message_id: messageId,
			author_id: id<UserID>(m.author_id),
			type: m.type,
			webhook_id: null,
			webhook_name: null,
			webhook_avatar_hash: null,
			content: m.content,
			edited_timestamp: m.edited_timestamp ? new Date(m.edited_timestamp) : null,
			pinned_timestamp: m.pinned_timestamp ? new Date(m.pinned_timestamp) : null,
			flags: 0,
			mention_everyone: m.mention_everyone,
			mention_users: m.mention_user_ids.length ? new Set(m.mention_user_ids.map((u) => id<UserID>(u))) : null,
			mention_roles: null,
			mention_channels: null,
			attachments: attachments.length ? attachments : null,
			embeds: m.embeds.length ? m.embeds.map(toEmbed) : null,
			sticker_items: m.sticker_items.length
				? m.sticker_items.map((s) => ({sticker_id: id<StickerID>(s.sticker_id), name: s.name, animated: s.animated}))
				: null,
			message_reference: m.reference
				? {
						channel_id: id<ChannelID>(m.reference.channel_id),
						message_id: id<MessageID>(m.reference.message_id),
						guild_id: m.reference.guild_id ? id<GuildID>(m.reference.guild_id) : null,
						type: 0,
					}
				: null,
			message_snapshots: null,
			call: null,
			has_reaction: m.reactions.length > 0,
			version: 1,
			persona_id: m.persona_id ? id<PersonaID>(m.persona_id) : null,
		};
		await deps.channelRepository.messages.upsertMessage(row);

		const reactedAt = new Date(m.timestamp);
		for (const r of m.reactions) {
			for (const u of r.users) {
				await upsertOne(
					MessageReactions.upsertAll({
						channel_id: channelId,
						bucket,
						message_id: messageId,
						user_id: id<UserID>(u.user_id),
						emoji_id: r.emoji.id ? id<EmojiID>(r.emoji.id) : (0n as unknown as EmojiID),
						emoji_name: r.emoji.name,
						emoji_animated: r.emoji.animated,
						created_at: reactedAt,
						persona_id: u.persona_id ? BigInt(u.persona_id) : 0n,
					}),
				);
				ledger.reactions++;
			}
		}
		ledger.messages.push(m.message_id);
		if (++n % 100 === 0) {
			save();
			console.log(`${n} of ${plan.messages.length} messages`);
		}
	}

	// A plan with no messages (emoji or stickers only) leaves the channel alone.
	if (plan.messages.length > 0) {
		// The channel's oldest bucket is where the API's reads of its history start: history older than
		// the channel needs it lowered, or search reindexing and purges would not see it. Never raise
		// it: an earlier import into this channel may have lowered it further.
		const state = await fetchOne<ChannelStateRow>(FETCH_CHANNEL_STATE.bind({channel_id: channelId}));
		const oldest = Math.min(minBucket, state?.created_bucket ?? minBucket);
		await upsertOne(
			ChannelState.patchByPk({channel_id: channelId}, {created_bucket: Db.set(oldest), updated_at: Db.set(new Date())}),
		);
		// Search: the worker reindexes the channel, imported history included (it reads from the
		// bucket lowered above). A key of its own, so it is not merged with a reindex queued earlier.
		await workerService.addJob(
			'indexChannelMessages',
			{channelId: channelId.toString()},
			{jobKey: `discord-import-reindex-${channelId}-${Date.now()}`, maxAttempts: 3},
		);
	}
	ledger.finished_at = new Date().toISOString();
	save();
	console.log(
		`done: ${ledger.messages.length} messages, ${ledger.reactions} reactions, ${ledger.placeholders.length} placeholders, ` +
			`${ledger.personas.length} personas, ${ledger.emoji.length} emoji, ${ledger.stickers.length} stickers; skipped ${ledger.skipped_existing} already there`,
	);
	await jetStream.drain();
	process.exit(0);
}

// Scratch copies start with empty storage: fetch what the plan's messages show from the source
// instance's public media route and store it under the same keys.
async function copyMedia(
	plan: Plan,
	origin: string,
	deps: Awaited<ReturnType<typeof initializeWorkerDependencies>>,
	cdn: string,
): Promise<number> {
	const keys = new Map<string, string>();
	const userIds = new Set<string>();
	const personaPairs: Array<{userId: UserID; personaId: PersonaID}> = [];
	for (const m of plan.messages) {
		userIds.add(m.author_id);
		for (const u of m.mention_user_ids) userIds.add(u);
		if (m.persona_id) personaPairs.push({userId: id<UserID>(m.author_id), personaId: id<PersonaID>(m.persona_id)});
		for (const r of m.reactions) {
			for (const u of r.users) {
				userIds.add(u.user_id);
				if (u.persona_id) personaPairs.push({userId: id<UserID>(u.user_id), personaId: id<PersonaID>(u.persona_id)});
			}
			if (r.emoji.id)
				keys.set(
					`emojis/${r.emoji.id}`,
					`${origin}/media/emojis/${r.emoji.id}.webp?size=128${r.emoji.animated ? '&animated=true' : ''}`,
				);
		}
		for (const e of (m.content ?? '').matchAll(/<(a?):\w+:(\d+)>/g))
			keys.set(`emojis/${e[2]}`, `${origin}/media/emojis/${e[2]}.webp?size=128${e[1] ? '&animated=true' : ''}`);
		for (const s of m.sticker_items)
			keys.set(
				`stickers/${s.sticker_id}`,
				`${origin}/media/stickers/${s.sticker_id}.webp?size=320${s.animated ? '&animated=true' : ''}`,
			);
	}
	for (const userId of userIds) {
		const user = await deps.userRepository.findUnique(id<UserID>(userId));
		const hash = user?.avatarHash;
		if (hash)
			keys.set(
				`avatars/${userId}/${hash.replace(/^a_/, '')}`,
				`${origin}/media/avatars/${userId}/${hash}.webp?size=512${hash.startsWith('a_') ? '&animated=true' : ''}`,
			);
	}
	const personas = await deps.personaRepository.findByUserAndPersonaIds(personaPairs);
	for (const p of personas.values()) {
		const hash = p.avatarHash;
		if (hash)
			keys.set(
				`avatars/${p.userId}/${hash.replace(/^a_/, '')}`,
				`${origin}/media/avatars/${p.userId}/${hash}.webp?size=512${hash.startsWith('a_') ? '&animated=true' : ''}`,
			);
	}
	let copied = 0;
	for (const [key, url] of keys) {
		if (
			plan.emoji.some((e) => key === `emojis/${e.emoji_id}`) ||
			plan.stickers.some((s) => key === `stickers/${s.sticker_id}`)
		)
			continue;
		const res = await fetch(url);
		if (!res.ok) {
			Logger.warn({url, status: res.status}, 'media copy failed');
			continue;
		}
		await deps.storageService.uploadObject({bucket: cdn, key, body: new Uint8Array(await res.arrayBuffer())});
		copied++;
	}
	console.log(`copied ${copied} of ${keys.size} media objects from ${origin}`);
	return copied;
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
