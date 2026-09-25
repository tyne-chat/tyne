// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	ChannelPersonaMentionItem,
	PersonaCreateRequest,
	PersonaSettingsResponse,
	PersonaSettingsUpdateRequest,
	PersonaTag,
	PersonaUpdateRequest,
	PublicPersonaResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {createPersonaID, type PersonaID, type UserID} from '../BrandedTypes';
import type {UserPersonaSettingsRow} from '../database/types/PersonaTypes';
import type {IGatewayService} from '../infrastructure/IGatewayService';
import type {Persona} from '../models/Persona';
import type {UserGuildRepository} from '../user/repositories/account/UserGuildRepository';
import type {UserAccountLookupService} from '../user/services/UserAccountLookupService';
import {
	DuplicatePersonaTagError,
	PersonaLimitReachedError,
	PersonaNotFoundError,
	PersonaTagLimitExceededError,
} from './errors/PersonaErrors';
import type {IPersonaRepository} from './IPersonaRepository';

export const MAX_PERSONAS_PER_USER = 250;

export interface PersonaServiceDeps {
	personaRepository: IPersonaRepository;
	userAccountLookupService?: UserAccountLookupService;
	gatewayService?: IGatewayService;
	userGuildRepository?: UserGuildRepository;
}

function normalizeTag(tag: PersonaTag): {prefix: string; suffix: string} {
	return {
		prefix: (tag.prefix ?? '').trim(),
		suffix: (tag.suffix ?? '').trim(),
	};
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
	systemName?: string | null,
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
	const sys = (systemName ?? '').toLowerCase();
	if (sys.startsWith(q)) {
		return 350;
	}
	if (sys.includes(q)) {
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

function getTagKey(tag: {prefix: string; suffix: string}): string {
	return `${tag.prefix}:::${tag.suffix}`;
}

function formatTagDisplay(tag: {prefix: string; suffix: string}): string {
	return `${tag.prefix || ''}text${tag.suffix || ''}`;
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

		const persona = await this.deps.personaRepository.create({
			user_id: userId,
			name: data.name,
			avatar_url: data.avatar_url,
			banner_url: data.banner_url,
			system_name: data.system_name,
			pronouns: data.pronouns,
			color: data.color,
			avatar_color: data.avatar_color,
			bio: data.bio,
			auto_tag_disabled: data.auto_tag_disabled,
			persona_tags: data.persona_tags,
			visibility: data.visibility ?? 'unlisted',
			external_uuid: data.external_uuid,
		});

		await this.dispatchToUser(userId, 'USER_PERSONA_CREATE', {
			persona: {...persona.toResponse(), user_id: userId.toString()},
		});
		if (persona.visibility === 'public' || persona.visibility === 'unlisted') {
			await this.dispatchToMutualGuilds(userId);
		}
		return persona;
	}

	async updatePersona(userId: UserID, personaId: PersonaID, data: PersonaUpdateRequest): Promise<Persona> {
		if (data.persona_tags !== undefined) {
			await this.validatePersonaTags(userId, data.persona_tags, personaId);
		}

		const existing = await this.deps.personaRepository.findById(userId, personaId);
		if (!existing) {
			throw new PersonaNotFoundError();
		}

		const updated = await this.deps.personaRepository.update(userId, personaId, {
			name: data.name,
			avatar_url: data.avatar_url,
			banner_url: data.banner_url,
			system_name: data.system_name,
			pronouns: data.pronouns,
			color: data.color,
			avatar_color: data.avatar_color,
			bio: data.bio,
			auto_tag_disabled: data.auto_tag_disabled,
			persona_tags: data.persona_tags,
			visibility: data.visibility,
			external_uuid: data.external_uuid,
		});
		if (!updated) {
			throw new PersonaNotFoundError();
		}

		await this.dispatchToUser(userId, 'USER_PERSONA_UPDATE', {
			persona: {...updated.toResponse(), user_id: userId.toString()},
		});

		const wasVisible = existing.visibility === 'public' || existing.visibility === 'unlisted';
		const isVisible = updated.visibility === 'public' || updated.visibility === 'unlisted';
		if (wasVisible || isVisible) {
			await this.dispatchToMutualGuilds(userId);
		}
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

		await this.dispatchToUser(userId, 'USER_PERSONA_DELETE', {
			persona_id: personaId.toString(),
			user_id: userId.toString(),
		});

		if (existing.visibility === 'public' || existing.visibility === 'unlisted') {
			await this.dispatchToMutualGuilds(userId);
		}
	}

	async importPersonas(userId: UserID, items: Array<PersonaCreateRequest>): Promise<Array<Persona>> {
		const existingPersonas = await this.deps.personaRepository.findByUserId(userId);
		const existingByUuid = new Map<string, Persona>();
		for (const p of existingPersonas) {
			if (p.externalUuid) {
				existingByUuid.set(p.externalUuid, p);
			}
		}

		// Track tags across existing personas (excluding those updated in this batch) + new imported personas
		const usedTags = new Map<string, string>(); // tagKey -> persona name
		for (const existing of existingPersonas) {
			if (existing.externalUuid && items.some((it) => it.external_uuid === existing.externalUuid)) {
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

		const results: Array<Persona> = [];
		let currentCount = existingPersonas.length;

		for (const item of items) {
			if (item.external_uuid && existingByUuid.has(item.external_uuid)) {
				const existing = existingByUuid.get(item.external_uuid)!;
				const updated = await this.deps.personaRepository.update(userId, existing.id, {
					name: item.name,
					avatar_url: item.avatar_url,
					banner_url: item.banner_url,
					system_name: item.system_name,
					pronouns: item.pronouns,
					color: item.color,
					avatar_color: item.avatar_color,
					bio: item.bio,
					auto_tag_disabled: item.auto_tag_disabled,
					persona_tags: item.persona_tags,
					visibility: item.visibility ?? existing.visibility,
					external_uuid: item.external_uuid,
				});
				if (updated) {
					results.push(updated);
				}
			} else {
				if (currentCount >= MAX_PERSONAS_PER_USER) {
					throw new PersonaLimitReachedError(MAX_PERSONAS_PER_USER);
				}
				const created = await this.deps.personaRepository.create({
					user_id: userId,
					name: item.name,
					avatar_url: item.avatar_url,
					banner_url: item.banner_url,
					system_name: item.system_name,
					pronouns: item.pronouns,
					color: item.color,
					avatar_color: item.avatar_color,
					bio: item.bio,
					auto_tag_disabled: item.auto_tag_disabled,
					persona_tags: item.persona_tags,
					visibility: item.visibility ?? 'unlisted',
					external_uuid: item.external_uuid,
				});
				results.push(created);
				currentCount++;
			}
		}

		const allPersonas = await this.deps.personaRepository.findByUserId(userId);
		await this.dispatchToUser(userId, 'USER_PERSONAS_UPDATE', {
			personas: allPersonas.map((p) => p.toResponse()),
		});
		if (results.some((p) => p.visibility === 'public' || p.visibility === 'unlisted')) {
			await this.dispatchToMutualGuilds(userId);
		}

		return results;
	}

	async getPublicPersonas(viewerUserId: UserID, targetUserId: UserID): Promise<Array<PublicPersonaResponse>> {
		if (viewerUserId !== targetUserId && this.deps.userAccountLookupService) {
			await this.deps.userAccountLookupService.validateProfileAccess(viewerUserId, targetUserId);
		}

		const personas = await this.deps.personaRepository.findByUserId(targetUserId);
		return personas.filter((p) => p.visibility === 'public').map((p) => p.toPublicResponse());
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
			throw new PersonaNotFoundError();
		}

		return persona.toPublicResponse();
	}

	async getSettings(userId: UserID): Promise<PersonaSettingsResponse> {
		const row = await this.deps.personaRepository.findSettings(userId);
		if (!row) {
			return {
				user_id: userId.toString(),
				active_persona_mode: 'off',
				active_persona_id: null,
				is_latched: false,
				display_tag_text: '',
				display_tag_icon: null,
			};
		}
		return {
			user_id: row.user_id.toString(),
			active_persona_mode: (row.active_persona_mode as 'off' | 'manual' | 'last') ?? 'off',
			active_persona_id: row.active_persona_id ? row.active_persona_id.toString() : null,
			is_latched: Boolean(row.is_latched),
			display_tag_text: row.display_tag_text ?? '',
			display_tag_icon: row.display_tag_icon ?? null,
		};
	}

	async updateSettings(userId: UserID, data: PersonaSettingsUpdateRequest): Promise<PersonaSettingsResponse> {
		const existing = await this.deps.personaRepository.findSettings(userId);
		const updatedRow: UserPersonaSettingsRow = {
			user_id: userId,
			active_persona_mode:
				data.active_persona_mode !== undefined ? data.active_persona_mode : (existing?.active_persona_mode ?? 'off'),
			active_persona_id:
				data.active_persona_id !== undefined ? data.active_persona_id : (existing?.active_persona_id ?? null),
			is_latched: data.is_latched !== undefined ? data.is_latched : (existing?.is_latched ?? false),
			display_tag_text:
				data.display_tag_text !== undefined ? (data.display_tag_text ?? '') : (existing?.display_tag_text ?? ''),
			display_tag_icon:
				data.display_tag_icon !== undefined ? data.display_tag_icon : (existing?.display_tag_icon ?? null),
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

		const response: PersonaSettingsResponse = {
			user_id: updatedRow.user_id.toString(),
			active_persona_mode: (updatedRow.active_persona_mode as 'off' | 'manual' | 'last') ?? 'off',
			active_persona_id: updatedRow.active_persona_id ? updatedRow.active_persona_id.toString() : null,
			is_latched: Boolean(updatedRow.is_latched),
			display_tag_text: updatedRow.display_tag_text ?? '',
			display_tag_icon: updatedRow.display_tag_icon ?? null,
		};

		await this.dispatchToUser(userId, 'USER_PERSONA_SETTINGS_UPDATE', response);
		await this.dispatchToMutualGuilds(userId);

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

		const allPersonas = await this.deps.personaRepository.findByUserIds(candidateUserIds);

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
			const systemMatch = persona.systemName?.toLowerCase().includes(normalizedQuery);
			const owner = userMap.get(persona.userId);
			const ownerUserMatch = owner?.username.toLowerCase().includes(normalizedQuery);
			const ownerNickMatch = owner?.nickname?.toLowerCase().includes(normalizedQuery);
			return nameMatch || Boolean(systemMatch) || Boolean(ownerUserMatch) || Boolean(ownerNickMatch);
		});

		// Sort: match strength tier first, then frecency (recency + frequency), then alphabetical
		const now = Date.now();
		matched.sort((a, b) => {
			const aOwner = userMap.get(a.userId);
			const bOwner = userMap.get(b.userId);
			const aMatch = calculatePersonaMatchScore(
				a.name,
				normalizedQuery,
				a.systemName,
				aOwner?.username,
				aOwner?.nickname,
				aOwner?.globalName,
			);
			const bMatch = calculatePersonaMatchScore(
				b.name,
				normalizedQuery,
				b.systemName,
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
			return {
				id: persona.id.toString(),
				name: persona.name,
				avatar_url: persona.avatarUrl,
				system_name: persona.systemName,
				pronouns: persona.pronouns,
				color: persona.color,
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

	private async dispatchToUser(
		userId: UserID,
		event:
			| 'USER_PERSONA_CREATE'
			| 'USER_PERSONA_UPDATE'
			| 'USER_PERSONA_DELETE'
			| 'USER_PERSONAS_UPDATE'
			| 'USER_PERSONA_SETTINGS_UPDATE',
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

	private async dispatchToMutualGuilds(userId: UserID): Promise<void> {
		if (!this.deps.gatewayService || !this.deps.userGuildRepository) return;
		try {
			const guildIds = await this.deps.userGuildRepository.getUserGuildIds(userId);
			if (!guildIds || guildIds.length === 0) return;
			await Promise.all(
				guildIds.map((guildId) =>
					this.deps.gatewayService!.dispatchGuild({
						guildId,
						event: 'GUILD_PERSONAS_DIRTY',
						data: {
							guild_id: guildId.toString(),
							user_id: userId.toString(),
						},
					}),
				),
			);
		} catch {
			// Non-blocking gateway broadcast failure
		}
	}
}
