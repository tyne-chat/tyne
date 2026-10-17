// SPDX-License-Identifier: AGPL-3.0-or-later

import {createPersonaID, type PersonaID} from '@app/api/BrandedTypes';
import type {MessageRow} from '@app/api/database/types/MessageTypes';
import {Logger} from '@app/api/Logger';

/**
 * The personas a stored message mentions (`mention_personas`), kept as upstream keeps the
 * accounts it mentions (`mention_users`): read once, by the messages service's mention parser,
 * when the message is written, and only for the accounts upstream's mention handling kept. A
 * mention the sender held back with `allowed_mentions`, or in a channel where mentions are not
 * stored, is left out here as its account is left out there. Search indexes this set, as it
 * indexes `mention_users`.
 *
 * Called on every write of a message row (MessageRepository.upsertMessage), so sends, edits,
 * forwards and upstream's read repair all keep it current. A forward counts the mentions in what
 * it carries against that snapshot's own `mention_users`.
 */

const MAY_MENTION_PERSONA = /<@!?\d+:\d+>/;

interface MentionText {
	content: string;
	accounts: ReadonlySet<string>;
}

function mentionTexts(row: MessageRow): Array<MentionText> {
	const texts = [{content: row.content, users: row.mention_users}];
	for (const snapshot of row.message_snapshots ?? []) {
		texts.push({content: snapshot.content, users: snapshot.mention_users});
	}
	return texts.flatMap(({content, users}) =>
		content && users && users.size > 0 && MAY_MENTION_PERSONA.test(content)
			? [{content, accounts: new Set([...users].map(String))}]
			: [],
	);
}

function sameMentionSources(a: MessageRow, b: MessageRow): boolean {
	const sources = (row: MessageRow) =>
		JSON.stringify(
			[row, ...(row.message_snapshots ?? [])].map((part) => [
				part.content ?? null,
				[...(part.mention_users ?? [])].map(String).sort(),
			]),
		);
	return sources(a) === sources(b);
}

/** The pairs the parser found in each text, as the messages service's `ExtractMentions` gives them. */
export type ExtractPersonaPairs = (
	contents: Array<string>,
) => Promise<Array<Array<{user_id: string; persona_id: string}>>>;

async function extractWithMessagesService(contents: Array<string>) {
	const {createMessageResponseDataService} = await import(
		'@app/api/channel/services/message/MessageResponseDataService'
	);
	const results = await createMessageResponseDataService().extractMentions(contents);
	return results.map((result) => result.personas ?? []);
}

export async function withMentionedPersonas(
	data: MessageRow,
	oldData?: MessageRow | null,
	extract: ExtractPersonaPairs = extractWithMessagesService,
): Promise<MessageRow> {
	if (oldData && sameMentionSources(data, oldData)) {
		return 'mention_personas' in data ? data : {...data, mention_personas: oldData.mention_personas ?? null};
	}
	const texts = mentionTexts(data);
	if (texts.length === 0) {
		return {...data, mention_personas: null};
	}
	try {
		const pairsByText = await extract(texts.map((text) => text.content));
		const personaIds = new Map<string, PersonaID>();
		texts.forEach((text, index) => {
			for (const {user_id: userId, persona_id: personaId} of pairsByText[index] ?? []) {
				if (text.accounts.has(userId) && /^\d+$/.test(personaId) && personaId !== '0') {
					personaIds.set(personaId, createPersonaID(BigInt(personaId)));
				}
			}
		});
		return {...data, mention_personas: personaIds.size > 0 ? new Set(personaIds.values()) : null};
	} catch (error) {
		// The message is written all the same; only search by its persona mentions misses it.
		Logger.warn({error, messageId: data.message_id.toString()}, 'Could not read the personas a message mentions');
		return data;
	}
}
