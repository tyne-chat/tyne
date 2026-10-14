import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openPersonasSettings} from '../support/auth.js';
import {readZip} from '../support/zip.js';

// A 1x1 PNG, used as a persona avatar and as the tag icon.
const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const FIXTURE = resolve(process.cwd(), 'fixtures/pluralkit-roundtrip.json');

async function importThroughDialog(page: Page, filePath: string, summary?: RegExp): Promise<void> {
	await page.getByRole('button', {name: /Import from PluralKit/i}).click();
	await page.locator('input[type="file"]').setInputFiles(filePath);
	await expect(page.getByText(/Total Members/i)).toBeVisible({timeout: 10_000});
	if (summary) await expect(page.getByText(summary)).toBeVisible();
	await page.getByRole('button', {name: /^Start Import$/i}).click();
	await expect(page.getByRole('heading', {name: /Import Complete/i})).toBeVisible({timeout: 30_000});
	await page.getByRole('button', {name: /^Done$/i}).click();
}

async function exportThroughButton(page: Page, name: string): Promise<{path: string; files: Map<string, Buffer>}> {
	const downloaded = page.waitForEvent('download');
	await page.getByRole('button', {name: /^Export$/}).click();
	const download = await downloaded;
	expect(download.suggestedFilename()).toMatch(/^Tyne personas \d{4}-\d{2}-\d{2}\.zip$/);
	const path = test.info().outputPath(name);
	await download.saveAs(path);
	return {path, files: readZip(await readFile(path))};
}

function json(files: Map<string, Buffer>, name: string): any {
	const file = files.get(name);
	if (!file) throw new Error(`${name} is not in the zip`);
	return JSON.parse(file.toString('utf8'));
}

// The only image links in this test point at an account's own copy on this instance, which differ
// between accounts; the rest of the file must not.
function withoutInstanceLinks(file: any): any {
	return {
		...file,
		members: file.members.map((member: any) => ({
			...member,
			avatar_url: member.avatar_url === null ? null : 'instance',
		})),
	};
}

test.describe('Persona export round trip', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('a PluralKit file comes back unchanged, and a second account gets the same personas from the zip', async ({
		page,
		browser,
	}) => {
		const stamp = Date.now().toString().slice(-6);
		const password = 'TestPassword123!';

		// Account A imports the PluralKit file through the dialog.
		const alice = new FluxerApiClient(baseURL);
		const aliceEmail = `export_a_${stamp}@test.local`;
		await alice.register({username: `exp_a_${stamp}`, email: aliceEmail, password, global_name: 'Exporter A'});
		await loginAs(page, aliceEmail, password);
		await openPersonasSettings(page);
		await importThroughDialog(page, FIXTURE, /1 public, 1 unlisted, 1 private/);

		// An avatar and a tag icon set in Tyne, which only the zip can carry back.
		const uploaded = (await alice.uploadPersonaAvatar(PNG)) as unknown as {avatar_hash: string};
		const personas = await alice.getPersonas();
		const firstWren = personas.find((persona: any) => persona.external_uuid === 'rtaaa')!;
		await alice.updatePersona(firstWren.id, {avatar_hash: uploaded.avatar_hash} as any);
		await alice.updatePersonaSettings({display_tag_icon: uploaded.avatar_hash} as any);

		const first = await exportThroughButton(page, 'export-a.zip');
		const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));

		// The PluralKit file is the one imported, apart from the avatar now set in Tyne. That one
		// links to Tyne's copy over https, or is left out where the media server is plain http.
		const exported = json(first.files, 'pluralkit.json');
		const avatarLink = exported.members[0].avatar_url;
		expect(avatarLink === null || (typeof avatarLink === 'string' && avatarLink.startsWith('https://'))).toBe(true);
		expect({
			...exported,
			members: exported.members.map((m: any, i: number) => (i === 0 ? {...m, avatar_url: null} : m)),
		}).toEqual(fixture);

		expect([...first.files.keys()].sort()).toEqual([
			'README.txt',
			'Tag icon.png',
			'avatars/Wren.png',
			'pluralkit.json',
			'tyne.json',
		]);
		expect(json(first.files, 'tyne.json')).toEqual({
			format: 'tyne-personas',
			version: 1,
			pluralkit_file: 'pluralkit.json',
			tag_icon: 'Tag icon.png',
			members: {rtaaa: {avatar: 'avatars/Wren.png'}, rtbbb: {}, rtccc: {}},
		});
		expect(first.files.get('README.txt')!.toString('utf8')).toContain('pk;import');

		// Account B imports the zip and exports again.
		const bobContext = await browser.newContext();
		const bobPage = await bobContext.newPage();
		try {
			const bob = new FluxerApiClient(baseURL);
			const bobEmail = `export_b_${stamp}@test.local`;
			await bob.register({username: `exp_b_${stamp}`, email: bobEmail, password, global_name: 'Exporter B'});
			await loginAs(bobPage, bobEmail, password);
			await openPersonasSettings(bobPage);
			await importThroughDialog(bobPage, first.path);

			const second = await exportThroughButton(bobPage, 'export-b.zip');
			expect(withoutInstanceLinks(json(second.files, 'pluralkit.json'))).toEqual(withoutInstanceLinks(exported));
			expect(second.files.get('tyne.json')!.toString('utf8')).toBe(first.files.get('tyne.json')!.toString('utf8'));
			expect([...second.files.keys()].sort()).toEqual([...first.files.keys()].sort());

			const settings = (await bob.getPersonaSettings()) as unknown as {
				display_tag_text?: string | null;
				display_tag_icon?: string | null;
			};
			expect(settings.display_tag_text).toBe('⚞Round Trip⚟');
			expect(settings.display_tag_icon).toBeTruthy();
		} finally {
			await bobContext.close();
		}
	});
});
