import {resolve} from 'node:path';
import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openPersonasSettings} from '../support/auth.js';

test.describe('PluralKit Import Review', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('importing into an account with personas reviews first, links the same persona and deletes nothing', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `pk_rev_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `pk_rev_${timestamp}`;

		await client.register({
			username,
			email,
			password,
			global_name: 'PK ReviewTester',
		});

		// A persona the file does not mention, which the import must leave alone
		const preExistingName = `PreExisting-${timestamp}`;
		const preExisting = await client.createPersona({
			name: preExistingName,
			pronouns: 'it/its',
			persona_tags: [{prefix: 'pre:'}],
		});
		// A persona made by hand with the same name and tag as the file's Alpha: probably the same persona
		const handMadeAlpha = await client.createPersona({
			name: 'Alpha',
			pronouns: 'she/her',
			persona_tags: [{prefix: 'alpha:'}],
		});

		await loginAs(page, email, password);
		await openPersonasSettings(page);

		// Verify pre-existing persona is visible
		await expect(page.getByText(preExistingName)).toBeVisible({timeout: 15_000});

		// 1. Click "Import"
		const importBtn = page.getByRole('button', {name: 'Import', exact: true});
		await expect(importBtn).toBeVisible({timeout: 10_000});
		await importBtn.click();

		// 2. Upload pluralkit-export.json fixture
		const dialog = page.locator('[data-flx="persona.plural-kit-import-modal.modal-root"]');
		const fixturePath = resolve(process.cwd(), 'fixtures/pluralkit-export.json');
		await dialog.locator('input[type="file"]').setInputFiles(fixturePath);

		// Verify file summary loaded
		await expect(dialog.getByText(/Total Members/i)).toBeVisible({timeout: 10_000});
		await dialog.getByRole('button', {name: 'Import', exact: true}).click();

		// 3. The review opens before anything changes: Alpha is probably the same persona, and the
		// file's system tag differs from the account's display tag
		await expect(dialog.getByRole('heading', {name: 'Review before importing'})).toBeVisible({timeout: 15_000});
		await expect(dialog.getByRole('heading', {name: 'Probably the same persona'})).toBeVisible();
		await expect(dialog.getByRole('heading', {name: 'Display tag'})).toBeVisible();
		await expect(dialog.getByRole('heading', {name: 'New in your file'})).toBeVisible();

		// 4. Import with the choices already picked
		await dialog.getByRole('button', {name: 'Import', exact: true}).click();
		await expect(dialog.getByRole('heading', {name: 'Import finished'})).toBeVisible({timeout: 30_000});
		await expect(dialog.getByText('Here is what changed')).toBeVisible();

		const doneBtn = dialog.getByRole('button', {name: /^Done$/i});
		await expect(doneBtn).toBeVisible();
		await doneBtn.click();

		// 5. The pre-existing persona is still there, Alpha once, and Beta added
		const cardName = (name: string) => page.locator('[class*="cardName"]').filter({hasText: name});
		await expect(cardName('Beta').first()).toBeVisible({timeout: 10_000});
		await expect(cardName(preExistingName)).toHaveCount(1);
		await expect(cardName('Alpha')).toHaveCount(1);

		// 6. The hand-made Alpha was linked to the file's member and kept as it was
		const personas = await client.getPersonas();
		expect(personas).toHaveLength(3);
		expect(personas.find((persona) => persona.id === preExisting.id)?.name).toBe(preExistingName);
		const alpha = personas.find((persona) => persona.id === handMadeAlpha.id);
		expect(alpha?.external_uuid).toBe('pk_mem_alpha');
		expect(alpha?.pronouns).toBe('she/her');
		expect(personas.find((persona) => persona.name === 'Beta')?.external_uuid).toBe('pk_mem_beta');

		// The display tag was kept, which is the choice the review starts with
		expect((await client.getPersonaSettings()).display_tag_text || null).toBeNull();
	});
});
