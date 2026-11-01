import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

const PNG = {
	name: 'added.png',
	mimeType: 'image/png',
	buffer: Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
		'base64',
	),
};

test.describe("The inline edit's Upload file", () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	async function setUp(page: Page, content: string) {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `edit_upload_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		await client.register({username: `edit_upload_${timestamp}`, email, password, global_name: 'Upload Tester'});
		const guild = await client.createGuild(`Upload Guild ${timestamp}`).catch(async (err: any) => {
			if (!err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
				throw err;
			}
			return (await client.getMyGuilds())[0];
		});
		const channels = await client.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) || channels[0];
		await client.sendMessage(channel.id, content);

		await loginAs(page, email, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		await expect(page.getByText(content)).toBeVisible({timeout: 20_000});

		const composer = page.locator('flx-channel-textarea-composer [contenteditable="true"]').first();
		await expect(composer).toBeVisible({timeout: 20_000});
		await composer.click();
		await page.keyboard.press('ArrowUp');
		const editor = page.locator(
			'[data-flx="channel.editing-message-input.textarea-container"] [contenteditable="true"]',
		);
		await expect(editor).toBeFocused({timeout: 10_000});

		const addFile = async () => {
			await page.locator('[data-flx="channel.inline-edit-controls.textarea-button.plus"]').click();
			const [chooser] = await Promise.all([
				page.waitForEvent('filechooser'),
				page.getByRole('menuitem', {name: /Upload file/i}).click(),
			]);
			await chooser.setFiles(PNG);
			await expect(page.getByText(PNG.name).first()).toBeVisible({timeout: 5_000});
			await expect(editor).toBeFocused();
		};
		const messages = async () => client.getMessages(channel.id, 5);
		return {addFile, client, editor, messages};
	}

	test('Upload file comes first in the menu, and Enter saves the file onto the message', async ({page}) => {
		const content = `add a file ${Date.now()}`;
		const {addFile, editor, messages} = await setUp(page, content);

		await page.locator('[data-flx="channel.inline-edit-controls.textarea-button.plus"]').click();
		await expect(page.getByRole('menuitem').first()).toHaveText(/Upload file/i);
		await page.keyboard.press('Escape');

		await addFile();
		expect((await messages())[0].attachments ?? []).toHaveLength(0);
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 15_000});
		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		const [saved] = await messages();
		expect(saved.content).toBe(content);
		expect(saved.attachments[0].filename).toBe(PNG.name);
		expect(saved.edited_timestamp).toBeTruthy();
		await expect(page.getByText('(edited)')).toBeVisible();
	});

	test('a pasted image lands in the edit, not the composer, and Enter saves it', async ({page}) => {
		const content = `paste a screenshot ${Date.now()}`;
		const {editor, messages} = await setUp(page, content);

		await editor.evaluate((element, base64) => {
			const clipboardData = new DataTransfer();
			const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
			clipboardData.items.add(new File([bytes], 'pasted.png', {type: 'image/png'}));
			element.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
		}, PNG.buffer.toString('base64'));

		await expect(page.getByText('pasted.png').first()).toBeVisible({timeout: 5_000});
		await expect(page.locator('flx-channel-textarea-composer').getByText('pasted.png')).toHaveCount(0);
		await expect(editor).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 15_000});
		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		const [saved] = await messages();
		expect(saved.content).toBe(content);
		expect(saved.attachments[0].filename).toBe('pasted.png');
	});

	test('text typed while the files upload stays in the box, and the files still land', async ({page}) => {
		const content = `slow upload ${Date.now()}`;
		const {addFile, editor, messages} = await setUp(page, content);
		await addFile();

		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/\/channels\/\d+\/messages\/\d+$/, async (route) => {
			if (route.request().method() === 'PATCH') {
				await held;
			}
			await route.continue();
		});
		const saving = page.waitForResponse(
			(response) => response.request().method() === 'PATCH' && /\/messages\/\d+$/.test(response.url()),
		);

		await page.keyboard.press('Enter');
		await expect(page.locator('[data-flx="channel.inline-edit-controls.uploading"]')).toBeVisible();
		await page.keyboard.press('End');
		await page.keyboard.type(' and more');
		release();
		await saving;

		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		await expect(editor).toBeVisible();
		await expect(editor).toHaveText(`${content} and more`);
		expect((await messages())[0].content).toBe(content);
		await expect(page.locator('[data-flx="channel.inline-edit-controls.uploading"]')).toHaveCount(0);
	});

	test('removing a file during the upload stops the save, and the text is not overwritten', async ({page}) => {
		const content = `change my mind mid upload ${Date.now()}`;
		const {addFile, editor, messages} = await setUp(page, content);
		await addFile();

		// Only the first save is held: the one that goes out after the removal must get through.
		let holdNext = true;
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/\/channels\/\d+\/messages\/\d+$/, async (route) => {
			if (route.request().method() === 'PATCH' && holdNext) {
				holdNext = false;
				await held;
			}
			await route.continue().catch(() => {});
		});

		const uploading = page.locator('[data-flx="channel.inline-edit-controls.uploading"]');
		await page.keyboard.press('Enter');
		await expect(uploading).toBeVisible();
		await page.getByText(PNG.name).first().hover();
		await page.getByRole('button', {name: /^Remove attachment/i}).click();
		await expect(uploading).toHaveCount(0);
		release();

		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' newer');
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 15_000});
		await expect.poll(async () => (await messages())[0].content).toBe(`${content} newer`);
		expect((await messages())[0].attachments ?? []).toHaveLength(0);
	});

	test('a persona picked on a message with only a file is saved', async ({page}) => {
		const {addFile, client, editor, messages} = await setUp(page, `only a file soon ${Date.now()}`);
		const persona = await client.createPersona({name: `Solo-${Date.now().toString().slice(-6)}`});

		await page.keyboard.press('Control+A');
		await page.keyboard.press('Backspace');
		await addFile();
		await page.keyboard.press('Enter');
		await expect(editor).toBeHidden({timeout: 15_000});
		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);

		await page.reload();
		const composer = page.locator('flx-channel-textarea-composer [contenteditable="true"]').first();
		await expect(composer).toBeVisible({timeout: 20_000});
		await composer.click();
		await page.keyboard.press('ArrowUp');
		await expect(editor).toBeFocused({timeout: 10_000});
		await page.locator('[data-flx="channel.inline-edit-controls.button.persona"]').click();
		await page.locator('[data-flx="persona.picker-sheet"]').getByText(persona.name).last().click();
		await expect(page.locator('[data-flx="persona.picker-sheet"]')).toBeHidden();
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 10_000});
		await expect.poll(async () => (await messages())[0].subprofile?.name).toBe(persona.name);
		expect((await messages())[0].attachments).toHaveLength(1);
	});

	test('a file and a persona pick survive leaving the channel, and save together', async ({page}) => {
		const content = `come back to this ${Date.now()}`;
		const {addFile, client, editor, messages} = await setUp(page, content);
		const persona = await client.createPersona({name: `Back-${Date.now().toString().slice(-6)}`});
		await page.reload();
		const composer = page.locator('flx-channel-textarea-composer [contenteditable="true"]').first();
		await expect(composer).toBeVisible({timeout: 20_000});
		await composer.click();
		await page.keyboard.press('ArrowUp');
		await expect(editor).toBeFocused({timeout: 10_000});

		await addFile();
		await page.locator('[data-flx="channel.inline-edit-controls.button.persona"]').click();
		await page.locator('[data-flx="persona.picker-sheet"]').getByText(persona.name).last().click();
		await expect(page.locator('[data-flx="persona.picker-sheet"]')).toBeHidden();

		await page.evaluate(() => {
			window.history.pushState({}, '', '/channels/@me');
			window.dispatchEvent(new PopStateEvent('popstate'));
		});
		await expect(editor).toBeHidden({timeout: 10_000});
		await page.goBack();
		await expect(editor).toBeVisible({timeout: 15_000});
		await expect(page.getByText(PNG.name).first()).toBeVisible();

		await editor.click();
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 15_000});
		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		expect((await messages())[0].subprofile?.name).toBe(persona.name);
	});

	test('closing the edit from outside the editor cancels a running save', async ({page}) => {
		const content = `cancel from outside ${Date.now()}`;
		const {addFile, editor, messages} = await setUp(page, content);
		await addFile();

		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/\/channels\/\d+\/messages\/\d+$/, async (route) => {
			if (route.request().method() === 'PATCH') {
				await held;
			}
			await route.continue().catch(() => {});
		});

		await page.locator('[data-flx="channel.editing-message-input.button.submit"]').click();
		await expect(page.locator('[data-flx="channel.inline-edit-controls.uploading"]')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(editor).toBeHidden({timeout: 10_000});
		release();

		await expect(page.locator('[data-flx="channel.inline-edit-controls.uploading"]')).toHaveCount(0);
		expect((await messages())[0].attachments ?? []).toHaveLength(0);
	});

	test('Enter straight after a paste saves the pasted file', async ({page}) => {
		const content = `quick enter ${Date.now()}`;
		const {editor, messages} = await setUp(page, content);

		await editor.evaluate((element, base64) => {
			const clipboardData = new DataTransfer();
			const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
			clipboardData.items.add(new File([bytes], 'quick.png', {type: 'image/png'}));
			element.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
			element.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true}),
			);
		}, PNG.buffer.toString('base64'));

		await expect(editor).toBeHidden({timeout: 15_000});
		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		expect((await messages())[0].attachments[0].filename).toBe('quick.png');
	});

	test('Escape discards the file', async ({page}) => {
		const {addFile, editor, messages} = await setUp(page, `change my mind ${Date.now()}`);

		await addFile();
		await page.keyboard.press('Escape');

		await expect(editor).toBeHidden({timeout: 10_000});
		await expect(page.getByText(PNG.name)).toHaveCount(0);
		expect((await messages())[0].attachments ?? []).toHaveLength(0);
	});

	test('clearing the text and adding a file saves the file, and does not delete the message', async ({page}) => {
		const {addFile, editor, messages} = await setUp(page, `replace me ${Date.now()}`);

		await page.keyboard.press('Control+A');
		await page.keyboard.press('Backspace');
		await addFile();
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 15_000});
		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		expect((await messages())[0].content).toBe('');
	});
});
