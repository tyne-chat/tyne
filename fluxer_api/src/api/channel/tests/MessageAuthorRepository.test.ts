import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createChannelID, createMessageID, createPersonaID, createUserID, type PersonaID} from '../../BrandedTypes';
import * as cassandra from '../../database/CassandraQueryExecution';
import {MessageAuthorRepository} from '../repositories/message/MessageAuthorRepository';

describe('MessageAuthorRepository', () => {
	const channelId = createChannelID(100n);
	const messageId = createMessageID(200n);
	const oldAuthorId = createUserID(300n);
	const newAuthorId = createUserID(400n);
	const personaId = createPersonaID(500n);
	const mappedPersonaId = createPersonaID(600n);

	let deleteSpy: any;
	let upsertSpy: any;

	beforeEach(() => {
		deleteSpy = vi.spyOn(cassandra, 'deleteOneOrMany').mockResolvedValue(undefined as any);
		upsertSpy = vi.spyOn(cassandra, 'upsertOne').mockResolvedValue(undefined as any);
	});

	it('returns early from anonymizeMessage if message does not exist', async () => {
		const mockDataRepo = {
			getMessage: vi.fn().mockResolvedValue(null),
		};
		const repo = new MessageAuthorRepository(mockDataRepo as any);

		await repo.anonymizeMessage(channelId, messageId, newAuthorId);
		expect(cassandra.upsertOne).not.toHaveBeenCalled();
	});

	it('anonymizes message and preserves mapped persona_id when present in mapping', async () => {
		const mockDataRepo = {
			getMessage: vi.fn().mockResolvedValue({
				authorId: oldAuthorId,
				personaId,
			}),
		};
		const repo = new MessageAuthorRepository(mockDataRepo as any);
		const mapping = new Map<string, PersonaID>([[personaId.toString(), mappedPersonaId]]);

		await repo.anonymizeMessage(channelId, messageId, newAuthorId, mapping);
		expect(deleteSpy).toHaveBeenCalled();
		expect(upsertSpy).toHaveBeenCalledTimes(2);
	});

	it('anonymizes message and clears persona_id when not in mapping or message has no persona', async () => {
		const mockDataRepo = {
			getMessage: vi.fn().mockResolvedValue({
				authorId: oldAuthorId,
				personaId,
			}),
		};
		const repo = new MessageAuthorRepository(mockDataRepo as any);
		const mapping = new Map<string, PersonaID>([['other_id', mappedPersonaId]]);

		await repo.anonymizeMessage(channelId, messageId, newAuthorId, mapping);
		expect(upsertSpy).toHaveBeenCalledTimes(2);

		// Also when message has no personaId
		const mockDataRepoNoPersona = {
			getMessage: vi.fn().mockResolvedValue({
				authorId: oldAuthorId,
				personaId: null,
			}),
		};
		const repoNoPersona = new MessageAuthorRepository(mockDataRepoNoPersona as any);
		await repoNoPersona.anonymizeMessage(channelId, messageId, newAuthorId, mapping);
		expect(upsertSpy).toHaveBeenCalledTimes(4);
	});
});
