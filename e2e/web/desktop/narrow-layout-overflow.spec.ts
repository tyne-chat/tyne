import {deflateSync} from 'node:zlib';
import {expect, type Locator, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// Fork: nothing runs off the side of a narrow window. Tyne keeps the desktop layout at any window
// width, so these screens had parts cut off or sticking out until a series of CSS fixes: the
// Friends tabs (e4889b2955), page titles in a narrow header (d3c86d195c), Discovery's search box
// (6bc2d05d90), dialogs (a4f4cb4f7d), the emoji rows (68437919f7) and the sticker cards (9f686ed5a9)
// in community settings. Each check: the page does not scroll sideways, and what the fix is about
// lies inside the window.
//
// The narrow window (600px) keeps both sidebars open, as people use it. At phone width (360px) the
// server list and channel list alone are wider than the window and the page beside them lies
// outside it, so that test first hides them with the channel header's sidebar button.

test.describe('Nothing overflows a narrow window', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';

	/** A solid square PNG as a data URI, large enough for an emoji or a sticker. */
	function squarePng(size: number): string {
		const crcTable = Array.from({length: 256}, (_, n) => {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			return c >>> 0;
		});
		const crc = (bytes: Buffer) => {
			let c = 0xffffffff;
			for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
			return (c ^ 0xffffffff) >>> 0;
		};
		const chunk = (type: string, data: Buffer) => {
			const length = Buffer.alloc(4);
			length.writeUInt32BE(data.length);
			const body = Buffer.concat([Buffer.from(type), data]);
			const sum = Buffer.alloc(4);
			sum.writeUInt32BE(crc(body));
			return Buffer.concat([length, body, sum]);
		};
		const header = Buffer.alloc(13);
		header.writeUInt32BE(size, 0);
		header.writeUInt32BE(size, 4);
		header[8] = 8;
		header[9] = 2;
		const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x60)]);
		const pixels = Buffer.concat(Array.from({length: size}, () => row));
		const file = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk('IHDR', header),
			chunk('IDAT', deflateSync(pixels)),
			chunk('IEND', Buffer.alloc(0)),
		]);
		return `data:image/png;base64,${file.toString('base64')}`;
	}

	/** An account with a community that has one emoji and one sticker, signed in on its #general. */
	async function signedInWithCommunity(page: Page) {
		const stamp = Date.now().toString().slice(-8);
		const client = new FluxerApiClient(baseURL);
		const email = `narrowlay_${stamp}@test.local`;
		await client.register({username: `narrowlay_${stamp}`, email, password, global_name: 'Narrow Layout'});
		const guildName = `Narrow Layout ${stamp}`;
		const guild = await client.createGuild(guildName);
		const channels = await client.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) ?? channels[0]!;
		const image = squarePng(128);
		for (const [path, body] of [
			[`/guilds/${guild.id}/emojis`, {name: `long_emoji_name_${stamp}`, image}],
			[`/guilds/${guild.id}/stickers`, {name: `Sticker ${stamp}`, image, tags: ['wave']}],
		] as const) {
			const response = await fetch(`${baseURL}/api/v1${path}`, {
				method: 'POST',
				headers: {Authorization: client.getToken() ?? '', 'Content-Type': 'application/json'},
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error(`API POST ${path} failed (${response.status}): ${await response.text()}`);
		}
		await loginAs(page, email, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		await expect(sidebarToggle(page)).toBeVisible({timeout: 20_000});
		return {guildId: guild.id, guildName, channelId: channel.id};
	}

	const sidebarToggle = (page: Page) => page.locator('[data-flx="channel.channel-header.toggle-channels"]');
	const serverList = (page: Page) => page.locator('[data-flx="app.sidebar-nav.fluxer-button.fluxer-button.select"]');

	async function expectNoSidewaysScroll(page: Page): Promise<void> {
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}

	/** The element is shown and lies inside the window from edge to edge. */
	async function expectInsideWindow(page: Page, element: Locator): Promise<void> {
		await expect(element).toBeVisible();
		const width = page.viewportSize()!.width;
		await expect
			.poll(async () => {
				const box = await element.boundingBox();
				return box !== null && box.width > 0 && box.x >= -0.5 && box.x + box.width <= width + 0.5;
			})
			.toBe(true);
	}

	/** `inner` lies inside `outer`, as a card's text inside its card. */
	async function expectInside(inner: Locator, outer: Locator): Promise<void> {
		await expect
			.poll(async () => {
				const [a, b] = [await inner.boundingBox(), await outer.boundingBox()];
				return (
					a !== null &&
					b !== null &&
					a.x >= b.x - 0.5 &&
					a.y >= b.y - 0.5 &&
					a.x + a.width <= b.x + b.width + 0.5 &&
					a.y + a.height <= b.y + b.height + 0.5
				);
			})
			.toBe(true);
	}

	const friendsTabs = (page: Page) => page.locator('[data-flx="channel.direct-message.dm-friends-view.tabs-wrapper"]');

	/** Opens the Friends page from the server list (a fresh load of /channels/@me goes back to the last page). */
	async function openFriends(page: Page): Promise<void> {
		await serverList(page).click();
		await expect(page).toHaveURL(/\/channels\/@me$/);
		await expect(friendsTabs(page)).toBeVisible();
	}

	async function checkFriends(page: Page): Promise<void> {
		await expectInsideWindow(page, friendsTabs(page));
		await expectNoSidewaysScroll(page);
	}

	async function checkOtherPages(page: Page, guildId: string): Promise<void> {
		await page.goto(`/channels/${guildId}/members`);
		await expectInsideWindow(
			page,
			page.locator('[data-flx="channel.guild-members-page.header-left-content.header-label"]'),
		);
		await expectNoSidewaysScroll(page);

		await page.goto('/bookmarks');
		await expectInsideWindow(page, page.locator('[data-flx="messaging.message-list-page.title"]'));
		await expectNoSidewaysScroll(page);

		await page.goto('/channels/@explore');
		await expectInsideWindow(
			page,
			page.locator('[data-flx="discovery.discovery.discovery-navbar.search-form.submit"]'),
		);
		await expectNoSidewaysScroll(page);
	}

	// The dialog's own box (a settings dialog gives it a data-flx of its own, so go by its class).
	const dialog = (page: Page) => page.getByRole('dialog').locator('[class^="Modal.module__root___"]');

	async function checkDialogs(page: Page): Promise<void> {
		// User settings (Ctrl+,) and the quick switcher (Ctrl+K).
		for (const shortcut of ['ControlOrMeta+,', 'ControlOrMeta+k']) {
			await page.keyboard.press(shortcut);
			await expectInsideWindow(page, dialog(page));
			await expectNoSidewaysScroll(page);
			await page.keyboard.press('Escape');
			await expect(dialog(page)).toHaveCount(0);
		}
	}

	async function checkCommunitySettings(page: Page, guildName: string): Promise<void> {
		await page.locator('[data-flx="app.guild-header.guild-name"]', {hasText: guildName}).click();
		await page.getByRole('menuitem', {name: 'Community settings'}).click();
		const backToList = page.locator(
			'[data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-button.show-list"]',
		);

		await page.getByRole('treeitem', {name: 'Emoji'}).click();
		const emojiRow = page.locator('[data-flx="emoji.emojis.emoji-list-item.card--2"]');
		await expect(emojiRow).toHaveCount(1);
		await expectInsideWindow(page, emojiRow);
		await expectInside(emojiRow.locator('[data-flx="emoji.emojis.emoji-list-item.list-uploader"]'), emojiRow);
		await expectNoSidewaysScroll(page);

		await backToList.click();
		await page.getByRole('treeitem', {name: 'Stickers'}).click();
		const stickerCard = page.locator('[data-flx="emoji.stickers.sticker-grid-item.container.context-menu"]');
		await expect(stickerCard).toHaveCount(1);
		await expectInsideWindow(page, stickerCard);
		await expectInside(stickerCard.locator('[data-flx="emoji.stickers.sticker-grid-item.author-info"]'), stickerCard);
		await expectNoSidewaysScroll(page);
	}

	test('a narrow window, with both sidebars open', async ({page}) => {
		const {guildId, guildName, channelId} = await signedInWithCommunity(page);
		await page.setViewportSize({width: 600, height: 800});

		await openFriends(page);
		await checkFriends(page);
		await checkOtherPages(page, guildId);
		await checkDialogs(page);
		await page.goto(`/channels/${guildId}/${channelId}`);
		await checkCommunitySettings(page, guildName);
	});

	test('phone width, with the sidebars hidden', async ({page}) => {
		const {guildId, guildName, channelId} = await signedInWithCommunity(page);
		await openFriends(page);
		await sidebarToggle(page).click();
		await expect(serverList(page)).toBeHidden();
		await page.setViewportSize({width: 360, height: 740});

		await checkFriends(page);
		await checkOtherPages(page, guildId);
		await checkDialogs(page);

		// Community settings open from the community's menu, in the channel list.
		await page.goto(`/channels/${guildId}/${channelId}`);
		await sidebarToggle(page).click();
		await expect(serverList(page)).toBeVisible();
		await checkCommunitySettings(page, guildName);
	});
});
