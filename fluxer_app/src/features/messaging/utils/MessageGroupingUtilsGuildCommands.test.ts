// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {isNewMessageGroup} from '@app/features/messaging/utils/MessageGroupingUtils';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: 'me'}}));
vi.mock('@app/features/moderation/state/LocalUserSpamOverride', () => ({
	default: {isUserMarkedAsSpammer: () => false},
}));
vi.mock('@app/features/user/utils/DateFormatting', () => ({
	getFormattedFullDate: (date: Date) => date.toISOString().slice(0, 10),
}));

const AUTHOR = {id: 'author-1', flags: 0} as Message['author'];

function message(id: string, minute: number, command: Message['command'] = null): Message {
	return {
		id,
		author: AUTHOR,
		blocked: false,
		ignored: false,
		timestamp: new Date(Date.UTC(2026, 9, 30, 12, minute)),
		type: 0,
		webhookId: null,
		mentions: [],
		mentionRoles: [],
		mentionEveryone: false,
		subprofile: null,
		command,
		isUserMessage: () => true,
		hasFlag: () => false,
	} as unknown as Message;
}

const TUCK = {id: '77', guild_id: '9', name: 'tuck'};

describe('grouping around server command messages', () => {
	it('starts a new group for a command message, even right after the same author', () => {
		expect(isNewMessageGroup(undefined, message('1', 0), message('2', 1, TUCK))).toBe(true);
	});

	it('starts a new group for the message after a command message', () => {
		expect(isNewMessageGroup(undefined, message('1', 0, TUCK), message('2', 1))).toBe(true);
	});

	it('still groups ordinary messages', () => {
		expect(isNewMessageGroup(undefined, message('1', 0), message('2', 1))).toBe(false);
	});
});
