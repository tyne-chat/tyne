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

const BOB = 'bob-id';
const trackReactors = (map: ReactionMap, emoji: ReactionEmoji, userIds: Array<string>) =>
	transitionReactionMap(map, {type: 'reaction.trackReactors', emoji, userIds});

describe('ReactionStateMachine: adding again', () => {
	it('counts a reactor again who reacts after removing their reaction', () => {
		let m = applyAdd(emptyMap(), FIRE, ALICE, false);
		m = applyAdd(m, FIRE, BOB, false);
		m = applyRemove(m, FIRE, ALICE, false);
		expect(getRecord(m, FIRE)!.count).toBe(1);

		m = applyAdd(m, FIRE, ALICE, false);
		expect(getRecord(m, FIRE)!.count).toBe(2);
		expect(getRecord(m, FIRE)!.removedReactors.has(ALICE)).toBe(false);
		expect(getRecord(m, FIRE)!.knownReactors.has(ALICE)).toBe(true);
	});

	it('changes nothing for an add it has already counted', () => {
		const once = applyAdd(emptyMap(), FIRE, ALICE, false);
		expect(applyAdd(once, FIRE, ALICE, false)).toBe(once);

		const asPersona = applyAdd(emptyMap(), FIRE, ME, true, 'persona-a');
		expect(applyAdd(asPersona, FIRE, ME, true, 'persona-a')).toBe(asPersona);
	});

	it("marks a persona reaction the users list already showed as the account's own, without counting it twice", () => {
		let m = hydrate(
			emptyMap(),
			[{emoji: FIRE, count: 1, persona_reactions: [{persona_id: 'persona-a', count: 1, me: false}]}],
			ME,
		);
		m = trackReactors(m, FIRE, [`${ME}:persona-a`]);
		expect(getRecord(m, FIRE)!.me).toBe(false);

		m = applyAdd(m, FIRE, ME, true, 'persona-a');
		const rec = getRecord(m, FIRE)!;
		expect(rec.count).toBe(1);
		expect(rec.me).toBe(true);
		expect(rec.me_root).toBeUndefined();
		expect(rec.persona_reactions).toEqual([{persona_id: 'persona-a', count: 1, me: true}]);
	});

	it("marks the account's own reaction the users list already showed as its root reaction, without counting it twice", () => {
		let m = hydrate(
			emptyMap(),
			[
				{
					emoji: FIRE,
					count: 2,
					me: true,
					me_root: false,
					persona_reactions: [{persona_id: 'persona-a', count: 1, me: true}],
				},
			],
			ME,
		);
		m = trackReactors(m, FIRE, [ME]);
		expect(getRecord(m, FIRE)!.me_root).toBeUndefined();

		m = applyAdd(m, FIRE, ME, true, null);
		const rec = getRecord(m, FIRE)!;
		expect(rec.count).toBe(2);
		expect(rec.me).toBe(true);
		expect(rec.me_root).toBe(true);
	});

	it("adds to a persona's count when the server already listed that persona, as it adds to the total", () => {
		let m = hydrate(
			emptyMap(),
			[{emoji: FIRE, count: 1, persona_reactions: [{persona_id: 'persona-b', count: 1, me: false}]}],
			ME,
		);
		m = applyAdd(m, FIRE, BOB, false, 'persona-b');

		const rec = getRecord(m, FIRE)!;
		expect(rec.count).toBe(2);
		expect(rec.persona_reactions).toEqual([{persona_id: 'persona-b', count: 2, me: false}]);
	});
});

