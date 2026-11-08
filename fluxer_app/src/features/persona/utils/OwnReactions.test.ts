// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/messaging/commands/ReactionCommands', () => ({
	addReaction: vi.fn(),
	removeReaction: vi.fn(),
}));

import * as ReactionCommands from '@app/features/messaging/commands/ReactionCommands';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {reactAsOnly, toggleOwnReaction} from '@app/features/persona/utils/OwnReactions';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {I18n} from '@lingui/core';

const emoji = {id: null, name: '😆'};
const reaction = (meRoot: boolean, personaIds: Array<string>, others = 0): MessageReaction =>
	({
		emoji,
		count: others + personaIds.length + (meRoot ? 1 : 0),
		me: meRoot || personaIds.length > 0,
		me_root: meRoot,
		persona_reactions: personaIds.map((persona_id) => ({persona_id, count: 1, me: true})),
	}) as MessageReaction;
const target = (r: MessageReaction | undefined) => ({
	i18n: {} as I18n,
	channelId: 'c1',
	messageId: 'm1',
	emoji,
	reaction: r,
});
const removedIds = () => vi.mocked(ReactionCommands.removeReaction).mock.calls.map((call) => call[5]);
const addedIds = () => vi.mocked(ReactionCommands.addReaction).mock.calls.map((call) => call[4]);

describe('OwnReactions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		PersonaStore.reset();
	});

	afterEach(() => {
		PersonaStore.reset();
	});

	describe('with several personas allowed (the default)', () => {
		it('toggles only the current persona, leaving the others', () => {
			toggleOwnReaction(target(reaction(false, ['a'])), 'b');
			expect(addedIds()).toEqual(['b']);
			expect(removedIds()).toEqual([]);

			vi.clearAllMocks();
			toggleOwnReaction(target(reaction(false, ['a', 'b'])), 'b');
			expect(removedIds()).toEqual(['b']);
			expect(addedIds()).toEqual([]);
		});
	});

	describe('with one reaction per emoji', () => {
		beforeEach(() => {
			PersonaStore.updateSettings({multi_persona_reactions: false});
		});

		it('removes every one of the account’s reactions with the emoji, one request each', () => {
			toggleOwnReaction(target(reaction(true, ['a', 'b'], 3)), 'c');
			expect(removedIds()).toEqual([null, 'a', 'b']);
			expect(addedIds()).toEqual([]);
		});

		it('reacts as the current persona when none of the account’s identities has', () => {
			toggleOwnReaction(target(reaction(false, [], 2)), 'c');
			expect(addedIds()).toEqual(['c']);
			expect(removedIds()).toEqual([]);

			vi.clearAllMocks();
			toggleOwnReaction(target(undefined), null);
			expect(addedIds()).toEqual([null]);
		});

		it('makes "React as…" a single choice: picking another identity replaces the account’s reactions', () => {
			reactAsOnly(target(reaction(false, ['a'])), 'b');
			expect(removedIds()).toEqual(['a']);
			expect(addedIds()).toEqual(['b']);
		});

		it('removes the picked identity’s reaction when it is the one that reacted', () => {
			reactAsOnly(target(reaction(false, ['a'])), 'a');
			expect(removedIds()).toEqual(['a']);
			expect(addedIds()).toEqual([]);
		});
	});
});
