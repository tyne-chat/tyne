// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// The fork's persona reactors in upstream's MessageReactions store: the user a reaction lists is
// built from the persona it was given as, and persona and display tag updates reach the lists.

import type {ReactionEmoji} from '@app/features/messaging/utils/ReactionUtils';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
	users: new Map<string, unknown>(),
	knownPersonas: new Map<string, unknown>(),
}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
		getSnapshotOrNull: () => null,
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: '1000000000000000001'}}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {
		getUser: (id: string) => state.users.get(id) ?? null,
		cacheUsers: () => {},
	},
}));
vi.mock('@app/features/persona/state/PersonaStore', () => ({
	PersonaStore: {getKnownPersona: (id: string) => state.knownPersonas.get(id) ?? null},
}));
vi.mock('@app/features/messaging/utils/ReactionUtils', () => ({
	getReactionKey: (messageId: string, emoji: ReactionEmoji) => `${messageId}:${emoji.name}:${emoji.id || ''}`,
}));

const {User} = await import('@app/features/user/models/User');
const {default: MessageReactions} = await import('@app/features/messaging/state/MessageReactions');

const ME = '1000000000000000001';
const ALICE = '1000000000000000002';
const MESSAGE = '2000000000000000001';
const FIRE: ReactionEmoji = {name: '🔥'};

function persona(id: string, name: string, extra: Partial<MessageSubprofileResponse> = {}): MessageSubprofileResponse {
	return {id, name, avatar: null, display_tag_text: 'SYS', ...extra};
}

function cacheUser(id: string, globalName: string): void {
	state.users.set(
		id,
		new User({
			id,
			username: globalName.toLowerCase(),
			discriminator: '0001',
			global_name: globalName,
			avatar: null,
			flags: 0,
		} as ConstructorParameters<typeof User>[0]),
	);
}

const reactors = () =>
	MessageReactions.getReactions(MESSAGE, FIRE).map((user) => ({
		id: user.id,
		personaId: user.personaId ?? null,
		name: user.subprofile?.name ?? user.globalName,
	}));

describe('MessageReactions: persona reactors', () => {
	beforeEach(() => {
		MessageReactions.handleGatewayReady();
		state.users.clear();
		state.knownPersonas.clear();
		cacheUser(ME, 'Chiara');
		cacheUser(ALICE, 'Alice');
	});

	it('lists a reaction given as a persona under that persona, apart from the account’s own', () => {
		MessageReactions.handleReactionAdd(MESSAGE, ME, FIRE, true, null);
		MessageReactions.handleReactionAdd(MESSAGE, ME, FIRE, true, 'p-kit', persona('p-kit', 'Kit'));

		expect(reactors()).toEqual([
			{id: ME, personaId: null, name: 'Chiara'},
			{id: ME, personaId: 'p-kit', name: 'Kit'},
		]);
		expect(MessageReactions.getMessageReactions(MESSAGE)).toEqual([
			expect.objectContaining({
				count: 2,
				me: true,
				me_root: true,
				persona_reactions: [{persona_id: 'p-kit', count: 1, me: true}],
			}),
		]);
	});

	it('takes the persona from the known personas when the event carries only its id', () => {
		state.knownPersonas.set('p-fox', persona('p-fox', 'Fox'));

		MessageReactions.handleReactionAdd(MESSAGE, ALICE, FIRE, false, 'p-fox');

		expect(reactors()).toEqual([{id: ALICE, personaId: 'p-fox', name: 'Fox'}]);
	});

	it('still lists an unknown persona apart from the account, without a persona to show', () => {
		MessageReactions.handleReactionAdd(MESSAGE, ALICE, FIRE, false, null);
		MessageReactions.handleReactionAdd(MESSAGE, ALICE, FIRE, false, 'p-unknown');

		expect(reactors().map(({id, personaId}) => ({id, personaId}))).toEqual([
			{id: ALICE, personaId: null},
			{id: ALICE, personaId: 'p-unknown'},
		]);
		expect(MessageReactions.getReactions(MESSAGE, FIRE)[1]?.subprofile).toBeNull();
	});

	it("treats persona '0' as the account itself", () => {
		MessageReactions.handleReactionAdd(MESSAGE, ALICE, FIRE, false, '0');

		expect(reactors()).toEqual([{id: ALICE, personaId: null, name: 'Alice'}]);
	});

	it('removes only the reaction of the persona named', () => {
		MessageReactions.handleReactionAdd(MESSAGE, ME, FIRE, true, null);
		MessageReactions.handleReactionAdd(MESSAGE, ME, FIRE, true, 'p-kit', persona('p-kit', 'Kit'));

		MessageReactions.handleReactionRemove(MESSAGE, ME, FIRE, true, 'p-kit');

		expect(reactors()).toEqual([{id: ME, personaId: null, name: 'Chiara'}]);
		expect(MessageReactions.getMessageReactions(MESSAGE)).toEqual([
			expect.objectContaining({count: 1, me: true, me_root: true}),
		]);
	});

	it('counts a reaction from an account it has not cached, without listing a reactor', () => {
		MessageReactions.handleReactionAdd(MESSAGE, '1000000000000000099', FIRE, false, 'p-x', persona('p-x', 'X'));

		expect(reactors()).toEqual([]);
		expect(MessageReactions.getMessageReactions(MESSAGE)[0]?.count).toBe(1);
	});
});

