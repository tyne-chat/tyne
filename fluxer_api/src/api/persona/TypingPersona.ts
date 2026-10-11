// SPDX-License-Identifier: AGPL-3.0-or-later

import type {UserID} from '@app/api/BrandedTypes';
import {getPersonaRepository} from '@app/api/middleware/ServiceSingletons';
import {resolveOwnedPersona} from '@app/api/persona/PersonaOwnership';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

/** Who is typing, as far as an indicator shows it: no bio, banner or visibility. */
export type TypingSubprofile = Pick<
	MessageSubprofileResponse,
	'id' | 'name' | 'avatar' | 'avatar_color' | 'display_tag_text' | 'display_tag_icon' | 'pronouns' | 'color'
>;

/**
 * What a typing indicator shows for the persona a request names, read from the account's own
 * records: the request supplies the id and nothing else. `undefined` when it names no persona.
 * A persona the account does not own, or has deleted, is refused, so that nobody is shown typing
 * as the account when they meant a persona.
 */
export async function resolveTypingSubprofile(
	userId: UserID,
	personaId: string | null | undefined,
): Promise<TypingSubprofile | undefined> {
	if (personaId == null) return undefined;
	const personaRepository = getPersonaRepository();
	const [persona, settings] = await Promise.all([
		resolveOwnedPersona(personaRepository, userId, personaId),
		personaRepository.findSettings(userId),
	]);
	const subprofile = persona.toSubprofileResponse(settings);
	return {
		id: subprofile.id,
		name: subprofile.name,
		avatar: subprofile.avatar,
		avatar_color: subprofile.avatar_color,
		display_tag_text: subprofile.display_tag_text ?? null,
		display_tag_icon: subprofile.display_tag_icon ?? null,
		pronouns: subprofile.pronouns,
		color: subprofile.color,
	};
}
