// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: Discord history import (tyne-chat/tyne#608). Applies an import plan made by the operator's
// review tool (tyne-tools discord_import, plan.py): creates the placeholder accounts, personas,
// emoji and stickers it lists, then writes each message through the message repository, so every
// index row (history buckets, pins, attachment lookups, last message) is written as Tyne writes it,
// but nothing is sent: no message events, notifications or unread changes. The one exception is at
// the end: the emoji and sticker lists of the communities the plan adds to go to the gateway
// (ImportExpressionLists.ts), or the apps would never show them. Run by an operator, one plan at a
// time, in a container of the API's image:
//
//   tsx src/api/discord_import/ImportPlan.ts <plan.json> <exports dir> <ledger.json>
//   tsx src/api/discord_import/ImportPlan.ts <plan.json> <exports dir> <ledger.json> --copy-media <origin>
//
// Ids are stable across plans (the review tool's registry), so a plan can be applied again, after a
// fix or a changed decision, or as part of a larger one (tyne-chat/tyne#657). What is not there yet
// is created. What an earlier import wrote is brought up to date by a three-way comparison
// (ImportMerge.ts) with the plan's `previous` entries, which say what that import wrote: changes made
// on Tyne since (edits, reactions, pins, renamed or deleted things) are kept. Messages in `remove`,
// which an earlier import wrote and the plan no longer has, are deleted unless someone changed them.
// Anything else already there is left alone. The ledger lists what was created, updated, removed and
// kept; `--dry-run` works it all out and writes nothing else. `--copy-media` (scratch copies only)
// first copies the avatars, persona avatars, emoji and stickers the plan's messages show from another
// instance's public media route, because a scratch copy of the database starts with empty storage.

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
import {
	EMBED_MEDIA_OWNED_ATTACHMENT_FLAG,
	purgeMessageAttachments,
} from '@app/api/channel/services/message/MessageHelpers';
import {
	deleteOneOrMany,
	fetchMany,
	fetchOne,
	setDatabaseQueryExecutor,
	upsertOne,
} from '@app/api/database/CassandraQueryExecution';
import {Db} from '@app/api/database/CassandraTypes';
import {ensurePostgresKvSchema, PostgresKvQueryExecutor} from '@app/api/database/PostgresKvQueryExecutor';
import type {
	ChannelStateRow,
	MessageAttachment,
	MessageEmbed,
	MessageEmbedMedia,
	MessageReactionRow,
	MessageRow,
	MessageSnapshot,
} from '@app/api/database/types/MessageTypes';
import {EMPTY_USER_ROW, type UserRow} from '@app/api/database/types/UserTypes';
import {sendExpressionLists} from '@app/api/discord_import/ImportExpressionLists';
import {canonical, changedSince, mergeFields, mergeSets} from '@app/api/discord_import/ImportMerge';
import {mediaProxyMetadataPolicy} from '@app/api/infrastructure/IMediaService';
import {JobLedgerRepository} from '@app/api/jobs/JobLedgerRepository';
import {initializeLogger, Logger} from '@app/api/Logger';
import {getGuildCommandRepository} from '@app/api/middleware/ForkServiceSingletons';
import {
	createSnowflakeService,
	getMediaService,
	setInjectedSnowflakeService,
	setInjectedWorkerService,
} from '@app/api/middleware/ServiceRegistry';
import {getCacheService, getEntityAssetService} from '@app/api/middleware/ServiceSingletons';
import {getMessageSearchService, initializeSearch} from '@app/api/SearchFactory';
import {ChannelState, MessageReactions, Messages, MessagesByAuthorV2} from '@app/api/Tables';
import {JetStreamWorkerQueue} from '@app/api/worker/JetStreamWorkerQueue';
import {initializeWorkerDependencies} from '@app/api/worker/WorkerDependencies';
import {WorkerService} from '@app/api/worker/WorkerService';
import {Config as AppConfig} from '@app/Config';
import {Logger as AppLogger} from '@app/Logger';
import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {normalizeFilename} from '@fluxer/schema/src/primitives/FileValidators';
import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
import {JetStreamConnectionManager} from '@pkgs/nats/src/JetStreamConnectionManager';
import {getDefaultPostgresClient, initPostgres} from '@pkgs/postgres/src/Client';

