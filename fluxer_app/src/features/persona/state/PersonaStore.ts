// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Toast from '@app/features/ui/commands/ToastCommands';
import UserSettings from '@app/features/user/state/UserSettings';
import type {
	PersonaResponse,
	PersonaTag,
	PersonaVisibility,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {type MatchResult, matchPersona, previewPersona} from '@fluxer/schema/src/domains/persona/PersonaMatcher';
import type {
	MessageSubprofileRequest,
	MessageSubprofileResponse,
} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';
import {makeAutoObservable, runInAction} from 'mobx';

export type ActivePersonaMode = 'off' | 'manual' | 'last';

export interface ClientPersona extends PersonaResponse {
	// CamelCase aliases for backwards compatibility with React components
	avatarUrl?: string | null;
	systemName?: string | null;
	personaTags?: Array<{prefix?: string; suffix?: string}>;
	accentColor?: number | null;
	autoTagDisabled?: boolean;
	useCount?: number;
	lastUsedAtMs?: bigint | null;
}

export type Persona = ClientPersona;

let personaIdCounter = 0;

export function normalizePersona(
	raw: PersonaResponse | (Partial<ClientPersona> & {id: string; name: string}),
): ClientPersona {
	const avatarUrl = (raw as any).avatar_url !== undefined ? (raw as any).avatar_url : ((raw as any).avatarUrl ?? null);
	const systemName =
		(raw as any).system_name !== undefined ? (raw as any).system_name : ((raw as any).systemName ?? null);
	const color =
		(raw as any).color !== undefined
			? (raw as any).color
			: (raw as any).accentColor !== undefined
				? (raw as any).accentColor
				: ((raw as any).accent_color ?? null);
	const rawTags = (raw as any).persona_tags ?? (raw as any).personaTags ?? [];
	const tags: Array<PersonaTag> = rawTags.map((t: any) => ({
		prefix: t.prefix ?? undefined,
		suffix: t.suffix ?? undefined,
	}));
	const useCount = (raw as any).use_count ?? (raw as any).useCount ?? 0;
	const lastUsedRaw = (raw as any).last_used_at_ms ?? (raw as any).lastUsedAtMs;
	const lastUsedAtMsStr = lastUsedRaw != null ? String(lastUsedRaw) : null;
	const lastUsedAtMsBigInt = lastUsedRaw != null ? BigInt(lastUsedRaw) : 0n;
	const autoTag =
		(raw as any).auto_tag_disabled !== undefined
			? Boolean((raw as any).auto_tag_disabled)
			: Boolean((raw as any).autoTagDisabled);
	const visibility: PersonaVisibility = (raw as any).visibility ?? 'unlisted';

	return {
		id: raw.id,
		name: raw.name,
		avatar_url: avatarUrl,
		system_name: systemName,
		pronouns: raw.pronouns ?? null,
		color,
		bio: raw.bio ?? null,
		auto_tag_disabled: autoTag,
		persona_tags: tags,
		use_count: useCount,
		last_used_at_ms: lastUsedAtMsStr,
		visibility,
		external_uuid: (raw as any).external_uuid ?? null,
		created_at: (raw as any).created_at ?? new Date().toISOString(),
		updated_at: (raw as any).updated_at ?? new Date().toISOString(),
		// CamelCase aliases
		avatarUrl,
		systemName,
		personaTags: tags,
		accentColor: color,
		autoTagDisabled: autoTag,
		useCount,
		lastUsedAtMs: lastUsedAtMsBigInt,
	};
}

export class PersonaStoreClass {
	private _personas: Array<ClientPersona> = [];

	constructor() {
		makeAutoObservable(this);
	}

	get personas(): ReadonlyArray<ClientPersona> {
		return this._personas;
	}

	setPersonas(personas: Array<PersonaResponse | ClientPersona>): void {
		runInAction(() => {
			this._personas = personas.map(normalizePersona);
		});
	}

	upsertPersona(persona: PersonaResponse | ClientPersona): void {
		runInAction(() => {
			const normalized = normalizePersona(persona);
			const idx = this._personas.findIndex((p) => p.id === normalized.id);
			if (idx >= 0) {
				this._personas[idx] = normalized;
			} else {
				this._personas.push(normalized);
			}
		});
	}

	upsertPersonas(personas: Array<PersonaResponse | ClientPersona>): void {
		runInAction(() => {
			for (const p of personas) {
				const normalized = normalizePersona(p);
				const idx = this._personas.findIndex((item) => item.id === normalized.id);
				if (idx >= 0) {
					this._personas[idx] = normalized;
				} else {
					this._personas.push(normalized);
				}
			}
		});
	}

	removePersona(id: string): void {
		runInAction(() => {
			this._personas = this._personas.filter((p) => p.id !== id);
		});
		if (this.activePersonaId === id) {
			void this.unlatch();
		}
	}

	clear(): void {
		runInAction(() => {
			this._personas = [];
		});
	}

	handleSessionInvalidated(): void {
		this.clear();
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

	get activePersona(): ClientPersona | null {
		const id = this.activePersonaId;
		if (!id) return null;
		return this._personas.find((p) => p.id === id) ?? null;
	}

	get displayTagText(): string {
		return UserSettings.getSubPreference('displayTagText') ?? '';
	}

	get displayTagIcon(): string | null {
		const icon = UserSettings.getSubPreference('displayTagIcon');
		return icon && icon.length > 0 ? icon : null;
	}

	async setDisplayTag(text: string, icon?: string | null): Promise<void> {
		await UserSettings.setSubPreference('displayTagText', text.trim());
		await UserSettings.setSubPreference('displayTagIcon', (icon ?? '').trim());
	}

	get rankedPersonas(): ReadonlyArray<ClientPersona> {
		const now = Date.now();
		return [...this._personas].sort((a, b) => {
			const scoreA = this.calculateFrecency(a, now);
			const scoreB = this.calculateFrecency(b, now);
			return scoreB - scoreA;
		});
	}

	private calculateFrecency(persona: ClientPersona, nowMs: number): number {
		const lastUsed = Number(persona.last_used_at_ms ?? persona.lastUsedAtMs ?? 0);
		const count = persona.use_count ?? persona.useCount ?? 0;
		if (lastUsed === 0) return 0;
		const hoursAgo = Math.max(0, (nowMs - lastUsed) / (1000 * 60 * 60));
		const recencyFactor = 0.5 ** (hoursAgo / 24);
		return (count + 1) * recencyFactor;
	}

	findPersonaByName(query: string): ClientPersona | null {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return null;
		const exact = this._personas.find((p) => p.name.toLowerCase() === trimmed);
		if (exact) return exact;
		const starts = this._personas.find((p) => p.name.toLowerCase().startsWith(trimmed));
		if (starts) return starts;
		return this._personas.find((p) => p.name.toLowerCase().includes(trimmed)) ?? null;
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
		visibility?: PersonaVisibility;
		external_uuid?: string | null;
		persona_tags?: Array<{prefix?: string; suffix?: string}>;
	}): Promise<ClientPersona> {
		const id = `${SnowflakeUtils.fromTimestamp(Date.now())}_${++personaIdCounter}`;
		const normalized = normalizePersona({
			id,
			name: personaData.name,
			avatar_url: personaData.avatar_url ?? null,
			system_name: personaData.system_name ?? null,
			pronouns: personaData.pronouns ?? null,
			color: personaData.accentColor ?? personaData.accent_color ?? personaData.color ?? null,
			bio: personaData.bio ?? null,
			persona_tags: personaData.persona_tags ?? [],
			visibility: personaData.visibility ?? 'unlisted',
			external_uuid: personaData.external_uuid ?? null,
		});
		this.upsertPersona(normalized);
		return normalized;
	}

	async updatePersona(
		id: string,
		updates: Partial<ClientPersona> & {accentColor?: number | null; accent_color?: number | null},
	): Promise<void> {
		const existing = this._personas.find((p) => p.id === id);
		if (!existing) return;
		const updated = normalizePersona({
			...existing,
			...updates,
			id,
			name: updates.name ?? existing.name,
		});
		this.upsertPersona(updated);
	}

	async deletePersona(id: string): Promise<void> {
		this.removePersona(id);
		if (this.activePersonaId === id) {
			await this.unlatch();
		}
	}

	async replaceAllPersonas(newPersonas: Array<ClientPersona | PersonaResponse>): Promise<void> {
		this.setPersonas(newPersonas);
		if (this.activePersonaId && !this._personas.some((p) => p.id === this.activePersonaId)) {
			await this.unlatch();
		}
	}

	async appendPersonas(newPersonas: Array<ClientPersona | PersonaResponse>): Promise<void> {
		this.upsertPersonas(newPersonas);
	}

	async setActivePersonaMode(mode: ActivePersonaMode): Promise<void> {
		const p1 = UserSettings.setSubPreference('activePersonaMode', mode);
		const promises: Array<Promise<void>> = [p1];
		if (mode === 'off') {
			promises.push(UserSettings.setSubPreference('activePersonaId', ''));
			promises.push(UserSettings.setSubPreference('activePersonaLatched', false));
		} else if (mode === 'manual') {
			const currentId = this.activePersonaId;
			const targetId =
				currentId && this._personas.some((p) => p.id === currentId)
					? currentId
					: (this.rankedPersonas[0]?.id ?? this._personas[0]?.id ?? '');
			promises.push(UserSettings.setSubPreference('activePersonaId', targetId));
			promises.push(UserSettings.setSubPreference('activePersonaLatched', Boolean(targetId)));
		} else if (mode === 'last') {
			const currentId = this.activePersonaId;
			if (currentId && this._personas.some((p) => p.id === currentId)) {
				promises.push(UserSettings.setSubPreference('activePersonaLatched', true));
			} else {
				promises.push(UserSettings.setSubPreference('activePersonaId', ''));
				promises.push(UserSettings.setSubPreference('activePersonaLatched', false));
			}
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

	async unlatch(preserveMode?: boolean): Promise<void> {
		const shouldPreserve = preserveMode ?? this.activePersonaMode === 'last';
		const p1 = UserSettings.setSubPreference('activePersonaLatched', false);
		const p2 = UserSettings.setSubPreference('activePersonaId', '');
		const promises: Array<Promise<void>> = [p1, p2];
		if (!shouldPreserve) {
			promises.push(UserSettings.setSubPreference('activePersonaMode', 'off'));
		}
		await Promise.all(promises);
	}

	async recordPersonaUse(id: string): Promise<void> {
		const persona = this._personas.find((p) => p.id === id);
		if (persona) {
			persona.use_count = (persona.use_count ?? 0) + 1;
			persona.useCount = persona.use_count;
			persona.last_used_at_ms = Date.now().toString();
			persona.lastUsedAtMs = BigInt(persona.last_used_at_ms);
		}
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
		const personasLike = this._personas.map((p) => ({
			id: p.id,
			name: p.name,
			avatar_url: p.avatar_url ?? p.avatarUrl ?? null,
			system_name: p.system_name ?? p.systemName ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? p.accentColor ?? null,
			auto_tag_disabled: p.auto_tag_disabled ?? p.autoTagDisabled ?? false,
			bio: p.bio ?? null,
			persona_tags: (p.persona_tags ?? p.personaTags ?? []).map((t) => ({
				prefix: t.prefix ?? null,
				suffix: t.suffix ?? null,
			})),
		}));

		const activeLatchedId = this.activePersona?.id ?? null;
		const result = matchPersona(content, personasLike, activeLatchedId, hasAttachments);

		if (result.clearedLatch || (result.wasEscaped && this.activePersonaMode === 'last')) {
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

	getEffectivePersonaForText(
		content: string,
		hasAttachments = false,
	): {persona: ClientPersona | null; isFromTag: boolean} {
		const personasLike = this._personas.map((p) => ({
			id: p.id,
			name: p.name,
			avatar_url: p.avatar_url ?? p.avatarUrl ?? null,
			system_name: p.system_name ?? p.systemName ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? p.accentColor ?? null,
			auto_tag_disabled: p.auto_tag_disabled ?? p.autoTagDisabled ?? false,
			bio: p.bio ?? null,
			persona_tags: (p.persona_tags ?? p.personaTags ?? []).map((t) => ({
				prefix: t.prefix ?? null,
				suffix: t.suffix ?? null,
			})),
		}));

		const activeLatchedId = this.isPersonaLatched && this.activePersona ? this.activePersona.id : null;
		const preview = previewPersona(content, personasLike, activeLatchedId, hasAttachments);

		if (preview.persona) {
			const found = this._personas.find((p) => p.id === preview.persona!.id) ?? null;
			return {persona: found, isFromTag: preview.isFromTag};
		}

		return {persona: null, isFromTag: false};
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

		const personasLike = this._personas.map((p) => ({
			id: p.id,
			name: p.name,
			avatar_url: p.avatar_url ?? p.avatarUrl ?? null,
			system_name: p.system_name ?? p.systemName ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? p.accentColor ?? null,
			auto_tag_disabled: p.auto_tag_disabled ?? p.autoTagDisabled ?? false,
			bio: p.bio ?? null,
			persona_tags: (p.persona_tags ?? p.personaTags ?? []).map((t) => ({
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

		// If explicit persona tags matched a persona, adopt that persona (note: bio omitted to keep message payload lightweight)
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
					display_tag_text: this.displayTagText || null,
					display_tag_icon: this.displayTagIcon || null,
					system_name: this.displayTagText || null,
					pronouns: result.persona.pronouns ?? null,
					color: result.persona.color ?? null,
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
					display_tag_text: currentSubprofile.display_tag_text ?? currentSubprofile.system_name ?? null,
					display_tag_icon: currentSubprofile.display_tag_icon ?? null,
					system_name: currentSubprofile.display_tag_text ?? currentSubprofile.system_name ?? null,
					pronouns: currentSubprofile.pronouns ?? null,
					color: currentSubprofile.color ?? null,
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
