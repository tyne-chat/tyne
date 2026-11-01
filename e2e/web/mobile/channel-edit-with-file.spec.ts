import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';
import {longPress} from '../support/touch.js';

const PNG = {
	name: 'added.png',
	mimeType: 'image/png',
	buffer: Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
		'base64',
	),
};

test.describe('Editing a message with a file on the mobile layout', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	async function setUp(page: Page, content: string) {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `mobile_edit_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		await client.register({username: `mobile_edit_${timestamp}`, email, password, global_name: 'Mobile Tester'});
		const guild = await client.createGuild(`Mobile Guild ${timestamp}`).catch(async (err: any) => {
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
		const message = page.getByText(content).first();
		const composer = page.locator('flx-channel-textarea-composer [contenteditable="true"]').first();
		await expect(message).toBeVisible({timeout: 20_000});

		const editItem = page.getByText(/^Edit( message)?$/).first();
		await longPress(page, message, () => expect(editItem).toBeVisible({timeout: 5_000}));
		await editItem.click();
		await expect(page.getByText('Editing message')).toBeVisible({timeout: 5_000});
		await expect(composer).toHaveText(content);

		const addFile = async () => {
			await page.locator('flx-channel-textarea-upload-column button').first().click();
			const [chooser] = await Promise.all([
				page.waitForEvent('filechooser'),
				page
					.getByText(/^Upload file$/i)
					.first()
					.click(),
			]);
			await chooser.setFiles(PNG);
			await expect(page.getByText(PNG.name).first()).toBeVisible({timeout: 5_000});
		};
		const send = () =>
			page
				.getByRole('button', {name: /^Send message/i})
				.last()
				.click();
		return {addFile, composer, messages: () => client.getMessages(channel.id, 5), send};
	}

	test('Send saves the file onto the message and empties the composer', async ({page}) => {
		const content = `edit on a phone ${Date.now()}`;
		const {addFile, composer, messages, send} = await setUp(page, content);

		await addFile();
		await send();

		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		const [saved] = await messages();
		expect(saved.content).toBe(content);
		expect(saved.attachments[0].filename).toBe(PNG.name);
		await expect(page.locator('flx-channel-textarea-composer').getByText(PNG.name)).toHaveCount(0);
		await expect(composer).toHaveText('');
		await expect(page.getByText('Editing message')).toHaveCount(0);
	});

	test('clearing the text and adding a file saves the file, and does not delete the message', async ({page}) => {
		const {addFile, composer, messages, send} = await setUp(page, `replace on a phone ${Date.now()}`);

		await composer.click();
		await page.keyboard.press('Control+A');
		await page.keyboard.press('Backspace');
		await addFile();
		await send();

		await expect.poll(async () => (await messages())[0].attachments?.length ?? 0).toBe(1);
		expect((await messages())[0].content).toBe('');
		await expect(page.locator('[role="dialog"]')).toHaveCount(0);
	});
});
