// SPDX-License-Identifier: AGPL-3.0-or-later

import {runtimeSnapshotFromDiscovery} from '@app/features/app/state/InstanceSnapshotStore';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {parseInstanceDiscoveryDocument} from '@fluxer/instance_bootstrap/src/Discovery';

const TEST_API_ENDPOINT = 'https://primary.test/api';

// The runtime config the fork's component tests start from: a minimal instance discovery document,
// as upstream's AccountSwitchHarness fixture installed it before upstream removed that fixture.
function installTestRuntimeConfig(): void {
	RuntimeConfig.applySnapshot(
		runtimeSnapshotFromDiscovery(
			parseInstanceDiscoveryDocument({
				api_code_version: Number.MAX_SAFE_INTEGER,
				endpoints: {
					api: TEST_API_ENDPOINT,
					api_client: TEST_API_ENDPOINT,
					api_public: TEST_API_ENDPOINT,
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
				captcha: {provider: 'none'},
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
				limits: {version: 1, traitDefinitions: [], rules: []},
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
			}),
		),
	);
}

export function installVoiceMenuTestBootstrap(): void {
	const host = globalThis as unknown as {window?: Record<string, unknown>};
	if (typeof host.window === 'undefined') {
		host.window = host as unknown as Record<string, unknown>;
	}
	installTestRuntimeConfig();
}
