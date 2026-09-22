import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openPersonasSettings} from '../support/auth.js';

test.describe('Persona Settings & CRUD', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can view, create, edit, and delete personas', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `e2e_crud_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `crud_${timestamp}`;

		// Seed test user with one initial persona
		await client.register({
			username,
			email,
			password,
			global_name: 'Persona CRUD Tester',
		});

		await client.createPersona({
			name: 'Initial-Persona',
			pronouns: 'they/them',
			persona_tags: [{prefix: 'init:'}],
		});

		// 1. Log in via UI
		await loginAs(page, email, password);

		// 2. Navigate to Personas settings tab
		await openPersonasSettings(page);

		// 3. Verify initial persona is visible
		await expect(page.getByText('Initial-Persona')).toBeVisible({timeout: 15_000});

		// 4. Click "Add Persona"
		const addPersonaBtn = page.getByRole('button', {name: /Add Persona/i});
		await expect(addPersonaBtn).toBeVisible();
		await addPersonaBtn.click();

		// 5. Fill out the creation form in the modal
		const nameInput = page
			.locator('[data-flx="persona.persona-edit-modal.input.name"] input, input[placeholder*="Alice" i]')
			.first();
		await expect(nameInput).toBeVisible({timeout: 10_000});
		await nameInput.fill('Gamma-Front');

		// Click Save changes
		const saveBtn = page
			.locator('[data-flx="persona.persona-edit-modal.button.save"], button:has-text("Save changes")')
			.first();
		await saveBtn.click();

		// 6. Verify "Gamma-Front" now appears in the personas list
		const gammaCard = page.locator('[class*="cardName"]').filter({hasText: 'Gamma-Front'}).first();
		await expect(gammaCard).toBeVisible({timeout: 15_000});

		// 7. Edit "Gamma-Front" (click the card)
		await gammaCard.click();

		// Modal opens, modify display name
		const editNameInput = page
			.locator('[data-flx="persona.persona-edit-modal.input.name"] input, input[placeholder*="Alice" i]')
			.first();
		await expect(editNameInput).toBeVisible({timeout: 10_000});
		await editNameInput.fill('Gamma-Renamed');

		// Save changes
		const updateSaveBtn = page
			.locator('[data-flx="persona.persona-edit-modal.button.save"], button:has-text("Save changes")')
			.first();
		await updateSaveBtn.click();

		// Verify renamed persona appears
		const renamedCard = page.locator('[class*="cardName"]').filter({hasText: 'Gamma-Renamed'}).first();
		await expect(renamedCard).toBeVisible({timeout: 15_000});

		// 8. Delete "Gamma-Renamed" (click the card to edit)
		await renamedCard.click();

		const deleteBtn = page.locator('button[aria-label*="Delete persona" i], button:has-text("Delete Persona")').first();
		await expect(deleteBtn).toBeVisible({timeout: 10_000});
		await deleteBtn.click();

		// Confirm dialog
		const confirmDeleteBtn = page.getByRole('button', {name: /^Delete$/i});
		await expect(confirmDeleteBtn).toBeVisible({timeout: 5_000});
		await confirmDeleteBtn.click();

		// Verify "Gamma-Renamed" is gone from the list
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Gamma-Renamed'})).not.toBeVisible({
			timeout: 15_000,
		});
		// But Initial-Persona remains
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Initial-Persona'})).toBeVisible();
	});
});
