// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: sending as the persona selected for a channel, for a sender that cannot see the selection,
// such as a reply typed in a notification (tyne-chat/tyne#343).
//
// Clients decide the persona of a message themselves and send its id; the server only stores the
// selection for them. A message request with `use_persona_selection` asks the server to decide
// instead, by the clients' rule: the persona selected in the channel when selections are kept per
// channel, otherwise the latched one, and a tag in the text wins over both, through the same
// `matchPersona` the web app uses. A deleted persona is no longer in the list, so the message goes
// out as the account. Nothing is changed by it: the escapes that unlatch on a client (`\\`) only
// send as the account here, and in "last" mode the selection does not move.

import {type ChannelID, createPersonaID, type PersonaID, type UserID} from '@app/api/BrandedTypes';
import type {MessageRequest} from '@app/api/channel/MessageTypes';
import type {PersonaChannelStateRow, UserPersonaSettingsRow} from '@app/api/database/types/PersonaTypes';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';
import {loadPersonaChannelStates} from '@app/api/persona/PersonaChannelStateStore';
import {matchPersona, type PersonaLike} from '@fluxer/schema/src/domains/persona/PersonaMatcher';

type ChannelStateLoader = (userId: UserID) => Promise<Array<PersonaChannelStateRow>>;

/** The persona an untagged message in the channel goes out as, or null for the account. */
async function selectedPersonaId(
	settings: UserPersonaSettingsRow | null,
	userId: UserID,
	channelId: ChannelID,
	loadChannelStates: ChannelStateLoader,
): Promise<string | null> {
	if (!settings) return null;
	if (settings.active_persona_scope === 'channel') {
		const states = await loadChannelStates(userId);
		const state = states.find((row) => row.channel_id.toString() === channelId.toString());
		return state ? state.persona_id.toString() : null;
	}
	return settings.is_latched && settings.active_persona_id ? settings.active_persona_id.toString() : null;
}

/**
 * Decides the persona of a message request that asked for the selection, and takes a matched tag
 * out of its content. Returns the persona, or null for the account.
 */
export async function applyPersonaSelection({
	personaRepository,
	userId,
	channelId,
	data,
	loadChannelStates = loadPersonaChannelStates,
}: {
	personaRepository: IPersonaRepository;
	userId: UserID;
	channelId: ChannelID;
	data: MessageRequest;
	loadChannelStates?: ChannelStateLoader;
}): Promise<PersonaID | null> {
	const [settings, personas] = await Promise.all([
		personaRepository.findSettings(userId),
		personaRepository.findByUserId(userId),
	]);
	const selectedId = await selectedPersonaId(settings, userId, channelId, loadChannelStates);
	const candidates: Array<PersonaLike> = personas.map((persona) => ({
		id: persona.id.toString(),
		name: persona.name,
		persona_tags: persona.personaTags,
		auto_tag_disabled: persona.autoTagDisabled,
	}));
	const hasAttachments = (data.attachments?.length ?? 0) > 0;
	const match = matchPersona(data.content ?? '', candidates, selectedId, hasAttachments);
	if (typeof data.content === 'string' && (match.matched || match.wasEscaped)) {
		data.content = match.strippedContent;
	}
	return match.matched && match.persona ? createPersonaID(BigInt(match.persona.id)) : null;
}
