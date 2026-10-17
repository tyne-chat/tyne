// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: persona mentions in plaintext (notifications, reply previews, copied text).

import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => ({
	msg: (descriptor: unknown) => descriptor,
}));
vi.mock('@app/features/expressions/utils/EmojiUtils', () => ({
	getEmojiURL: () => null,
}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {
		getUser: (id: string) => (id === '1' ? {id: '1', username: 'alice', globalName: 'Alice'} : null),
	},
}));
vi.mock('@app/features/user/utils/NicknameUtils', () => ({
	getNickname: (user: {globalName: string}) => user.globalName,
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {getCachedMessages: () => null},
}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {getChannel: () => null},
}));

const {parseAndRenderToPlaintext} = await import('@app/features/messaging/utils/markdown/Plaintext');
const {ParserFlags} = await import('@app/features/messaging/utils/markdown/parser/Enums');
const {PersonaStore} = await import('@app/features/persona/state/PersonaStore');

const render = (content: string) =>
	parseAndRenderToPlaintext(content, ParserFlags.ALLOW_USER_MENTIONS, {
		channelId: 'c1',
		i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? ''} as never,
	});

describe('persona mentions in plaintext', () => {
	beforeEach(() => {
		PersonaStore.reset();
	});

	it('names a persona the client knows', () => {
		PersonaStore.recordKnownPersona({id: '999', name: 'Bob the Fox'});

		expect(render('hi <@1:999>')).toBe('hi @Bob the Fox');
	});

	it("falls back to the account's name for a persona it does not know", () => {
		expect(render('hi <@1:999>')).toBe('hi @Alice');
	});

	it("keeps the account's name for a mention of the account", () => {
		expect(render('hi <@1>')).toBe('hi @Alice');
	});
});
