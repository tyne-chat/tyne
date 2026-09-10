// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Toast from '@app/features/ui/commands/ToastCommands';
import UserSettings from '@app/features/user/state/UserSettings';
import {type MatchResult, matchPersona} from '@fluxer/schema/src/domains/persona/PersonaMatcher';
import type {
	MessageSubprofileRequest,
	MessageSubprofileResponse,
} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import type {Persona} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/preferences_pb';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';
import {makeAutoObservable} from 'mobx';

export type ActivePersonaMode = 'off' | 'manual' | 'last';

let personaIdCounter = 0;

export class PersonaStoreClass {
	constructor() {
		makeAutoObservable(this);
	}

	get personas(): ReadonlyArray<Persona> {
		return UserSettings.getSubPreference('personas') ?? [];
	}

	get activePersonaId(): string | null {
		const id = UserSettings.getSubPreference('activePersonaId');
		return id && id.length > 0 ? id : null;
	}

	get activePersonaMode(): ActivePersonaMode {
		const raw = UserSettings.getSubPreference('activePersonaMode');
		if (raw === 'off' || raw === 'manual' || raw === 'last') {
			return raw;
		}
		return this.isPersonaLatched ? 'last' : 'off';
	}

	get isPersonaLatched(): boolean {
		return UserSettings.getSubPreference('activePersonaLatched') ?? false;
	}

	get activePersona(): Persona | null {
		const id = this.activePersonaId;
		if (!id) return null;
		return this.personas.find((p) => p.id === id) ?? null;
	}

	get rankedPersonas(): ReadonlyArray<Persona> {
		const now = Date.now();
		return [...this.personas].sort((a, b) => {
			const scoreA = this.calculateFrecency(a, now);
			const scoreB = this.calculateFrecency(b, now);
			return scoreB - scoreA;
		});
	}

	private calculateFrecency(persona: Persona, nowMs: number): number {
		const lastUsed = Number(persona.lastUsedAtMs ?? 0n);
		const count = persona.useCount ?? 0;
		if (lastUsed === 0) return 0;
		const hoursAgo = Math.max(0, (nowMs - lastUsed) / (1000 * 60 * 60));
		const recencyFactor = 0.5 ** (hoursAgo / 24);
		return (count + 1) * recencyFactor;
	}

	findPersonaByName(query: string): Persona | null {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return null;
		const exact = this.personas.find((p) => p.name.toLowerCase() === trimmed);
		if (exact) return exact;
		const starts = this.personas.find((p) => p.name.toLowerCase().startsWith(trimmed));
		if (starts) return starts;
		return this.personas.find((p) => p.name.toLowerCase().includes(trimmed)) ?? null;
	}

	async addPersona(personaData: {
		name: string;
		avatar_url?: string | null;
		system_name?: string | null;
		pronouns?: string | null;
		color?: number | null;
		accentColor?: number | null;
		accent_color?: number | null;
		bio?: string | null;
		persona_tags?: Array<{prefix?: string; suffix?: string}>;
	}): Promise<Persona> {
		const id = `${SnowflakeUtils.fromTimestamp(Date.now())}_${++personaIdCounter}`;
		const rawTags = personaData.persona_tags ?? [];
		const color = personaData.accentColor ?? personaData.accent_color ?? personaData.color ?? undefined;
		const newPersona: Persona = {
			$typeName: 'fluxer.user.preferences.v1.Persona',
			id,
			name: personaData.name,
			avatarUrl: personaData.avatar_url ?? undefined,
			systemName: personaData.system_name ?? undefined,
			pronouns: personaData.pronouns ?? undefined,
			color: color ?? undefined,
			bio: personaData.bio ?? undefined,
			autoTagDisabled: false,
			useCount: 0,
			lastUsedAtMs: 0n,
			personaTags: rawTags.map((t) => ({
				$typeName: 'fluxer.user.preferences.v1.PersonaTag',
				prefix: t.prefix ?? undefined,
				suffix: t.suffix ?? undefined,
			})),
		};

		const updatedList = [...this.personas, newPersona];
		await UserSettings.setSubPreference('personas', updatedList);
		return newPersona;
	}

