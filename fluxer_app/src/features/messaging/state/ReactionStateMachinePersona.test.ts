// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	emptyMap,
	getEmojiKey,
	mapToReactions,
	type ReactionMap,
	transitionReactionMap,
} from '@app/features/messaging/state/ReactionStateMachine';
import type {ReactionEmoji} from '@app/features/messaging/utils/ReactionUtils';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {describe, expect, it} from 'vitest';

const ME = 'me-user-id';
const ALICE = 'alice-id';
const FIRE: ReactionEmoji = {name: '🔥'};

// Upstream dropped these one-line wrappers from the state machine; the tests keep their own.
const applyAdd = (
	map: ReactionMap,
	emoji: ReactionEmoji,
	userId: string,
	isCurrentUser: boolean,
	personaId?: string | null,
) => transitionReactionMap(map, {type: 'reaction.add', emoji, userId, isCurrentUser, personaId});
const applyRemove = (
	map: ReactionMap,
	emoji: ReactionEmoji,
	userId: string,
	isCurrentUser: boolean,
	personaId?: string | null,
) => transitionReactionMap(map, {type: 'reaction.remove', emoji, userId, isCurrentUser, personaId});
const getRecord = (map: ReactionMap, emoji: ReactionEmoji) => map.get(getEmojiKey(emoji));
const hydrate = (map: ReactionMap, reactions: ReadonlyArray<MessageReaction>, currentUserId?: string | null) =>
	transitionReactionMap(map, {type: 'reaction.hydrate', reactions, currentUserId}, currentUserId);

describe('ReactionStateMachine: several reactors', () => {
	it('preserves reaction count when another user removes their reaction', () => {
		let m = applyAdd(emptyMap(), FIRE, ME, true);
		m = applyAdd(m, FIRE, ALICE, false);
		expect(getRecord(m, FIRE)!.count).toBe(2);
		expect(getRecord(m, FIRE)!.me).toBe(true);

		m = applyRemove(m, FIRE, ALICE, false);
		expect(getRecord(m, FIRE)!.count).toBe(1);
		expect(getRecord(m, FIRE)!.me).toBe(true);
		expect(getRecord(m, FIRE)!.removedReactors.has(ALICE)).toBe(true);
	});
});

describe('ReactionStateMachine: persona reactions', () => {
	it('tracks reactions per persona independently for the same user', () => {
		let m = applyAdd(emptyMap(), FIRE, ME, true, 'persona-a');
		let rec = getRecord(m, FIRE);
		expect(rec).toBeDefined();
		expect(rec!.count).toBe(1);
		expect(rec!.me).toBe(true);
		expect(rec!.me_root).toBeUndefined();
		expect(rec!.persona_reactions).toEqual([{persona_id: 'persona-a', count: 1, me: true}]);

		// Add second persona for same user
		m = applyAdd(m, FIRE, ME, true, 'persona-b');
		rec = getRecord(m, FIRE);
		expect(rec!.count).toBe(2);
		expect(rec!.me).toBe(true);
		expect(rec!.persona_reactions).toEqual([
			{persona_id: 'persona-a', count: 1, me: true},
			{persona_id: 'persona-b', count: 1, me: true},
		]);

		// Remove persona-b
		m = applyRemove(m, FIRE, ME, true, 'persona-b');
		rec = getRecord(m, FIRE);
		expect(rec!.count).toBe(1);
		expect(rec!.me).toBe(true);
		expect(rec!.persona_reactions).toEqual([{persona_id: 'persona-a', count: 1, me: true}]);

		// Remove persona-a
		m = applyRemove(m, FIRE, ME, true, 'persona-a');
		expect(getRecord(m, FIRE)).toBeUndefined();
	});

	it('tracks root reaction alongside persona reactions', () => {
		// Root reaction
		let m = applyAdd(emptyMap(), FIRE, ME, true, null);
		let rec = getRecord(m, FIRE);
		expect(rec!.count).toBe(1);
		expect(rec!.me).toBe(true);
		expect(rec!.me_root).toBe(true);
		expect(rec!.persona_reactions).toBeUndefined();

		// Persona reaction alongside root
		m = applyAdd(m, FIRE, ME, true, 'persona-a');
		rec = getRecord(m, FIRE);
		expect(rec!.count).toBe(2);
		expect(rec!.me).toBe(true);
		expect(rec!.me_root).toBe(true);
		expect(rec!.persona_reactions).toEqual([{persona_id: 'persona-a', count: 1, me: true}]);

		// Remove root reaction
		m = applyRemove(m, FIRE, ME, true, '0');
		rec = getRecord(m, FIRE);
		expect(rec!.count).toBe(1);
		expect(rec!.me).toBe(true);
		expect(rec!.me_root).toBe(false);
		expect(rec!.persona_reactions).toEqual([{persona_id: 'persona-a', count: 1, me: true}]);

		// Remove persona reaction
		m = applyRemove(m, FIRE, ME, true, 'persona-a');
		expect(getRecord(m, FIRE)).toBeUndefined();
	});

	it('hydrates persona_reactions and me_root correctly into message reactions', () => {
		const wireReactions = [
			{
				emoji: FIRE,
				count: 2,
				me: true as const,
				me_root: false,
				persona_reactions: [
					{persona_id: 'persona-a', count: 1, me: true},
					{persona_id: 'persona-b', count: 1, me: false},
				],
			},
		];
		const m = hydrate(emptyMap(), wireReactions, ME);
		const rec = getRecord(m, FIRE);
		expect(rec).toBeDefined();
		expect(rec!.count).toBe(2);
		expect(rec!.me).toBe(true);
		expect(rec!.me_root).toBeUndefined();
		expect(rec!.persona_reactions).toEqual([
			{persona_id: 'persona-a', count: 1, me: true},
			{persona_id: 'persona-b', count: 1, me: false},
		]);

		const output = mapToReactions(m);
		expect(output).toHaveLength(1);
		expect(output[0].me_root).toBeUndefined();
		expect(output[0].persona_reactions).toEqual([
			{persona_id: 'persona-a', count: 1, me: true},
			{persona_id: 'persona-b', count: 1, me: false},
		]);
	});

	it('transitions the reaction map through events that carry a personaId', () => {
		let m = transitionReactionMap(emptyMap(), {
			type: 'reaction.add',
			emoji: FIRE,
			userId: ME,
			isCurrentUser: true,
			personaId: 'persona-a',
		});
		expect(getRecord(m, FIRE)!.count).toBe(1);

		m = transitionReactionMap(m, {
			type: 'reaction.add',
			emoji: FIRE,
			userId: ME,
			isCurrentUser: true,
			personaId: 'persona-b',
		});
		expect(getRecord(m, FIRE)!.count).toBe(2);

		m = transitionReactionMap(m, {
			type: 'reaction.remove',
			emoji: FIRE,
			userId: ME,
			isCurrentUser: true,
			personaId: 'persona-a',
		});
		expect(getRecord(m, FIRE)!.count).toBe(1);

		m = transitionReactionMap(m, {
			type: 'reaction.remove',
			emoji: FIRE,
			userId: ME,
			isCurrentUser: true,
			personaId: 'persona-b',
		});
		expect(getRecord(m, FIRE)).toBeUndefined();
	});
});
