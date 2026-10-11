// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: 'user_1'}}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {post: vi.fn().mockResolvedValue({ok: true, status: 204, body: null})},
}));
vi.mock('@app/features/typing/rolling/RollingTypingStore', () => ({
	default: {start: vi.fn(), remove: vi.fn(), countTypists: () => 0},
}));

const {http} = await import('@app/features/platform/transport/RestTransport');
const {Endpoints} = await import('@app/features/app/constants/Endpoints');
const {default: RollingTypingStore} = await import('@app/features/typing/rolling/RollingTypingStore');
const {default: RollingTypingSender} = await import('@app/features/typing/rolling/RollingTypingSender');

const FOX: MessageSubprofileResponse = {id: '1546500000000000003', name: 'Fox', avatar: 'fox_avatar_hash'};

describe('what a typing request says about the persona', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(http.post).mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('names the persona by id and sends nothing else of it', async () => {
		RollingTypingSender.startTyping('channel_persona', FOX);
		await vi.runAllTimersAsync();

		expect(http.post).toHaveBeenCalledTimes(1);
		expect(http.post).toHaveBeenCalledWith(Endpoints.CHANNEL_TYPING('channel_persona'), {
			body: {persona_id: FOX.id},
		});
		// The indicator shown to the person typing is drawn from the copy the app already has.
		expect(RollingTypingStore.start).toHaveBeenCalledWith('channel_persona', 'user_1', 'local', FOX);
	});

	it('sends no body when typing as the account', async () => {
		RollingTypingSender.startTyping('channel_account', null);
		await vi.runAllTimersAsync();

		expect(http.post).toHaveBeenCalledTimes(1);
		expect(http.post).toHaveBeenCalledWith(Endpoints.CHANNEL_TYPING('channel_account'));
	});
});
