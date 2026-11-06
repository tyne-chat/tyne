// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the instance fields the fork adds to discovery. Upstream's parsers copy only the fields
// they name, so each of these is read by a fork line in Discovery.ts or ClientRuntimeDiscovery.ts;
// a rebase that drops one loses the field without a type error. Only the server had tests for them.

import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {describe, test} from 'node:test';

// Discovery.ts imports its workspace packages without a file extension, as the bundlers resolve
// them; Node's own resolver needs the `.ts`.
registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (error?.code !== 'ERR_MODULE_NOT_FOUND' || specifier.endsWith('.ts')) throw error;
			return nextResolve(`${specifier}.ts`, context);
		}
	},
});

const {parseInstanceDiscoveryDocument} = await import('./Discovery.ts');
const {projectClientRuntimeDiscovery} = await import('./ClientRuntimeDiscovery.ts');
const {DEPLOYED_OFFICIAL_DOCUMENT, SELF_HOSTED_API_TOPOLOGY_DOCUMENT} = await import(
	'./__tests__/DiscoveryFixtures.ts'
);

const SIGNAL_BAR_GUILD_ID = '1400000000000000001';

function withForkFields(base, {community = {}, branding = {}} = {}) {
	return {
		...base,
		community: {...base.community, ...community},
		app_public: {...base.app_public, branding: {...base.app_public.branding, ...branding}},
	};
}

function parseAndProject(document) {
	const parsed = parseInstanceDiscoveryDocument(document);
	return {parsed, runtime: projectClientRuntimeDiscovery(parsed)};
}

describe("the fork's instance fields in discovery", () => {
	test('the signal bar community, the server list buttons and the desktop app prompt reach the client runtime', () => {
		const buttons = {favorites: false, explore: true, create_join: false, download: false, help: true};
		const {parsed, runtime} = parseAndProject(
			withForkFields(DEPLOYED_OFFICIAL_DOCUMENT, {
				community: {signal_bar_guild_id: SIGNAL_BAR_GUILD_ID, server_list_buttons: buttons},
				branding: {desktop_app_prompt_enabled: false},
			}),
		);

		assert.equal(parsed.community.signal_bar_guild_id, SIGNAL_BAR_GUILD_ID);
		assert.deepEqual(parsed.community.server_list_buttons, buttons);
		assert.equal(parsed.appPublic.branding.desktop_app_prompt_enabled, false);
		assert.equal(runtime.community.signal_bar_guild_id, SIGNAL_BAR_GUILD_ID);
		assert.deepEqual(runtime.community.server_list_buttons, buttons);
		assert.equal(runtime.appPublic.branding.desktop_app_prompt_enabled, false);
	});

	test('an instance that sends none of them leaves the community fields out and shows the desktop app prompt', () => {
		for (const document of [DEPLOYED_OFFICIAL_DOCUMENT, SELF_HOSTED_API_TOPOLOGY_DOCUMENT]) {
			const {parsed, runtime} = parseAndProject(document);

			assert.equal(Object.hasOwn(parsed.community, 'signal_bar_guild_id'), false);
			assert.equal(Object.hasOwn(parsed.community, 'server_list_buttons'), false);
			assert.equal(Object.hasOwn(parsed.appPublic.branding, 'desktop_app_prompt_enabled'), false);
			assert.equal(Object.hasOwn(runtime.community, 'signal_bar_guild_id'), false);
			assert.equal(Object.hasOwn(runtime.community, 'server_list_buttons'), false);
			assert.equal(runtime.appPublic.branding.desktop_app_prompt_enabled, true);
		}
	});

	test('a server list button the instance leaves out, or gives no boolean for, is shown', () => {
		const {runtime: partial} = parseAndProject(
			withForkFields(DEPLOYED_OFFICIAL_DOCUMENT, {
				community: {server_list_buttons: {explore: false, download: 'no'}},
			}),
		);
		assert.deepEqual(partial.community.server_list_buttons, {
			favorites: true,
			explore: false,
			create_join: true,
			download: true,
			help: true,
		});

		const {runtime: malformed} = parseAndProject(
			withForkFields(DEPLOYED_OFFICIAL_DOCUMENT, {community: {server_list_buttons: 'hidden'}}),
		);
		assert.deepEqual(malformed.community.server_list_buttons, {
			favorites: true,
			explore: true,
			create_join: true,
			download: true,
			help: true,
		});
	});

	test('a signal bar community that is null or empty is no community, and is kept as null', () => {
		for (const value of [null, '']) {
			const {runtime} = parseAndProject(
				withForkFields(DEPLOYED_OFFICIAL_DOCUMENT, {community: {signal_bar_guild_id: value}}),
			);
			assert.equal(Object.hasOwn(runtime.community, 'signal_bar_guild_id'), true);
			assert.equal(runtime.community.signal_bar_guild_id, null);
		}
	});

	test('a desktop app prompt setting that is not a boolean counts as not sent', () => {
		const {parsed, runtime} = parseAndProject(
			withForkFields(DEPLOYED_OFFICIAL_DOCUMENT, {branding: {desktop_app_prompt_enabled: 'false'}}),
		);
		assert.equal(Object.hasOwn(parsed.appPublic.branding, 'desktop_app_prompt_enabled'), false);
		assert.equal(runtime.appPublic.branding.desktop_app_prompt_enabled, true);
	});
});
