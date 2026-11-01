import {crc32, deflateSync} from 'node:zlib';
import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';
import {longPress} from '../support/touch.js';

// A plain PNG big enough to show inline: a very small image is shown as a file.
function png(width: number, height: number): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body) >>> 0);
		return Buffer.concat([length, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 90)]);
	const pixels = deflateSync(Buffer.concat(Array.from({length: height}, () => row)));
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', pixels),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

test.describe('Deleting an attachment on the mobile layout', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	async function register(name: string) {
		const client = new FluxerApiClient(baseURL);
		const email = `${name}@test.local`;
		const password = 'TestPassword123!';
		await client.register({username: name, email, password, global_name: name});
		return {client, email, password};
	}

	async function channelOf(client: FluxerApiClient) {
		const guild = await client.createGuild(`Delete Guild ${Date.now()}`).catch(async (err: any) => {
			if (!err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
				throw err;
			}
			return (await client.getMyGuilds())[0];
		});
		const channels = await client.getGuildChannels(guild.id);
		return {guild, channel: channels.find((c) => c.type === 0) || channels[0]};
	}

	async function sendWithFiles(
		client: FluxerApiClient,
		channelId: string,
		content: string,
		files: Array<{name: string; type: string; data: Buffer}>,
	) {
		await client.ensureGatewaySession();
		const form = new FormData();
		form.append(
			'payload_json',
			JSON.stringify({content, attachments: files.map((file, id) => ({id: String(id), filename: file.name}))}),
		);
		files.forEach((file, index) => {
			form.append(`files[${index}]`, new Blob([new Uint8Array(file.data)], {type: file.type}), file.name);
		});
		const response = await fetch(`${baseURL}/api/v1/channels/${channelId}/messages`, {
			method: 'POST',
			headers: {Authorization: client.getToken()!},
			body: form,
		});
		expect(response.ok, await response.clone().text()).toBe(true);
	}

	const deleteItem = (page: Page) => page.getByText(/^Delete attachment$/).first();

	async function confirm(page: Page) {
		await deleteItem(page).click();
		await page
			.locator('[role="dialog"]')
			.getByRole('button', {name: /^Delete attachment/i})
			.click();
	}

	test('a file offers it, and it removes that file', async ({page}) => {
		const name = `del_file_${Date.now().toString().slice(-6)}`;
		const {client, email, password} = await register(name);
		const {guild, channel} = await channelOf(client);
		const content = `with a file ${Date.now()}`;
		await sendWithFiles(client, channel.id, content, [
			{name: 'notes.bin', type: 'application/octet-stream', data: Buffer.alloc(64, 7)},
		]);

		await loginAs(page, email, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		const file = page.getByText('notes.bin').first();
		await expect(file).toBeVisible({timeout: 20_000});
		await longPress(page, file, () => expect(deleteItem(page)).toBeVisible({timeout: 5_000}));
		await confirm(page);

		await expect.poll(async () => (await client.getMessages(channel.id, 1))[0].attachments?.length ?? 0).toBe(0);
		expect((await client.getMessages(channel.id, 1))[0].content).toBe(content);
	});

	test('an image offers it, and the other images stay', async ({page}) => {
		const name = `del_image_${Date.now().toString().slice(-6)}`;
		const {client, email, password} = await register(name);
		const {guild, channel} = await channelOf(client);
		const image = png(400, 300);
		await sendWithFiles(client, channel.id, `with images ${Date.now()}`, [
			{name: 'one.png', type: 'image/png', data: image},
			{name: 'two.png', type: 'image/png', data: image},
		]);

		await loginAs(page, email, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		const second = page.getByRole('button', {name: 'Open image in full view'}).last();
		await expect(second).toBeVisible({timeout: 20_000});
		await longPress(page, second, () => expect(deleteItem(page)).toBeVisible({timeout: 5_000}));
		await confirm(page);

		await expect.poll(async () => (await client.getMessages(channel.id, 1))[0].attachments?.length ?? 0).toBe(1);
	});

	test('the message text and other people’s files do not offer it', async ({page}) => {
		const stamp = Date.now().toString().slice(-6);
		const owner = await register(`del_owner_${stamp}`);
		const reader = await register(`del_reader_${stamp}`);
		const {guild, channel} = await channelOf(owner.client);
		const invite = await owner.client.createInvite(channel.id);
		await reader.client.acceptInvite(invite.code).catch((err: any) => {
			if (!err.message?.includes('ALREADY')) {
				throw err;
			}
		});
		const theirs = `their words ${stamp}`;
		const mine = `my words ${stamp}`;
		await sendWithFiles(owner.client, channel.id, theirs, [
			{name: 'theirs.bin', type: 'application/octet-stream', data: Buffer.alloc(64, 7)},
		]);
		await sendWithFiles(reader.client, channel.id, mine, [
			{name: 'mine.bin', type: 'application/octet-stream', data: Buffer.alloc(64, 7)},
		]);

		await loginAs(page, reader.email, reader.password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		const sheetItem = page.getByText(/^Copy text$|^Copy message$|^Reply$/).first();

		const theirFile = page.getByText('theirs.bin').first();
		await expect(theirFile).toBeVisible({timeout: 20_000});
		await longPress(page, theirFile, () => expect(sheetItem).toBeVisible({timeout: 5_000}));
		await expect(deleteItem(page)).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(sheetItem).toHaveCount(0);

		const myWords = page.getByText(mine).first();
		await longPress(page, myWords, () => expect(sheetItem).toBeVisible({timeout: 5_000}));
		await expect(deleteItem(page)).toHaveCount(0);
	});
});
