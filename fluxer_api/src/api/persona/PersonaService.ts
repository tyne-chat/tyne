// SPDX-License-Identifier: AGPL-3.0-or-later

import {ContentBlockedError} from '@fluxer/errors/src/domains/content/ContentBlockedError';
import type {
	ChannelPersonaMentionItem,
	PersonaChannelState,
	PersonaChannelStatesResponse,
	PersonaCreateRequest,
	PersonaImportImageSources,
	PersonaImportItem,
	PersonaSettingsResponse,
	PersonaSettingsUpdateRequest,
	PersonaTag,
	PersonaUpdateRequest,
	PersonaVisibility,
	PublicPersonaListResponse,
	PublicPersonaResponse,
	SignatureEmoji,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {MAX_SIGNATURE_EMOJIS_PER_PERSONA} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	PersonaImportAction,
	PersonaImportApplyRequest,
	PersonaImportApplyResponse,
	PersonaImportPreviewRequest,
	PersonaImportPreviewResponse,
	PersonaRestoreResponse,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import type {PersonaLookupItem} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {ownTyneMediaImageHash} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import {type ChannelID, createPersonaID, type PersonaID, type UserID} from '../BrandedTypes';
import {Config} from '../Config';
import {SYSTEM_USER_ID} from '../constants/Core';
import type {UserPersonaSettingsRow} from '../database/types/PersonaTypes';
import type {IGatewayService} from '../infrastructure/IGatewayService';
import {profileSubstringBlocklistCache} from '../middleware/ProfileSubstringBlocklistCache';
import type {Persona} from '../models/Persona';
import type {UserGuildRepository} from '../user/repositories/account/UserGuildRepository';
import type {UserChannelRepository} from '../user/repositories/UserChannelRepository';
import type {UserAccountLookupService} from '../user/services/UserAccountLookupService';
import {isProfileSubstringExempt} from '../user/UserHelpers';
import {
	DuplicatePersonaTagError,
	DuplicateSignatureEmojiError,
	PersonaImportConflictError,
	PersonaLimitReachedError,
	PersonaNotFoundError,
	PersonaPrivateError,
	PersonaTagLimitExceededError,
	SignatureEmojiLimitExceededError,
} from './errors/PersonaErrors';
import type {
	CreatePersonaParams,
	IPersonaRepository,
	PersonaImportStep,
	UpdatePersonaParams,
} from './IPersonaRepository';
import {
	forgetPersonaChannelState,
	forgetPersonaChannelStatesOfPersona,
	forgetPersonaChannelStateWrite,
	loadPersonaChannelStates,
	storePersonaChannelState,
} from './PersonaChannelStateStore';
import {loadPersonaImageSources, personaImageSourcesWrite} from './PersonaImageSourceStore';
import {planPersonaImport} from './PersonaImportPlanner';
import {formatTagDisplay, getTagKey, normalizeTag} from './PersonaTagKeys';

export const MAX_PERSONAS_PER_USER = 250;

export interface PersonaServiceDeps {
	personaRepository: IPersonaRepository;
	userAccountLookupService?: UserAccountLookupService;
	gatewayService?: IGatewayService;
	userGuildRepository?: UserGuildRepository;
	userChannelRepository?: UserChannelRepository;
}

export function calculatePersonaFrecencyScore(
	useCount: number,
	lastUsedAtMs: bigint | number | null | undefined,
	now: number = Date.now(),
): number {
	const safeCount = Math.max(0, useCount || 0);
	const countScore = Math.log10(safeCount + 1) * 20;

	const ms = typeof lastUsedAtMs === 'bigint' ? Number(lastUsedAtMs) : (lastUsedAtMs ?? null);
	if (!ms || ms <= 0) {
		return countScore;
	}

	const ageMs = Math.max(0, now - ms);
	const ageHours = ageMs / (1000 * 60 * 60);

	let recencyBoost = 0;
	if (ageHours < 0.25) {
		recencyBoost = 120;
	} else if (ageHours < 1) {
		recencyBoost = 90;
	} else if (ageHours < 24) {
		recencyBoost = 60;
	} else if (ageHours < 72) {
		recencyBoost = 35;
	} else if (ageHours < 168) {
		recencyBoost = 15;
	} else if (ageHours < 720) {
		recencyBoost = 5;
	}

	return countScore + recencyBoost;
}

export function calculatePersonaMatchScore(
	personaName: string,
	query: string,
	displayTagText?: string | null,
	ownerUsername?: string | null,
	ownerNickname?: string | null,
	ownerGlobalName?: string | null,
): number {
	const q = query.trim().toLowerCase();
	if (!q) return 0;

	const name = personaName.toLowerCase();
	if (name.startsWith(q)) {
		return 1000;
	}
	if (name.includes(` ${q}`) || name.includes(`-${q}`) || name.includes(`_${q}`)) {
		return 800;
	}
	if (name.includes(q)) {
		return 500;
	}
	const tag = (displayTagText ?? '').toLowerCase();
	if (tag.startsWith(q)) {
		return 350;
	}
	if (tag.includes(q)) {
		return 250;
	}
	const user = (ownerUsername ?? '').toLowerCase();
	const nick = (ownerNickname ?? '').toLowerCase();
	const global = (ownerGlobalName ?? '').toLowerCase();
	if (user.startsWith(q) || nick.startsWith(q) || global.startsWith(q)) {
		return 150;
	}
	if (user.includes(q) || nick.includes(q) || global.includes(q)) {
		return 100;
	}
	return -1;
}

/** A persona field checked against the admin profile blocklist, with the blocklist scope it falls under. */
type PersonaProfileText = ['global_name' | 'bio' | 'pronouns', string | null | undefined];

/**
 * The persona fields a request changes. A value that is already stored stays allowed, so a word banned
 * later does not stop the persona's other fields from being edited.
 */
function changedProfileText(
	existing: Persona,
	data: {name?: string | null; bio?: string | null; pronouns?: string | null},
): Array<PersonaProfileText> {
	const fields: Array<PersonaProfileText> = [];
	if (data.name != null && data.name !== existing.name) fields.push(['global_name', data.name]);
	if (data.bio != null && data.bio !== existing.bio) fields.push(['bio', data.bio]);
	if (data.pronouns != null && data.pronouns !== existing.pronouns) fields.push(['pronouns', data.pronouns]);
	return fields;
}

function personaSettingsResponse(row: UserPersonaSettingsRow): PersonaSettingsResponse {
	return {
		user_id: row.user_id.toString(),
		active_persona_mode: (row.active_persona_mode as 'manual' | 'last') === 'last' ? 'last' : 'manual',
		active_persona_scope: row.active_persona_scope === 'channel' ? 'channel' : 'global',
		active_persona_id: row.active_persona_id ? row.active_persona_id.toString() : null,
		is_latched: Boolean(row.is_latched),
		display_tag_text: row.display_tag_text ?? '',
		display_tag_icon: row.display_tag_icon ?? null,
		multi_persona_reactions: row.multi_persona_reactions !== false,
	};
}

export class PersonaService {
	constructor(private readonly deps: PersonaServiceDeps) {}

	private async validatePersonaTags(
		userId: UserID,
		tags: Array<PersonaTag> | undefined,
		currentPersonaId?: PersonaID,
	): Promise<void> {
		if (!tags || tags.length === 0) return;

		if (tags.length > 5) {
			throw new PersonaTagLimitExceededError(5);
		}

		// 1. Check for duplicates within the same persona
		const seenInRequest = new Set<string>();
		const normalizedTags = tags.map(normalizeTag).filter((t) => t.prefix || t.suffix);

		for (const tag of normalizedTags) {
			const key = getTagKey(tag);
			if (seenInRequest.has(key)) {
				throw new DuplicatePersonaTagError(
					`Duplicate tag pair '${formatTagDisplay(tag)}' cannot be listed multiple times on the same persona`,
				);
			}
			seenInRequest.add(key);
		}

		// 2. Check for collisions across all other personas owned by this user
		const userPersonas = await this.deps.personaRepository.findByUserId(userId);
		for (const otherPersona of userPersonas) {
			if (currentPersonaId && otherPersona.id.toString() === currentPersonaId.toString()) {
				continue;
			}
			for (const otherTag of otherPersona.personaTags) {
				const normOther = normalizeTag(otherTag);
				if (!normOther.prefix && !normOther.suffix) continue;
				const key = getTagKey(normOther);
				if (seenInRequest.has(key)) {
					throw new DuplicatePersonaTagError(
						`Tag pair '${formatTagDisplay(normOther)}' is already in use by persona '${otherPersona.name}'`,
					);
				}
			}
		}
	}

	/**
	 * Rejects persona text containing a substring an admin banned from profiles, as upstream does for an
	 * account's names, bio and pronouns. Accounts exempt there are exempt here; the account is only looked
	 * up when something matches.
	 */
	private async assertProfileTextAllowed(userId: UserID, fields: Array<PersonaProfileText>): Promise<void> {
		const blocked = fields.some(
			([scope, text]) => !!text && profileSubstringBlocklistCache.containsBannedSubstring(scope, text),
		);
		if (!blocked) return;
		const user = await this.deps.userAccountLookupService?.findUnique(userId);
		if (user && isProfileSubstringExempt(user)) return;
		throw new ContentBlockedError();
	}

	private async validateSignatureEmojis(
		userId: UserID,
		emojis: Array<SignatureEmoji> | undefined,
		currentPersonaId?: PersonaID,
	): Promise<void> {
		if (!emojis || emojis.length === 0) return;

		if (emojis.length > MAX_SIGNATURE_EMOJIS_PER_PERSONA) {
			throw new SignatureEmojiLimitExceededError(MAX_SIGNATURE_EMOJIS_PER_PERSONA);
		}

		const getEmojiKey = (emoji: SignatureEmoji): string => {
			return emoji.id ? `custom:${emoji.id}` : `unicode:${emoji.name}`;
		};

		// 1. Check duplicates within the request
		const seenInRequest = new Set<string>();
		for (const emoji of emojis) {
			const key = getEmojiKey(emoji);
			if (seenInRequest.has(key)) {
				throw new DuplicateSignatureEmojiError(
					`Signature emoji '${emoji.name}' cannot be listed multiple times on the same persona`,
				);
			}
			seenInRequest.add(key);
		}

		// 2. Check collision across other personas owned by this user
		const userPersonas = await this.deps.personaRepository.findByUserId(userId);
		for (const otherPersona of userPersonas) {
			if (currentPersonaId && otherPersona.id.toString() === currentPersonaId.toString()) {
				continue;
			}
			for (const otherEmoji of otherPersona.signatureEmojis) {
				const key = getEmojiKey(otherEmoji);
				if (seenInRequest.has(key)) {
					throw new DuplicateSignatureEmojiError(
						`Signature emoji '${otherEmoji.name}' is already assigned to persona '${otherPersona.name}'`,
					);
				}
			}
		}
	}

	async getPersonas(userId: UserID): Promise<Array<Persona>> {
		return await this.deps.personaRepository.findByUserId(userId);
	}

	async getPersona(userId: UserID, personaId: PersonaID): Promise<Persona> {
		const persona = await this.deps.personaRepository.findById(userId, personaId);
		if (!persona) {
			throw new PersonaNotFoundError();
		}
		return persona;
	}

	async createPersona(userId: UserID, data: PersonaCreateRequest): Promise<Persona> {
		const currentCount = await this.deps.personaRepository.count(userId);
		if (currentCount >= MAX_PERSONAS_PER_USER) {
			throw new PersonaLimitReachedError(MAX_PERSONAS_PER_USER);
		}

		if (data.persona_tags) {
			await this.validatePersonaTags(userId, data.persona_tags);
		}
		if (data.signature_emojis) {
			await this.validateSignatureEmojis(userId, data.signature_emojis);
		}
		await this.assertProfileTextAllowed(userId, [
			['global_name', data.name],
			['bio', data.bio],
			['pronouns', data.pronouns],
		]);

		const persona = await this.deps.personaRepository.create({
			user_id: userId,
			name: data.name,
			avatar_hash: data.avatar_hash,
			banner_hash: data.banner_hash,
			pronouns: data.pronouns,
			color: data.color,
			avatar_color: data.avatar_color,
			bio: data.bio,
			auto_tag_disabled: data.auto_tag_disabled,
			persona_tags: data.persona_tags,
			signature_emojis: data.signature_emojis,
			visibility: data.visibility ?? 'unlisted',
			external_uuid: data.external_uuid,
		});

		await this.dispatchToUser(userId, 'USER_PERSONA_CREATE', {
			persona: {...persona.toResponse(), user_id: userId.toString()},
		});
		if (persona.visibility === 'public' || persona.visibility === 'unlisted') {
			await this.dispatchToMutualGuilds(userId, persona, 'update');
		}
		return persona;
	}

	async updatePersona(userId: UserID, personaId: PersonaID, data: PersonaUpdateRequest): Promise<Persona> {
		if (data.persona_tags !== undefined) {
			await this.validatePersonaTags(userId, data.persona_tags, personaId);
		}
		if (data.signature_emojis !== undefined) {
			await this.validateSignatureEmojis(userId, data.signature_emojis, personaId);
		}

		const existing = await this.deps.personaRepository.findById(userId, personaId);
		if (!existing) {
			throw new PersonaNotFoundError();
		}
		await this.assertProfileTextAllowed(userId, changedProfileText(existing, data));

		const updated = await this.deps.personaRepository.update(userId, personaId, {
			name: data.name,
			avatar_hash: data.avatar_hash,
			banner_hash: data.banner_hash,
			pronouns: data.pronouns,
			color: data.color,
			avatar_color: data.avatar_color,
			bio: data.bio,
			auto_tag_disabled: data.auto_tag_disabled,
			persona_tags: data.persona_tags,
			signature_emojis: data.signature_emojis,
			visibility: data.visibility,
			external_uuid: data.external_uuid,
		});
		if (!updated) {
			throw new PersonaNotFoundError();
		}

		await this.dispatchToUser(userId, 'USER_PERSONA_UPDATE', {
			persona: {...updated.toResponse(), user_id: userId.toString()},
		});

		await this.dispatchToMutualGuilds(userId, updated, 'update');
		return updated;
	}

	async deletePersona(userId: UserID, personaId: PersonaID): Promise<void> {
		const existing = await this.deps.personaRepository.findById(userId, personaId);
		if (!existing) {
			throw new PersonaNotFoundError();
		}

		const deleted = await this.deps.personaRepository.delete(userId, personaId);
		if (!deleted) {
			throw new PersonaNotFoundError();
		}
		// The image sources stay: a restored persona still knows where its pictures came from, so the
		// next import compares them instead of listing the persona as changed (tyne-chat/tyne#243).

		await this.dispatchToUser(userId, 'USER_PERSONA_DELETE', {
			persona_id: personaId.toString(),
			user_id: userId.toString(),
		});

		const settings = await this.deps.personaRepository.findSettings(userId);
		if (settings?.active_persona_id && settings.active_persona_id.toString() === personaId.toString()) {
			const updatedSettingsRow: UserPersonaSettingsRow = {
				...settings,
				active_persona_id: null,
				is_latched: false,
				updated_at: new Date(),
				version: (settings.version ?? 0) + 1,
			};
			await this.deps.personaRepository.upsertSettings(updatedSettingsRow);
			await this.dispatchToUser(userId, 'USER_PERSONA_SETTINGS_UPDATE', personaSettingsResponse(updatedSettingsRow));
		}

		// The channels that had this persona selected go back to the account.
		const clearedChannelIds = await forgetPersonaChannelStatesOfPersona(userId, personaId);
		for (const channelId of clearedChannelIds) {
			await this.dispatchToUser(userId, 'USER_PERSONA_CHANNEL_STATE_UPDATE', {
				channel_id: channelId.toString(),
				persona_id: null,
			} satisfies PersonaChannelState);
		}

		await this.dispatchToMutualGuilds(userId, existing, 'delete');
	}

	/**
	 * Brings in personas from an export file. Everything is checked before anything is written, and the
	 * writes are one atomic batch, so a refused or failed import changes nothing. With `replace`, the
	 * account's live personas are deleted in that same batch, so they are kept unless the import goes
	 * through (tyne-chat/tyne#359).
	 */
	async importPersonas(
		userId: UserID,
		items: Array<PersonaImportItem>,
		options: {replace?: boolean} = {},
	): Promise<Array<Persona>> {
		const livePersonas = await this.deps.personaRepository.findByUserId(userId);
		// Replaced personas take no part in matching or in the checks: once the import is written they
		// are gone, so their tags, signature emojis and places under the cap are free.
		const retired = options.replace ? livePersonas : [];
		const existingPersonas = options.replace ? [] : livePersonas;
		const existingByUuid = new Map<string, Persona>();
		const existingById = new Map<string, Persona>();
		for (const p of existingPersonas) {
			if (p.externalUuid) {
				existingByUuid.set(p.externalUuid, p);
			}
			existingById.set(p.id.toString(), p);
		}
		// An item's external ID is the member ID in the file. A Tyne export writes a persona made in
		// Tyne under its own ID, so re-importing an export updates those personas instead of adding
		// them again.
		const findExisting = (item: PersonaImportItem): Persona | undefined =>
			item.external_uuid ? (existingByUuid.get(item.external_uuid) ?? existingById.get(item.external_uuid)) : undefined;
		const updatedIds = new Set(
			items.map((item) => findExisting(item)?.id.toString()).filter((id): id is string => id !== undefined),
		);

		// Track tags across existing personas (excluding those updated in this batch) + new imported personas
		const usedTags = new Map<string, string>(); // tagKey -> persona name
		for (const existing of existingPersonas) {
			if (updatedIds.has(existing.id.toString())) {
				continue;
			}
			for (const tag of existing.personaTags) {
				const norm = normalizeTag(tag);
				if (norm.prefix || norm.suffix) {
					usedTags.set(getTagKey(norm), existing.name);
				}
			}
		}

		for (const item of items) {
			if (item.persona_tags) {
				if (item.persona_tags.length > 5) {
					throw new PersonaTagLimitExceededError(5);
				}
				const seenInItem = new Set<string>();
				for (const tag of item.persona_tags) {
					const norm = normalizeTag(tag);
					if (!norm.prefix && !norm.suffix) continue;
					const key = getTagKey(norm);
					if (seenInItem.has(key)) {
						throw new DuplicatePersonaTagError(
							`Duplicate tag pair '${formatTagDisplay(norm)}' cannot be listed multiple times on '${item.name}'`,
						);
					}
					seenInItem.add(key);
					if (usedTags.has(key)) {
						throw new DuplicatePersonaTagError(
							`Tag pair '${formatTagDisplay(norm)}' is already in use by persona '${usedTags.get(key)}'`,
						);
					}
					usedTags.set(key, item.name);
				}
			}
		}

		// Signature emojis follow the same rule as on a single persona: each belongs to one persona.
		const signatureEmojiKey = (emoji: SignatureEmoji): string =>
			emoji.id ? `custom:${emoji.id}` : `unicode:${emoji.name}`;
		const usedEmojis = new Map<string, string>();
		for (const existing of existingPersonas) {
			if (updatedIds.has(existing.id.toString())) continue;
			for (const emoji of existing.signatureEmojis) usedEmojis.set(signatureEmojiKey(emoji), existing.name);
		}
		for (const item of items) {
			for (const emoji of item.signature_emojis ?? []) {
				const key = signatureEmojiKey(emoji);
				const owner = usedEmojis.get(key);
				if (owner !== undefined) {
					throw new DuplicateSignatureEmojiError(
						`Signature emoji '${emoji.name}' is already assigned to persona '${owner}'`,
					);
				}
				usedEmojis.set(key, item.name);
			}
		}

		await this.assertProfileTextAllowed(
			userId,
			items.flatMap((item) => {
				const existing = findExisting(item);
				return existing
					? changedProfileText(existing, item)
					: ([
							['global_name', item.name],
							['bio', item.bio],
							['pronouns', item.pronouns],
						] satisfies Array<PersonaProfileText>);
			}),
		);

		const steps: Array<PersonaImportStep> = items.map((item) => {
			const existing = findExisting(item);
			if (existing) {
				return {
					update: existing,
					params: {
						name: item.name,
						avatar_hash: item.avatar_hash,
						banner_hash: item.banner_hash,
						pronouns: item.pronouns,
						color: item.color,
						avatar_color: item.avatar_color,
						bio: item.bio,
						auto_tag_disabled: item.auto_tag_disabled,
						persona_tags: item.persona_tags,
						signature_emojis: item.signature_emojis,
						visibility: item.visibility ?? existing.visibility,
						external_uuid:
							existing.externalUuid ?? (item.external_uuid === existing.id.toString() ? null : item.external_uuid),
					},
				};
			}
			return {
				create: {
					user_id: userId,
					name: item.name,
					avatar_hash: item.avatar_hash,
					banner_hash: item.banner_hash,
					pronouns: item.pronouns,
					color: item.color,
					avatar_color: item.avatar_color,
					bio: item.bio,
					auto_tag_disabled: item.auto_tag_disabled,
					persona_tags: item.persona_tags,
					signature_emojis: item.signature_emojis,
					visibility: item.visibility ?? 'unlisted',
					external_uuid: item.external_uuid,
				},
			};
		});
		const createdCount = steps.filter((step) => 'create' in step).length;
		if (existingPersonas.length + createdCount > MAX_PERSONAS_PER_USER) {
			throw new PersonaLimitReachedError(MAX_PERSONAS_PER_USER);
		}

		const {settings, clearedChannelIds} = await this.planRetirement(userId, retired);

		const results = await this.deps.personaRepository.writeImport(userId, {
			retire: retired,
			steps,
			settings,
			alongside: (written) => [
				...written.flatMap((persona, i) => {
					const sources = items[i]?.image_sources;
					return sources === undefined ? [] : [personaImageSourcesWrite(userId, persona, sources)];
				}),
				...clearedChannelIds.map((channelId) => forgetPersonaChannelStateWrite(userId, channelId)),
			],
		});

		await this.dispatchListToOwnSessions(userId, settings, clearedChannelIds);
		// One refresh for everyone who sees this account, also for the replaced personas, whatever
		// their visibility, as a deletion of each would have sent.
		if (retired.length > 0 || results.some((p) => p.visibility === 'public' || p.visibility === 'unlisted')) {
			await this.dispatchToMutualGuilds(userId);
		}

		return results;
	}

	/**
	 * Gives many of the account's personas a new visibility at once (tyne-chat/tyne#542): every
	 * persona named must be the caller's and live, or nothing changes. One atomic write, the whole
	 * list to the account's own sessions, and one refresh for everyone who sees the account, where
	 * saving each persona would send one request and one refresh per persona. A persona named twice
	 * takes its last visibility; one that already has it is left as it is. Returns the personas changed.
	 */
	async setPersonaVisibilities(
		userId: UserID,
		changes: ReadonlyArray<{personaId: PersonaID; visibility: PersonaVisibility}>,
	): Promise<Array<Persona>> {
		const live = await this.liveByIds(
			userId,
			changes.map((c) => c.personaId),
		);
		const wanted = new Map(changes.map((c) => [c.personaId.toString(), c.visibility]));
		const steps = Array.from(wanted, ([id, visibility]) => ({persona: live.get(id)!, visibility}))
			.filter(({persona, visibility}) => persona.visibility !== visibility)
			.map(({persona, visibility}) => ({update: persona, params: {visibility}}));
		if (steps.length === 0) return [];
		const results = await this.deps.personaRepository.writeImport(userId, {retire: [], steps});
		await this.dispatchListToOwnSessions(userId);
		await this.dispatchToMutualGuilds(userId);
		return results;
	}

	/**
	 * Deletes many of the account's personas at once (tyne-chat/tyne#542), as deleting each would:
	 * soft-deleted (their messages keep showing them) and the selection and channel selections that
	 * named them cleared, in one atomic write. Their image sources stay, for a restore. Every persona
	 * named must be the caller's and live, or nothing changes.
	 */
	async deletePersonas(userId: UserID, personaIds: ReadonlyArray<PersonaID>): Promise<void> {
		const retired = Array.from((await this.liveByIds(userId, personaIds)).values());
		const {settings, clearedChannelIds} = await this.planRetirement(userId, retired);
		await this.deps.personaRepository.writeImport(userId, {
			retire: retired,
			steps: [],
			settings,
			alongside: () => clearedChannelIds.map((channelId) => forgetPersonaChannelStateWrite(userId, channelId)),
		});
		await this.dispatchListToOwnSessions(userId, settings, clearedChannelIds);
		await this.dispatchToMutualGuilds(userId);
	}

	/**
	 * Classifies every member of an import file against the account's personas, deleted ones
	 * included, and changes nothing (tyne-chat/tyne#243). The rules are in `PersonaImportPlanner`.
	 */
	async previewImport(userId: UserID, request: PersonaImportPreviewRequest): Promise<PersonaImportPreviewResponse> {
		const all = await this.deps.personaRepository.findByUserId(userId, {includeDeleted: true});
		const live = all.filter((p) => !p.isDeleted);
		const deleted = all.filter((p) => p.isDeleted);
		const plan = planPersonaImport({
			source: request.source,
			members: request.members,
			live,
			deleted,
			imageSources: await loadPersonaImageSources(userId),
			ownImageHash: (url, kind) => ownTyneMediaImageHash(url, Config.endpoints.media, kind, userId.toString()),
		});

		const settings = await this.deps.personaRepository.findSettings(userId);
		const currentText = settings?.display_tag_text?.trim() || null;
		const fileText = request.display_tag?.text?.trim() || null;
		const fileHasTag = Boolean(fileText || request.display_tag?.has_icon);
		let decision: PersonaImportPreviewResponse['display_tag']['decision'] = 'none';
		if (fileHasTag) {
			if (live.length === 0 && !currentText && !settings?.display_tag_icon) decision = 'auto_apply';
			else if (fileText && fileText !== currentText) decision = 'ask';
		}

		return {
			entries: plan.entries,
			personas: all.filter((p) => plan.referencedIds.has(p.id.toString())).map((p) => p.toResponse()),
			display_tag: {decision, current_text: currentText},
			untouched: plan.untouched,
			needs_review:
				decision === 'ask' || plan.entries.some((entry) => entry.kind !== 'new' && entry.kind !== 'up_to_date'),
		};
	}

	/**
	 * Applies a reviewed import: one explicit action per member, checked against the account as it is
	 * now and written in one atomic batch, so a refused import changes nothing. Nothing is deleted. A
	 * link records the PluralKit id only; a restore brings back the same row, leaving off tags and
	 * signature emojis another persona holds now; `use_file` replaces a persona's details (connecting it
	 * to the member if it was not) but never its visibility, and from a PluralKit file never its
	 * signature emojis or auto-tag setting. Connecting a persona to a member unlinks any other persona
	 * linked to that member.
	 */
	async applyImport(userId: UserID, request: PersonaImportApplyRequest): Promise<PersonaImportApplyResponse> {
		const fromTyne = request.source === 'tyne';
		const all = await this.deps.personaRepository.findByUserId(userId, {includeDeleted: true});
		const byId = new Map(all.map((p) => [p.id.toString(), p] as const));
		const imageSources = await loadPersonaImageSources(userId);
		const targeted = new Set<string>();
		const target = (action: PersonaImportAction, wantDeleted: boolean): Persona => {
			const id = action.persona_id ?? '';
			const persona = byId.get(id);
			if (!persona || persona.isDeleted !== wantDeleted) throw new PersonaNotFoundError();
			if (targeted.has(id)) throw new PersonaImportConflictError(`Persona ${id} is named by more than one action`);
			targeted.add(id);
			return persona;
		};
		// Connecting a persona to a member leaves no other live persona connected to it: any other one
		// (duplicates an older import left, tyne-chat/tyne#571) keeps its details and loses the link,
		// unless an action of its own connects it, which then decides its link (one of two duplicates
		// given to another member).
		const connecting = new Set(
			request.actions.flatMap((action) =>
				(action.action === 'link' || action.action === 'use_file') && action.persona_id ? [action.persona_id] : [],
			),
		);
		const connectedMembers = new Set<string>();
		const unlinkOthers = (persona: Persona, externalId: string) => {
			if (connectedMembers.has(externalId)) {
				throw new PersonaImportConflictError(`More than one action connects member ${externalId}`);
			}
			connectedMembers.add(externalId);
			for (const other of all) {
				if (other.isDeleted || other.id === persona.id) continue;
				if (other.externalUuid !== externalId && other.id.toString() !== externalId) continue;
				const id = other.id.toString();
				if (connecting.has(id) || targeted.has(id)) continue;
				targeted.add(id);
				planned.push({kind: 'update', persona: other, params: {external_uuid: null}});
			}
		};
		const withoutKeys = <T>(values: ReadonlyArray<T>, drop: ReadonlyArray<T>, key: (value: T) => string) => {
			const dropped = new Set(drop.map(key));
			return values.filter((value) => !dropped.has(key(value)));
		};
		const tagKeyOf = (tag: PersonaTag) => getTagKey(normalizeTag(tag));
		const emojiKeyOf = (emoji: SignatureEmoji) => (emoji.id ? `custom:${emoji.id}` : `unicode:${emoji.name}`);

		// The personas as they will be once written, to check tags, emojis and the cap on the end state.
		const finalState = new Map<string, {name: string; tags: Array<PersonaTag>; emojis: Array<SignatureEmoji>}>();
		for (const persona of all) {
			if (!persona.isDeleted) {
				finalState.set(persona.id.toString(), {
					name: persona.name,
					tags: persona.personaTags,
					emojis: persona.signatureEmojis,
				});
			}
		}
		type Planned =
			| {kind: 'create'; params: CreatePersonaParams; sources: PersonaImportImageSources | null | undefined}
			| {kind: 'update'; persona: Persona; params: UpdatePersonaParams; sources?: PersonaImportImageSources | null}
			// With `params`: a deleted persona brought back with the file's details (`use_file` on it).
			| {kind: 'restore'; persona: Persona; params?: UpdatePersonaParams; sources?: PersonaImportImageSources | null};
		const planned: Array<Planned> = [];
		const profileText: Array<PersonaProfileText> = [];
		let created = 0;

		for (const action of request.actions) {
			switch (action.action) {
				case 'add': {
					const item = action.item;
					if (!item) throw new PersonaImportConflictError('An add needs the member');
					const tags = withoutKeys(item.persona_tags ?? [], action.drop_tags ?? [], tagKeyOf);
					const emojis = fromTyne
						? withoutKeys(item.signature_emojis ?? [], action.drop_signature_emojis ?? [], emojiKeyOf)
						: [];
					const key = `new:${created++}`;
					finalState.set(key, {name: item.name, tags, emojis});
					profileText.push(['global_name', item.name], ['bio', item.bio], ['pronouns', item.pronouns]);
					planned.push({
						kind: 'create',
						params: {
							user_id: userId,
							name: item.name,
							avatar_hash: item.avatar_hash,
							banner_hash: item.banner_hash,
							pronouns: item.pronouns,
							color: item.color,
							avatar_color: item.avatar_color,
							bio: item.bio,
							auto_tag_disabled: fromTyne ? item.auto_tag_disabled : undefined,
							persona_tags: tags,
							signature_emojis: emojis,
							visibility: item.visibility ?? 'unlisted',
							external_uuid: item.external_uuid,
						},
						sources: item.image_sources,
					});
					break;
				}
				case 'link': {
					const persona = target(action, false);
					const externalId = action.external_uuid?.trim();
					if (!externalId) throw new PersonaImportConflictError('A link needs the member id');
					unlinkOthers(persona, externalId);
					planned.push({kind: 'update', persona, params: {external_uuid: externalId}});
					break;
				}
				case 'restore': {
					const persona = target(action, true);
					finalState.set(persona.id.toString(), {
						name: persona.name,
						tags: persona.personaTags,
						emojis: persona.signatureEmojis,
					});
					planned.push({kind: 'restore', persona});
					break;
				}
				case 'use_file': {
					// On a deleted persona it brings it back with the file's details (tyne-chat/tyne#574).
					const deleted = byId.get(action.persona_id ?? '')?.isDeleted ?? false;
					const persona = target(action, deleted);
					const item = action.item;
					if (!item) throw new PersonaImportConflictError("Using the file's version needs the member");
					const externalId = item.external_uuid?.trim();
					if (!externalId) throw new PersonaImportConflictError("Using the file's version needs the member id");
					// A persona not yet connected to the member (one the review asked about) is connected by
					// the same write, as a link would.
					const linked = persona.externalUuid === externalId || persona.id.toString() === externalId;
					unlinkOthers(persona, externalId);
					const tags = withoutKeys(item.persona_tags ?? [], action.drop_tags ?? [], tagKeyOf);
					const params: UpdatePersonaParams = {
						name: item.name,
						pronouns: item.pronouns ?? null,
						bio: item.bio ?? null,
						color: item.color ?? null,
						persona_tags: tags,
						...(linked ? {} : {external_uuid: externalId}),
					};
					if (!action.keep_avatar) {
						params.avatar_hash = item.avatar_hash ?? null;
						params.avatar_color = item.avatar_hash ? (item.avatar_color ?? null) : null;
					}
					if (!action.keep_banner) params.banner_hash = item.banner_hash ?? null;
					let emojis = persona.signatureEmojis;
					if (fromTyne) {
						emojis = withoutKeys(item.signature_emojis ?? [], action.drop_signature_emojis ?? [], emojiKeyOf);
						params.signature_emojis = emojis;
						params.auto_tag_disabled = Boolean(item.auto_tag_disabled);
					}
					finalState.set(persona.id.toString(), {name: item.name, tags, emojis});
					profileText.push(...changedProfileText(persona, item));
					// Pictures kept because the file's could not be stored keep their recorded origin too.
					const recorded = imageSources.get(persona.id.toString());
					const recordedAvatar: PersonaImportImageSources['avatar'] = recorded?.avatar_url
						? {
								url: recorded.avatar_url,
								field: recorded.avatar_field === 'webhook_avatar_url' ? 'webhook_avatar_url' : 'avatar_url',
								main_avatar_empty: recorded.avatar_main_empty ?? undefined,
							}
						: null;
					const recordedBanner: PersonaImportImageSources['banner'] = recorded?.banner_url
						? {url: recorded.banner_url}
						: null;
					const sources: PersonaImportImageSources = {
						avatar: action.keep_avatar ? recordedAvatar : (item.image_sources?.avatar ?? null),
						banner: action.keep_banner ? recordedBanner : (item.image_sources?.banner ?? null),
					};
					planned.push(
						deleted ? {kind: 'restore', persona, params, sources} : {kind: 'update', persona, params, sources},
					);
					break;
				}
			}
		}

		// Restored personas give up what another persona holds in the end state.
		const dropped: PersonaImportApplyResponse['dropped'] = [];
		const restoredIds = new Set(
			planned.flatMap((p) => (p.kind === 'restore' && !p.params ? [p.persona.id.toString()] : [])),
		);
		const heldElsewhere = (key: string, own: string, of: 'tags' | 'emojis') => {
			for (const [id, state] of finalState) {
				if (id === own || restoredIds.has(id)) continue;
				const keys = of === 'tags' ? state.tags.map(tagKeyOf) : state.emojis.map(emojiKeyOf);
				if (keys.includes(key)) return true;
			}
			return false;
		};
		const restoreParams = new Map<string, UpdatePersonaParams>();
		const claimedByRestores = {tags: new Set<string>(), emojis: new Set<string>()};
		for (const step of planned) {
			if (step.kind !== 'restore' || step.params) continue;
			const id = step.persona.id.toString();
			const keepTag = (tag: PersonaTag) =>
				!heldElsewhere(tagKeyOf(tag), id, 'tags') && !claimedByRestores.tags.has(tagKeyOf(tag));
			const keepEmoji = (emoji: SignatureEmoji) =>
				!heldElsewhere(emojiKeyOf(emoji), id, 'emojis') && !claimedByRestores.emojis.has(emojiKeyOf(emoji));
			const tags = step.persona.personaTags.filter(keepTag);
			const emojis = step.persona.signatureEmojis.filter(keepEmoji);
			for (const tag of tags) claimedByRestores.tags.add(tagKeyOf(tag));
			for (const emoji of emojis) claimedByRestores.emojis.add(emojiKeyOf(emoji));
			finalState.set(id, {name: step.persona.name, tags, emojis});
			const lostTags = step.persona.personaTags.filter((tag) => !tags.includes(tag));
			const lostEmojis = step.persona.signatureEmojis.filter((emoji) => !emojis.includes(emoji));
			if (lostTags.length > 0 || lostEmojis.length > 0) {
				dropped.push({persona_id: id, tags: lostTags, signature_emojis: lostEmojis});
				restoreParams.set(id, {persona_tags: tags, signature_emojis: emojis});
			} else {
				restoreParams.set(id, {});
			}
		}

		// The end state: each tag and signature emoji on one persona, and no more than the cap.
		const tagOwners = new Map<string, string>();
		const emojiOwners = new Map<string, string>();
		for (const state of finalState.values()) {
			for (const tag of state.tags) {
				const norm = normalizeTag(tag);
				if (!norm.prefix && !norm.suffix) continue;
				const key = getTagKey(norm);
				const owner = tagOwners.get(key);
				if (owner !== undefined) {
					throw new DuplicatePersonaTagError(
						`Tag pair '${formatTagDisplay(norm)}' would be on both '${owner}' and '${state.name}'`,
					);
				}
				tagOwners.set(key, state.name);
			}
			for (const emoji of state.emojis) {
				const key = emojiKeyOf(emoji);
				const owner = emojiOwners.get(key);
				if (owner !== undefined) {
					throw new DuplicateSignatureEmojiError(
						`Signature emoji '${emoji.name}' would be on both '${owner}' and '${state.name}'`,
					);
				}
				emojiOwners.set(key, state.name);
			}
		}
		if (finalState.size > MAX_PERSONAS_PER_USER) throw new PersonaLimitReachedError(MAX_PERSONAS_PER_USER);
		await this.assertProfileTextAllowed(userId, profileText);

		if (planned.length === 0) return {personas: [], dropped: []};
		const steps: Array<PersonaImportStep> = planned.map((step) => {
			if (step.kind === 'create') return {create: step.params};
			if (step.kind === 'restore') {
				return {restore: step.persona, params: step.params ?? restoreParams.get(step.persona.id.toString()) ?? {}};
			}
			return {update: step.persona, params: step.params};
		});
		const written = await this.deps.personaRepository.writeImport(userId, {
			retire: [],
			steps,
			alongside: (personas) =>
				personas.flatMap((persona, i) => {
					const step = planned[i];
					if (!step) return [];
					// A plain restore keeps the image sources the persona had; so does an update that names none.
					if (step.kind !== 'create' && step.sources === undefined) return [];
					return [personaImageSourcesWrite(userId, persona, step.sources ?? null)];
				}),
		});

		await this.dispatchListToOwnSessions(userId);
		const revived = planned.some((p) => p.kind === 'restore');
		if (revived || written.some((p) => p.visibility === 'public' || p.visibility === 'unlisted')) {
			await this.dispatchToMutualGuilds(userId);
		}
		return {personas: written.map((p) => p.toResponse()), dropped};
	}

	/** The account's deleted personas, the most recently deleted first. Only the owner sees these. */
	async listDeletedPersonas(userId: UserID): Promise<Array<Persona>> {
		const all = await this.deps.personaRepository.findByUserId(userId, {includeDeleted: true});
		return all.filter((p) => p.isDeleted).sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0));
	}

	/**
	 * Brings back a deleted persona: the same row, so its old messages and usage are its own again.
	 * Tags and signature emojis another persona holds now are left off and reported.
	 */
	async restorePersona(userId: UserID, personaId: PersonaID): Promise<PersonaRestoreResponse> {
		const result = await this.applyImport(userId, {
			source: 'tyne',
			actions: [{action: 'restore', persona_id: personaId.toString()}],
		});
		const persona = result.personas[0];
		if (!persona) throw new PersonaNotFoundError();
		const dropped = result.dropped[0];
		return {
			persona,
			dropped_tags: dropped?.tags ?? [],
			dropped_signature_emojis: dropped?.signature_emojis ?? [],
		};
	}

	/** The caller's live personas with these IDs, by ID; one that is not answers `UNKNOWN_PERSONA`. */
	private async liveByIds(userId: UserID, personaIds: ReadonlyArray<PersonaID>): Promise<Map<string, Persona>> {
		const live = new Map(
			(await this.deps.personaRepository.findByUserId(userId)).map((p) => [p.id.toString(), p] as const),
		);
		const found = new Map<string, Persona>();
		for (const personaId of personaIds) {
			const persona = live.get(personaId.toString());
			if (!persona) throw new PersonaNotFoundError();
			found.set(personaId.toString(), persona);
		}
		return found;
	}

	/**
	 * What deleting these personas one by one would clear, to write in the same batch: the selection,
	 * when it is one of them, and the channels they are selected in.
	 */
	private async planRetirement(
		userId: UserID,
		retired: ReadonlyArray<Persona>,
	): Promise<{settings: UserPersonaSettingsRow | undefined; clearedChannelIds: Array<ChannelID>}> {
		if (retired.length === 0) return {settings: undefined, clearedChannelIds: []};
		const retiredIds = new Set(retired.map((p) => p.id.toString()));
		let settings: UserPersonaSettingsRow | undefined;
		const current = await this.deps.personaRepository.findSettings(userId);
		if (current?.active_persona_id && retiredIds.has(current.active_persona_id.toString())) {
			settings = {
				...current,
				active_persona_id: null,
				is_latched: false,
				updated_at: new Date(),
				version: (current.version ?? 0) + 1,
			};
		}
		const clearedChannelIds = (await loadPersonaChannelStates(userId))
			.filter((row) => retiredIds.has(row.persona_id.toString()))
			.map((row) => row.channel_id);
		return {settings, clearedChannelIds};
	}

	/** After a write to many personas: the account's own sessions get the whole list, and what it cleared. */
	private async dispatchListToOwnSessions(
		userId: UserID,
		settings?: UserPersonaSettingsRow,
		clearedChannelIds: ReadonlyArray<ChannelID> = [],
	): Promise<void> {
		// The cleared selection goes first: a client that sees its selected persona missing from the
		// list clears the selection itself, with a request of its own.
		if (settings) {
			await this.dispatchToUser(userId, 'USER_PERSONA_SETTINGS_UPDATE', personaSettingsResponse(settings));
		}
		const allPersonas = await this.deps.personaRepository.findByUserId(userId);
		await this.dispatchToUser(userId, 'USER_PERSONAS_UPDATE', {
			personas: allPersonas.map((p) => p.toResponse()),
		});
		for (const channelId of clearedChannelIds) {
			await this.dispatchToUser(userId, 'USER_PERSONA_CHANNEL_STATE_UPDATE', {
				channel_id: channelId.toString(),
				persona_id: null,
			} satisfies PersonaChannelState);
		}
	}

	/**
	 * An account's public personas, the most used first, with the account's display tag. The order is
	 * the only thing the caller learns of the usage counters: the counts and last-used times stay out,
	 * since for a system they would show who is fronting.
	 */
	async getPublicPersonas(viewerUserId: UserID, targetUserId: UserID): Promise<PublicPersonaListResponse> {
		if (viewerUserId !== targetUserId && this.deps.userAccountLookupService) {
			await this.deps.userAccountLookupService.validateProfileAccess(viewerUserId, targetUserId);
		}

		const [personas, settings] = await Promise.all([
			this.deps.personaRepository.findByUserId(targetUserId),
			this.deps.personaRepository.findSettings(targetUserId),
		]);
		const tagText = settings?.display_tag_text?.trim();
		const tagIcon = settings?.display_tag_icon?.trim();
		return {
			display_tag_text: tagText ? tagText : null,
			display_tag_icon: tagIcon ? tagIcon : null,
			personas: personas
				.filter((p) => p.visibility === 'public')
				.sort((a, b) => b.useCount - a.useCount || (a.id < b.id ? -1 : 1))
				.map((p) => p.toPublicResponse()),
		};
	}

	async getPublicPersonaById(
		viewerUserId: UserID,
		targetUserId: UserID,
		personaId: PersonaID,
	): Promise<PublicPersonaResponse> {
		if (viewerUserId !== targetUserId && this.deps.userAccountLookupService) {
			await this.deps.userAccountLookupService.validateProfileAccess(viewerUserId, targetUserId);
		}

		const persona = await this.deps.personaRepository.findById(targetUserId, personaId);
		if (!persona) {
			throw new PersonaNotFoundError();
		}

		if (persona.visibility === 'private' && viewerUserId !== targetUserId) {
			throw new PersonaPrivateError();
		}

		return persona.toPublicResponse();
	}

	/**
	 * What messages from the given personas show, each named by owner and ID, whatever their visibility.
	 * Knowing the ID entitles the caller to this and to nothing of the profile. Deleted personas are
	 * included, as their old messages still show them.
	 */
	async lookupPersonas(pairs: Array<{userId: UserID; personaId: PersonaID}>): Promise<Array<PersonaLookupItem>> {
		if (pairs.length === 0) return [];
		const found = await this.deps.personaRepository.findByUserAndPersonaIds(pairs);
		if (found.size === 0) return [];
		const owners = Array.from(new Set(Array.from(found.values(), (persona) => persona.userId)));
		const settings = await this.deps.personaRepository.findSettingsByUserIds(owners);
		return Array.from(found.values(), (persona) => ({
			...persona.toSubprofileResponse(settings.get(persona.userId.toString())),
			user_id: persona.userId.toString(),
		}));
	}

	async getSettings(userId: UserID): Promise<PersonaSettingsResponse> {
		const row = await this.deps.personaRepository.findSettings(userId);
		if (!row) {
			return {
				user_id: userId.toString(),
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				active_persona_id: null,
				is_latched: false,
				display_tag_text: '',
				display_tag_icon: null,
				multi_persona_reactions: true,
			};
		}

		let activePersonaId: string | null = row.active_persona_id ? row.active_persona_id.toString() : null;
		let isLatched = Boolean(row.is_latched);

		if (activePersonaId) {
			try {
				const pId = createPersonaID(BigInt(activePersonaId));
				const persona = await this.deps.personaRepository.findById(userId, pId);
				if (!persona || persona.isDeleted) {
					activePersonaId = null;
					isLatched = false;
				}
			} catch {
				activePersonaId = null;
				isLatched = false;
			}
		}

		return {
			user_id: row.user_id.toString(),
			active_persona_mode: (row.active_persona_mode as 'manual' | 'last') === 'last' ? 'last' : 'manual',
			active_persona_scope: row.active_persona_scope === 'channel' ? 'channel' : 'global',
			active_persona_id: activePersonaId,
			is_latched: isLatched,
			display_tag_text: row.display_tag_text ?? '',
			display_tag_icon: row.display_tag_icon ?? null,
			multi_persona_reactions: row.multi_persona_reactions !== false,
		};
	}

	async updateSettings(userId: UserID, data: PersonaSettingsUpdateRequest): Promise<PersonaSettingsResponse> {
		const existing = await this.deps.personaRepository.findSettings(userId);
		if (data.display_tag_text && data.display_tag_text !== (existing?.display_tag_text ?? '')) {
			await this.assertProfileTextAllowed(userId, [['global_name', data.display_tag_text]]);
		}
		const existingMode = (existing?.active_persona_mode as 'manual' | 'last') === 'last' ? 'last' : 'manual';
		const existingScope = existing?.active_persona_scope === 'channel' ? 'channel' : 'global';
		const updatedRow: UserPersonaSettingsRow = {
			user_id: userId,
			active_persona_mode: data.active_persona_mode !== undefined ? data.active_persona_mode : existingMode,
			active_persona_scope: data.active_persona_scope !== undefined ? data.active_persona_scope : existingScope,
			active_persona_id:
				data.active_persona_id !== undefined ? data.active_persona_id : (existing?.active_persona_id ?? null),
			is_latched: data.is_latched !== undefined ? data.is_latched : (existing?.is_latched ?? false),
			display_tag_text:
				data.display_tag_text !== undefined ? (data.display_tag_text ?? '') : (existing?.display_tag_text ?? ''),
			display_tag_icon:
				data.display_tag_icon !== undefined ? data.display_tag_icon : (existing?.display_tag_icon ?? null),
			multi_persona_reactions:
				data.multi_persona_reactions !== undefined
					? data.multi_persona_reactions
					: existing?.multi_persona_reactions !== false,
			updated_at: new Date(),
			version: (existing?.version ?? 0) + 1,
		};

		await this.deps.personaRepository.upsertSettings(updatedRow);

		if (updatedRow.active_persona_id) {
			try {
				const pId = createPersonaID(BigInt(updatedRow.active_persona_id));
				void this.deps.personaRepository.recordUsage(userId, pId).catch(() => {});
			} catch {
				// Ignore invalid persona ID formatting
			}
		}

		const response = personaSettingsResponse(updatedRow);

		const displayTagChanged =
			(updatedRow.display_tag_text ?? '') !== (existing?.display_tag_text ?? '') ||
			(updatedRow.display_tag_icon ?? null) !== (existing?.display_tag_icon ?? null);

		await this.dispatchToUser(userId, 'USER_PERSONA_SETTINGS_UPDATE', response);
		if (displayTagChanged) {
			await this.dispatchToMutualGuilds(userId, undefined, 'sync', updatedRow);
		}

		return response;
	}

	async getChannelPersonaMentions({
		callerUserId,
		candidateUserIds,
		query,
		limit,
		userMap,
	}: {
		callerUserId: UserID;
		candidateUserIds: Array<UserID>;
		query?: string;
		limit?: number;
		userMap: Map<
			UserID,
			{username: string; discriminator?: string | null; globalName: string | null; nickname?: string | null}
		>;
	}): Promise<Array<ChannelPersonaMentionItem>> {
		if (candidateUserIds.length === 0) return [];
		const maxLimit = Math.min(Math.max(limit ?? 100, 1), 1000);
		const normalizedQuery = (query ?? '').trim().toLowerCase();

		const [allPersonas, settingsMap] = await Promise.all([
			this.deps.personaRepository.findByUserIds(candidateUserIds),
			this.deps.personaRepository.findSettingsByUserIds(candidateUserIds),
		]);

		// Filter according to privacy model:
		// - caller can see all of their own personas
		// - other room members' personas can be public or unlisted (private personas are hidden)
		const visiblePersonas = allPersonas.filter((persona) => {
			if (persona.userId === callerUserId) {
				return true;
			}
			return persona.visibility === 'public' || persona.visibility === 'unlisted';
		});

		// Query matching
		const matched = visiblePersonas.filter((persona) => {
			if (!normalizedQuery) return true;
			const nameMatch = persona.name.toLowerCase().includes(normalizedQuery);
			const userSettings = settingsMap.get(persona.userId.toString());
			const tagMatch = userSettings?.display_tag_text?.toLowerCase().includes(normalizedQuery);
			const owner = userMap.get(persona.userId);
			const ownerUserMatch = owner?.username.toLowerCase().includes(normalizedQuery);
			const ownerNickMatch = owner?.nickname?.toLowerCase().includes(normalizedQuery);
			return nameMatch || Boolean(tagMatch) || Boolean(ownerUserMatch) || Boolean(ownerNickMatch);
		});

		// Sort: match strength tier first, then frecency (recency + frequency), then alphabetical
		const now = Date.now();
		matched.sort((a, b) => {
			const aOwner = userMap.get(a.userId);
			const bOwner = userMap.get(b.userId);
			const aSettings = settingsMap.get(a.userId.toString());
			const bSettings = settingsMap.get(b.userId.toString());
			const aMatch = calculatePersonaMatchScore(
				a.name,
				normalizedQuery,
				aSettings?.display_tag_text,
				aOwner?.username,
				aOwner?.nickname,
				aOwner?.globalName,
			);
			const bMatch = calculatePersonaMatchScore(
				b.name,
				normalizedQuery,
				bSettings?.display_tag_text,
				bOwner?.username,
				bOwner?.nickname,
				bOwner?.globalName,
			);
			if (aMatch !== bMatch) {
				return bMatch - aMatch;
			}
			const aFrecency = calculatePersonaFrecencyScore(a.useCount, a.lastUsedAtMs, now);
			const bFrecency = calculatePersonaFrecencyScore(b.useCount, b.lastUsedAtMs, now);
			if (Math.abs(bFrecency - aFrecency) > 0.001) {
				return bFrecency - aFrecency;
			}
			return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
		});

		const results = matched.slice(0, maxLimit);
		return results.map((persona) => {
			const owner = userMap.get(persona.userId);
			const userSettings = settingsMap.get(persona.userId.toString());
			return {
				id: persona.id.toString(),
				name: persona.name,
				avatar_hash: persona.avatarHash,
				banner_hash: persona.bannerHash,
				display_tag_text: userSettings?.display_tag_text ?? null,
				display_tag_icon: userSettings?.display_tag_icon ?? null,
				pronouns: persona.pronouns,
				color: persona.color,
				avatar_color: persona.avatarColor,
				bio: persona.bio,
				visibility: persona.visibility,
				use_count: persona.useCount,
				last_used_at_ms: persona.lastUsedAtMs ? persona.lastUsedAtMs.toString() : null,
				owner_user_id: persona.userId.toString(),
				owner_username: owner?.username ?? 'unknown',
				owner_discriminator: owner?.discriminator ?? null,
				owner_global_name: owner?.globalName ?? null,
				owner_nickname: owner?.nickname ?? null,
			};
		});
	}

	/** Every channel the account has a persona selected in. Channels not listed are used as the account. */
	async getChannelStates(userId: UserID): Promise<PersonaChannelStatesResponse> {
		const rows = await loadPersonaChannelStates(userId);
		return {
			states: rows.map((row) => ({
				channel_id: row.channel_id.toString(),
				persona_id: row.persona_id.toString(),
			})),
		};
	}

	/**
	 * Selects a persona in one channel, or the account itself with `null`. The caller has already
	 * checked that the account can see the channel. Tells the account's other sessions, and nobody
	 * else: which persona someone has selected is theirs to show by acting.
	 */
	async setChannelState(
		userId: UserID,
		channelId: ChannelID,
		personaId: PersonaID | null,
	): Promise<PersonaChannelState> {
		if (personaId === null) {
			await forgetPersonaChannelState(userId, channelId);
		} else {
			const persona = await this.deps.personaRepository.findById(userId, personaId);
			if (!persona || persona.isDeleted) throw new PersonaNotFoundError();
			await storePersonaChannelState(userId, channelId, personaId);
		}
		const state: PersonaChannelState = {
			channel_id: channelId.toString(),
			persona_id: personaId === null ? null : personaId.toString(),
		};
		await this.dispatchToUser(userId, 'USER_PERSONA_CHANNEL_STATE_UPDATE', state);
		return state;
	}

	private async dispatchToUser(
		userId: UserID,
		event:
			| 'USER_PERSONA_CREATE'
			| 'USER_PERSONA_UPDATE'
			| 'USER_PERSONA_DELETE'
			| 'USER_PERSONAS_UPDATE'
			| 'USER_PERSONA_SETTINGS_UPDATE'
			| 'USER_PERSONA_CHANNEL_STATE_UPDATE',
		data: unknown,
	): Promise<void> {
		if (!this.deps.gatewayService) return;
		try {
			await this.deps.gatewayService.dispatchPresence({
				userId,
				event,
				data,
			});
		} catch {
			// Non-blocking gateway broadcast failure
		}
	}

	private async dispatchToMutualGuilds(
		userId: UserID,
		persona?: Persona | null,
		action: 'update' | 'delete' | 'sync' = 'sync',
		settings?: UserPersonaSettingsRow | null,
	): Promise<void> {
		if (!this.deps.gatewayService) return;
		try {
			const effectiveSettings = settings ?? (await this.deps.personaRepository.findSettings(userId));
			// A private persona is never named in an event: its ID is only for those who have seen it, and
			// clients that show it fetch it again by ID. Public and unlisted personas still travel with the
			// event, for clients released before the lookup (tyne#206 drops them too).
			const personaData =
				persona && persona.visibility !== 'private' ? persona.toSubprofileResponse(effectiveSettings) : undefined;
			const dispatches: Array<Promise<void>> = [];

			if (this.deps.userGuildRepository) {
				const guildIds = await this.deps.userGuildRepository.getUserGuildIds(userId);
				if (guildIds && guildIds.length > 0) {
					for (const guildId of guildIds) {
						dispatches.push(
							this.deps.gatewayService.dispatchGuild({
								guildId,
								event: 'GUILD_PERSONAS_DIRTY',
								data: {
									guild_id: guildId.toString(),
									user_id: userId.toString(),
									...(personaData ? {persona: personaData} : {}),
									display_tag_text: effectiveSettings?.display_tag_text ?? null,
									display_tag_icon: effectiveSettings?.display_tag_icon ?? null,
									action,
								},
							}),
						);
					}
				}
			}

			if (this.deps.userChannelRepository) {
				const privateChannels = await this.deps.userChannelRepository.listPrivateChannels(userId);
				const recipientUserIds = new Set<UserID>();
				for (const channel of privateChannels) {
					if (channel.recipientIds) {
						for (const recipientId of channel.recipientIds) {
							if (recipientId !== userId && recipientId !== SYSTEM_USER_ID) {
								recipientUserIds.add(recipientId);
							}
						}
					}
				}
				for (const recipientId of recipientUserIds) {
					dispatches.push(
						this.deps.gatewayService.dispatchPresence({
							userId: recipientId,
							event: 'GUILD_PERSONAS_DIRTY',
							data: {
								user_id: userId.toString(),
								...(personaData ? {persona: personaData} : {}),
								display_tag_text: effectiveSettings?.display_tag_text ?? null,
								display_tag_icon: effectiveSettings?.display_tag_icon ?? null,
								action,
							},
						}),
					);
				}
			}

			if (dispatches.length > 0) {
				await Promise.all(dispatches);
			}
		} catch {
			// Non-blocking gateway broadcast failure
		}
	}
}
