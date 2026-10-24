// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import {
	clearPersonaMentionCache,
	invalidatePersonaMentionCache,
} from '@app/features/lexical/composer/useAutocompletePersonaSearch';
import MessageReactions from '@app/features/messaging/state/MessageReactions';
import Messages from '@app/features/messaging/state/MessagingMessages';
import type {
	PersonaChannelState,
	PersonaResponse,
	PersonaSettingsResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {forgetPersonaProfilesOf} from '../commands/PersonaCommands';
import {normalizeSubprofile, PersonaStore} from '../state/PersonaStore';
import {applyPersonaUpdate, requestPersonaRefresh} from './PersonaRefresh';

type PersonaPayload = {persona: PersonaResponse} | PersonaResponse;
type PersonaDeletePayload = {persona_id: string} | {id: string};
type PersonasPayload = {personas: Array<PersonaResponse>} | Array<PersonaResponse>;

export function handleUserPersonaCreate(data: PersonaPayload, _context: GatewayHandlerContext): void {
	const persona = data && 'persona' in data && data.persona ? data.persona : (data as PersonaResponse);
	if (persona?.id) {
		PersonaStore.upsertPersona(persona);
		clearPersonaMentionCache();
	}
}

export function handleUserPersonaUpdate(data: PersonaPayload, _context: GatewayHandlerContext): void {
	const persona = data && 'persona' in data && data.persona ? data.persona : (data as PersonaResponse);
	if (persona?.id) {
		PersonaStore.upsertPersona(persona);
		clearPersonaMentionCache();
		const subprofile = normalizeSubprofile(persona);
		Messages.handlePersonaUpdate({persona: subprofile});
		MessageReactions.handlePersonaUpdate(subprofile);
	}
}

export function handleUserPersonaDelete(data: PersonaDeletePayload, _context: GatewayHandlerContext): void {
	const id = (data as any)?.persona_id ?? (data as any)?.id;
	if (id) {
		PersonaStore.removePersona(id);
		clearPersonaMentionCache();
	}
}

export function handleUserPersonasUpdate(data: PersonasPayload, _context: GatewayHandlerContext): void {
	const personas = Array.isArray(data)
		? data
		: data && Array.isArray((data as any).personas)
			? (data as any).personas
			: null;
	if (personas) {
		PersonaStore.setPersonas(personas);
		clearPersonaMentionCache();
		for (const p of personas) {
			const subprofile = normalizeSubprofile(p);
			Messages.handlePersonaUpdate({persona: subprofile});
			MessageReactions.handlePersonaUpdate(subprofile);
		}
	}
}

export function handleUserPersonaSettingsUpdate(
	data: PersonaSettingsResponse | {settings: PersonaSettingsResponse},
	_context: GatewayHandlerContext,
): void {
	const settings = data && 'settings' in data && data.settings ? data.settings : (data as PersonaSettingsResponse);
	if (settings) {
		PersonaStore.updateSettings(settings);
		clearPersonaMentionCache();
		const currentUserId = Authentication.currentUserId;
		if (currentUserId) {
			Messages.handleAuthorDisplayTagUpdate({
				userId: currentUserId,
				display_tag_text: settings.display_tag_text,
				display_tag_icon: settings.display_tag_icon,
			});
			MessageReactions.handleAuthorDisplayTagUpdate({
				userId: currentUserId,
				display_tag_text: settings.display_tag_text,
				display_tag_icon: settings.display_tag_icon,
			});
		}
	}
}

/** Another session of this account selected a persona in a channel, or the server cleared one. */
export function handleUserPersonaChannelStateUpdate(
	data: PersonaChannelState | undefined,
	_context: GatewayHandlerContext,
): void {
	if (data?.channel_id) {
		PersonaStore.handleChannelStateUpdate({channel_id: data.channel_id, persona_id: data.persona_id ?? null});
	}
}

/**
 * Another account changed its personas. For public and unlisted personas the event carries the persona,
 * as older servers did for all; otherwise it carries only the account, and the personas of it this
 * client shows are fetched again (`requestPersonaRefresh`). A deleted persona keeps showing as it was
 * on old messages, so a delete fetches nothing.
 */
export function handleGuildPersonasDirty(
	data:
		| {
				guild_id?: string;
				user_id?: string;
				persona?: any;
				action?: 'update' | 'delete' | 'sync';
				display_tag_text?: string | null;
				display_tag_icon?: string | null;
		  }
		| undefined,
	_context: GatewayHandlerContext,
): void {
	if (data?.user_id && data.user_id === Authentication.currentUserId) {
		return;
	}
	invalidatePersonaMentionCache(data?.guild_id);
	if (data?.user_id) forgetPersonaProfilesOf(data.user_id);
	if (data?.action === 'update' || data?.action === 'sync') {
		if (data.persona) {
			const subprofile = normalizeSubprofile(data.persona);
			// Only a persona already shown here is remembered; the event alone is no reason to keep one.
			if (PersonaStore.getKnownPersona(subprofile.id)) PersonaStore.recordKnownPersona(subprofile, data.user_id);
			applyPersonaUpdate(subprofile);
		} else if (data.user_id) {
			requestPersonaRefresh(data.user_id);
		}
	}
	if (data?.user_id && (data?.display_tag_text !== undefined || data?.display_tag_icon !== undefined)) {
		Messages.handleAuthorDisplayTagUpdate({
			userId: data.user_id,
			display_tag_text: data.display_tag_text,
			display_tag_icon: data.display_tag_icon,
		});
		MessageReactions.handleAuthorDisplayTagUpdate({
			userId: data.user_id,
			display_tag_text: data.display_tag_text,
			display_tag_icon: data.display_tag_icon,
		});
	}
}
