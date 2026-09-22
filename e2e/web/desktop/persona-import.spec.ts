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

		// Click "Import from PluralKit"
		const importBtn = page.getByRole('button', {name: /Import from PluralKit/i});
		await expect(importBtn).toBeVisible({timeout: 15_000});
		await importBtn.click();

		// Verify modal appears
		await expect(page.getByText(/Import from PluralKit/i).first()).toBeVisible();

		// Set file input for pluralkit-export.json
		const fixturePath = resolve(process.cwd(), 'fixtures/pluralkit-export.json');
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(fixturePath);

		// Verify summary is parsed: should show total 2 members
		await expect(page.getByText(/Total Members/i)).toBeVisible({timeout: 10_000});
		await expect(page.getByText('2').first()).toBeVisible();

		// Click start import button
		const startImportBtn = page.getByRole('button', {name: /^Start Import$/i});
		await expect(startImportBtn).toBeVisible();
		await startImportBtn.click();

		// Wait for completion message or close modal
		await expect(page.getByRole('heading', {name: /Import Complete/i})).toBeVisible({timeout: 30_000});

		const doneBtn = page.getByRole('button', {name: /^Done$/i});
		await expect(doneBtn).toBeVisible();
		await doneBtn.click();

		// Verify imported personas "Alpha" and "Beta" appear in the list
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Alpha'}).first()).toBeVisible({timeout: 15_000});
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Beta'}).first()).toBeVisible({timeout: 15_000});
	});
});
