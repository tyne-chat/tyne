import {resolve} from 'node:path';
import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openPersonasSettings} from '../support/auth.js';

test.describe('PluralKit Replace Mode & Destructive Confirmation', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can import with replace mode and danger confirmation wipes old personas and imports new ones', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `pk_rep_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `pk_rep_${timestamp}`;

		await client.register({
			username,
			email,
			password,
			global_name: 'PK ReplaceTester',
		});

		// Seed one pre-existing persona that should be destroyed by replace mode
		const preExistingName = `PreExisting-${timestamp}`;
		await client.createPersona({
			name: preExistingName,
			pronouns: 'it/its',
			persona_tags: [{prefix: 'pre:'}],
		});

		await loginAs(page, email, password);
		await openPersonasSettings(page);

		// Verify pre-existing persona is visible
		await expect(page.getByText(preExistingName)).toBeVisible({timeout: 15_000});

		// 1. Click "Import from PluralKit"
		const importBtn = page.getByRole('button', {name: /Import from PluralKit/i});
		await expect(importBtn).toBeVisible({timeout: 10_000});
		await importBtn.click();

		// 2. Upload pluralkit-export.json fixture
		const fixturePath = resolve(process.cwd(), 'fixtures/pluralkit-export.json');
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(fixturePath);

		// Verify file summary loaded
		await expect(page.getByText(/Total Members/i)).toBeVisible({timeout: 10_000});

		// 3. Select "Replace all existing personas" radio option
		const replaceRadio = page.locator('input[type="radio"][value="replace"], input[type="radio"]').nth(1);
		await replaceRadio.click();

		// 4. Click Start Import
		const startImportBtn = page.getByRole('button', {name: /^Start Import$/i});
		await expect(startImportBtn).toBeVisible();
		await startImportBtn.click();

		// 5. Verify ConfirmModal danger dialog appears with "Replace All Personas"
		await expect(page.getByText(/Replace All Personas/i)).toBeVisible({timeout: 5_000});

		const confirmReplaceBtn = page.getByRole('button', {name: /Replace All/i});
		await expect(confirmReplaceBtn).toBeVisible();
		await confirmReplaceBtn.click();

		// 6. Wait for import completion
		await expect(page.getByRole('heading', {name: /Import Complete/i})).toBeVisible({timeout: 30_000});

		const doneBtn = page.getByRole('button', {name: /^Done$/i});
		await expect(doneBtn).toBeVisible();
		await doneBtn.click();

		// 7. Verify pre-existing persona is GONE
		await expect(page.locator('[class*="cardName"]').filter({hasText: preExistingName})).toBeHidden({timeout: 10_000});

		// 8. Verify only imported personas "Alpha" and "Beta" exist
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Alpha'}).first()).toBeVisible({timeout: 10_000});
		await expect(page.locator('[class*="cardName"]').filter({hasText: 'Beta'}).first()).toBeVisible({timeout: 10_000});
	});
});
