import {expect, type Locator, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openUserSettings} from '../support/auth.js';

// Double-clicking a message edits your own and replies to anyone else's under a switch each, not
// one switch for both (tyne-chat/tyne#611). An account that turned upstream's one switch on keeps
// editing and stops replying, so double-clicking a word in someone else's message selects it.

// SyncedPreferences { accessibility = 1 { message_double_click_actions = 66: true } }: what a client
// from before the split stores with its switch on, without the fork's fields.
const UPSTREAM_SWITCH_ONLY = Buffer.from([0x0a, 0x03, 0x90, 0x04, 0x01]).toString('base64');

/** Double-clicks the middle of `text` inside `container`, where a word would be picked. */
async function doubleClickText(page: Page, container: Locator, text: string): Promise<void> {
	await container.scrollIntoViewIfNeeded();
	const point = await container.evaluate((element, wanted) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
			const index = node.textContent?.indexOf(wanted) ?? -1;
			if (index < 0) continue;
			const range = document.createRange();
			range.setStart(node, index);
			range.setEnd(node, index + wanted.length);
			const rect = range.getBoundingClientRect();
			return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
		}
		throw new Error(`"${wanted}" is not in the element`);
	}, text);
	await page.mouse.dblclick(point.x, point.y);
}

test.describe('Double-click on a message', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test("edits your own message, selects a word in someone else's, and replies once that is turned on", async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const password = 'TestPassword123!';

		const bob = new FluxerApiClient(baseURL);
		await bob.register({
			username: `bob_dbl_${timestamp}`,
			email: `dbl_bob_${timestamp}@test.local`,
			password,
			global_name: 'Bob Writer',
		});
		const aliceEmail = `dbl_alice_${timestamp}@test.local`;
		const alice = new FluxerApiClient(baseURL);
		await alice.register({
			username: `alice_dbl_${timestamp}`,
			email: aliceEmail,
			password,
			global_name: 'Alice Reader',
		});
		await alice.updateUserSettings({synced_preferences: UPSTREAM_SWITCH_ONLY});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await alice.createGuild(`Double-click ${timestamp}`);
			guildId = guild.id;
			const channels = await alice.getGuildChannels(guildId);
			channelId = (channels.find((c) => c.type === 0) || channels[0]).id;
			const invite = await alice.createInvite(channelId);
			await bob.acceptInvite(invite.code);
		} catch (err: any) {
			if (!err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) throw err;
			const guilds = await alice.getMyGuilds();
			guildId = guilds[0].id;
			const channels = await alice.getGuildChannels(guildId);
			channelId = (channels.find((c) => c.type === 0) || channels[0]).id;
		}

		const bobWord = `wordpick${timestamp}`;
		await bob.sendMessage(channelId, `${bobWord} is the word to pick`);
		const aliceText = `Alice wrote this ${timestamp}`;
		await alice.sendMessage(channelId, aliceText);

		await loginAs(page, aliceEmail, password);
		await page.goto(`/channels/${guildId}/${channelId}`);

		const bobMessage = page.locator('[data-flx*="message-content"]').filter({hasText: bobWord}).first();
		const aliceMessage = page.locator('[data-flx*="message-content"]').filter({hasText: aliceText}).first();
		const replyBar = page.locator('[data-flx="channel.reply-bar.top-border"]');
		const editBox = page.locator('[data-flx="channel.editing-message-input.textarea-container"]');
		await expect(bobMessage).toBeVisible({timeout: 15_000});
		await expect(aliceMessage).toBeVisible();

		// Someone else's message: the word is selected and no reply starts.
		await doubleClickText(page, bobMessage, bobWord);
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe(bobWord);

		// Your own message: the edit opens. A reply from the double-click before would be showing by now.
		await doubleClickText(page, aliceMessage, aliceText);
		await expect(editBox).toBeVisible();
		await expect(replyBar).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(editBox).toHaveCount(0);

		// Turn replying on in Advanced settings; editing stays on.
		await openUserSettings(page);
		const advancedTab = page.getByRole('treeitem', {name: 'Advanced'});
		await advancedTab.click();
		await page.getByPlaceholder('Search advanced settings').fill('Double-click');
		const editSwitch = page.getByRole('switch', {name: 'Double-click to edit'});
		const replySwitch = page.getByRole('switch', {name: 'Double-click to reply'});
		await expect(editSwitch).toBeChecked();
		await expect(replySwitch).not.toBeChecked();
		await replySwitch.click();
		await expect(replySwitch).toBeChecked();
		await expect(editSwitch).toBeChecked();
		await page.keyboard.press('Escape');
		await expect(advancedTab).toHaveCount(0);

		await doubleClickText(page, bobMessage, bobWord);
		await expect(replyBar).toBeVisible();
		await expect(page.locator('[data-flx="channel.reply-bar.author-name"]')).toContainText('Bob Writer');
	});
});
