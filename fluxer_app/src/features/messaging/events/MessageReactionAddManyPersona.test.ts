// SPDX-License-Identifier: AGPL-3.0-or-later

// The fork's personas in upstream's MESSAGE_REACTION_ADD_MANY handler (tyne-chat/tyne#120): the
// gateway sends several reactions to one message together, and each keeps the persona it was
// given as, as a single MESSAGE_REACTION_ADD does.

import {beforeEach, describe, expect, it, vi} from 'vitest';

const calls = vi.hoisted(() => ({
	reactionAdds: [] as Array<Array<unknown>>,
	knownPersonas: [] as Array<Array<unknown>>,
}));

vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: 'me'}}));
vi.mock('@app/features/channel/state/ChannelPins', () => ({default: {handleMessageReactionAdd: () => {}}}));
vi.mock('@app/features/forum/state/ForumPosts', () => ({default: {handleReaction: () => {}}}));
vi.mock('@app/features/member/state/GuildMembers', () => ({default: {hydrateIfMissing: () => {}}}));
vi.mock('@app/features/messaging/state/MessageReactions', () => ({
	default: {
		batch: (run: () => void) => run(),
		handleReactionAdd: (...args: Array<unknown>) => calls.reactionAdds.push(args),
	},
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({default: {handleReaction: () => {}}}));
vi.mock('@app/features/messaging/state/SavedMessages', () => ({default: {handleMessageReactionChange: () => {}}}));
vi.mock('@app/features/notification/state/MentionFeed', () => ({default: {handleMessageReactionChange: () => {}}}));
vi.mock('@app/features/persona/state/PersonaStore', () => ({
	PersonaStore: {recordKnownPersona: (...args: Array<unknown>) => calls.knownPersonas.push(args)},
}));

const {handleMessageReactionAddMany} = await import('@app/features/messaging/events/MessageReactionAddMany');

const FOX = {id: 'p_fox', name: 'Fox', avatar: null};
const FIRE = {id: null, name: '🔥'};

describe('MESSAGE_REACTION_ADD_MANY with personas', () => {
	beforeEach(() => {
		calls.reactionAdds.length = 0;
		calls.knownPersonas.length = 0;
	});

	it('adds each reaction as the persona it was given as, and the account’s own without one', () => {
		handleMessageReactionAddMany(
			{
				channel_id: 'c1',
				message_id: 'm1',
				reactions: [
					{user_id: 'me', emoji: FIRE, persona_id: 'p_fox', subprofile: FOX},
					{user_id: 'me', emoji: FIRE, persona_id: 'p_bao'},
					{user_id: 'me', emoji: FIRE},
				],
			},
			{} as never,
		);

		expect(calls.reactionAdds).toEqual([
			['m1', 'me', FIRE, undefined, 'p_fox', FOX],
			['m1', 'me', FIRE, undefined, 'p_bao', undefined],
			['m1', 'me', FIRE, undefined, undefined, undefined],
		]);
		expect(calls.knownPersonas).toEqual([[FOX, 'me']]);
	});
});
