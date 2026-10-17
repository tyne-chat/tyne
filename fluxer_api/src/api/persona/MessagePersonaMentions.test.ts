// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createMessageID, createPersonaID, createUserID} from '@app/api/BrandedTypes';
import type {MessageRow, MessageSnapshot} from '@app/api/database/types/MessageTypes';
import {type ExtractPersonaPairs, withMentionedPersonas} from '@app/api/persona/MessagePersonaMentions';
import {MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import {describe, expect, it} from 'vitest';

function row(overrides: Partial<MessageRow> = {}): MessageRow {
	return {
		channel_id: createChannelID(10n),
		bucket: 0,
		message_id: createMessageID(20n),
		author_id: createUserID(30n),
		type: MessageTypes.DEFAULT,
		webhook_id: null,
		webhook_name: null,
		webhook_avatar_hash: null,
		content: null,
		edited_timestamp: null,
		pinned_timestamp: null,
		flags: 0,
		mention_everyone: false,
		mention_users: null,
		mention_roles: null,
		mention_channels: null,
		attachments: null,
		embeds: null,
		sticker_items: null,
		message_reference: null,
		message_snapshots: null,
		call: null,
		has_reaction: null,
		version: 1,
		persona_id: null,
		...overrides,
	};
}

function snapshot(content: string, mentionUsers: Array<bigint>): MessageSnapshot {
	return {
		content,
		timestamp: new Date('2026-10-01T00:00:00.000Z'),
		edited_timestamp: null,
		mention_users: new Set(mentionUsers.map(createUserID)),
		mention_roles: null,
		mention_channels: null,
		attachments: null,
		embeds: null,
		sticker_items: null,
		type: MessageTypes.DEFAULT,
		flags: 0,
	};
}

const users = (...ids: Array<bigint>) => new Set(ids.map(createUserID));
const personas = (...ids: Array<bigint>) => new Set(ids.map(createPersonaID));

/** Stands in for the parser: the `<@user:persona>` forms in each text, and the texts it was asked about. */
function recordingParser() {
	const asked: Array<Array<string>> = [];
	const extract: ExtractPersonaPairs = async (contents) => {
		asked.push(contents);
		return contents.map((content) =>
			[...content.matchAll(/<@!?(\d+):(\d+)>/g)].map(([, user_id, persona_id]) => ({
				user_id: user_id!,
				persona_id: persona_id!,
			})),
		);
	};
	return {asked, extract};
}

describe('the personas a stored message mentions', () => {
	it('are kept for the accounts upstream stored as mentioned, and no others', async () => {
		const {extract} = recordingParser();

		const written = await withMentionedPersonas(
			row({content: 'hi <@40:41> <@50:51> <@40:0>', mention_users: users(40n)}),
			null,
			extract,
		);

		// <@50:51> was held back (allowed_mentions) or dropped by upstream's checks, so its account
		// is not in mention_users.
		expect(written.mention_personas).toEqual(personas(41n));
	});

	it('count what a forward carries against that snapshot’s own stored mentions', async () => {
		const {extract} = recordingParser();

		const written = await withMentionedPersonas(
			row({
				content: 'look',
				message_snapshots: [snapshot('<@40:41> <@50:51>', [50n])],
			}),
			null,
			extract,
		);

		expect(written.mention_personas).toEqual(personas(51n));
	});

	it('are none without stored mentions, and the parser is not asked', async () => {
		const {asked, extract} = recordingParser();

		const inNotes = await withMentionedPersonas(row({content: 'hi <@40:41>'}), null, extract);
		const noPersona = await withMentionedPersonas(row({content: 'hi <@40>', mention_users: users(40n)}), null, extract);

		expect(inNotes.mention_personas).toBeNull();
		expect(noPersona.mention_personas).toBeNull();
		expect(asked).toEqual([]);
	});

	it('stay as they are when a write leaves the text and stored mentions alone', async () => {
		const {asked, extract} = recordingParser();
		const before = row({content: 'hi <@40:41>', mention_users: users(40n), mention_personas: personas(41n)});

		const pinned = await withMentionedPersonas({...before, pinned_timestamp: new Date()}, before, extract);
		const fromOlderModel = await withMentionedPersonas(
			(({mention_personas: _, ...rest}) => rest)(before),
			before,
			extract,
		);

		expect(pinned.mention_personas).toEqual(personas(41n));
		expect(fromOlderModel.mention_personas).toEqual(personas(41n));
		expect(asked).toEqual([]);
	});

	it('follow an edit', async () => {
		const {extract} = recordingParser();
		const before = row({content: 'hi <@40:41>', mention_users: users(40n), mention_personas: personas(41n)});

		const edited = await withMentionedPersonas(
			{...before, content: 'hi <@40:42>', mention_personas: before.mention_personas},
			before,
			extract,
		);
		const cleared = await withMentionedPersonas({...before, content: 'hi'}, before, extract);

		expect(edited.mention_personas).toEqual(personas(42n));
		expect(cleared.mention_personas).toBeNull();
	});

	it('are left as they were when the parser cannot be reached, and the message is still written', async () => {
		const failing: ExtractPersonaPairs = async () => {
			throw new Error('messages service unavailable');
		};
		const data = row({content: 'hi <@40:41>', mention_users: users(40n)});

		await expect(withMentionedPersonas(data, null, failing)).resolves.toBe(data);
	});
});
