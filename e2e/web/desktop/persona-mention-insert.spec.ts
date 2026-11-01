import {expect, type Locator, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Mentioning from a name', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const composer = (page: Page): Locator =>
		page.locator('flx-channel-textarea-composer [contenteditable="true"]').first();

	async function setUp(page: Page) {
		const stamp = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
		const password = 'TestPassword123!';
		const bob = new FluxerApiClient(baseURL);
		await bob.register({
			username: `bob_ins_${stamp}`,
			email: `ins_bob_${stamp}@test.local`,
			password,
			global_name: `Bob ${stamp}`,
		});
		const persona = await bob.createPersona({
			name: `Fox-${stamp}`,
			persona_tags: [{prefix: `f${stamp}:`}],
			visibility: 'public',
		});

		const alice = new FluxerApiClient(baseURL);
		const aliceEmail = `ins_alice_${stamp}@test.local`;
		await alice.register({
			username: `alice_ins_${stamp}`,
			email: aliceEmail,
			password,
			global_name: `Alice ${stamp}`,
		});
		const guild = await alice.createGuild(`Mention Guild ${stamp}`).catch(async (err: any) => {
			if (!err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
				throw err;
			}
			return (await alice.getMyGuilds())[0];
		});
		const channels = await alice.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) || channels[0];
		const invite = await alice.createInvite(channel.id);
		await bob.acceptInvite(invite.code).catch((err: any) => {
			if (!err.message?.includes('ALREADY')) {
				throw err;
			}
		});

		const bobId = (await bob.getMe()).id;
		const asPersona = await bob.sendMessageBody(channel.id, {content: `speaking ${stamp}`, persona_id: persona.id});
		const asAccount = await bob.sendMessage(channel.id, `plainly ${stamp}`);
		const mine = await alice.sendMessage(channel.id, `alpha beta ${stamp}`);

		await loginAs(page, aliceEmail, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		await expect(composer(page)).toBeVisible({timeout: 20_000});
		const row = (message: {id: string}) => page.locator(`[data-message-id="${message.id}"]`).first();
		await expect(row(mine)).toBeVisible({timeout: 15_000});
		return {
			alice,
			bobId,
			channelId: channel.id,
			mine,
			persona,
			personaName: row(asPersona).getByText(persona.name, {exact: true}).first(),
			accountBadge: row(asPersona)
				.locator('[data-flx="channel.message-username.context-menu-underline.key-down"]')
				.last(),
			accountName: row(asAccount).getByText(`Bob ${stamp}`, {exact: true}).first(),
			row,
		};
	}

	async function send(page: Page) {
		await composer(page).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
	}

	const latest = async (client: FluxerApiClient, channelId: string) => (await client.getMessages(channelId, 1))[0];

	test('shift-clicking a name mentions the persona the message is from', async ({page}) => {
		const {alice, bobId, channelId, persona, personaName} = await setUp(page);

		await personaName.click({modifiers: ['Shift']});
		await expect(composer(page).getByText(`@${persona.name}`)).toBeVisible();
		await send(page);

		await expect.poll(async () => (await latest(alice, channelId)).content).toContain(`<@${bobId}:${persona.id}>`);
	});

	test('right-click Mention does too', async ({page}) => {
		const {alice, bobId, channelId, persona, personaName} = await setUp(page);

		await personaName.click({button: 'right'});
		await page
			.getByText(/^Mention$/)
			.first()
			.click();
		await expect(composer(page).getByText(`@${persona.name}`)).toBeVisible();
		await send(page);

		await expect.poll(async () => (await latest(alice, channelId)).content).toContain(`<@${bobId}:${persona.id}>`);
	});

	test('a name with no persona, and the account badge on a persona’s message, mention the account', async ({page}) => {
		const {accountBadge, accountName, alice, bobId, channelId} = await setUp(page);

		await accountName.click({modifiers: ['Shift']});
		await send(page);
		await expect.poll(async () => (await latest(alice, channelId)).content).toContain(`<@${bobId}>`);

		await accountBadge.click({modifiers: ['Shift']});
		await send(page);
		await expect
			.poll(async () => (await alice.getMessages(channelId, 2)).every((m) => m.content.includes(`<@${bobId}>`)))
			.toBe(true);
	});

	test('in the composer it goes to the caret, not the end of the text', async ({page}) => {
		const {alice, bobId, channelId, persona, personaName} = await setUp(page);
		await composer(page).click();
		await page.keyboard.type('hello there');
		await page.keyboard.press('Home');
		for (let i = 0; i < 'hello '.length; i++) {
			await page.keyboard.press('ArrowRight');
		}

		await personaName.click({modifiers: ['Shift']});

		await expect(composer(page).getByText(`@${persona.name}`)).toBeVisible();
		await expect(composer(page)).toBeFocused();
		await page.keyboard.press('Enter');

		await expect
			.poll(async () => (await latest(alice, channelId)).content)
			.toBe(`hello <@${bobId}:${persona.id}>there`);
	});

	async function openEdit(row: Locator) {
		await row.hover();
		await row.getByRole('button', {name: /^Edit/i}).first().click();
		const box = row.locator('[contenteditable="true"]').first();
		await expect(box).toBeFocused({timeout: 5_000});
		return box;
	}

	test('during an edit it goes to the edit’s caret, and the edit keeps focus', async ({page}) => {
		const {alice, bobId, channelId, mine, persona, personaName, row} = await setUp(page);
		const box = await openEdit(row(mine));
		await page.keyboard.press('Home');
		for (let i = 0; i < 'alpha '.length; i++) {
			await page.keyboard.press('ArrowRight');
		}

		await personaName.click({modifiers: ['Shift']});

		await expect(box.getByText(`@${persona.name}`)).toBeVisible();
		await expect(composer(page)).toHaveText('');
		await expect(box).toBeFocused();
		await page.keyboard.press('Enter');

		await expect
			.poll(async () => (await alice.getMessages(channelId, 5)).find((m) => m.id === mine.id)?.content)
			.toContain(`alpha <@${bobId}:${persona.id}>beta`);
	});

	test('with the caret in the composer during an edit, it goes to the composer', async ({page}) => {
		const {mine, persona, personaName, row} = await setUp(page);
		const box = await openEdit(row(mine));

		await composer(page).click();
		await personaName.click({modifiers: ['Shift']});

		await expect(composer(page).getByText(`@${persona.name}`)).toBeVisible();
		await expect(box.getByText(`@${persona.name}`)).toHaveCount(0);
	});
});
