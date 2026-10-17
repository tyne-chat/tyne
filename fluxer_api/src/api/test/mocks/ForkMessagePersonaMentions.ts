// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Embed} from '@app/api/models/Embed';
import type {Message} from '@app/api/models/Message';

/**
 * Fork: stands in for the messages service's persona mentions, as this mock's `extractMentions`
 * stands in for its mention parser. The service reads them with the full Markdown parser; a
 * regex that leaves out code is enough for the tests that run without it.
 */

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const PERSONA_MENTION = /(?<!\\)<@!?(\d+):(\d+)>/g;

type PersonaPair = {user_id: string; persona_id: string};

function personaPairsIn(texts: Iterable<string | null | undefined>): Array<PersonaPair> {
	const pairs: Array<PersonaPair> = [];
	for (const text of texts) {
		if (!text?.includes('<@')) continue;
		const outsideCode = text.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ');
		for (const [, userId, personaId] of outsideCode.matchAll(PERSONA_MENTION)) {
			if (personaId === '0' || pairs.some((p) => p.user_id === userId && p.persona_id === personaId)) continue;
			pairs.push({user_id: userId!, persona_id: personaId!});
		}
	}
	return pairs;
}

/** What `ExtractMentions` adds for one text: the `<@user:persona>` pairs. */
export function extractedPersonaPairs(content: string): Array<PersonaPair> {
	return personaPairsIn([content]);
}

/** The response's `persona_mentions`: in the content, the embeds and what a forward carries. */
export function personaMentionsOf(message: Message): Array<PersonaPair> | undefined {
	const embedTexts = (embed: Embed): Array<string | null | undefined> => [
		embed.title,
		embed.description,
		embed.author?.name,
		embed.footer?.text,
		embed.image?.description,
		embed.thumbnail?.description,
		embed.video?.description,
		embed.audio?.description,
		...embed.fields.flatMap((field) => [field.name, field.value]),
		...embed.children.flatMap(embedTexts),
	];
	const pairs = personaPairsIn([
		message.content,
		...message.embeds.flatMap(embedTexts),
		...message.messageSnapshots.flatMap((snapshot) => [snapshot.content, ...snapshot.embeds.flatMap(embedTexts)]),
	]);
	return pairs.length > 0 ? pairs : undefined;
}
