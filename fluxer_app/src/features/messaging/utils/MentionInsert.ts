// SPDX-License-Identifier: AGPL-3.0-or-later

// The persona a mention is of, when it comes from a name on a persona's message. Without one, a
// mention is of the account (tyne-chat/tyne#288).
export interface MentionPersona {
	id: string;
	name: string;
}

export function personaMentionText(userId: string, persona: MentionPersona): {display: string; wire: string} {
	return {display: `@${persona.name}`, wire: `<@${userId}:${persona.id}>`};
}
