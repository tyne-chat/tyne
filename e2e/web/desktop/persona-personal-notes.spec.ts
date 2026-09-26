import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Personal Notes Persona Integration', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can send and manage persona-attributed messages in personal notes self-channel', async ({
		page,
		isMobile,
	}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Register User with a dedicated Persona
		const email = `notes_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `notes_${timestamp}`;
		const client = new FluxerApiClient(baseURL);
		const auth = await client.register({
			username,
			email,
			password,
			global_name: 'Notes User',
		});

		await client.createPersona({
			name: 'Notes-Persona',
			pronouns: 'it/its',
			persona_tags: [{prefix: 'n:'}],
		});

		// 2. Log in and navigate to Personal Notes (@me/userId)
		await loginAs(page, email, password);

		const personalNotesUrl = `/channels/@me/${auth.user.id}`;
		await page.goto(personalNotesUrl);

		// Verify Personal Notes channel is loaded
		await expect(page.getByText(/Personal notes/i).first()).toBeVisible({timeout: 20_000});

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 15_000});

		const submitMessage = async () => {
			if (isMobile) {
				const sendBtn = page
					.locator(
						'[data-flx="channel.textarea.textarea-buttons.textarea-button.submit"], button[aria-label="Send message"]',
					)
					.first();
				if (await sendBtn.isVisible({timeout: 1_000}).catch(() => false)) {
					await sendBtn.click();
					return;
				}
			}
			await composer.press('Enter');
		};

		// 3. Send a note using persona prefix tag "n:"
		const noteText = `Secret note from persona [${timestamp}]`;
		await composer.click();
		await composer.fill(`n: ${noteText}`);
		await submitMessage();

		// Verify message appears in personal notes with Notes-Persona attribution
		await expect(page.getByText(noteText)).toBeVisible({timeout: 15_000});
		await expect(page.locator('[data-flx*="message-username"]').getByText('Notes-Persona')).toBeVisible({
			timeout: 10_000,
		});

		// 4. Send a second note untagged as root account
		const rootNoteText = `Regular root user note [${timestamp}]`;
		await composer.click();
		await composer.fill(rootNoteText);
		await submitMessage();

		await expect(page.getByText(rootNoteText)).toBeVisible({timeout: 15_000});
		await expect(page.locator('[data-flx*="message-username"]').getByText('Notes User')).toBeVisible({timeout: 10_000});

		// 5. Reload page to verify persistence across page reloads
		await page.reload();
		await expect(page.getByText(noteText)).toBeVisible({timeout: 20_000});
		await expect(page.locator('[data-flx*="message-username"]').getByText('Notes-Persona')).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByText(rootNoteText)).toBeVisible({timeout: 10_000});
	});
});