describe('ReactionStateMachine: removing', () => {
	it('changes nothing for a second removal of a reaction already removed', () => {
		let m = applyAdd(emptyMap(), FIRE, ALICE, false);
		m = applyAdd(m, FIRE, BOB, false);
		m = applyRemove(m, FIRE, ALICE, false);

		expect(applyRemove(m, FIRE, ALICE, false)).toBe(m);
	});

	it("does not count the echo of the account's own removal twice", () => {
		let m = applyAdd(emptyMap(), FIRE, ME, true, null);
		m = applyAdd(m, FIRE, ME, true, 'persona-a');
		m = applyRemove(m, FIRE, ME, true, null);
		expect(getRecord(m, FIRE)!.count).toBe(1);

		m = applyRemove(m, FIRE, ME, true, null);
		const rec = getRecord(m, FIRE)!;
		expect(rec.count).toBe(1);
		expect(rec.me).toBe(true);
		expect(rec.persona_reactions).toEqual([{persona_id: 'persona-a', count: 1, me: true}]);
	});

	it('does not count a removal twice when a users list showed the reactor again before the removal arrived', () => {
		let m = applyAdd(emptyMap(), FIRE, ALICE, false);
		m = applyAdd(m, FIRE, BOB, false);
		m = applyRemove(m, FIRE, ALICE, false);
		m = trackReactors(m, FIRE, [ALICE]);
		expect(getRecord(m, FIRE)!.count).toBe(2);

		m = applyRemove(m, FIRE, ALICE, false);
		expect(getRecord(m, FIRE)!.count).toBe(2);
		expect(getRecord(m, FIRE)!.knownReactors.has(ALICE)).toBe(false);
	});

	it("removes the account's persona reaction and then its root reaction as the server listed them", () => {
		let m = hydrate(
			emptyMap(),
			[
				{
					emoji: FIRE,
					count: 2,
					me: true,
					me_root: true,
					persona_reactions: [{persona_id: 'persona-a', count: 1, me: true}],
				},
			],
			ME,
		);

		m = applyRemove(m, FIRE, ME, true, 'persona-a');
		let rec = getRecord(m, FIRE)!;
		expect(rec.count).toBe(1);
		expect(rec.me).toBe(true);
		expect(rec.me_root).toBe(true);
		expect(rec.persona_reactions).toBeUndefined();

		m = applyRemove(m, FIRE, ME, true, '0');
		rec = getRecord(m, FIRE)!;
		expect(rec).toBeUndefined();
	});

	it("lowers a persona's count when one of its reactions goes, and keeps whether it was the account's", () => {
		let m = hydrate(
			emptyMap(),
			[{emoji: FIRE, count: 3, persona_reactions: [{persona_id: 'persona-b', count: 2, me: false}]}],
			ME,
		);
		m = applyRemove(m, FIRE, BOB, false, 'persona-b');

		const rec = getRecord(m, FIRE)!;
		expect(rec.count).toBe(2);
		expect(rec.persona_reactions).toEqual([{persona_id: 'persona-b', count: 1, me: false}]);
		expect(rec.removedReactors.has(`${BOB}:persona-b`)).toBe(true);
	});

	it("lowers the count for someone else's reaction the map never saw", () => {
		let m = hydrate(emptyMap(), [{emoji: FIRE, count: 3}], ME);
		m = applyRemove(m, FIRE, BOB, false);

		expect(getRecord(m, FIRE)!.count).toBe(2);
		expect(getRecord(m, FIRE)!.removedReactors.has(BOB)).toBe(true);
	});

	it('changes nothing when the account removes a reaction it does not have', () => {
		const m = hydrate(emptyMap(), [{emoji: FIRE, count: 1}], ME);

		expect(applyRemove(m, FIRE, ME, true, null)).toBe(m);
		expect(applyRemove(m, FIRE, ME, true, 'persona-a')).toBe(m);
	});
});

describe("ReactionStateMachine: the account's reactions from the server", () => {
	it('reads a wire reaction with me and no me_root as the root reaction, unless one of its personas is mine', () => {
		const root = hydrate(emptyMap(), [{emoji: FIRE, count: 1, me: true}], ME);
		expect(getRecord(root, FIRE)!.me_root).toBe(true);

		const persona = hydrate(
			emptyMap(),
			[{emoji: FIRE, count: 1, me: true, persona_reactions: [{persona_id: 'persona-a', count: 1, me: true}]}],
			ME,
		);
		expect(getRecord(persona, FIRE)!.me_root).toBeUndefined();
	});

	it('keeps the same map when the server sends what it already has', () => {
		const wire: ReadonlyArray<MessageReaction> = [
			{emoji: FIRE, count: 2, me: true, persona_reactions: [{persona_id: 'persona-a', count: 1, me: true}]},
		];
		const m = hydrate(applyAdd(emptyMap(), FIRE, ALICE, false), wire, ME);

		expect(hydrate(m, wire, ME)).toBe(m);
	});

	it("does not take the account's removed reaction off again when the server has already dropped it", () => {
		let m = hydrate(emptyMap(), [{emoji: FIRE, count: 2, me: true}], ME);
		m = applyRemove(m, FIRE, ME, true, null);
		expect(getRecord(m, FIRE)!.count).toBe(1);

		const caughtUp = hydrate(m, [{emoji: FIRE, count: 1}], ME);
		expect(getRecord(caughtUp, FIRE)!.count).toBe(1);
		expect(getRecord(caughtUp, FIRE)!.me).toBe(false);
		expect(getRecord(caughtUp, FIRE)!.me_root).toBe(false);

		const stale = hydrate(m, [{emoji: FIRE, count: 2, me: true}], ME);
		expect(getRecord(stale, FIRE)!.count).toBe(1);
		expect(getRecord(stale, FIRE)!.me).toBe(false);
	});

	it("does the same for a removed persona reaction of the account's", () => {
		let m = hydrate(
			emptyMap(),
			[{emoji: FIRE, count: 2, me: true, persona_reactions: [{persona_id: 'persona-a', count: 1, me: true}]}],
			ME,
		);
		m = applyRemove(m, FIRE, ME, true, 'persona-a');
		expect(getRecord(m, FIRE)!.count).toBe(1);

		const caughtUp = hydrate(m, [{emoji: FIRE, count: 1}], ME);
		expect(getRecord(caughtUp, FIRE)!.count).toBe(1);
		expect(getRecord(caughtUp, FIRE)!.me).toBe(false);
	});
});