describe('MessageReactions: updates to the personas listed', () => {
	beforeEach(() => {
		MessageReactions.handleGatewayReady();
		state.users.clear();
		state.knownPersonas.clear();
		cacheUser(ME, 'Chiara');
		cacheUser(ALICE, 'Alice');
		MessageReactions.handleReactionAdd(MESSAGE, ME, FIRE, true, null);
		MessageReactions.handleReactionAdd(MESSAGE, ME, FIRE, true, 'p-kit', persona('p-kit', 'Kit'));
		MessageReactions.handleReactionAdd(MESSAGE, ALICE, FIRE, false, 'p-fox', persona('p-fox', 'Fox'));
	});

	it('renames a persona in the lists and tells their listeners once', () => {
		const listener = vi.fn();
		const unsubscribe = MessageReactions.subscribeReaction(MESSAGE, FIRE, listener);

		expect(MessageReactions.handlePersonaUpdate(persona('p-kit', 'Kit renamed', {avatar: 'a1b2c3d4'}))).toBe(true);

		expect(reactors().map((reactor) => reactor.name)).toEqual(['Chiara', 'Kit renamed', 'Fox']);
		expect(MessageReactions.getReactions(MESSAGE, FIRE)[1]?.subprofile?.avatar).toBe('a1b2c3d4');
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it('changes nothing and tells nobody for a persona not listed, or one without an id', () => {
		const listener = vi.fn();
		const unsubscribe = MessageReactions.subscribeReaction(MESSAGE, FIRE, listener);

		expect(MessageReactions.handlePersonaUpdate(persona('p-other', 'Other'))).toBe(false);
		expect(MessageReactions.handlePersonaUpdate({id: '', name: 'Nobody'} as MessageSubprofileResponse)).toBe(false);

		expect(reactors().map((reactor) => reactor.name)).toEqual(['Chiara', 'Kit', 'Fox']);
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("changes the display tag of one account's persona reactors only", () => {
		expect(MessageReactions.handleAuthorDisplayTagUpdate({userId: ME, display_tag_text: 'NEW'})).toBe(true);

		const [own, kit, fox] = MessageReactions.getReactions(MESSAGE, FIRE);
		expect(own?.subprofile ?? null).toBeNull();
		expect(kit?.subprofile?.display_tag_text).toBe('NEW');
		expect(fox?.subprofile?.display_tag_text).toBe('SYS');
	});

	it('changes nothing for a display tag of an account with no persona reactors, or without an account', () => {
		expect(
			MessageReactions.handleAuthorDisplayTagUpdate({userId: '1000000000000000099', display_tag_text: 'NEW'}),
		).toBe(false);
		expect(MessageReactions.handleAuthorDisplayTagUpdate({userId: '', display_tag_text: 'NEW'})).toBe(false);
	});
});
