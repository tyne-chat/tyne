// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {beforeEach, describe, expect, it, vi} from 'vitest';

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

export const mockSpeakText = vi.fn();
vi.mock('@app/features/voice/utils/TtsSpeechUtils', () => ({
	nativeApiPresent: () => true,
	nativeHasVoices: () => true,
	speak: vi.fn(),
	speakWithNative: vi.fn(),
	stopNative: vi.fn(),
	cancel: vi.fn(),
	pauseNative: vi.fn(),
	resumeNative: vi.fn(),
	getNativeVoices: () => [],
	getVoices: () => [],
	createUtterances: (text: string) => [
		{
			text,
			rate: 1,
			onstart: null,
			onend: null,
			onerror: null,
		},
	],
}));

if (typeof window !== 'undefined' && !window.speechSynthesis) {
	(window as any).speechSynthesis = {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		getVoices: () => [],
		speak: vi.fn(),
		cancel: vi.fn(),
	};
}

export const mockGetChannel = vi.fn();
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {
		getChannel: (id: string) => mockGetChannel(id),
	},
}));

export const mockGetUser = vi.fn();
vi.mock('@app/features/user/state/Users', () => ({
	default: {
		getUser: (id: string) => mockGetUser(id),
	},
}));

export const mockGetMessageReference = vi.fn();
vi.mock('@app/features/messaging/state/MessageReferences', () => ({
	default: {
		getMessageReference: (...args: Array<any>) => mockGetMessageReference(...args),
	},
	MessageReferenceState: {
		LOADED: 'LOADED',
	},
}));

vi.mock('@app/features/relationship/state/Relationships', () => ({
	default: {
		isBlocked: () => false,
		getRelationship: () => null,
	},
}));

vi.mock('@app/features/navigation/state/SelectedChannel', () => ({
	default: {
		get currentChannelId() {
			return '100000000000000001';
		},
	},
}));

vi.mock('@app/features/ui/state/Notification', () => ({
	default: {
		ttsNotificationMode: 1, // ALL_CHANNELS
		getTTSNotificationMode: () => 1,
		setTTSNotificationMode: vi.fn(),
	},
	TTSNotificationMode: {
		NEVER: 0,
		ALL_CHANNELS: 1,
		FOR_CURRENT_CHANNEL: 2,
	},
}));

vi.mock('@app/features/accessibility/state/Accessibility', () => ({
	default: {
		enableTTSCommand: true,
		setEnableTTSCommand: vi.fn(),
	},
}));

import {Channel} from '@app/features/channel/models/Channel';
import {User} from '@app/features/user/models/User';
import * as TtsTextFormatter from '@app/features/voice/utils/TtsTextFormatter';
import VoiceTtsUtils from '@app/features/voice/utils/VoiceTtsUtils';

describe('VoiceTtsUtils - Persona Subprofile Awareness', () => {
	const channelId = '100000000000000001';
	const authorUserId = '200000000000000001';
	const replyUserId = '200000000000000002';

	const mockChannel = new Channel({
		id: channelId,
		name: 'general',
		type: 0,
		guild_id: '300000000000000001',
	});

	const mockAuthor = new User({
		id: authorUserId,
		username: 'alice',
		discriminator: '0001',
		avatar: null,
		flags: 0,
	} as any);

	const mockReplyAuthor = new User({
		id: replyUserId,
		username: 'bob',
		discriminator: '0002',
		avatar: null,
		flags: 0,
	} as any);

	beforeEach(() => {
		vi.clearAllMocks();
		VoiceTtsUtils.dispose();

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
			locale: 'en',
		} as any;
		VoiceTtsUtils.setI18n(mockI18n);

		mockGetChannel.mockReturnValue(mockChannel);
		mockGetUser.mockImplementation((id: string) => {
			if (id === authorUserId) return mockAuthor;
			if (id === replyUserId) return mockReplyAuthor;
			return null;
		});
	});

	it('uses persona name when message.subprofile is present', () => {
		const formatSpy = vi.spyOn(TtsTextFormatter, 'formatMessageForTts');

		const message: any = {
			id: 'msg_101',
			channel_id: channelId,
			type: 0,
			content: 'Hello from persona!',
			author: {id: authorUserId},
			subprofile: {
				id: 'sub_alice',
				name: 'AlicePersona',
			},
		};

		VoiceTtsUtils.handleIncomingTtsMessage(message);

		expect(formatSpy).toHaveBeenCalledWith(
			'Hello from persona!',
			'AlicePersona',
			'300000000000000001',
			expect.anything(),
			null,
		);
	});

	it('falls back to username/nickname when message.subprofile is not present', () => {
		const formatSpy = vi.spyOn(TtsTextFormatter, 'formatMessageForTts');

		const message: any = {
			id: 'msg_102',
			channel_id: channelId,
			type: 0,
			content: 'Standard message',
			author: {id: authorUserId},
		};

		VoiceTtsUtils.handleIncomingTtsMessage(message);

		expect(formatSpy).toHaveBeenCalledWith('Standard message', 'alice', '300000000000000001', expect.anything(), null);
	});

	it('resolves replyPersonaName when replying to a message authored by a persona', () => {
		const formatSpy = vi.spyOn(TtsTextFormatter, 'formatMessageForTts');

		mockGetMessageReference.mockReturnValue({
			state: 'LOADED',
			message: {
				id: 'ref_msg_01',
				author: {id: replyUserId},
				subprofile: {
					id: 'sub_bob',
					name: 'BobPersona',
				},
			},
		} as any);

		const replyMessage: any = {
			id: 'msg_103',
			channel_id: channelId,
			type: 19,
			content: 'Replying to you!',
			author: {id: authorUserId},
			subprofile: {
				id: 'sub_alice',
				name: 'AlicePersona',
			},
			message_reference: {
				channel_id: channelId,
				message_id: 'ref_msg_01',
			},
		};

		VoiceTtsUtils.handleIncomingTtsMessage(replyMessage);

		expect(formatSpy).toHaveBeenCalledWith(
			'Replying to you!',
			'AlicePersona',
			'300000000000000001',
			expect.anything(),
			'BobPersona',
		);
	});
});
