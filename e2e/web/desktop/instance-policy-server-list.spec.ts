import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// Fork: an instance admin chooses which buttons the server list shows (policy.server_list_buttons)
// and who may create communities (policy.guild_create_access); the web app reads both from the
// instance's discovery document when it starts (RuntimeConfig.serverListButtons, GuildsLayout,
// guild/utils/ForkCommunityCreation.ts). The seed registers Alice with the setup token, so she is
// the instance admin. The policy is the whole instance's, so each test puts it back as it found it.
//
// The help button is left out: it needs a help centre address, which this instance does not have,
// so it is never shown here whatever the policy says.

function readSeed(): Record<string, string> {
	const content = readFileSync(resolve(process.cwd(), '.env.test'), 'utf-8');
	const seed: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) seed[match[1]] = match[2];
	}
	return seed;
}

type ServerListButton = 'favorites' | 'explore' | 'create_join' | 'download' | 'help';
type ServerListButtons = Record<ServerListButton, boolean>;
interface InstancePolicy {
	server_list_buttons: ServerListButtons;
	guild_create_access: boolean;
}

test.describe('Instance policy in the server list', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';
	const seed = readSeed();

	const request = async (token: string, method: string, path: string, body?: unknown): Promise<Response> =>
		fetch(`${baseURL}/api/v1${path}`, {
			method,
			headers: {'Content-Type': 'application/json', Authorization: token},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	const adminPolicy = async (method: 'GET' | 'PATCH', policy?: Partial<InstancePolicy>): Promise<InstancePolicy> => {
		const body = policy === undefined ? undefined : {policy};
		const response = await request(seed.E2E_ALICE_TOKEN, method, '/admin/instance/config', body);
		if (!response.ok) {
			throw new Error(`API ${method} /admin/instance/config failed (${response.status}): ${await response.text()}`);
		}
		return ((await response.json()) as {policy: InstancePolicy}).policy;
	};
	const writePolicy = (policy: Partial<InstancePolicy>) => adminPolicy('PATCH', policy);

	let saved: InstancePolicy;
	test.beforeEach(async () => {
		saved = await adminPolicy('GET');
	});
	test.afterEach(async () => {
		await writePolicy({server_list_buttons: saved.server_list_buttons, guild_create_access: saved.guild_create_access});
	});

	/** A new account with no admin rights. */
	async function member(label: string): Promise<{client: FluxerApiClient; email: string}> {
		const stamp = Date.now().toString().slice(-8);
		const client = new FluxerApiClient(baseURL);
		const email = `policy_${label}_${stamp}@test.local`;
		await client.register({username: `policy_${label}_${stamp}`, email, password, global_name: `Policy ${label}`});
		return {client, email};
	}

	const CHECKED: Array<Exclude<ServerListButton, 'help'>> = ['favorites', 'explore', 'create_join', 'download'];
	const button = (page: Page, name: ServerListButton) =>
		page.locator(
			{
				favorites: '[data-flx="app.sidebar-nav.favorites-button.fluxer-button.select"]',
				explore: '[data-flx="app.sidebar-nav.discovery-button.button.click"]',
				create_join: '[data-flx="app.sidebar-nav.add-guild-button.button.add-guild"]',
				download: '[data-flx="app.sidebar-nav.download-button.button.download"]',
				help: '[data-flx="app.sidebar-nav.help-button.button.help"]',
			}[name],
		);
	// Always in the server list: once it shows, the list has been laid out with the policy it read.
	const homeButton = (page: Page) => page.locator('[data-flx="app.sidebar-nav.fluxer-button.fluxer-button.select"]');
	const openApp = async (page: Page, email: string, accountPassword = password) => {
		await loginAs(page, email, accountPassword);
		await expect(homeButton(page)).toBeVisible({timeout: 20_000});
	};
	const reloadApp = async (page: Page) => {
		await page.reload();
		await expect(homeButton(page)).toBeVisible({timeout: 20_000});
	};
	const buttonsShown = (shown: boolean): ServerListButtons => ({
		favorites: shown,
		explore: shown,
		create_join: shown,
		download: shown,
		help: shown,
	});
	const expectButtons = async (page: Page, policy: ServerListButtons) => {
		for (const name of CHECKED) {
			if (policy[name]) await expect(button(page, name)).toBeVisible();
			else await expect(button(page, name)).toHaveCount(0);
		}
	};

	test('the server list shows the buttons the policy allows, after a reload', async ({page}) => {
		await writePolicy({server_list_buttons: buttonsShown(true)});
		const {email} = await member('buttons');
		await openApp(page, email);
		await expectButtons(page, buttonsShown(true));

		const some = {...buttonsShown(true), explore: false, download: false};
		await writePolicy({server_list_buttons: some});
		await reloadApp(page);
		await expectButtons(page, some);

		await writePolicy({server_list_buttons: buttonsShown(false)});
		await reloadApp(page);
		await expectButtons(page, buttonsShown(false));

		await writePolicy({server_list_buttons: buttonsShown(true)});
		await reloadApp(page);
		await expectButtons(page, buttonsShown(true));
	});

	test('with community creation restricted, a member is offered only joining', async ({page}) => {
		await writePolicy({server_list_buttons: buttonsShown(true), guild_create_access: true});
		const {client, email} = await member('restricted');
		await openApp(page, email);
		await expect(button(page, 'create_join')).toHaveAttribute('aria-label', 'Create or join a community');

		await writePolicy({guild_create_access: false});
		await reloadApp(page);
		await expect(button(page, 'create_join')).toHaveAttribute('aria-label', 'Join a community');
		await button(page, 'create_join').click();
		await expect(page.locator('[data-flx="guild.add-guild-modal.guild-join-form.form-container"]')).toBeVisible();
		await expect(page.locator('[data-flx="guild.add-guild-modal.guild-join-form.button.back"]')).toHaveCount(0);
		await expect(page.locator('[data-flx="guild.add-guild-modal.landing-view.landing-container"]')).toHaveCount(0);

		// The client hides what the API would refuse.
		const refused = await request(client.getToken()!, 'POST', '/guilds', {name: 'Not allowed'});
		expect(refused.status).toBe(403);

		await writePolicy({guild_create_access: true});
		await reloadApp(page);
		await expect(button(page, 'create_join')).toHaveAttribute('aria-label', 'Create or join a community');
		await button(page, 'create_join').click();
		await expect(page.locator('[data-flx="guild.add-guild-modal.landing-view.landing-container"]')).toBeVisible();
	});

	test('the instance admin keeps the add-community button when the policy hides it from everyone', async ({
		page,
		browser,
	}) => {
		await writePolicy({server_list_buttons: {...buttonsShown(true), create_join: false}, guild_create_access: false});
		const {email} = await member('hidden');
		await openApp(page, email);
		await expect(button(page, 'favorites')).toBeVisible();
		await expect(button(page, 'create_join')).toHaveCount(0);

		const adminContext = await browser.newContext();
		try {
			const adminPage = await adminContext.newPage();
			await openApp(adminPage, seed.E2E_ALICE_EMAIL, seed.E2E_ALICE_PASSWORD);
			await expect(button(adminPage, 'create_join')).toHaveAttribute('aria-label', 'Create or join a community');
		} finally {
			await adminContext.close();
		}
	});
});
