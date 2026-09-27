// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import RollingTypingStore from '@app/features/typing/rolling/RollingTypingStore';
import {TYPING_ROLLING_EXPIRY_MS} from '@app/features/typing/rolling/TypingSendThrottle';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

describe('RollingTypingStore', () => {
	const channelId = '100000000000000001';
	const userId1 = '200000000000000001';
	const userId2 = '200000000000000002';

	const samplePersona: MessageSubprofileResponse = {
		id: 'persona_1',
		name: 'Persona One',
		avatar: 'avatar_hash_1',
		color: 0xff0000,
		pronouns: 'she/her',
		display_tag_text: 'P1',
		display_tag_icon: null,
	};

	beforeEach(() => {
		vi.useFakeTimers();
		RollingTypingStore.reset();
	});

	afterEach(() => {
		RollingTypingStore.reset();
		vi.useRealTimers();
	});

	it('tracks typing status and subprofile for local origin', () => {
		RollingTypingStore.start(channelId, userId1, 'local', samplePersona);

		expect(RollingTypingStore.isTyping(channelId, userId1)).toBe(true);
		expect(RollingTypingStore.isConfirmedTyping(channelId, userId1)).toBe(false);
		expect(RollingTypingStore.countTypists(channelId)).toBe(1);
		expect(RollingTypingStore.getSubprofile(channelId, userId1)).toEqual(samplePersona);
	});

	it('tracks confirmed typing status for gateway origin', () => {
		RollingTypingStore.start(channelId, userId1, 'gateway', samplePersona);

		expect(RollingTypingStore.isTyping(channelId, userId1)).toBe(true);
		expect(RollingTypingStore.isConfirmedTyping(channelId, userId1)).toBe(true);
		expect(RollingTypingStore.getSubprofile(channelId, userId1)).toEqual(samplePersona);
	});

	it('promotes local entry to confirmed when gateway event arrives', () => {
		RollingTypingStore.start(channelId, userId1, 'local', samplePersona);
		expect(RollingTypingStore.isConfirmedTyping(channelId, userId1)).toBe(false);

		RollingTypingStore.start(channelId, userId1, 'gateway', samplePersona);
		expect(RollingTypingStore.isConfirmedTyping(channelId, userId1)).toBe(true);
		expect(RollingTypingStore.getSubprofile(channelId, userId1)).toEqual(samplePersona);
	});

	it('removes typist on explicit remove call', () => {
		RollingTypingStore.start(channelId, userId1, 'local', samplePersona);
		expect(RollingTypingStore.isTyping(channelId, userId1)).toBe(true);

		RollingTypingStore.remove(channelId, userId1);
		expect(RollingTypingStore.isTyping(channelId, userId1)).toBe(false);
		expect(RollingTypingStore.getSubprofile(channelId, userId1)).toBeUndefined();
		expect(RollingTypingStore.countTypists(channelId)).toBe(0);
	});

	it('expires typist after TYPING_ROLLING_EXPIRY_MS', () => {
		RollingTypingStore.start(channelId, userId1, 'local', samplePersona);
		expect(RollingTypingStore.isTyping(channelId, userId1)).toBe(true);

		vi.advanceTimersByTime(TYPING_ROLLING_EXPIRY_MS - 100);
		expect(RollingTypingStore.isTyping(channelId, userId1)).toBe(true);

		vi.advanceTimersByTime(200);
		expect(RollingTypingStore.isTyping(channelId, userId1)).toBe(false);
		expect(RollingTypingStore.getSubprofile(channelId, userId1)).toBeUndefined();
	});

	it('resets all typists across channels', () => {
		RollingTypingStore.start(channelId, userId1, 'local', samplePersona);
		RollingTypingStore.start('other_channel', userId2, 'gateway', null);

		expect(RollingTypingStore.countTypists(channelId)).toBe(1);
		expect(RollingTypingStore.countTypists('other_channel')).toBe(1);

		RollingTypingStore.reset();

		expect(RollingTypingStore.countTypists(channelId)).toBe(0);
		expect(RollingTypingStore.countTypists('other_channel')).toBe(0);
	});
});
