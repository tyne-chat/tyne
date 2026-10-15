// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createMessageID, createPersonaID, createUserID} from '@app/api/BrandedTypes';
import type {MessageRow} from '@app/api/database/types/MessageTypes';
import {Message} from '@app/api/models/Message';
import {buildMessageSearchFilters} from '@app/api/search/BuildMessageSearchFilters';
import type {MeilisearchClient, MeilisearchTask} from '@app/api/search/meilisearch/MeilisearchClient';
import {MeilisearchMessageAdapter} from '@app/api/search/meilisearch/MeilisearchDomainAdapters';
import {MEILISEARCH_INDEX_DEFINITIONS} from '@app/api/search/meilisearch/MeilisearchIndexDefinitions';
import {convertToSearchableMessage} from '@app/api/search/message/MessageSearchSerializer';
import {extractMentionedPersonaIds} from '@app/api/search/message/PersonaMessageSearch';
import {MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import type {MessageSearchFilters} from '@fluxer/schema/src/contracts/search/SearchDocumentTypes';
import {MessageSearchRequest} from '@fluxer/schema/src/domains/message/MessageRequestSchemas';
import {describe, expect, it} from 'vitest';

function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
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

function searchRequest(body: Record<string, unknown>): MessageSearchRequest {
	return MessageSearchRequest.parse(body);
}

class RecordingMeilisearchClient implements MeilisearchClient {
	readonly searchBodies: Array<{filter?: string}> = [];
	private nextTaskUid = 1;

	async request<TResponse>(method: string, path: string, body?: unknown): Promise<TResponse> {
		if (method === 'GET' && path.startsWith('/indexes/')) {
			return {uid: path.slice('/indexes/'.length)} as TResponse;
		}
		if ((method === 'PUT' || method === 'PATCH') && path.includes('/settings/')) {
			return {taskUid: this.nextTaskUid++, status: 'enqueued'} satisfies MeilisearchTask as TResponse;
		}
		if (method === 'POST' && path.endsWith('/search')) {
			this.searchBodies.push(body as {filter?: string});
			return {hits: [], estimatedTotalHits: 0} as TResponse;
		}
		throw new Error(`Unhandled fake Meilisearch request: ${method} ${path}`);
	}

	async waitForTask(): Promise<void> {}
}

async function meiliFilterFor(filters: MessageSearchFilters): Promise<string | undefined> {
	const client = new RecordingMeilisearchClient();
	const adapter = new MeilisearchMessageAdapter({client});
	await adapter.initialize();
	await adapter.search('', filters);
	return client.searchBodies[0]?.filter;
}

describe('persona fields on message search documents', () => {
	it('records the persona a message was sent as, and null for the account', () => {
		const asPersona = convertToSearchableMessage(new Message(messageRow({persona_id: createPersonaID(12345n)})));
		const asAccount = convertToSearchableMessage(new Message(messageRow()));

		expect(asPersona.personaId).toBe('12345');
		expect(asAccount.personaId).toBeNull();
		expect(asAccount.mentionedPersonaIds).toEqual([]);
	});

	it('records the personas a message mentions', () => {
		const doc = convertToSearchableMessage(
			new Message(messageRow({content: 'hi <@30:111> and <@!31:222>, also <@32> and <@30:111> again'})),
		);

		expect(doc.mentionedPersonaIds).toEqual(['111', '222']);
	});

	it('counts the mentions in what a forward carries, as upstream does for users', () => {
		const doc = convertToSearchableMessage(
			new Message(
				messageRow({
					content: 'look <@30:111>',
					message_reference: {
						channel_id: createChannelID(11n),
						message_id: createMessageID(19n),
						guild_id: null,
						type: 1,
					},
					message_snapshots: [
						{
							content: 'forwarded <@31:222>',
							timestamp: new Date('2026-10-01T00:00:00.000Z'),
							edited_timestamp: null,
							mention_users: null,
							mention_roles: null,
							mention_channels: null,
							attachments: null,
							embeds: null,
							sticker_items: null,
							type: MessageTypes.DEFAULT,
							flags: 0,
						},
					],
				}),
			),
		);

		expect(doc.mentionedPersonaIds).toEqual(['111', '222']);
	});
});

describe('extractMentionedPersonaIds', () => {
	it('leaves out mentions inside code, escaped mentions and non-numeric persona parts', () => {
		const ids = extractMentionedPersonaIds([
			'`<@1:100>` ``<@1:101>`` <@1:102>',
			'```\n<@1:103>\n```\n<@1:104>',
			'\\<@1:105> <@1:bob_the_fox> <@1:0>',
			null,
			undefined,
		]);

		expect(ids).toEqual(['102', '104']);
	});
});

describe('persona search request fields', () => {
	it('accept persona IDs as snowflake strings', () => {
		const request = searchRequest({
			persona_id: ['111'],
			exclude_persona_id: ['112'],
			persona_mentions: ['113'],
			exclude_persona_mentions: ['114'],
		});

		expect(request.persona_id).toEqual([111n]);
		expect(request.exclude_persona_id).toEqual([112n]);
		expect(request.persona_mentions).toEqual([113n]);
		expect(request.exclude_persona_mentions).toEqual([114n]);
	});

	it('leave the filters as upstream builds them when no persona is named', () => {
		const filters = buildMessageSearchFilters(searchRequest({author_id: ['30'], mentions: ['31']}), ['10']);

		expect(filters.authorId).toEqual(['30']);
		expect(filters.mentions).toEqual(['31']);
		expect(filters.authorOrPersona).toBeUndefined();
	});

	it('combine accounts and personas named in from: so that either matches', () => {
		const filters = buildMessageSearchFilters(searchRequest({author_id: ['30'], persona_id: ['111', '111']}), ['10']);

		expect(filters.authorId).toBeUndefined();
		expect(filters.authorOrPersona).toEqual({authorIds: ['30'], personaIds: ['111']});
	});
});

describe('Meilisearch filters for personas', () => {
	it('make personaId and mentionedPersonaIds filterable', () => {
		expect(MEILISEARCH_INDEX_DEFINITIONS.messages.filterableAttributes).toEqual(
			expect.arrayContaining(['personaId', 'mentionedPersonaIds']),
		);
	});

	it('match a persona alone', async () => {
		const filters = buildMessageSearchFilters(searchRequest({persona_id: ['111']}), ['10']);

		expect(await meiliFilterFor(filters)).toBe('((channelId = "10")) AND ((personaId = "111"))');
	});

	it('match any of the accounts or personas named in from:', async () => {
		const filters = buildMessageSearchFilters(searchRequest({author_id: ['30'], persona_id: ['111']}), ['10']);

		expect(await meiliFilterFor(filters)).toBe('((channelId = "10")) AND ((authorId = "30" OR personaId = "111"))');
	});

	it('exclude a persona without excluding the rest of its account', async () => {
		const filters = buildMessageSearchFilters(searchRequest({exclude_persona_id: ['111', '112']}), ['10']);

		expect(await meiliFilterFor(filters)).toBe(
			'((channelId = "10")) AND (NOT personaId = "111") AND (NOT personaId = "112")',
		);
	});

	it('require every mentioned persona, as upstream requires every mentioned user', async () => {
		const filters = buildMessageSearchFilters(
			searchRequest({mentions: ['31'], persona_mentions: ['111', '112'], exclude_persona_mentions: ['113']}),
			['10'],
		);

		expect(await meiliFilterFor(filters)).toBe(
			'((channelId = "10")) AND (mentionedUserIds = "31") AND (mentionedPersonaIds = "111") AND (mentionedPersonaIds = "112") AND (NOT mentionedPersonaIds = "113")',
		);
	});
});