const FETCH_CHANNEL_STATE = ChannelState.select({where: ChannelState.where.eq('channel_id'), limit: 1});
const FETCH_MESSAGE = Messages.select({
	where: [Messages.where.eq('channel_id'), Messages.where.eq('bucket'), Messages.where.eq('message_id')],
	limit: 1,
});
const FETCH_REACTIONS = MessageReactions.select({
	where: [
		MessageReactions.where.eq('channel_id'),
		MessageReactions.where.eq('bucket'),
		MessageReactions.where.eq('message_id'),
	],
});

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
	/** The export's copy, stored on Tyne because the original no longer loads (tyne-chat/tyne#662). */
	local?: PlanFile;
	attachment_id?: string;
	content_type?: string;
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
	provider?: {name: string; url: string | null} | null;
}
/** What a forward forwarded, as Tyne keeps a forward's copy (tyne-chat/tyne#661). */
interface PlanSnapshot {
	content: string | null;
	timestamp: string;
	edited_timestamp: string | null;
	mention_user_ids: Array<string>;
	attachments: Array<PlanAttachment>;
	embeds: Array<PlanEmbed>;
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
	snapshot?: PlanSnapshot | null;
	/** The forwarded original, when its channel is on Tyne: the "go to original" link. */
	forward?: {message_id: string; channel_id: string; guild_id: string | null} | null;
	/** The command the message answered, shown as Tyne's server commands are: a /name chip. */
	command?: {name: string; command_id: string; guild_id: string} | null;
}
interface PlanPlaceholder {
	user_id: string;
	username: string;
	global_name: string;
	bot: boolean;
	avatar: PlanFile | null;
}
interface PlanPersona {
	persona_id: string;
	user_id: string;
	name: string;
	tags: Array<{prefix: string | null; suffix: string | null}>;
	deleted: boolean;
	avatar: PlanFile | null;
}
interface PlanEmoji {
	emoji_id: string;
	name: string;
	guild_id: string | null;
	animated: boolean;
	file: PlanFile | null;
}
interface PlanSticker {
	sticker_id: string;
	name: string;
	guild_id: string;
	animated: boolean;
	file: PlanFile | null;
}
/** An entry as an earlier import wrote it, with the avatar hash that write produced, if known. */
type Written<T> = T & {_avatar_hash?: string | null};
interface Plan {
	version: number;
	/** The instance the plan was made for: its links point there. */
	origin?: string;
	destination: {channel_id: string; path: string; dm: boolean};
	operator_user_id: string;
	placeholders: Array<PlanPlaceholder>;
	personas: Array<PlanPersona>;
	emoji: Array<PlanEmoji>;
	stickers: Array<PlanSticker>;
	messages: Array<PlanMessage>;
	/** What earlier imports wrote for the objects in this plan, by Tyne id: the base of the three-way
	 * comparison (ImportMerge.ts). An object with no entry here is created, or left alone if it exists. */
	previous?: {
		messages?: Record<string, PlanMessage>;
		placeholders?: Record<string, Written<PlanPlaceholder>>;
		personas?: Record<string, Written<PlanPersona>>;
		emoji?: Record<string, PlanEmoji>;
		stickers?: Record<string, PlanSticker>;
	};
	/** Messages earlier imports wrote into this channel that the plan no longer has, as they wrote them:
	 * removed unless someone changed them on Tyne. */
	remove?: Array<PlanMessage>;
}
type Kind = 'message' | 'placeholder' | 'persona' | 'emoji' | 'sticker';
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
	/** Objects an earlier import wrote that this run brought up to date. */
	updated: Record<Kind, Array<string>>;
	removed: {message: Array<string>};
	/** Changes made on Tyne that this run kept, by what they were. */
	kept: Record<string, number>;
	/** The avatar hash each placeholder or persona got when this run wrote its avatar. */
	hashes: {placeholder: Record<string, string | null>; persona: Record<string, string | null>};
	dry_run: boolean;
}

const [planPath, exportsDir, ledgerPath, ...rest] = process.argv.slice(2);
if (!planPath || !exportsDir || !ledgerPath) {
	console.error('usage: ImportPlan.ts <plan.json> <exports dir> <ledger.json> [--copy-media <origin>] [--dry-run]');
	process.exit(2);
}
const copyMediaFrom = rest.includes('--copy-media') ? rest[rest.indexOf('--copy-media') + 1] : null;
// Works out everything the run would do and writes nothing: the ledger then says what it would have done.
const dryRun = rest.includes('--dry-run');

const id = <T>(value: string) => BigInt(value) as unknown as T;
const readBase64 = (file: PlanFile) => readFileSync(join(exportsDir, file.path)).toString('base64');

/** Where the export's copy of a preview's media goes: next to the channel's attachments, flagged as the
 * preview's own, as Tyne keeps media it hosts for a preview itself (MessageHelpers.ts). */
function ownedMediaKey(channelId: ChannelID, m: PlanMedia): string | null {
	return m.local && m.attachment_id
		? `attachments/${channelId}/${m.attachment_id}/${normalizeFilename(m.local.name) || 'file'}`
		: null;
}

function embedMedia(m: PlanMedia | null, channelId: ChannelID): MessageEmbedMedia | null {
	if (!m) return null;
	const owned = ownedMediaKey(channelId, m);
	const url = owned ? `${Config.endpoints.media}/${owned}` : m.url;
	if (!url) return null;
	return {
		url,
		width: m.width ?? null,
		height: m.height ?? null,
		description: null,
		content_type: owned ? (m.content_type ?? null) : null,
		content_hash: null,
		placeholder: null,
		flags: owned ? EMBED_MEDIA_OWNED_ATTACHMENT_FLAG : 0,
		duration: null,
	};
}

function toEmbed(e: PlanEmbed, channelId: ChannelID): MessageEmbed {
	return {
		type: e.type,
		title: e.title,
		description: e.description,
		url: e.url,
		timestamp: e.timestamp ? new Date(e.timestamp) : null,
		color: e.color,
		author: e.author ? {name: e.author.name, url: e.author.url, icon_url: e.author.icon_url} : null,
		provider: e.provider ? {name: e.provider.name, url: e.provider.url} : null,
		thumbnail: embedMedia(e.thumbnail, channelId),
		image: embedMedia(e.image, channelId),
		video: embedMedia(e.video, channelId),
		footer: e.footer ? {text: e.footer.text, icon_url: e.footer.icon_url} : null,
		fields: e.fields.length ? e.fields.map((f) => ({name: f.name, value: f.value, inline: f.inline})) : null,
		nsfw: null,
	};
}

