// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import {
	countOwnReactions,
	opensOwnReactionsMenu,
	orderIdentitiesForReaction,
	ownReactedIds,
	personaMatchesQuery,
	recentPersonaIds,
} from '@app/features/persona/utils/PersonaReactionIdentities';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {describe, expect, it} from 'vitest';

const persona = (id: string, name: string, extra: Partial<ClientPersona> = {}): ClientPersona =>
	({id, name, pronouns: null, persona_tags: [], use_count: 0, last_used_at_ms: null, ...extra}) as ClientPersona;

const reaction = (meRoot: boolean, personaIds: Array<string>, others = 0): MessageReaction =>
	({
		emoji: {id: null, name: '😆'},
		count: others + personaIds.length + (meRoot ? 1 : 0),
		me: meRoot || personaIds.length > 0,
		me_root: meRoot,
		persona_reactions: personaIds.map((persona_id) => ({persona_id, count: 1, me: true})),
	}) as MessageReaction;

const alice = persona('a', 'Alice');
const bob = persona('b', 'Bob');
const cass = persona('c', 'Cass');

describe('PersonaReactionIdentities', () => {
	it('counts the account and each persona that reacted, not other people', () => {
		expect(countOwnReactions(undefined)).toBe(0);
		expect(countOwnReactions(reaction(false, [], 4))).toBe(0);
		expect(countOwnReactions(reaction(true, ['a', 'b'], 4))).toBe(3);
	});

	it('opens the menu only for an account with personas, once one of its identities reacted', () => {
		expect(opensOwnReactionsMenu(reaction(false, [], 3), [alice])).toBe(false);
		expect(opensOwnReactionsMenu(reaction(false, ['a']), [alice])).toBe(true);
		expect(opensOwnReactionsMenu(reaction(true, []), [alice])).toBe(true);
		// Without personas the chip stays upstream's toggle.
		expect(opensOwnReactionsMenu(reaction(true, []), [])).toBe(false);
		// With "React as several personas at once" off, never.
		expect(opensOwnReactionsMenu(reaction(false, ['a']), [alice], false)).toBe(false);
	});

	it('lists the account first, then each persona that reacted', () => {
		expect(ownReactedIds(undefined)).toEqual([]);
		expect(ownReactedIds(reaction(false, [], 2))).toEqual([]);
		expect(ownReactedIds(reaction(true, ['b', 'a']))).toEqual([null, 'b', 'a']);
	});

	it('orders those who reacted first; within each group the current persona, then the account', () => {
		const order = orderIdentitiesForReaction(reaction(true, ['c']), 'b', [alice, bob, cass]);
		expect(order.reacted).toEqual([null, 'c']);
		expect(order.rest).toEqual(['b', 'a']);

		const accountCurrent = orderIdentitiesForReaction(undefined, null, [alice, bob]);
		expect(accountCurrent.reacted).toEqual([]);
		expect(accountCurrent.rest).toEqual([null, 'a', 'b']);
	});

	it('takes recent personas in ranked order, leaving out ones never used', () => {
		const used = (p: ClientPersona) => ({...p, use_count: 2, last_used_at_ms: '1'}) as ClientPersona;
		expect(recentPersonaIds([used(cass), alice, used(bob)], 6)).toEqual(['c', 'b']);
		expect(recentPersonaIds([used(cass), used(alice), used(bob)], 2)).toEqual(['c', 'a']);
	});

	it('searches name, pronouns and tags, ignoring case', () => {
		const juniper = persona('j', 'Juniper', {pronouns: 'they/them', persona_tags: [{prefix: 'j:'}] as never});
		expect(personaMatchesQuery(juniper, 'JUN')).toBe(true);
		expect(personaMatchesQuery(juniper, 'they')).toBe(true);
		expect(personaMatchesQuery(juniper, 'j:')).toBe(true);
		expect(personaMatchesQuery(juniper, 'alice')).toBe(false);
		expect(personaMatchesQuery(juniper, '  ')).toBe(true);
	});
});
