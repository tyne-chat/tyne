import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// tyne-chat/tyne#232: in a narrow settings dialog, channel Permissions and community Roles are a
// drill-down: the list of sections, then the override or role list as a page of its own, then the
// editor as the level below, named in the header ("Permissions › Mods") with an arrow back to the
// list. Removing the open override, or deleting the open role, goes back to the list rather than on
// to the next one (app/components/dialogs/shared/SettingsNarrowNav.tsx, ChannelPermissionsTab.tsx,
// GuildRolesTab.tsx). The window is a narrow desktop one, as in channel-header-narrow.spec.ts.

test.describe('Narrow settings drill-downs', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';
	const SEND_MESSAGES = String(1 << 11);

	const authed = async <T = any>(client: FluxerApiClient, method: string, path: string, body?: unknown): Promise<T> => {
		const response = await fetch(`${baseURL}/api/v1${path}`, {
			method,
			headers: {Authorization: client.getToken() ?? '', 'Content-Type': 'application/json'},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) throw new Error(`API ${method} ${path} failed (${response.status}): ${await response.text()}`);
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	};

	/** A community whose #general has overrides for two roles, Mods and Helpers. */
	async function communityWithRoles(page: Page) {
		const stamp = Date.now().toString().slice(-8);
		const client = new FluxerApiClient(baseURL);
		const email = `narrowset_${stamp}@test.local`;
		await client.register({username: `narrowset_${stamp}`, email, password, global_name: 'Narrow Settings'});
		const guildName = `Narrow Settings ${stamp}`;
		const guild = await client.createGuild(guildName);
		const channels = await client.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) ?? channels[0]!;
		const mods = await authed<{id: string; name: string}>(client, 'POST', `/guilds/${guild.id}/roles`, {
			name: `Mods ${stamp}`,
		});
		const helpers = await authed<{id: string; name: string}>(client, 'POST', `/guilds/${guild.id}/roles`, {
			name: `Helpers ${stamp}`,
		});
		await authed(client, 'PUT', `/channels/${channel.id}/permissions/${mods.id}`, {
			type: 0,
			allow: '0',
			deny: SEND_MESSAGES,
		});
		await authed(client, 'PUT', `/channels/${channel.id}/permissions/${helpers.id}`, {
			type: 0,
			allow: SEND_MESSAGES,
			deny: '0',
		});

		await loginAs(page, email, password);
		await page.setViewportSize({width: 520, height: 800});
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		return {client, guild, guildName, channel, mods, helpers};
	}

	const nav = (page: Page) => page.locator('[data-flx="app.settings-narrow-nav.root"]');
	const title = (page: Page) => page.locator('[data-flx="app.settings-modal-header.title"]');
	const back = (page: Page) =>
		page.locator('[data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-button.show-list"]');

	test('channel Permissions: overrides list, override editor one level below, back, and removing one', async ({
		page,
	}) => {
		const {client, channel, mods, helpers} = await communityWithRoles(page);
		const rows = page.locator(
			'[data-flx="channel.channel-tabs.channel-permissions-tab.mobile-override-item.mobile-overwrite-select.button"]',
		);
		const removeOverride = page.locator(
			'[data-flx="channel.channel-tabs.channel-permissions-tab.button.delete-override"]',
		);

		await page
			.locator('[data-flx="app.channel-item-icon.icon-button.stop-propagation"][aria-label="Channel settings"]')
			.first()
			.click({timeout: 20_000});
		// Channel settings open narrow on the list of sections.
		await expect(nav(page)).toHaveAttribute('data-settings-narrow', 'true');
		await expect(nav(page)).toHaveAttribute('data-settings-narrow-view', 'list');
		await page.getByRole('treeitem', {name: 'Permissions'}).click();

		await expect(nav(page)).toHaveAttribute('data-settings-narrow-view', 'section');
		await expect(title(page)).toHaveText('Permissions');
		await expect(rows).toHaveText([mods.name, helpers.name, '@everyone']);

		await rows.filter({hasText: mods.name}).click();
		await expect(title(page)).toHaveText(`Permissions › ${mods.name}`);
		await expect(back(page)).toHaveAccessibleName('Back to Permissions');
		await expect(removeOverride).toBeVisible();
		await expect(rows).toHaveCount(0);

		await back(page).click();
		await expect(title(page)).toHaveText('Permissions');
		await expect(rows).toHaveCount(3);
		await expect(removeOverride).toHaveCount(0);

		// Removing the open override goes back to the list, not to the override next to it.
		await rows.filter({hasText: mods.name}).click();
		await removeOverride.click();
		await expect(rows).toHaveText([helpers.name, '@everyone']);
		await expect(removeOverride).toHaveCount(0);

		await page.getByRole('button', {name: 'Save changes'}).click();
		await expect
			.poll(async () => {
				const saved = await authed<{permission_overwrites?: Array<{id: string}>}>(
					client,
					'GET',
					`/channels/${channel.id}`,
				);
				return (saved.permission_overwrites ?? []).map((overwrite) => overwrite.id).includes(mods.id);
			})
			.toBe(false);
	});

	test('community Roles: role list, role editor one level below, back, and deleting one', async ({page}) => {
		const {client, guild, guildName, mods, helpers} = await communityWithRoles(page);
		const rows = page.locator(
			'[data-flx="guild.guild-tabs.guild-roles-tab.mobile-role-item.mobile-role-select.button"]',
		);
		const deleteRole = page.locator('[data-flx="guild.guild-tabs.guild-roles-tab.button.delete-role"]');

		await page.locator('[data-flx="app.guild-header.guild-name"]', {hasText: guildName}).click({timeout: 20_000});
		await page.getByRole('menuitem', {name: 'Community settings'}).click();
		// Opened with no section asked for, a narrow dialog starts on the list of sections.
		await expect(nav(page)).toHaveAttribute('data-settings-narrow', 'true');
		await expect(nav(page)).toHaveAttribute('data-settings-narrow-view', 'list');
		await page.getByRole('treeitem', {name: 'Roles'}).click();

		await expect(nav(page)).toHaveAttribute('data-settings-narrow-view', 'section');
		await expect(title(page)).toHaveText('Roles');
		await expect(rows).toHaveText([mods.name, helpers.name, '@everyone']);

		await rows.filter({hasText: mods.name}).click();
		await expect(title(page)).toHaveText(`Roles › ${mods.name}`);
		await expect(back(page)).toHaveAccessibleName('Back to Roles');
		await expect(deleteRole).toBeVisible();
		await expect(rows).toHaveCount(0);

		await back(page).click();
		await expect(title(page)).toHaveText('Roles');
		await expect(rows).toHaveCount(3);
		await expect(deleteRole).toHaveCount(0);

		// Deleting the open role goes back to the list once the server has deleted it, not on to the
		// role after it.
		await rows.filter({hasText: mods.name}).click();
		await deleteRole.click();
		await page
			.getByRole('dialog')
			.filter({hasText: 'Are you sure you want to delete'})
			.getByRole('button', {name: 'Delete role'})
			.click();
		await expect(rows).toHaveText([helpers.name, '@everyone']);
		await expect(title(page)).toHaveText('Roles');
		await expect(deleteRole).toHaveCount(0);
		const roles = await authed<Array<{id: string}>>(client, 'GET', `/guilds/${guild.id}/roles`);
		expect(roles.map((role) => role.id)).not.toContain(mods.id);
	});
});