// The message fields an import writes and a re-import compares (attachments and reactions apart).
const MESSAGE_FIELDS = [
	'author_id',
	'persona_id',
	'type',
	'content',
	'edited_timestamp',
	'pinned_timestamp',
	'mention_everyone',
	'mention_users',
	'embeds',
	'sticker_items',
	'message_reference',
] as const;
type MessageFields = Pick<MessageRow, (typeof MESSAGE_FIELDS)[number]>;

/** A reply's reference, or a forward's (type 1) when its original's channel is on Tyne. */
function messageReference(m: PlanMessage): MessageRow['message_reference'] {
	const target = m.reference ?? m.forward;
	if (!target) return null;
	return {
		channel_id: id<ChannelID>(target.channel_id),
		message_id: id<MessageID>(target.message_id),
		guild_id: target.guild_id ? id<GuildID>(target.guild_id) : null,
		type: m.reference ? 0 : 1,
	};
}

function messageFields(m: PlanMessage, channelId: ChannelID): MessageFields {
	return {
		author_id: id<UserID>(m.author_id),
		persona_id: m.persona_id ? id<PersonaID>(m.persona_id) : null,
		type: m.type,
		content: m.content,
		edited_timestamp: m.edited_timestamp ? new Date(m.edited_timestamp) : null,
		pinned_timestamp: m.pinned_timestamp ? new Date(m.pinned_timestamp) : null,
		mention_everyone: m.mention_everyone,
		mention_users: m.mention_user_ids.length ? new Set(m.mention_user_ids.map((u) => id<UserID>(u))) : null,
		embeds: m.embeds.length ? m.embeds.map((e) => toEmbed(e, channelId)) : null,
		sticker_items: m.sticker_items.length
			? m.sticker_items.map((s) => ({sticker_id: id<StickerID>(s.sticker_id), name: s.name, animated: s.animated}))
			: null,
		message_reference: messageReference(m),
	};
}

// A forward's copy, comparable between a plan entry and a stored row. Nobody can edit a forward on
// Tyne, so the copy is compared as a whole; its files by id and stored name, as attachments are.
function plannedSnapshot(s: PlanSnapshot | null | undefined, channelId: ChannelID): string {
	if (!s) return canonical(null);
	return canonical({
		content: s.content,
		timestamp: new Date(s.timestamp),
		edited_timestamp: s.edited_timestamp ? new Date(s.edited_timestamp) : null,
		mention_users: new Set(s.mention_user_ids),
		embeds: s.embeds.map((e) => toEmbed(e, channelId)),
		attachments: s.attachments.map((a) => ({id: a.attachment_id, filename: storedFilename(a)})),
	});
}

function storedSnapshot(row: MessageRow): string {
	const s = row.message_snapshots?.[0];
	if (!s) return canonical(null);
	return canonical({
		content: s.content,
		timestamp: s.timestamp,
		edited_timestamp: s.edited_timestamp,
		mention_users: s.mention_users,
		embeds: s.embeds,
		attachments: (s.attachments ?? []).map((a) => ({id: a.attachment_id, filename: a.filename})),
	});
}

/** A plan's forward copy including where its files come from, to tell whether the plan changed it. */
function snapshotSource(s: PlanSnapshot | null | undefined, channelId: ChannelID): string {
	return canonical([plannedSnapshot(s, channelId), s?.attachments.map((a) => a.path) ?? null]);
}

function rowFields(row: MessageRow): MessageFields {
	return Object.fromEntries(MESSAGE_FIELDS.map((field) => [field, row[field]])) as MessageFields;
}

function storedFilename(a: PlanAttachment): string {
	return normalizeFilename(a.filename) || 'file';
}

function attachmentKey(channelId: ChannelID, a: PlanAttachment): string {
	return `attachments/${channelId}/${a.attachment_id}/${storedFilename(a)}`;
}

/** What a plan's attachments are: ids, source files and names (the stored metadata follows from them). */
function attachmentIdentity(attachments: Array<PlanAttachment>): string {
	return canonical(attachments.map((a) => ({id: a.attachment_id, path: a.path, filename: storedFilename(a)})));
}

interface ReactionWrite {
	emoji_id: EmojiID;
	emoji_name: string;
	emoji_animated: boolean;
	user_id: UserID;
	persona_id: bigint;
}

/** A reaction row's key; stored rows may carry the persona as a string, or none for the account (0). */
function reactionKey(r: {
	emoji_id: bigint;
	emoji_name: string;
	user_id: bigint;
	persona_id?: bigint | string | null;
}): string {
	return `${r.emoji_id}|${r.emoji_name}|${r.user_id}|${r.persona_id ?? 0}`;
}

