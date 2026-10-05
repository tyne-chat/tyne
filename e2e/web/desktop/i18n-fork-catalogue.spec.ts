import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openUserSettings} from '../support/auth.js';

// Fork-only strings live in their own Lingui catalogue (fluxer_app/src/features/i18n/fork_locales)
// that is layered over the upstream one at load time. These checks fail if either catalogue stops
// loading for a locale, or if a fork string falls back to English.

interface LocaleExpectation {
	/** Name shown in the language selector. */
	languageName: string;
	/** Upstream catalogue: settings sidebar label and section title of the language tab. */
	languageTabLabel: string;
	interfaceLanguageTitle: string;
	/** Fork catalogue: settings sidebar label and buttons of the personas tab. */
	personasTabLabel: string;
	addPersona: string;
	importFromPluralKit: string;
}

const ENGLISH: LocaleExpectation = {
	languageName: 'English',
	languageTabLabel: 'Language',
	interfaceLanguageTitle: 'Interface language',
	personasTabLabel: 'Personas',
	addPersona: 'Add Persona',
	importFromPluralKit: 'Import from PluralKit',
};

const GERMAN: LocaleExpectation = {
	languageName: 'Deutsch',
	languageTabLabel: 'Sprache',
	interfaceLanguageTitle: 'Sprache der Benutzeroberfläche',
	personasTabLabel: 'Personas',
	addPersona: 'Persona hinzufügen',
	importFromPluralKit: 'Aus PluralKit importieren',
};

const JAPANESE: LocaleExpectation = {
	languageName: '日本語',
	languageTabLabel: '言語',
	interfaceLanguageTitle: 'インターフェース言語',
	personasTabLabel: 'ペルソナ',
	addPersona: 'ペルソナを追加',
	importFromPluralKit: 'PluralKit からインポート',
};

async function openSettingsTab(page: Page, label: string): Promise<void> {
	// Same language-independent lookup as openPersonasSettings: the sidebar entry whose whole text is the label.
	const tab = page
		.locator('[data-flx*="sidebar-item"], [data-flx*="settings-item"], [data-flx*="tab-select"], button')
		.filter({hasText: new RegExp(`^${label}$`)})
		.first();
	await expect(tab).toBeVisible({timeout: 10_000});
	await tab.click();
}

async function switchLanguage(page: Page, current: LocaleExpectation, next: LocaleExpectation): Promise<void> {
	await openSettingsTab(page, current.languageTabLabel);
	const selector = page.locator('[data-flx="user.language-tab.language-controls"]').getByRole('combobox').first();
	await expect(selector).toBeVisible({timeout: 10_000});
	await selector.click();
	const option = page
		.locator('[data-flx="user.language-selector.render-language-content.language-option"]')
		.filter({hasText: next.languageName})
		.last();
	await expect(option).toBeVisible({timeout: 10_000});
	await option.click();
}

async function expectTranslatedUi(page: Page, locale: LocaleExpectation): Promise<void> {
	// Upstream catalogue: the language tab we are on re-renders in the new language.
	await expect(page.getByText(locale.interfaceLanguageTitle, {exact: true}).first()).toBeVisible({
		timeout: 15_000,
	});
	// Fork catalogue: the personas tab and its actions.
	await openSettingsTab(page, locale.personasTabLabel);
	await expect(page.getByRole('button', {name: locale.addPersona, exact: true})).toBeVisible({timeout: 15_000});
	await expect(page.getByRole('button', {name: locale.importFromPluralKit, exact: true})).toBeVisible();
}

test.describe('Fork translation catalogue', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('switching the interface language translates fork and upstream strings', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `e2e_i18n_${timestamp}@test.local`;
		const password = 'TestPassword123!';

		await client.register({
			username: `i18n_${timestamp}`,
			email,
			password,
			global_name: 'I18n Tester',
		});

		await loginAs(page, email, password);
		await openUserSettings(page);

		await openSettingsTab(page, ENGLISH.languageTabLabel);
		await expectTranslatedUi(page, ENGLISH);

		await switchLanguage(page, ENGLISH, GERMAN);
		await expectTranslatedUi(page, GERMAN);
		// The English source text must be gone, not merely joined by a translation.
		await expect(page.getByRole('button', {name: ENGLISH.addPersona, exact: true})).toHaveCount(0);

		await switchLanguage(page, GERMAN, JAPANESE);
		await expectTranslatedUi(page, JAPANESE);
		await expect(page.getByRole('button', {name: GERMAN.addPersona, exact: true})).toHaveCount(0);
	});
});
