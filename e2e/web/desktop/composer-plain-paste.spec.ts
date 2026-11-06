import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// Fork (tyne-chat/tyne#169): a plain paste puts only the clipboard's text in the message box: no
// files, no formatting (messaging/utils/PlainPasteUtils.ts, channel/components/useChannelComposerPaste.tsx).
// The clipboard here holds what copying a spreadsheet range gives: formatted HTML, the plain text
// and a picture of the cells. An ordinary paste attaches the picture; a plain paste must not.
//
// The "Paste as plain text" item of the message box's context menu (TextareaContextMenu.tsx) is not
// tested here: the app opens that menu only in the desktop app, through its native context menu
// event (ui/hooks/useTextInputContextMenu.tsx), and a browser shows its own menu instead. In the
// browser a plain paste is the Ctrl+Shift+V shortcut, which this spec uses.

test.describe('Plain paste in the message box', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';

	test.use({permissions: ['clipboard-read', 'clipboard-write']});

	async function openChannel(page: Page) {
		const stamp = Date.now().toString().slice(-8);
		const client = new FluxerApiClient(baseURL);
		const email = `paste_${stamp}@test.local`;
		await client.register({username: `paste_${stamp}`, email, password, global_name: 'Paste Tester'});
		const userId = (await client.getMe()).id;
		const guild = await client.createGuild(`Paste Guild ${stamp}`);
		const channels = await client.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) ?? channels[0]!;

		await loginAs(page, email, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});
		return {client, channelId: channel.id, composer, stamp, userId};
	}

	/** Puts formatted HTML, plain text and a PNG on the clipboard, and returns the types it then holds. */
	async function copySpreadsheetRange(page: Page, html: string, text: string): Promise<Array<string>> {
		return page.evaluate(
			async ({html, text}) => {
				const canvas = new OffscreenCanvas(8, 8);
				const context = canvas.getContext('2d')!;
				context.fillStyle = '#c00';
				context.fillRect(0, 0, 8, 8);
				await navigator.clipboard.write([
					new ClipboardItem({
						'text/html': new Blob([html], {type: 'text/html'}),
						'text/plain': new Blob([text], {type: 'text/plain'}),
						'image/png': await canvas.convertToBlob({type: 'image/png'}),
					}),
				]);
				const items = await navigator.clipboard.read();
				return items.flatMap((item) => [...item.types]).sort();
			},
			{html, text},
		);
	}

	const attachments = (page: Page) =>
		page.locator('[data-flx="channel.channel-attachment-area.sortable-attachment-item.upload"]');

	test('the plain-paste shortcut inserts only the text, with mentions as pills, and that is what is sent', async ({
		page,
	}) => {
		const {client, channelId, composer, stamp, userId} = await openChannel(page);
		const html = `<table><tr><td><b>Total</b></td><td><i>42</i> <a href="https://example.com">${stamp}</a></td></tr></table>`;
		const text = `Total\t42 ${stamp} for <@${userId}>`;
		expect(await copySpreadsheetRange(page, html, text)).toEqual(['image/png', 'text/html', 'text/plain']);

		await composer.click();
		await page.keyboard.press('Control+Shift+V');

		// The text arrives as text, and the mention in it as a pill.
		await expect(composer).toContainText(new RegExp(`^Total\\s+42 ${stamp} for`));
		await expect(composer.locator('[data-lexical-mention-type="user"]')).toHaveCount(1);
		await expect(composer.locator('[data-lexical-mention-type="user"]')).toContainText('Paste Tester');
		await expect(composer.locator('b, strong, i, em, a, table')).toHaveCount(0);
		await expect(attachments(page)).toHaveCount(0);

		await page.keyboard.press('Enter');
		await expect(page.locator('[class*="messageSent"]', {hasText: `42 ${stamp}`})).toBeVisible({timeout: 15_000});
		// What is sent is the text as an ordinary paste sends it, tab included (upstream stopped widening
		// pasted tabs in #3896).
		const [sent] = await client.getMessages(channelId, 1);
		expect(sent.content).toBe(`Total\t42 ${stamp} for <@${userId}>`);
		expect(sent.attachments ?? []).toEqual([]);
	});

	test('an ordinary paste of the same clipboard attaches the picture instead', async ({page}) => {
		const {composer, stamp} = await openChannel(page);
		expect(await copySpreadsheetRange(page, `<b>${stamp}</b>`, `${stamp}`)).toEqual([
			'image/png',
			'text/html',
			'text/plain',
		]);

		await composer.click();
		await page.keyboard.press('Control+V');

		await expect(attachments(page)).toHaveCount(1);
		await expect(composer).toHaveText('');
	});
});
