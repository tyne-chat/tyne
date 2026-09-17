// SPDX-License-Identifier: AGPL-3.0-or-later
import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import * as Toast from '@app/features/ui/commands/ToastCommands';
import type {
	PersonaResponse,
	PersonaSettingsResponse,
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
	raw: PersonaResponse | (Partial<ClientPersona> & {id: string; name: string}) | {persona: PersonaResponse},
): ClientPersona {
	const source: any = (raw as any)?.persona ?? raw;
	const avatarUrl = source.avatar_url !== undefined ? source.avatar_url : (source.avatarUrl ?? null);
	const systemName = source.system_name !== undefined ? source.system_name : (source.systemName ?? null);
	const color =
		source.color !== undefined
			? source.color
			: source.accentColor !== undefined
				? source.accentColor
				: (source.accent_color ?? null);
	const rawTags = source.persona_tags ?? source.personaTags ?? [];
	const tags: Array<PersonaTag> = rawTags.map((t: any) => ({
		prefix: t.prefix ?? undefined,
		suffix: t.suffix ?? undefined,
	}));
	const useCount = source.use_count ?? source.useCount ?? 0;
	const lastUsedRaw = source.last_used_at_ms ?? source.lastUsedAtMs;
	const lastUsedAtMsStr = lastUsedRaw != null ? String(lastUsedRaw) : null;
	const lastUsedAtMsBigInt = lastUsedRaw != null ? BigInt(lastUsedRaw) : 0n;
	const autoTag =
		source.auto_tag_disabled !== undefined ? Boolean(source.auto_tag_disabled) : Boolean(source.autoTagDisabled);
	const visibility: PersonaVisibility = source.visibility ?? 'unlisted';

	return {
		id: source.id ?? '',
		name: source.name ?? '',
		avatar_url: avatarUrl,
		system_name: systemName,
		pronouns: source.pronouns ?? null,
		color,
		bio: source.bio ?? null,
		auto_tag_disabled: autoTag,
		persona_tags: tags,
		use_count: useCount,
		last_used_at_ms: lastUsedAtMsStr,
		visibility,
		external_uuid: source.external_uuid ?? null,
		created_at: source.created_at ?? new Date().toISOString(),
		updated_at: source.updated_at ?? new Date().toISOString(),
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
	private _displayTagText: string = '';
	private _displayTagIcon: string | null = null;
	private _activePersonaMode: ActivePersonaMode = 'off';
	private _activePersonaId: string | null = null;
	private _isPersonaLatched: boolean = false;
	private _settingsLoaded: boolean = false;

	constructor() {
		makeAutoObservable(this);
	}

	get personas(): ReadonlyArray<ClientPersona> {
		return this._personas;
	}

	setPersonas(
		personas: Array<PersonaResponse | ClientPersona> | {personas: Array<PersonaResponse | ClientPersona>},
	): void {
		runInAction(() => {
			const list = Array.isArray(personas)
				? personas
				: Array.isArray((personas as any)?.personas)
					? (personas as any).personas
					: [];
			this._personas = list
				.filter((p: any) => Boolean((p as any)?.id || (p as any)?.persona?.id))
				.map(normalizePersona);
		});
	}

	upsertPersona(persona: PersonaResponse | ClientPersona | {persona: PersonaResponse}): void {
		runInAction(() => {
			const normalized = normalizePersona(persona);
			if (!normalized.id) {
				return;
			}
			const idx = this._personas.findIndex((p) => p.id === normalized.id);
			if (idx >= 0) {
				this._personas[idx] = normalized;
			} else {
				this._personas.push(normalized);
			}
		});
	}

	upsertPersonas(
		personas: Array<PersonaResponse | ClientPersona> | {personas: Array<PersonaResponse | ClientPersona>},
	): void {
		runInAction(() => {
			const list = Array.isArray(personas)
				? personas
				: Array.isArray((personas as any)?.personas)
					? (personas as any).personas
					: [];
			for (const p of list) {
				const normalized = normalizePersona(p);
				if (!normalized.id) {
					continue;
				}
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
		if (!id) {
			return;
		}
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
			this._displayTagText = '';
			this._displayTagIcon = null;
			this._activePersonaMode = 'off';
			this._activePersonaId = null;
			this._isPersonaLatched = false;
			this._settingsLoaded = false;
		});
	}

	handleSessionInvalidated(): void {
		this.clear();
	}

	get activePersonaId(): string | null {
		return this._activePersonaId && this._activePersonaId.length > 0 ? this._activePersonaId : null;
	}

	get activePersonaMode(): ActivePersonaMode {
		return this._activePersonaMode;
	}

	get isPersonaLatched(): boolean {
		return this._isPersonaLatched;
	}

	get activePersona(): ClientPersona | null {
		const id = this.activePersonaId;
		if (!id) return null;
		return this._personas.find((p) => p.id === id) ?? null;
	}

	get displayTagText(): string {
		return this._displayTagText;
	}

	get displayTagIcon(): string | null {
		return this._displayTagIcon && this._displayTagIcon.length > 0 ? this._displayTagIcon : null;
	}

	get isSettingsLoaded(): boolean {
		return this._settingsLoaded;
	}

	updateSettings(settings: Partial<PersonaSettingsResponse>): void {
		runInAction(() => {
			if (settings.active_persona_mode !== undefined) {
				this._activePersonaMode = settings.active_persona_mode;
			}
			if (settings.active_persona_id !== undefined) {
				this._activePersonaId = settings.active_persona_id;
			}
			if (settings.is_latched !== undefined) {
				this._isPersonaLatched = settings.is_latched;
			}
			if (settings.display_tag_text !== undefined) {
				this._displayTagText = settings.display_tag_text ?? '';
			}
			if (settings.display_tag_icon !== undefined) {
				this._displayTagIcon = settings.display_tag_icon ?? null;
			}
			this._settingsLoaded = true;
		});
	}

	async setDisplayTag(text: string, icon?: string | null): Promise<void> {
		const newText = text.trim();
		const newIcon = icon !== undefined ? (icon ? icon.trim() : null) : this._displayTagIcon;
		runInAction(() => {
			this._displayTagText = newText;
			this._displayTagIcon = newIcon;
		});
		try {
			await http.patch(Endpoints.USER_PERSONA_SETTINGS, {
				body: {
					display_tag_text: newText,
					display_tag_icon: newIcon,
				},
			});
		} catch {
			// Non-blocking
		}
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
		let targetId: string | null = this._activePersonaId;
		let targetLatched: boolean = this._isPersonaLatched;

		if (mode === 'off') {
			targetId = null;
			targetLatched = false;
		} else if (mode === 'manual') {
			const currentId = this._activePersonaId;
			targetId =
				currentId && this._personas.some((p) => p.id === currentId)
					? currentId
					: (this.rankedPersonas[0]?.id ?? this._personas[0]?.id ?? null);
			targetLatched = Boolean(targetId);
		} else if (mode === 'last') {
			const currentId = this._activePersonaId;
			if (currentId && this._personas.some((p) => p.id === currentId)) {
				targetLatched = true;
			} else {
				targetId = null;
				targetLatched = false;
			}
		}

		runInAction(() => {
			this._activePersonaMode = mode;
			this._activePersonaId = targetId;
			this._isPersonaLatched = targetLatched;
		});

		try {
			await http.patch(Endpoints.USER_PERSONA_SETTINGS, {
				body: {
					active_persona_mode: mode,
					active_persona_id: targetId,
					is_latched: targetLatched,
				},
			});
		} catch {
			// Non-blocking
		}
	}

	async setActivePersona(id: string | null, latch = true, mode?: ActivePersonaMode): Promise<void> {
		let newMode = mode ?? this._activePersonaMode;
		if (!mode && id && latch && this._activePersonaMode === 'off') {
			newMode = 'manual';
		}
		const newLatched = Boolean(id && latch);

		runInAction(() => {
			this._activePersonaId = id;
			this._isPersonaLatched = newLatched;
			this._activePersonaMode = newMode;
		});

		try {
			await http.patch(Endpoints.USER_PERSONA_SETTINGS, {
				body: {
					active_persona_id: id,
					is_latched: newLatched,
					active_persona_mode: newMode,
				},
			});
		} catch {
			// Non-blocking
		}
	}

	async unlatch(preserveMode?: boolean): Promise<void> {
		const shouldPreserve = preserveMode ?? this._activePersonaMode === 'last';
		const newMode = shouldPreserve ? this._activePersonaMode : 'off';

		runInAction(() => {
			this._isPersonaLatched = false;
			this._activePersonaId = null;
			this._activePersonaMode = newMode;
		});

		try {
			await http.patch(Endpoints.USER_PERSONA_SETTINGS, {
				body: {
					is_latched: false,
					active_persona_id: null,
					active_persona_mode: newMode,
				},
			});
		} catch {
			// Non-blocking
		}
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
