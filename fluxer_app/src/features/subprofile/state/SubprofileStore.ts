// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Toast from '@app/features/ui/commands/ToastCommands';
import UserSettings from '@app/features/user/state/UserSettings';
import {type MatchResult, matchProxy} from '@fluxer/schema/src/domains/subprofile/ProxyMatcher';
import type {
	MessageSubprofileRequest,
	MessageSubprofileResponse,
} from '@fluxer/schema/src/domains/subprofile/SubprofileSchemas';
import type {Persona} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/preferences_pb';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';
import {makeAutoObservable} from 'mobx';

export type AutoproxyMode = 'off' | 'manual' | 'last';

let personaIdCounter = 0;

export class SubprofileStoreClass {
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

	get autoproxyMode(): AutoproxyMode {
		const raw = UserSettings.getSubPreference('autoproxyMode');
		if (raw === 'off' || raw === 'manual' || raw === 'last') {
			return raw;
		}
		return this.autoproxyLatched ? 'last' : 'off';
	}

	get autoproxyLatched(): boolean {
		return UserSettings.getSubPreference('autoproxyLatched') ?? false;
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
		bio?: string | null;
		proxy_tags?: Array<{prefix?: string; suffix?: string}>;
	}): Promise<Persona> {
		const id = `${SnowflakeUtils.fromTimestamp(Date.now())}_${++personaIdCounter}`;
		const newPersona: Persona = {
			$typeName: 'fluxer.user.preferences.v1.Persona',
			id,
			name: personaData.name,
			avatarUrl: personaData.avatar_url ?? undefined,
			systemName: personaData.system_name ?? undefined,
			pronouns: personaData.pronouns ?? undefined,
			color: personaData.color ?? undefined,
			bio: personaData.bio ?? undefined,
			autoProxyDisabled: false,
			useCount: 0,
			lastUsedAtMs: 0n,
			proxyTags: (personaData.proxy_tags ?? []).map((t) => ({
				$typeName: 'fluxer.user.preferences.v1.ProxyTag',
				prefix: t.prefix ?? undefined,
				suffix: t.suffix ?? undefined,
			})),
		};

		const updatedList = [...this.personas, newPersona];
		await UserSettings.setSubPreference('personas', updatedList);
		return newPersona;
	}

	async updatePersona(id: string, updates: Partial<Persona>): Promise<void> {
		const updatedList = this.personas.map((p) => {
			if (p.id !== id) return p;
			return {
				...p,
				...updates,
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

	async setAutoproxyMode(mode: AutoproxyMode): Promise<void> {
		const p1 = UserSettings.setSubPreference('autoproxyMode', mode);
		const p2 = UserSettings.setSubPreference('autoproxyLatched', mode !== 'off');
		const promises: Array<Promise<void>> = [p1, p2];
		if (mode === 'off') {
			promises.push(UserSettings.setSubPreference('activePersonaId', ''));
		} else if (!this.activePersonaId && this.personas.length > 0) {
			promises.push(UserSettings.setSubPreference('activePersonaId', this.personas[0].id));
		}
		await Promise.all(promises);
	}

	async setActivePersona(id: string | null, latch = true, mode?: AutoproxyMode): Promise<void> {
		const p1 = UserSettings.setSubPreference('activePersonaId', id ?? '');
		const p2 = UserSettings.setSubPreference('autoproxyLatched', Boolean(id && latch));
		const promises: Array<Promise<void>> = [p1, p2];
		if (mode) {
			promises.push(UserSettings.setSubPreference('autoproxyMode', mode));
		} else if (id && latch && this.autoproxyMode === 'off') {
			promises.push(UserSettings.setSubPreference('autoproxyMode', 'manual'));
		}
		await Promise.all(promises);
	}

	async unlatch(): Promise<void> {
		const p1 = UserSettings.setSubPreference('autoproxyLatched', false);
		const p2 = UserSettings.setSubPreference('activePersonaId', '');
		const p3 = UserSettings.setSubPreference('autoproxyMode', 'off');
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
			Toast.success('Autoproxy latch cleared');
			return {isCommand: true, handled: true};
		}
		return {isCommand: false, handled: false};
	}

	matchOutgoingMessage(content: string): MatchResult {
		const personasLike = this.personas.map((p) => ({
			id: p.id,
			name: p.name,
			avatar_url: p.avatarUrl ?? null,
			system_name: p.systemName ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? null,
			auto_proxy_disabled: p.autoProxyDisabled ?? false,
			bio: p.bio ?? null,
			proxy_tags: (p.proxyTags ?? []).map((t) => ({
				prefix: t.prefix ?? null,
				suffix: t.suffix ?? null,
			})),
		}));

		const activeLatchedId = this.activePersona?.id ?? null;
		const result = matchProxy(content, personasLike, activeLatchedId);

		if (result.clearedLatch) {
			void this.unlatch();
			Toast.success('Autoproxy turned off (sending as root account)');
		} else if (result.matched && result.persona) {
			void this.recordPersonaUse(result.persona.id);
			if (this.autoproxyMode === 'last' && this.activePersonaId !== result.persona.id) {
				void this.setActivePersona(result.persona.id, true, 'last');
			}
		}

		return result;
	}

	matchEditMessage(
		content: string,
		currentSubprofile?: MessageSubprofileResponse | null,
	): {
		finalContent: string;
		subprofile?: MessageSubprofileRequest | null;
	} {
		const personasLike = this.personas.map((p) => ({
			id: p.id,
			name: p.name,
			avatar_url: p.avatarUrl ?? null,
			system_name: p.systemName ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? null,
			auto_proxy_disabled: p.autoProxyDisabled ?? false,
			bio: p.bio ?? null,
			proxy_tags: (p.proxyTags ?? []).map((t) => ({
				prefix: t.prefix ?? null,
				suffix: t.suffix ?? null,
			})),
		}));

		// Pass currentSubprofile?.id as latched persona so that leading backslash escape works
		const result = matchProxy(content, personasLike, currentSubprofile?.id ?? null);

		// If user typed \ or \\ to explicitly unproxy / escape
		if (result.wasEscaped && currentSubprofile) {
			return {
				finalContent: result.strippedContent,
				subprofile: null,
			};
		}

		// If explicit proxy tags matched a persona, adopt that persona
		if (result.matched && result.persona) {
			return {
				finalContent: result.strippedContent,
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

export const SubprofileStore = new SubprofileStoreClass();
