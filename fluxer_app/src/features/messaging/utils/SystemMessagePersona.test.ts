// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the "started a thread" notice is a message, so it can carry the persona the thread was
// started as. Its plain text (notifications, previews, copying) names that persona.

import {MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import type {I18n} from '@lingui/core';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@app/features/user/state/Users', () => ({default: {getUser: (id: string) => ({id})}}));
vi.mock('@app/features/user/utils/NicknameUtils', () => ({getDisplayName: () => 'Chiara'}));

const {SystemMessageUtils} = await import('@app/features/messaging/utils/SystemMessageUtils');

const i18n = {
	_: (descriptor: {message?: string}, values: Record<string, unknown> = {}) =>
		Object.entries(values).reduce(
			(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
			descriptor.message ?? '',
		),
} as unknown as I18n;

const NOTICE = {
	id: '1500000000000000005',
	type: MessageTypes.THREAD_CREATED,
	content: 'fox thread',
	author: {id: '100'},
};

describe('SystemMessageUtils.stringify', () => {
	it('names the persona a thread was started as', () => {
		expect(SystemMessageUtils.stringify({...NOTICE, subprofile: {name: 'Fox'}}, i18n)).toBe(
			'Fox started a thread: fox thread',
		);
	});

	it('names the account when the thread was started as the account', () => {
		expect(SystemMessageUtils.stringify(NOTICE, i18n)).toBe('Chiara started a thread: fox thread');
		expect(SystemMessageUtils.stringify({...NOTICE, subprofile: null}, i18n)).toBe(
			'Chiara started a thread: fox thread',
		);
	});
});
