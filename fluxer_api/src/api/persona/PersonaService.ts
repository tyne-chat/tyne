// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	PersonaCreateRequest,
	PersonaUpdateRequest,
	PublicPersonaResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaID, UserID} from '../BrandedTypes';
import type {IGatewayService} from '../infrastructure/IGatewayService';
import type {Persona} from '../models/Persona';
import type {UserAccountLookupService} from '../user/services/UserAccountLookupService';
import {PersonaLimitReachedError, PersonaNotFoundError} from './errors/PersonaErrors';
import type {IPersonaRepository} from './IPersonaRepository';

export const MAX_PERSONAS_PER_USER = 250;

export interface PersonaServiceDeps {
	personaRepository: IPersonaRepository;
	userAccountLookupService?: UserAccountLookupService;
	gatewayService?: IGatewayService;
}

export class PersonaService {
	constructor(private readonly deps: PersonaServiceDeps) {}

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

		const persona = await this.deps.personaRepository.create({
			user_id: userId,
			name: data.name,
			avatar_url: data.avatar_url,
			system_name: data.system_name,
			pronouns: data.pronouns,
			color: data.color,
			bio: data.bio,
			auto_tag_disabled: data.auto_tag_disabled,
			persona_tags: data.persona_tags,
			visibility: data.visibility ?? 'unlisted',
			external_uuid: data.external_uuid,
		});

		await this.dispatchToUser(userId, 'USER_PERSONA_CREATE', {persona: persona.toResponse()});
		return persona;
	}

	async updatePersona(userId: UserID, personaId: PersonaID, data: PersonaUpdateRequest): Promise<Persona> {
		const updated = await this.deps.personaRepository.update(userId, personaId, {
			name: data.name,
			avatar_url: data.avatar_url,
			system_name: data.system_name,
			pronouns: data.pronouns,
			color: data.color,
			bio: data.bio,
			auto_tag_disabled: data.auto_tag_disabled,
			persona_tags: data.persona_tags,
			visibility: data.visibility,
			external_uuid: data.external_uuid,
		});
		if (!updated) {
			throw new PersonaNotFoundError();
		}

		await this.dispatchToUser(userId, 'USER_PERSONA_UPDATE', {persona: updated.toResponse()});
		return updated;
	}

	async deletePersona(userId: UserID, personaId: PersonaID): Promise<void> {
		const deleted = await this.deps.personaRepository.delete(userId, personaId);
		if (!deleted) {
			throw new PersonaNotFoundError();
		}

		await this.dispatchToUser(userId, 'USER_PERSONA_DELETE', {persona_id: personaId.toString()});
	}

	async importPersonas(userId: UserID, items: Array<PersonaCreateRequest>): Promise<Array<Persona>> {
		const existingPersonas = await this.deps.personaRepository.findByUserId(userId);
		const existingByUuid = new Map<string, Persona>();
		for (const p of existingPersonas) {
			if (p.externalUuid) {
				existingByUuid.set(p.externalUuid, p);
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
					system_name: item.system_name,
					pronouns: item.pronouns,
					color: item.color,
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
					system_name: item.system_name,
					pronouns: item.pronouns,
					color: item.color,
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

	private async dispatchToUser(
		userId: UserID,
		event: 'USER_PERSONA_CREATE' | 'USER_PERSONA_UPDATE' | 'USER_PERSONA_DELETE' | 'USER_PERSONAS_UPDATE',
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
}
