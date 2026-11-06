// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the instance fields the fork adds (the server list buttons and the signal bar's community
// under `community`, the desktop app prompt under `app_public.branding`) go from the discovery
// document through upstream's snapshot readers to RuntimeConfig's getters. Upstream's readers copy
// only the fields they name, so each step has a fork line a rebase could drop without a conflict.

import {runtimeSnapshotFromDiscovery} from '@app/features/app/state/InstanceSnapshotStore';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {
	InvalidRuntimeConfigSnapshotError,
	requireRuntimeConfigSnapshot,
} from '@app/features/app/state/RuntimeConfigSnapshot';
import {DEPLOYED_OFFICIAL_DOCUMENT} from '@fluxer/instance_bootstrap/src/__tests__/DiscoveryFixtures';
import {parseInstanceDiscoveryDocument} from '@fluxer/instance_bootstrap/src/Discovery';
import type {ServerListButtons} from '@fluxer/instance_bootstrap/src/Types';
import type {InstanceConfigResponse} from '@fluxer/schema/src/domains/admin/AdminSchemas';
import {describe, expect, it} from 'vitest';

const SIGNAL_BAR_GUILD_ID = '1400000000000000001';
const ALL_SHOWN: ServerListButtons = {favorites: true, explore: true, create_join: true, download: true, help: true};
const SOME_HIDDEN: ServerListButtons = {
	favorites: false,
	explore: true,
	create_join: false,
	download: false,
	help: true,
};

function discovery(fork: {community?: Record<string, unknown>; branding?: Record<string, unknown>} = {}) {
	return parseInstanceDiscoveryDocument({
		...DEPLOYED_OFFICIAL_DOCUMENT,
		community: {...DEPLOYED_OFFICIAL_DOCUMENT.community, ...fork.community},
		app_public: {
			...DEPLOYED_OFFICIAL_DOCUMENT.app_public,
			branding: {...DEPLOYED_OFFICIAL_DOCUMENT.app_public.branding, ...fork.branding},
		},
	});
}

function activate(fork: Parameters<typeof discovery>[0] = {}): void {
	RuntimeConfig.applySnapshot(runtimeSnapshotFromDiscovery(discovery(fork)));
}

// What `GET /admin/instance-config` answers, with only the fields applyAdminInstanceConfig reads.
function adminConfig(
	fork: {policy?: Record<string, unknown>; branding?: Record<string, unknown>} = {},
): InstanceConfigResponse {
	const current = RuntimeConfig.getSnapshot();
	return {
		self_hosted: current.features.self_hosted,
		billing: {billing_active: false, stripe_serviceable: false},
		account_identity: {mode: RuntimeConfig.accountIdentity, tag_style: RuntimeConfig.tagStyle},
		registration: current.registration,
		policy: {
			single_community_enabled: false,
			single_community_guild_id: null,
			direct_messages_disabled: false,
			friends_disabled: false,
			personal_notes_enabled: true,
			guild_create_access: true,
			premium_mode: 'mirror',
			services_resolved: {gif_enabled: true, youtube_enabled: true, bluesky_enabled: false},
			...fork.policy,
		},
		app_public: {
			branding: {...current.appPublic.branding, desktop_app_prompt_enabled: undefined, ...fork.branding},
			setup: {configured: true},
			legal: current.appPublic.legal,
			registration: current.appPublic.registration,
		},
		notice: null,
	} as unknown as InstanceConfigResponse;
}

