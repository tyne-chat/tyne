import {resolve} from 'node:path';
import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openPersonasSettings} from '../support/auth.js';

test.describe('PluralKit Batch Import Flow', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can upload a PluralKit export and batch import personas', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `pk_user_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `pk_user_${timestamp}`;

		await client.register({
			username,
			email,
			password,
			global_name: 'PK Importer',
		});

		await loginAs(page, email, password);
		await openPersonasSettings(page);

		// Click "Import"
		const importBtn = page.getByRole('button', {name: 'Import', exact: true});
		await expect(importBtn).toBeVisible({timeout: 15_000});
		await importBtn.click();

		// Verify modal appears
		const dialog = page.locator('[data-flx="persona.plural-kit-import-modal.modal-root"]');
		await expect(dialog.getByRole('heading', {name: 'Import personas'})).toBeVisible();

		// Set file input for pluralkit-export.json
		const fixturePath = resolve(process.cwd(), 'fixtures/pluralkit-export.json');
		const fileInput = dialog.locator('input[type="file"]');
		await fileInput.setInputFiles(fixturePath);

		// Verify summary is parsed: should show total 2 members
		await expect(dialog.getByText(/Total Members/i)).toBeVisible({timeout: 10_000});
		await expect(dialog.getByText('2').first()).toBeVisible();

		// A new account has nothing to decide, so Import imports straight away, without a review
		await dialog.getByRole('button', {name: 'Import', exact: true}).click();

		// Wait for completion message or close modal
		await expect(dialog.getByRole('heading', {name: 'Import finished'})).toBeVisible({timeout: 30_000});
		await expect(dialog.getByText('2 personas added')).toBeVisible();

		const doneBtn = dialog.getByRole('button', {name: /^Done$/i});
		await expect(doneBtn).toBeVisible();
		await doneBtn.click();

		// Verify imported personas "Alpha" and "Beta" appear in the list
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Alpha'}).first()).toBeVisible({timeout: 15_000});
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Beta'}).first()).toBeVisible({timeout: 15_000});
	});
});
