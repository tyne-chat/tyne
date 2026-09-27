// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) => {
				let msg = descriptor?.message ?? '';
				if (values) {
					for (const [k, v] of Object.entries(values)) {
						msg = msg.replaceAll(`{${k}}`, String(v));
					}
				}
				return msg;
			},
			locale: 'en',
		},
	}),
}));

import {Channel} from '@app/features/channel/models/Channel';
import {
	getRollingTypingAnnouncement,
	getRollingTypingText,
	getTypistName,
	type Typist,
} from '@app/features/typing/rolling/RollingTypingText';
import {User} from '@app/features/user/models/User';

describe('RollingTypingText - Persona Awareness', () => {
	const mockI18n = {
		_: (descriptor: {message?: string}, values?: Record<string, unknown>) => {
			let msg = descriptor?.message ?? '';
			if (values) {
				for (const [k, v] of Object.entries(values)) {
					msg = msg.replaceAll(`{${k}}`, String(v));
				}
			}
			return msg;
		},
	} as any;

	const channel = new Channel({
		id: '100000000000000001',
		name: 'general',
		type: 0,
		guild_id: '100000000000000010',
	});

	const aliceUser = new User({
		id: '200000000000000001',
		username: 'alice',
		discriminator: '0001',
		avatar: null,
		flags: 0,
	} as any);

	const bobUser = new User({
		id: '200000000000000002',
		username: 'bob',
		discriminator: '0002',
		avatar: null,
		flags: 0,
	} as any);

	it('getTypistName returns persona name when subprofile has name', () => {
		const typistWithPersona: Typist = {
			user: aliceUser,
			subprofile: {
				id: 'sub_alice',
				name: 'AlicePersona',
				color: 0xff00ff,
			} as any,
		};

		expect(getTypistName(typistWithPersona, channel)).toBe('AlicePersona');
	});

	it('getTypistName falls back to username/nickname when subprofile has no name or is absent', () => {
		const typistWithoutPersonaName: Typist = {
			user: aliceUser,
			subprofile: {
				id: 'sub_alice',
				name: '',
			} as any,
		};
		expect(getTypistName(typistWithoutPersonaName, channel)).toBe('alice');

		const directUserTypist: Typist = bobUser;
		expect(getTypistName(directUserTypist, channel)).toBe('bob');
	});

	it('getRollingTypingAnnouncement formats announcement with persona name for single typist', () => {
		const typistWithPersona: Typist = {
			user: aliceUser,
			subprofile: {
				id: 'sub_alice',
				name: 'AlicePersona',
			} as any,
		};

		const announcement = getRollingTypingAnnouncement(mockI18n, [typistWithPersona], channel);
		expect(announcement).toBe('AlicePersona is typing...');
	});

	it('getRollingTypingAnnouncement formats announcement with multiple typists including personas', () => {
		const typistA: Typist = {
			user: aliceUser,
			subprofile: {
				id: 'sub_alice',
				name: 'AlicePersona',
			} as any,
		};
		const typistB: Typist = bobUser;

		const announcement = getRollingTypingAnnouncement(mockI18n, [typistA, typistB], channel);
		expect(announcement).toBe('AlicePersona and bob are typing...');
	});

	it('getRollingTypingText returns null when no typing users', () => {
		expect(getRollingTypingText(mockI18n, [], channel, false)).toBeNull();
	});

	it('getRollingTypingText returns multiple people text when overflowing', () => {
		const typist: Typist = aliceUser;
		const result = getRollingTypingText(mockI18n, [typist], channel, true);
		expect(result).toBe('Multiple people are typing...');
	});
});