describe("the fork's instance fields in RuntimeConfig", () => {
	it('reads the server list buttons, the signal bar community and the desktop app prompt from discovery', () => {
		activate({
			community: {server_list_buttons: SOME_HIDDEN, signal_bar_guild_id: SIGNAL_BAR_GUILD_ID},
			branding: {desktop_app_prompt_enabled: false},
		});

		expect(RuntimeConfig.serverListButtons).toEqual(SOME_HIDDEN);
		expect(RuntimeConfig.signalBarGuildId).toBe(SIGNAL_BAR_GUILD_ID);
		expect(RuntimeConfig.desktopAppPromptEnabled).toBe(false);
	});

	it('shows every button, has no signal bar and offers the desktop app when the instance sends none of them', () => {
		activate();

		expect(RuntimeConfig.serverListButtons).toEqual(ALL_SHOWN);
		expect(RuntimeConfig.signalBarGuildId).toBeNull();
		expect(RuntimeConfig.desktopAppPromptEnabled).toBe(true);
	});

	it('keeps the fields in a snapshot stored and read back, as stored accounts are', () => {
		activate({
			community: {server_list_buttons: SOME_HIDDEN, signal_bar_guild_id: SIGNAL_BAR_GUILD_ID},
			branding: {desktop_app_prompt_enabled: false},
		});

		const stored = requireRuntimeConfigSnapshot(JSON.parse(JSON.stringify(RuntimeConfig.getSnapshot())));

		expect(stored.community.server_list_buttons).toEqual(SOME_HIDDEN);
		expect(stored.community.signal_bar_guild_id).toBe(SIGNAL_BAR_GUILD_ID);
		expect(stored.appPublic.branding.desktop_app_prompt_enabled).toBe(false);
	});

	it('reads a stored snapshot from before the fields with every button shown and the prompt on', () => {
		activate();
		const before = JSON.parse(JSON.stringify(RuntimeConfig.getSnapshot()));
		delete before.appPublic.branding.desktop_app_prompt_enabled;
		before.community.server_list_buttons = {explore: false};

		const stored = requireRuntimeConfigSnapshot(before);

		expect(stored.community.server_list_buttons).toEqual({...ALL_SHOWN, explore: false});
		expect(Object.hasOwn(stored.community, 'signal_bar_guild_id')).toBe(false);
		expect(stored.appPublic.branding.desktop_app_prompt_enabled).toBe(true);
	});

	it('refuses a stored snapshot whose button setting is not a boolean', () => {
		activate();
		const broken = JSON.parse(JSON.stringify(RuntimeConfig.getSnapshot()));
		broken.community.server_list_buttons = {explore: 'no'};

		expect(() => requireRuntimeConfigSnapshot(broken)).toThrow(InvalidRuntimeConfigSnapshotError);
	});

	it('takes the three fields from an admin config response', () => {
		activate();

		RuntimeConfig.applyAdminInstanceConfig(
			adminConfig({
				policy: {server_list_buttons: SOME_HIDDEN, signal_bar_guild_id: SIGNAL_BAR_GUILD_ID},
				branding: {desktop_app_prompt_enabled: false},
			}),
		);

		expect(RuntimeConfig.serverListButtons).toEqual(SOME_HIDDEN);
		expect(RuntimeConfig.signalBarGuildId).toBe(SIGNAL_BAR_GUILD_ID);
		expect(RuntimeConfig.desktopAppPromptEnabled).toBe(false);
	});

	it('keeps the desktop app prompt setting it has when an admin config response leaves it out', () => {
		activate({branding: {desktop_app_prompt_enabled: false}});

		RuntimeConfig.applyAdminInstanceConfig(
			adminConfig({policy: {server_list_buttons: ALL_SHOWN, signal_bar_guild_id: null}}),
		);

		expect(RuntimeConfig.desktopAppPromptEnabled).toBe(false);
		expect(RuntimeConfig.signalBarGuildId).toBeNull();

		RuntimeConfig.applyAdminInstanceConfig(
			adminConfig({
				policy: {server_list_buttons: ALL_SHOWN, signal_bar_guild_id: null},
				branding: {desktop_app_prompt_enabled: true},
			}),
		);
		RuntimeConfig.applyAdminInstanceConfig(
			adminConfig({policy: {server_list_buttons: ALL_SHOWN, signal_bar_guild_id: null}}),
		);

		expect(RuntimeConfig.desktopAppPromptEnabled).toBe(true);
	});
});