	async updatePersona(
		id: string,
		updates: Partial<Persona> & {accentColor?: number | null; accent_color?: number | null},
	): Promise<void> {
		const resolvedColor =
			updates.accentColor !== undefined
				? (updates.accentColor ?? undefined)
				: updates.accent_color !== undefined
					? (updates.accent_color ?? undefined)
					: updates.color;
		const finalUpdates = {
			...updates,
			...(resolvedColor !== undefined ? {color: resolvedColor} : {}),
		};
		const updatedList = this.personas.map((p) => {
			if (p.id !== id) return p;
			return {
				...p,
				...finalUpdates,
			};
		});
		await UserSettings.setSubPreference('personas', updatedList);
	}

	async deletePersona(id: string): Promise<void> {
		const updatedList = this.personas.filter((p) => p.id !== id);
		await UserSettings.setSubPreference('personas', updatedList);
		if (this.activePersonaId === id) {
			await this.unlatch();
		}
	}

	async replaceAllPersonas(newPersonas: Array<Persona>): Promise<void> {
		await UserSettings.setSubPreference('personas', newPersonas);
		if (this.activePersonaId && !newPersonas.some((p) => p.id === this.activePersonaId)) {
			await this.unlatch();
		}
	}

	async appendPersonas(newPersonas: Array<Persona>): Promise<void> {
		const updatedList = [...this.personas, ...newPersonas];
		await UserSettings.setSubPreference('personas', updatedList);
	}

	async setActivePersonaMode(mode: ActivePersonaMode): Promise<void> {
		const p1 = UserSettings.setSubPreference('activePersonaMode', mode);
		const p2 = UserSettings.setSubPreference('activePersonaLatched', mode !== 'off');
		const promises: Array<Promise<void>> = [p1, p2];
		if (mode === 'off') {
			promises.push(UserSettings.setSubPreference('activePersonaId', ''));
		} else if (!this.activePersonaId && this.personas.length > 0) {
			promises.push(UserSettings.setSubPreference('activePersonaId', this.personas[0].id));
		}
		await Promise.all(promises);
	}

	async setActivePersona(id: string | null, latch = true, mode?: ActivePersonaMode): Promise<void> {
		const p1 = UserSettings.setSubPreference('activePersonaId', id ?? '');
		const p2 = UserSettings.setSubPreference('activePersonaLatched', Boolean(id && latch));
		const promises: Array<Promise<void>> = [p1, p2];
		if (mode) {
			promises.push(UserSettings.setSubPreference('activePersonaMode', mode));
		} else if (id && latch && this.activePersonaMode === 'off') {
			promises.push(UserSettings.setSubPreference('activePersonaMode', 'manual'));
		}
		await Promise.all(promises);
	}

	async unlatch(): Promise<void> {
		const p1 = UserSettings.setSubPreference('activePersonaLatched', false);
		const p2 = UserSettings.setSubPreference('activePersonaId', '');
		const p3 = UserSettings.setSubPreference('activePersonaMode', 'off');
		await Promise.all([p1, p2, p3]);
	}

	async recordPersonaUse(id: string): Promise<void> {
		const updatedList = this.personas.map((p) => {
			if (p.id !== id) return p;
			return {
				...p,
				useCount: (p.useCount ?? 0) + 1,
				lastUsedAtMs: BigInt(Date.now()),
			};
		});
		await UserSettings.setSubPreference('personas', updatedList);
	}

	handleInChatCommand(content: string): {isCommand: boolean; handled: boolean} {
		if (content.trim() === '\\\\') {
			if (!this.activePersona) {
				return {isCommand: false, handled: false};
			}
			void this.unlatch();
			Toast.success('Active persona cleared');
			return {isCommand: true, handled: true};
		}
		return {isCommand: false, handled: false};
	}

