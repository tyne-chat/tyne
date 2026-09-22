import {expect, type Page} from '@playwright/test';

export async function loginAs(page: Page, email: string, password = 'TestPassword123!'): Promise<void> {
	await page.goto('/login');

	const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
	const passwordInput = page.locator('input[type="password"]').first();
	const submitButton = page.locator('button[type="submit"]').first();

	await expect(emailInput).toBeVisible({timeout: 15_000});
	await emailInput.fill(email);
	await passwordInput.fill(password);
	await submitButton.click();

	// Wait until navigated to the authenticated dashboard
	await expect(page).toHaveURL(/.*channels.*/, {timeout: 20_000});
}

export async function openUserSettings(page: Page): Promise<void> {
	// Try desktop settings button first (in UserArea bottom-left)
	const desktopSettingsBtn = page
		.locator('button[data-flx*="control-button.settings-click"], button[aria-label*="User Settings" i]')
		.first();
	if (await desktopSettingsBtn.isVisible({timeout: 2_000}).catch(() => false)) {
		await desktopSettingsBtn.click();
		return;
	}

	// If on mobile inside a channel view, tap back button first to reveal mobile nav
	const backBtn = page.locator('button[aria-label*="Back" i], [data-flx*="back-button"]').first();
	if (await backBtn.isVisible({timeout: 1_000}).catch(() => false)) {
		await backBtn.click();
	}

	// Mobile navigation: tap "You" in bottom nav, then tap the settings gear button
	const youBtn = page.locator('[data-flx*="mobile-bottom-nav"] button, button').filter({hasText: /^You$/i}).first();
	if (await youBtn.isVisible({timeout: 3_000}).catch(() => false)) {
		await youBtn.click();
		const mobileSettingsBtn = page
			.locator('[data-flx="app.you-page.settings-button"], button[aria-label*="Settings" i]')
			.first();
		await expect(mobileSettingsBtn).toBeVisible({timeout: 5_000});
		await mobileSettingsBtn.click();
		return;
	}

	// Fallback: click any visible settings button
	const fallbackBtn = page.locator('button[aria-label*="Settings" i]').first();
	await fallbackBtn.click();
}

export async function openPersonasSettings(page: Page): Promise<void> {
	await openUserSettings(page);
	// Find Personas tab in the settings list / sidebar
	const personasTab = page
		.locator('[data-flx*="sidebar-item"], [data-flx*="settings-item"], [data-flx*="tab-select"], button, div')
		.filter({hasText: /^Personas$/i})
		.first();
	await expect(personasTab).toBeVisible({timeout: 10_000});
	await personasTab.click();
}