/** The reaction rows a plan message asks for, by key. */
function planReactions(m: PlanMessage): Map<string, ReactionWrite> {
	const rows = new Map<string, ReactionWrite>();
	for (const r of m.reactions) {
		for (const u of r.users) {
			const row: ReactionWrite = {
				emoji_id: r.emoji.id ? id<EmojiID>(r.emoji.id) : (0n as unknown as EmojiID),
				emoji_name: r.emoji.name,
				emoji_animated: r.emoji.animated,
				user_id: id<UserID>(u.user_id),
				persona_id: u.persona_id ? BigInt(u.persona_id) : 0n,
			};
			rows.set(reactionKey(row), row);
		}
	}
	return rows;
}

async function main(): Promise<void> {
	initializeConfig(AppConfig);
	initializeLogger(AppLogger);
	const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;
	if (plan.version !== 1) throw new Error(`unknown plan version ${plan.version}`);
	// A plan's links and previous entries belong to the instance it was made for.
	if (plan.origin && new URL(plan.origin).origin !== new URL(Config.endpoints.webApp).origin)
		throw new Error(`the plan was made for ${plan.origin}, but this instance is ${Config.endpoints.webApp}`);

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
		updated: {message: [], placeholder: [], persona: [], emoji: [], sticker: []},
		removed: {message: []},
		kept: {},
		hashes: {placeholder: {}, persona: {}},
		dry_run: dryRun,
	};
	const save = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
	const keep = (what: string) => {
		ledger.kept[what] = (ledger.kept[what] ?? 0) + 1;
	};
	const updated = (kind: Kind, tyneId: string) => {
		if (!ledger.updated[kind].includes(tyneId)) ledger.updated[kind].push(tyneId);
	};
	const previous = plan.previous ?? {};

	if (copyMediaFrom && !dryRun) ledger.copied_media = await copyMedia(plan, copyMediaFrom, deps, cdn);

	const uploadAvatar = async (userId: UserID, file: PlanFile): Promise<string | null> => {
		if (dryRun) return null;
		const prepared = await assets.prepareAssetUpload({
			assetType: 'avatar',
			entityType: 'user',
			entityId: userId,
			previousHash: null,
			base64Image: readBase64(file),
			errorPath: 'avatar',
		});
		if (prepared.newS3Key) ledger.storage_keys.push(prepared.newS3Key);
		return prepared.newHash;
	};

	// Placeholder accounts, personas, emoji and stickers are shared between channels: an earlier
	// import's are brought up to date field by field, and never deleted.
	for (const p of plan.placeholders) {
		const userId = id<UserID>(p.user_id);
		const existing = await deps.userRepository.findUnique(userId);
		const prev = previous.placeholders?.[p.user_id];
		if (!existing) {
			if (prev) {
				keep('placeholder deleted on Tyne');
				continue;
			}
			const {discriminator, available} = await deps.discriminatorService.generateDiscriminator({username: p.username});
			if (!available) throw new Error(`no free tag for username ${p.username}`);
			const avatarHash = p.avatar ? await uploadAvatar(userId, p.avatar) : null;
			if (!dryRun)
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
			ledger.hashes.placeholder[p.user_id] = avatarHash;
			save();
			continue;
		}
		if (!prev) {
			ledger.skipped_existing++;
			continue;
		}
		const merge = mergeFields(
			{global_name: prev.global_name, bot: prev.bot},
			{global_name: existing.globalName ?? '', bot: existing.isBot},
			{global_name: p.global_name, bot: p.bot},
			['global_name', 'bot'],
		);
		for (const field of merge.kept) keep(`placeholder ${field}`);
		if (p.username !== prev.username) keep('placeholder username (imports never change one: use the admin panel)');
		const patch: Partial<UserRow> = {...merge.patch};
		if ((prev.avatar?.path ?? null) !== (p.avatar?.path ?? null)) {
			if (prev._avatar_hash !== undefined && existing.avatarHash === prev._avatar_hash) {
				patch.avatar_hash = p.avatar ? await uploadAvatar(userId, p.avatar) : null;
				ledger.hashes.placeholder[p.user_id] = patch.avatar_hash;
			} else keep('placeholder avatar');
		}
		if (Object.keys(patch).length) {
			if (!dryRun) await deps.userRepository.patchUpsert(userId, patch, existing.toRow());
			updated('placeholder', p.user_id);
			save();
		}
	}

	const personaTags = (tags: PlanPersona['tags']): Array<PersonaTag> =>
		tags.map((t) => ({...(t.prefix ? {prefix: t.prefix} : {}), ...(t.suffix ? {suffix: t.suffix} : {})}));
	for (const p of plan.personas) {
		const userId = id<UserID>(p.user_id);
		const personaId = id<PersonaID>(p.persona_id);
		const found = await deps.personaRepository.findById(userId, personaId, {includeDeleted: true});
		const prev = previous.personas?.[p.persona_id];
		if (!found) {
			if (prev) {
				keep('persona deleted on Tyne');
				continue;
			}
			const avatarHash = p.avatar ? await uploadAvatar(userId, p.avatar) : null;
			if (!dryRun) {
				await deps.personaRepository.create({
					user_id: userId,
					persona_id: personaId,
					name: p.name,
					avatar_hash: avatarHash,
					persona_tags: personaTags(p.tags),
					visibility: 'unlisted',
				});
				if (p.deleted) await deps.personaRepository.delete(userId, personaId);
			}
			ledger.personas.push({user_id: p.user_id, persona_id: p.persona_id});
			ledger.hashes.persona[p.persona_id] = avatarHash;
			save();
			continue;
		}
		if (!prev) {
			ledger.skipped_existing++;
			continue;
		}
		const merge = mergeFields(
			{name: prev.name, persona_tags: personaTags(prev.tags), deleted: prev.deleted},
			{name: found.name, persona_tags: found.personaTags, deleted: found.isDeleted},
			{name: p.name, persona_tags: personaTags(p.tags), deleted: p.deleted},
			['name', 'persona_tags', 'deleted'],
		);
		for (const field of merge.kept) keep(`persona ${field}`);
		const params: {name?: string; persona_tags?: Array<PersonaTag>; avatar_hash?: string | null} = {};
		if (merge.patch.name !== undefined) params.name = merge.patch.name;
		if (merge.patch.persona_tags !== undefined) params.persona_tags = merge.patch.persona_tags;
		if ((prev.avatar?.path ?? null) !== (p.avatar?.path ?? null)) {
			if (prev._avatar_hash !== undefined && found.avatarHash === prev._avatar_hash) {
				params.avatar_hash = p.avatar ? await uploadAvatar(userId, p.avatar) : null;
				ledger.hashes.persona[p.persona_id] = params.avatar_hash;
			} else keep('persona avatar');
		}
		if (!Object.keys(params).length && merge.patch.deleted === undefined) continue;
		if (!dryRun) {
			if (merge.patch.deleted === false) {
				await deps.personaRepository.writeImport(userId, {retire: [], steps: [{restore: found, params}]});
			} else if (found.isDeleted) {
				await deps.personaRepository.writeImport(userId, {retire: [], steps: [{update: found, params}]});
			} else {
				if (Object.keys(params).length) await deps.personaRepository.update(userId, personaId, params);
				if (merge.patch.deleted === true) await deps.personaRepository.delete(userId, personaId);
			}
		}
		updated('persona', p.persona_id);
		save();
	}

	for (const e of plan.emoji) {
		const file = e.file;
		if (!file) {
			Logger.warn({emoji: e.name}, 'emoji has no image in the export; skipped');
			continue;
		}
		const prev = previous.emoji?.[e.emoji_id];
		const uploadImage = async () => {
			const guild = e.guild_id ? await deps.guildRepository.findUnique(id<GuildID>(e.guild_id)) : null;
			const {imageBuffer} = await deps.avatarService.processEmoji({
				errorPath: 'image',
				base64Image: readBase64(file),
				guildFeatures: guild ? [...guild.features] : [],
			});
			if (!dryRun) await deps.avatarService.uploadEmoji({prefix: 'emojis', emojiId: BigInt(e.emoji_id), imageBuffer});
			ledger.storage_keys.push(`emojis/${e.emoji_id}`);
		};
		if (!e.guild_id) {
			// Stored only for the messages that show it, in no community: Tyne has no row to check.
			if (prev && prev.file?.path === file.path) {
				ledger.skipped_existing++;
				continue;
			}
			await uploadImage();
			if (prev) updated('emoji', e.emoji_id);
			else ledger.emoji.push({emoji_id: e.emoji_id, guild_id: null});
			save();
			continue;
		}
		const existing = await deps.guildRepository.getEmojiById(id<EmojiID>(e.emoji_id));
		if (!existing) {
			if (prev) {
				keep('emoji deleted on Tyne');
				continue;
			}
			await uploadImage();
			if (!dryRun)
				await deps.guildRepository.upsertEmoji({
					guild_id: id<GuildID>(e.guild_id),
					emoji_id: id<EmojiID>(e.emoji_id),
					name: e.name,
					creator_id: id<UserID>(plan.operator_user_id),
					animated: e.animated,
					version: 1,
				});
			ledger.emoji.push({emoji_id: e.emoji_id, guild_id: e.guild_id});
			save();
			continue;
		}
		if (!prev) {
			ledger.skipped_existing++;
			continue;
		}
		const merge = mergeFields({name: prev.name}, {name: existing.name}, {name: e.name}, ['name']);
		for (const field of merge.kept) keep(`emoji ${field}`);
		// Nobody can change an emoji's image on Tyne, only its name: a new file always applies.
		const newImage = prev.file?.path !== file.path;
		if (newImage) await uploadImage();
		if (merge.patch.name !== undefined || newImage) {
			if (!dryRun)
				await deps.guildRepository.upsertEmoji({
					...existing.toRow(),
					name: merge.patch.name ?? existing.name,
					animated: e.animated,
				});
			updated('emoji', e.emoji_id);
			save();
		}
	}

	for (const s of plan.stickers) {
		const file = s.file;
		if (!file) {
			Logger.warn({sticker: s.name}, 'sticker has no image in the export; skipped');
			continue;
		}
		const prev = previous.stickers?.[s.sticker_id];
		const uploadImage = async (): Promise<boolean> => {
			const guild = await deps.guildRepository.findUnique(id<GuildID>(s.guild_id));
			const processed = await deps.avatarService.processSticker({
				errorPath: 'image',
				base64Image: readBase64(file),
				guildFeatures: guild ? [...guild.features] : [],
			});
			if (!dryRun)
				await deps.avatarService.uploadSticker({
					prefix: 'stickers',
					stickerId: BigInt(s.sticker_id),
					imageBuffer: processed.imageBuffer,
				});
			ledger.storage_keys.push(`stickers/${s.sticker_id}`);
			return processed.animated;
		};
		const existing = await deps.guildRepository.getStickerById(id<StickerID>(s.sticker_id));
		if (!existing) {
			if (prev) {
				keep('sticker deleted on Tyne');
				continue;
			}
			const animated = await uploadImage();
			if (!dryRun)
				await deps.guildRepository.upsertSticker({
					guild_id: id<GuildID>(s.guild_id),
					sticker_id: id<StickerID>(s.sticker_id),
					name: s.name,
					description: null,
					animated,
					tags: [],
					creator_id: id<UserID>(plan.operator_user_id),
					version: 1,
				});
			ledger.stickers.push({sticker_id: s.sticker_id, guild_id: s.guild_id});
			save();
			continue;
		}
		if (!prev) {
			ledger.skipped_existing++;
			continue;
		}
		const merge = mergeFields({name: prev.name}, {name: existing.name}, {name: s.name}, ['name']);
		for (const field of merge.kept) keep(`sticker ${field}`);
		const newImage = prev.file?.path !== file.path;
		const animated = newImage ? await uploadImage() : existing.animated;
		if (merge.patch.name !== undefined || newImage) {
			if (!dryRun)
				await deps.guildRepository.upsertSticker({
					...existing.toRow(),
					name: merge.patch.name ?? existing.name,
					animated,
				});
			updated('sticker', s.sticker_id);
			save();
		}
	}

	const uploadAttachment = async (a: PlanAttachment): Promise<MessageAttachment> => {
		let body: Uint8Array = readFileSync(join(exportsDir, a.path));
		if (a.content_type.startsWith('image/')) body = (await media.stripImageMetadata(body)) ?? body;
		const key = attachmentKey(channelId, a);
		if (!dryRun) await deps.storageService.uploadObject({bucket: cdn, key, body, contentType: a.content_type});
		ledger.storage_keys.push(key);
		const meta = dryRun
			? null
			: await media.getMetadata({type: 's3', bucket: cdn, key, ...mediaProxyMetadataPolicy('flag')});
		return {
			attachment_id: id<AttachmentID>(a.attachment_id),
			filename: storedFilename(a),
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
		};
	};
	const fetchMessage = (bucket: number, messageId: MessageID) =>
		fetchOne<MessageRow>(FETCH_MESSAGE.bind({channel_id: channelId, bucket, message_id: messageId}));
	const currentReactions = async (bucket: number, messageId: MessageID) =>
		new Set(
			(
				await fetchMany<MessageReactionRow>(
					FETCH_REACTIONS.bind({channel_id: channelId, bucket, message_id: messageId}),
				)
			).map(reactionKey),
		);
	const writeReactions = async (bucket: number, messageId: MessageID, rows: Iterable<ReactionWrite>, at: Date) => {
		for (const r of rows) {
			if (!dryRun)
				await upsertOne(
					MessageReactions.upsertAll({channel_id: channelId, bucket, message_id: messageId, ...r, created_at: at}),
				);
			ledger.reactions++;
		}
	};
	// The attachments of a stored message, and of a plan entry, as ids and stored names.
	const storedFiles = (row: MessageRow) =>
		canonical((row.attachments ?? []).map((a) => ({id: a.attachment_id, filename: a.filename})));
	const plannedFiles = (m: PlanMessage) =>
		canonical(m.attachments.map((a) => ({id: a.attachment_id, filename: storedFilename(a)})));

	// The export's copies of preview media that no longer load from their sites (tyne-chat/tyne#662),
	// stored wherever a preview is written.
	const uploadEmbedMedia = async (embeds: Array<PlanEmbed>) => {
		for (const e of embeds) {
			for (const m of [e.thumbnail, e.image, e.video]) {
				const key = m ? ownedMediaKey(channelId, m) : null;
				if (!m?.local || !key) continue;
				let body: Uint8Array = readFileSync(join(exportsDir, m.local.path));
				if ((m.content_type ?? '').startsWith('image/')) body = (await media.stripImageMetadata(body)) ?? body;
				if (!dryRun)
					await deps.storageService.uploadObject({
						bucket: cdn,
						key,
						body,
						contentType: m.content_type ?? 'application/octet-stream',
					});
				ledger.storage_keys.push(key);
			}
		}
	};
	// A forward's copy, its files uploaded, or reused from the stored copy where they did not change.
	const buildSnapshot = async (
		s: PlanSnapshot,
		stored?: MessageSnapshot | null,
		before?: PlanSnapshot | null,
	): Promise<MessageSnapshot> => {
		const have = new Map((stored?.attachments ?? []).map((a) => [a.attachment_id.toString(), a]));
		const old = new Map((before?.attachments ?? []).map((a) => [a.attachment_id, a]));
		const attachments: Array<MessageAttachment> = [];
		for (const a of s.attachments) {
			const o = old.get(a.attachment_id);
			const unchanged =
				o && o.path === a.path && storedFilename(o) === storedFilename(a) ? have.get(a.attachment_id) : undefined;
			attachments.push(unchanged ?? (await uploadAttachment(a)));
		}
		await uploadEmbedMedia(s.embeds);
		return {
			content: s.content,
			timestamp: new Date(s.timestamp),
			edited_timestamp: s.edited_timestamp ? new Date(s.edited_timestamp) : null,
			mention_users: s.mention_user_ids.length ? new Set(s.mention_user_ids.map((u) => id<UserID>(u))) : null,
			mention_roles: null,
			mention_channels: null,
			attachments: attachments.length ? attachments : null,
			embeds: s.embeds.length ? s.embeds.map((e) => toEmbed(e, channelId)) : null,
			sticker_items: null,
			type: 0,
			flags: 0,
		};
	};

	// Command chips, recorded as the send path records a server command's use. A command named like one of
	// the community's own takes that one's id, so its chip works like theirs; otherwise the plan's id, which
	// no command has, so the chip shows the name as a deleted command's does.
	const commands = getGuildCommandRepository();
	const commandNames = new Map<string, Promise<Map<string, bigint>>>();
	const commandId = async (c: NonNullable<PlanMessage['command']>): Promise<bigint> => {
		let names = commandNames.get(c.guild_id);
		if (!names) {
			names = commands
				.listByGuild(id<GuildID>(c.guild_id))
				.then((rows) => new Map(rows.map((row) => [row.name, row.command_id])));
			commandNames.set(c.guild_id, names);
		}
		return (await names).get(c.name) ?? BigInt(c.command_id);
	};
	const recordCommand = async (m: PlanMessage, messageId: MessageID) => {
		if (!m.command || dryRun) return;
		await commands.recordUse({
			channel_id: channelId,
			message_id: messageId,
			guild_id: id<GuildID>(m.command.guild_id),
			command_id: await commandId(m.command),
			command_name: m.command.name,
			created_at: new Date(m.timestamp),
		});
	};

	let minBucket = BucketUtils.makeBucket(channelId);
	let n = 0;
	for (const m of plan.messages) {
		const messageId = id<MessageID>(m.message_id);
		const bucket = BucketUtils.makeBucket(messageId);
		minBucket = Math.min(minBucket, bucket);
		if (++n % 100 === 0) {
			save();
			console.log(`${n} of ${plan.messages.length} messages`);
		}
		const row = await fetchMessage(bucket, messageId);
		const prev = previous.messages?.[m.message_id];
		if (!row) {
			if (prev) {
				keep('message deleted on Tyne');
				continue;
			}
			const attachments: Array<MessageAttachment> = [];
			for (const a of m.attachments) attachments.push(await uploadAttachment(a));
			await uploadEmbedMedia(m.embeds);
			const snapshots = m.snapshot ? [await buildSnapshot(m.snapshot)] : null;
			if (!dryRun)
				await deps.channelRepository.messages.upsertMessage({
					channel_id: channelId,
					bucket,
					message_id: messageId,
					...messageFields(m, channelId),
					webhook_id: null,
					webhook_name: null,
					webhook_avatar_hash: null,
					flags: 0,
					mention_roles: null,
					mention_channels: null,
					attachments: attachments.length ? attachments : null,
					message_snapshots: snapshots,
					call: null,
					has_reaction: m.reactions.length > 0,
					version: 1,
				});
			await writeReactions(bucket, messageId, planReactions(m).values(), new Date(m.timestamp));
			await recordCommand(m, messageId);
			ledger.messages.push(m.message_id);
			continue;
		}
		if (!prev) {
			ledger.skipped_existing++;
			continue;
		}

		// Imported before: bring it up to date, keeping what people changed on Tyne since.
		const merge = mergeFields(
			messageFields(prev, channelId),
			rowFields(row),
			messageFields(m, channelId),
			MESSAGE_FIELDS,
		);
		for (const field of merge.kept) keep(`message ${field}`);
		const next: MessageRow = {...row, ...merge.patch};
		let changed = Object.keys(merge.patch).length > 0;
		if (merge.patch.embeds !== undefined) await uploadEmbedMedia(m.embeds);
		if (snapshotSource(prev.snapshot, channelId) !== snapshotSource(m.snapshot, channelId)) {
			if (storedSnapshot(row) === plannedSnapshot(prev.snapshot, channelId)) {
				next.message_snapshots = m.snapshot
					? [await buildSnapshot(m.snapshot, row.message_snapshots?.[0], prev.snapshot)]
					: null;
				changed = true;
			} else keep('message forwarded content');
		}
		if (attachmentIdentity(prev.attachments) !== attachmentIdentity(m.attachments)) {
			if (storedFiles(row) === plannedFiles(prev)) {
				const stored = new Map((row.attachments ?? []).map((a) => [a.attachment_id.toString(), a]));
				const before = new Map(prev.attachments.map((a) => [a.attachment_id, a]));
				const rebuilt: Array<MessageAttachment> = [];
				for (const a of m.attachments) {
					const old = before.get(a.attachment_id);
					const unchanged =
						old && old.path === a.path && storedFilename(old) === storedFilename(a)
							? stored.get(a.attachment_id)
							: undefined;
					rebuilt.push(unchanged ?? (await uploadAttachment(a)));
				}
				const keys = new Set(m.attachments.map((a) => attachmentKey(channelId, a)));
				for (const a of prev.attachments) {
					const key = attachmentKey(channelId, a);
					if (!keys.has(key) && !dryRun) await deps.storageService.deleteObject(cdn, key);
				}
				next.attachments = rebuilt.length ? rebuilt : null;
				changed = true;
			} else keep('message attachments');
		}
		const wrote = planReactions(prev);
		const want = planReactions(m);
		if (canonical([...wrote.keys()].sort()) !== canonical([...want.keys()].sort())) {
			const {add, remove} = mergeSets(
				new Set(wrote.keys()),
				await currentReactions(bucket, messageId),
				new Set(want.keys()),
			);
			for (const key of remove) {
				const r = wrote.get(key) as ReactionWrite;
				if (!dryRun)
					await deleteOneOrMany(
						MessageReactions.deleteByPk({
							channel_id: channelId,
							bucket,
							message_id: messageId,
							emoji_id: r.emoji_id,
							emoji_name: r.emoji_name,
							user_id: r.user_id,
							persona_id: r.persona_id,
						}),
					);
			}
			await writeReactions(
				bucket,
				messageId,
				add.map((key) => want.get(key) as ReactionWrite),
				new Date(m.timestamp),
			);
			if (add.length && !row.has_reaction) {
				next.has_reaction = true;
				changed = true;
			}
			if (add.length || remove.length) updated('message', m.message_id);
		}
		// The chip, unless it changed on Tyne since (an edit to the text drops it).
		if ((prev.command?.name ?? null) !== (m.command?.name ?? null)) {
			const current = (await commands.findUses(channelId, [messageId]))[0]?.command_name ?? null;
			if (current !== (prev.command?.name ?? null)) keep('message command');
			else {
				if (current !== null && !dryRun) await commands.deleteUse(channelId, messageId);
				await recordCommand(m, messageId);
				updated('message', m.message_id);
			}
		}
		if (changed) {
			if (!dryRun) {
				// The repository indexes the new author; the old one's index row goes here.
				if (merge.patch.author_id !== undefined && row.author_id)
					await deleteOneOrMany(MessagesByAuthorV2.deleteByPk({author_id: row.author_id, message_id: messageId}));
				await deps.channelRepository.messages.upsertMessage(next, row);
			}
			updated('message', m.message_id);
		}
	}

	// Messages an earlier import wrote here that the plan no longer has: removed with everything that
	// goes with them, unless someone changed them on Tyne (edited, reacted, pinned...).
	const removable: Array<MessageID> = [];
	for (const prev of plan.remove ?? []) {
		const messageId = id<MessageID>(prev.message_id);
		const bucket = BucketUtils.makeBucket(messageId);
		const row = await fetchMessage(bucket, messageId);
		if (!row) continue;
		const wrote = planReactions(prev);
		const theirs = [...(await currentReactions(bucket, messageId))].some((key) => !wrote.has(key));
		if (
			theirs ||
			storedFiles(row) !== plannedFiles(prev) ||
			changedSince(messageFields(prev, channelId), rowFields(row), MESSAGE_FIELDS)
		) {
			keep('message no longer planned, kept: changed on Tyne');
			continue;
		}
		removable.push(messageId);
	}
	if (removable.length && !dryRun) {
		const messages = await Promise.all(
			removable.map((messageId) => deps.channelRepository.messages.getMessage(channelId, messageId)),
		);
		await deps.channelRepository.messages.bulkDeleteMessages(channelId, removable);
		for (const message of messages) {
			if (message) await purgeMessageAttachments(message, deps.storageService, deps.purgeQueue);
		}
		await getMessageSearchService()?.deleteMessages(removable);
	}
	ledger.removed.message.push(...removable.map((messageId) => messageId.toString()));
	save();

	// A plan with no messages (emoji or stickers only) leaves the channel alone.
	if (plan.messages.length > 0 && !dryRun) {
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
	// Last, so a gateway that cannot be reached fails the run only after everything is written;
	// applying the plan again sends the lists again (tyne-chat/tyne#660).
	if (!dryRun) {
		const sent = await sendExpressionLists(plan, deps);
		console.log(
			`sent the emoji list of ${sent.emoji.length} and the sticker list of ${sent.stickers.length} communities to the gateway`,
		);
	}
	ledger.finished_at = new Date().toISOString();
	save();
	const count = (kind: Kind) => ledger.updated[kind].length;
	console.log(
		`done${dryRun ? ' (dry run: nothing written)' : ''}: created ${ledger.messages.length} messages, ` +
			`${ledger.reactions} reactions, ${ledger.placeholders.length} placeholders, ${ledger.personas.length} personas, ` +
			`${ledger.emoji.length} emoji, ${ledger.stickers.length} stickers; updated ${count('message')} messages, ` +
			`${count('placeholder')} placeholders, ${count('persona')} personas, ${count('emoji')} emoji, ` +
			`${count('sticker')} stickers; removed ${ledger.removed.message.length} messages; ` +
			`skipped ${ledger.skipped_existing} already there; kept from Tyne: ${JSON.stringify(ledger.kept)}`,
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