	matchOutgoingMessage(content: string, hasAttachments = false): MatchResult {
		const personasLike = this.personas.map((p) => ({
			id: p.id,
			name: p.name,
			avatar_url: p.avatarUrl ?? null,
			system_name: p.systemName ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? null,
			auto_tag_disabled: p.autoTagDisabled ?? false,
			bio: p.bio ?? null,
			persona_tags: (p.personaTags ?? []).map((t) => ({
				prefix: t.prefix ?? null,
				suffix: t.suffix ?? null,
			})),
		}));

		const activeLatchedId = this.activePersona?.id ?? null;
		const result = matchPersona(content, personasLike, activeLatchedId, hasAttachments);

		if (result.clearedLatch) {
			void this.unlatch();
			Toast.success('Active persona cleared (sending as root account)');
		} else if (result.matched && result.persona) {
			void this.recordPersonaUse(result.persona.id);
			if (this.activePersonaMode === 'last' && this.activePersonaId !== result.persona.id) {
				void this.setActivePersona(result.persona.id, true, 'last');
			}
		}

		return result;
	}

	matchEditMessage(
		content: string,
		currentSubprofile?: MessageSubprofileResponse | null,
		options?: {
			hasAttachments?: boolean;
			originalContent?: string;
		},
	): {
		finalContent: string;
		subprofile?: MessageSubprofileRequest | null;
	} {
		const originalContent = options?.originalContent;

		const personasLike = this.personas.map((p) => ({
			id: p.id,
			name: p.name,
			avatar_url: p.avatarUrl ?? null,
			system_name: p.systemName ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? null,
			auto_tag_disabled: p.autoTagDisabled ?? false,
			bio: p.bio ?? null,
			persona_tags: (p.personaTags ?? []).map((t) => ({
				prefix: t.prefix ?? null,
				suffix: t.suffix ?? null,
			})),
		}));

		const isJustPersonaTag = (text?: string | null): boolean => {
			const trimmed = (text ?? '').trim();
			if (!trimmed) return false;
			const res = matchPersona(trimmed, personasLike, null, true);
			return res.matched && res.strippedContent.length === 0;
		};

		const hasRealOriginalText = Boolean(
			originalContent && originalContent.trim().length > 0 && !isJustPersonaTag(originalContent),
		);

		// If user typed \ or \\ to explicitly clear active persona / escape
		if (content.startsWith('\\') && currentSubprofile) {
			let strippedContent = '';
			if (content.startsWith('\\\\')) {
				const rawRest = content.slice(2);
				strippedContent = rawRest.startsWith(' ') ? rawRest.slice(1) : rawRest;
			} else {
				const rawRest = content.slice(1);
				strippedContent = rawRest.startsWith(' ') ? rawRest.slice(1) : rawRest;
			}
			const finalContent =
				strippedContent.length > 0 ? strippedContent : hasRealOriginalText ? (originalContent ?? '') : '';
			return {
				finalContent,
				subprofile: null,
			};
		}

		// In edit mode, check explicit persona tags. Pass activeLatchedPersonaId as null so it never falls back to latched persona.
		const result = matchPersona(content, personasLike, null, true);

		// If explicit persona tags matched a persona, adopt that persona
		if (result.matched && result.persona) {
			const finalContent =
				result.strippedContent.length > 0 ? result.strippedContent : hasRealOriginalText ? (originalContent ?? '') : '';
			return {
				finalContent,
				subprofile: {
					id: result.persona.id,
					name: result.persona.name,
					avatar: result.persona.avatar_url ?? null,
					avatar_color: result.persona.color ?? null,
					system_name: result.persona.system_name ?? null,
					pronouns: result.persona.pronouns ?? null,
					color: result.persona.color ?? null,
					bio: result.persona.bio ?? null,
				},
			};
		}

		// Preserve existing subprofile if no tags matched
		if (currentSubprofile) {
			return {
				finalContent: content,
				subprofile: {
					id: currentSubprofile.id,
					name: currentSubprofile.name,
					avatar: currentSubprofile.avatar ?? null,
					avatar_color: currentSubprofile.avatar_color ?? null,
					system_name: currentSubprofile.system_name ?? null,
					pronouns: currentSubprofile.pronouns ?? null,
					color: currentSubprofile.color ?? null,
					bio: currentSubprofile.bio ?? null,
				},
			};
		}

		return {
			finalContent: content,
			subprofile: undefined,
		};
	}
}

export const PersonaStore = new PersonaStoreClass();
export const SubprofileStore = PersonaStore;
