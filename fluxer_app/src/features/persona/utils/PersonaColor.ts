// SPDX-License-Identifier: AGPL-3.0-or-later

/** The fields that decide a persona's colour, as a persona (`avatar_hash`) or a message's copy (`avatar`) names them. */
export interface PersonaColorSource {
	color?: number | null;
	avatar_color?: number | null;
	avatar?: string | null;
	avatar_hash?: string | null;
}

// The one rule for the colour a persona is drawn in (mentions, typing, the profile card), the same in the
// mobile app (`persona_color.dart`): the accent colour its owner picked, else the colour taken from its own
// avatar. A persona without an avatar of its own shows the account's, so its stored avatar colour says
// nothing then. Null when neither applies: each place keeps its usual colour. 0 means no colour, as the
// mobile app stores it. The settings list shows the accent setting itself and does not use this.
export function personaColor(persona: PersonaColorSource | null | undefined): number | null {
	if (persona == null) return null;
	if (persona.color != null && persona.color !== 0) return persona.color;
	const hasOwnAvatar = Boolean(persona.avatar ?? persona.avatar_hash);
	if (hasOwnAvatar && persona.avatar_color != null && persona.avatar_color !== 0) return persona.avatar_color;
	return null;
}
