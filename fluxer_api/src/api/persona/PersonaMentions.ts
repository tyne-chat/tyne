// SPDX-License-Identifier: AGPL-3.0-or-later

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const PERSONA_MENTION = /(?<!\\)<@!?(\d+):(\d+)>/g;

export interface PersonaMention {
	readonly userId: string;
	readonly personaId: string;
}

/**
 * The personas mentioned in message texts, in the `<@user:persona>` form both clients write, in
 * the order they first appear. Mentions inside code are left out, as the mention parser does.
 */
export function extractPersonaMentions(contents: Iterable<string | null | undefined>): Array<PersonaMention> {
	const mentions: Array<PersonaMention> = [];
	for (const content of contents) {
		if (!content?.includes('<@')) continue;
		const outsideCode = content.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ');
		for (const match of outsideCode.matchAll(PERSONA_MENTION)) {
			const userId = match[1]!;
			const personaId = match[2]!;
			if (personaId === '0' || mentions.some((m) => m.personaId === personaId && m.userId === userId)) continue;
			mentions.push({userId, personaId});
		}
	}
	return mentions;
}
