// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the first message of a new thread is sent by its own helper, not by the composer's normal
// send. It has to carry the persona the composer showed, both on the message shown at once and on
// the request, or the thread opens with a message from the account instead.

import type {Channel} from '@app/features/channel/models/Channel';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const reserveSend = vi.fn();
const createOptimistic = vi.fn();
const send = vi.fn();
const createOptimisticMessage = vi.fn();

vi.mock('@app/features/messaging/commands/MessageCommands', () => ({reserveSend, createOptimistic, send}));
vi.mock('@app/features/messaging/utils/MessageSubmitUtils', () => ({createOptimisticMessage}));
vi.mock('@app/features/user/state/Users', () => ({default: {getCurrentUser: () => ({id: '100'})}}));

const {sendThreadStarter} = await import('@app/features/threads/utils/ThreadStarterSend');

const THREAD = {id: '1500000000000000003'} as Channel;
const FOX = {id: '1500000000000000009', name: 'Fox'};

describe('sendThreadStarter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		reserveSend.mockReturnValue(true);
		send.mockResolvedValue(undefined);
		createOptimisticMessage.mockImplementation((data: {content: string; subprofile?: unknown}) => ({
			content: data.content,
			flags: 0,
			toJSON: () => ({content: data.content, subprofile: data.subprofile ?? null}),
		}));
	});

	it('sends the first message as the given persona', () => {
		sendThreadStarter(THREAD, {
			content: 'bao',
			nonce: '1',
			attachments: [],
			hasAttachments: false,
			stickers: [],
			subprofile: FOX,
		});
		expect(createOptimisticMessage.mock.calls[0]?.[0]).toMatchObject({channelId: THREAD.id, subprofile: FOX});
		expect(createOptimistic).toHaveBeenCalledWith(THREAD.id, expect.objectContaining({subprofile: FOX}));
		expect(send).toHaveBeenCalledWith(THREAD.id, expect.objectContaining({content: 'bao', subprofile: FOX}));
	});

	it('sends as the account when no persona is given', () => {
		sendThreadStarter(THREAD, {content: 'bao', nonce: '2', attachments: [], hasAttachments: false, stickers: []});
		expect(send).toHaveBeenCalledWith(THREAD.id, expect.objectContaining({content: 'bao', subprofile: undefined}));
	});
});
