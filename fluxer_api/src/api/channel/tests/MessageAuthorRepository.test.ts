// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createMessageID, createPersonaID, createUserID, type PersonaID} from '@app/api/BrandedTypes';
import {MessageAuthorRepository} from '@app/api/channel/repositories/message/MessageAuthorRepository';
import type {MessageDataRepository} from '@app/api/channel/repositories/message/MessageDataRepository';
import {fetchOne, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {Db} from '@app/api/database/CassandraTypes';
import {Messages, MessagesByAuthorV2} from '@app/api/Tables';
import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
import {describe, expect, it, vi} from 'vitest';

const SELECT_MESSAGE_AUTHOR = Messages.select({
	columns: ['author_id', 'persona_id'],
	where: [Messages.where.eq('channel_id'), Messages.where.eq('bucket'), Messages.where.eq('message_id')],
});

describe('MessageAuthorRepository', () => {
	const channelId = createChannelID(100n);
	const messageId = createMessageID(200n);
	const bucket = BucketUtils.makeBucket(messageId);
	const oldAuthorId = createUserID(300n);
	const newAuthorId = createUserID(400n);
	const personaId = createPersonaID(500n);
	const mappedPersonaId = createPersonaID(600n);

	async function seedMessage(authorId: typeof oldAuthorId, initialPersonaId: PersonaID | null): Promise<void> {
		await upsertOne(
			MessagesByAuthorV2.upsertAll({
				author_id: authorId,
				channel_id: channelId,
				message_id: messageId,
			}),
		);
		await upsertOne(
			Messages.patchByPk(
				{channel_id: channelId, bucket, message_id: messageId},
				{
					author_id: Db.set(authorId),
					persona_id: initialPersonaId ? Db.set(initialPersonaId) : Db.clear(),
				},
			),
		);
	}

	async function readStoredMessage(): Promise<{author_id: bigint | null; persona_id: bigint | null} | null> {
		return fetchOne<{author_id: bigint | null; persona_id: bigint | null}>(
			SELECT_MESSAGE_AUTHOR.bind({channel_id: channelId, bucket, message_id: messageId}),
		);
	}

	function repoWithMessage(message: {authorId: typeof oldAuthorId; personaId: PersonaID | null} | null) {
		const mockDataRepo = {
			getMessage: vi.fn().mockResolvedValue(message),
		} as unknown as MessageDataRepository;
		return new MessageAuthorRepository(mockDataRepo);
	}

	it('returns early from anonymizeMessage if message does not exist', async () => {
		const repo = repoWithMessage(null);

		await repo.anonymizeMessage(channelId, messageId, newAuthorId);
		expect(await repo.listMessagesByAuthor(newAuthorId)).toEqual([]);
		expect(await readStoredMessage()).toBeNull();
	});

	it('anonymizes message and preserves mapped persona_id when present in mapping', async () => {
		await seedMessage(oldAuthorId, personaId);
		const repo = repoWithMessage({authorId: oldAuthorId, personaId});
		const mapping = new Map<string, PersonaID>([[personaId.toString(), mappedPersonaId]]);

		await repo.anonymizeMessage(channelId, messageId, newAuthorId, mapping);
		expect(await repo.listMessagesByAuthor(oldAuthorId)).toEqual([]);
		expect(await repo.listMessagesByAuthor(newAuthorId)).toEqual([{channelId, messageId}]);
		expect(await readStoredMessage()).toEqual({author_id: newAuthorId, persona_id: mappedPersonaId});
	});

	it('anonymizes message and clears persona_id when not in mapping or message has no persona', async () => {
		await seedMessage(oldAuthorId, personaId);
		const repo = repoWithMessage({authorId: oldAuthorId, personaId});
		const mapping = new Map<string, PersonaID>([['other_id', mappedPersonaId]]);

		await repo.anonymizeMessage(channelId, messageId, newAuthorId, mapping);
		expect(await repo.listMessagesByAuthor(oldAuthorId)).toEqual([]);
		expect(await repo.listMessagesByAuthor(newAuthorId)).toEqual([{channelId, messageId}]);
		expect(await readStoredMessage()).toEqual({author_id: newAuthorId, persona_id: null});

		// Also when message has no personaId
		await seedMessage(oldAuthorId, null);
		const repoNoPersona = repoWithMessage({authorId: oldAuthorId, personaId: null});
		await repoNoPersona.anonymizeMessage(channelId, messageId, newAuthorId, mapping);
		expect(await repoNoPersona.listMessagesByAuthor(oldAuthorId)).toEqual([]);
		expect(await repoNoPersona.listMessagesByAuthor(newAuthorId)).toEqual([{channelId, messageId}]);
		expect(await readStoredMessage()).toEqual({author_id: newAuthorId, persona_id: null});
	});
});
