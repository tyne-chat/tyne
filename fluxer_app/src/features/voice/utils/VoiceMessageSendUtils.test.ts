// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import {CloudUpload} from '@app/features/messaging/upload/CloudUpload';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import Users from '@app/features/user/state/Users';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.hoisted(() => {
	const HARNESS_ENDPOINT = 'https://primary.test/api';
	const host = globalThis as unknown as {window?: Record<string, unknown>};
	if (typeof host.window === 'undefined') {
		host.window = host as unknown as Record<string, unknown>;
	}
	host.window.__FLUXER_BOOTSTRAP__ = {
		config: {
			releaseChannel: 'stable',
			bootstrapApiEndpoint: HARNESS_ENDPOINT,
			bootstrapApiPublicEndpoint: HARNESS_ENDPOINT,
		},
		instance: {
			api_code_version: Number.MAX_SAFE_INTEGER,
			endpoints: {
				api: HARNESS_ENDPOINT,
				api_client: HARNESS_ENDPOINT,
				api_public: HARNESS_ENDPOINT,
				gateway: 'wss://gateway.primary.test',
				media: 'https://media.primary.test',
				static_cdn: 'https://cdn.primary.test',
				marketing: 'https://primary.test',
				admin: 'https://admin.primary.test',
				invite: 'https://primary.test/invite',
				gift: 'https://primary.test/gift',
				webapp: 'https://app.primary.test',
				upload_relay: 'https://upload.primary.test',
			},
			captcha: {provider: 'none', hcaptcha_site_key: null, turnstile_site_key: null},
			features: {
				voice_enabled: false,
				stripe_enabled: false,
				self_hosted: false,
				presigned_attachment_uploads: false,
				emails_enabled: false,
			},
			gif: {provider: 'klipy', display_name: 'Klipy', attribution_required: false},
			sso: {enabled: false, enforced: false, display_name: null, redirect_uri: ''},
			registration: {mode: 'open', admin_registration_urls_enabled: true},
			community: {single_community: false, single_community_guild_id: null, direct_messages_disabled: false},
			services: {gif_enabled: true, youtube_enabled: false, bluesky_enabled: false},
			limits: undefined,
			push: {public_vapid_key: null},
			app_public: {
				branding: {
					product_name: 'Fluxer',
					icon_url: null,
					symbol_url: null,
					logo_url: null,
					wordmark_url: null,
					favicon_url: null,
					theme_color: null,
				},
				setup: {configured: true, admin_url: null},
				legal: {terms_url: null, privacy_url: null},
				registration: {collect_date_of_birth: true},
			},
		},
		geoip: {
			countryCode: null,
			regionCode: null,
			latitude: null,
			longitude: null,
			ageRestrictedGeos: [],
			ageBlockedGeos: [],
		},
	};
});

import {sendVoiceMessage} from './VoiceMessageSendUtils';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
	},
}));

vi.mock('@app/features/messaging/commands/MessageCommands', () => ({
	createOptimistic: vi.fn(),
	send: vi.fn().mockResolvedValue(null),
}));

vi.mock('@app/features/messaging/upload/CloudUpload', () => ({
	CloudUpload: {
		createAndStartUploads: vi.fn(),
		claimAttachmentsForMessage: vi.fn(),
	},
}));

vi.mock('@app/features/user/state/Users', () => ({
	default: {
		getCurrentUser: vi.fn(),
		cacheUsers: vi.fn(),
		getUser: vi.fn(),
	},
}));

describe('VoiceMessageSendUtils', () => {
	const channelId = '1000000000000000001';
	const mockFile = new File(['audio data'], 'voice-message.ogg', {type: 'audio/ogg'});
	const mockCurrentUser = {
		id: 'user-123',
		username: 'testuser',
		discriminator: '0001',
		avatar: null,
		toJSON: () => ({
			id: 'user-123',
			username: 'testuser',
			discriminator: '0001',
			avatar: null,
		}),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(Users.getCurrentUser).mockReturnValue(mockCurrentUser as any);
		vi.mocked(CloudUpload.createAndStartUploads).mockResolvedValue([
			{
				waveform: '',
				duration: 0,
				isVoiceMessage: false,
			} as any,
		]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('sends voice message without persona when no persona is latched', async () => {
		vi.spyOn(PersonaStore, 'getActiveSubprofileRequest').mockReturnValue(null);
		const recordUseSpy = vi.spyOn(PersonaStore, 'recordPersonaUse');

		await sendVoiceMessage({
			channelId,
			file: mockFile,
			waveform: 'AQIDBA==',
			duration: 5,
		});

		expect(MessageCommands.createOptimistic).toHaveBeenCalledWith(
			channelId,
			expect.objectContaining({
				subprofile: null,
			}),
		);
		expect(MessageCommands.send).toHaveBeenCalledWith(
			channelId,
			expect.objectContaining({
				subprofile: undefined,
			}),
		);
		expect(recordUseSpy).not.toHaveBeenCalled();
	});

	it('sends voice message with latched persona and records usage', async () => {
		const mockSubprofile = {
			id: 'persona-456',
			name: 'Alice',
			avatar: 'https://example.com/avatar.png',
			avatar_color: 0x123456,
			color: 0x123456,
			display_tag_text: 'SYS',
			display_tag_icon: null,
			pronouns: 'she/her',
			bio: 'Hello world',
			visibility: 'unlisted' as const,
		};
		vi.spyOn(PersonaStore, 'getActiveSubprofileRequest').mockReturnValue(mockSubprofile);
		const recordUseSpy = vi.spyOn(PersonaStore, 'recordPersonaUse').mockResolvedValue();

		await sendVoiceMessage({
			channelId,
			file: mockFile,
			waveform: 'AQIDBA==',
			duration: 5,
		});

		expect(recordUseSpy).toHaveBeenCalledWith('persona-456');
		expect(MessageCommands.createOptimistic).toHaveBeenCalledWith(
			channelId,
			expect.objectContaining({
				subprofile: expect.objectContaining({
					id: 'persona-456',
					name: 'Alice',
				}),
			}),
		);
		expect(MessageCommands.send).toHaveBeenCalledWith(
			channelId,
			expect.objectContaining({
				subprofile: mockSubprofile,
			}),
		);
	});

	it('honors explicitly provided subprofile param override', async () => {
		vi.spyOn(PersonaStore, 'getActiveSubprofileRequest').mockReturnValue(null);
		const explicitSubprofile = {
			id: 'persona-override',
			name: 'Override Persona',
			avatar: null,
			avatar_color: null,
			pronouns: null,
			color: null,
		};

		await sendVoiceMessage({
			channelId,
			file: mockFile,
			waveform: 'AQIDBA==',
			duration: 3,
			subprofile: explicitSubprofile,
		});

		expect(MessageCommands.createOptimistic).toHaveBeenCalledWith(
			channelId,
			expect.objectContaining({
				subprofile: expect.objectContaining({
					id: 'persona-override',
					name: 'Override Persona',
				}),
			}),
		);
		expect(MessageCommands.send).toHaveBeenCalledWith(
			channelId,
			expect.objectContaining({
				subprofile: explicitSubprofile,
			}),
		);
	});
});
