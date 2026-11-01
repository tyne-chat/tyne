import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe("The inline edit's persona selector", () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	async function setUp(page: Page) {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `edit_persona_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		await client.register({
			username: `edit_persona_${timestamp}`,
			email,
			password,
			global_name: 'Edit Tester',
		});
		const alpha = await client.createPersona({name: `Alpha-${timestamp}`, persona_tags: [{prefix: 'a:'}]});
		const beta = await client.createPersona({name: `Beta-${timestamp}`, persona_tags: [{prefix: 'b:'}]});

		const guild = await client.createGuild(`Edit Guild ${timestamp}`).catch(async (err: any) => {
			if (!err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
				throw err;
			}
			return (await client.getMyGuilds())[0];
		});
		const channels = await client.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) || channels[0];

		const content = `edit me ${timestamp}`;
		await client.sendMessage(channel.id, content, alpha);

		await loginAs(page, email, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		await expect(page.getByText(content)).toBeVisible({timeout: 20_000});
		await expect(page.getByText(alpha.name)).toBeVisible({timeout: 10_000});

		const composer = page.locator('flx-channel-textarea-composer [contenteditable="true"]').first();
		await expect(composer).toBeVisible({timeout: 20_000});
		const editor = page.locator(
			'[data-flx="channel.editing-message-input.textarea-container"] [contenteditable="true"]',
		);
		const openEdit = async () => {
			await composer.click();
			await page.keyboard.press('ArrowUp');
			await expect(editor).toBeFocused({timeout: 10_000});
		};
		const pick = async (name: string) => {
			await page.locator('[data-flx="channel.inline-edit-controls.button.persona"]').click();
			await page.locator('[data-flx="persona.picker-sheet"]').getByText(name).last().click();
			await expect(page.locator('[data-flx="persona.picker-sheet"]')).toBeHidden();
			await expect(editor).toBeFocused();
		};
		return {alpha, beta, content, editor, openEdit, pick};
	}

	const authorName = (page: Page, name: string) => page.locator('[data-flx*="message-username"]').getByText(name);

	test('a pick waits for Save, Escape discards it, and Enter saves it with the text unchanged', async ({page}) => {
		const {alpha, beta, content, editor, openEdit, pick} = await setUp(page);

		await openEdit();
		await pick(beta.name);
		await page.keyboard.press('Escape');
		await expect(editor).toBeHidden({timeout: 10_000});
		await expect(authorName(page, alpha.name)).toBeVisible();
		await expect(authorName(page, beta.name)).toHaveCount(0);

		await openEdit();
		await pick(beta.name);
		await expect(authorName(page, alpha.name)).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(editor).toBeHidden({timeout: 10_000});
		await expect(authorName(page, beta.name)).toBeVisible({timeout: 10_000});
		await expect(page.getByText(content)).toBeVisible();
	});

	test('a typed tag wins over a pick', async ({page}) => {
		const {alpha, beta, editor, openEdit, pick} = await setUp(page);

		await openEdit();
		await pick(alpha.name);
		await page.keyboard.press('Home');
		await page.keyboard.type('b: ');
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 10_000});
		await expect(authorName(page, beta.name)).toBeVisible({timeout: 10_000});
	});
});
