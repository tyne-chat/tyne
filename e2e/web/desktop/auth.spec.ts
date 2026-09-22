import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';

test.describe('Authentication Flows', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('login page loads and displays brand elements', async ({page}) => {
		await page.goto('/login');
		await expect(page).toHaveTitle(/Fluxer|Sign In|Log In/i);
		// Verify email and password input fields are visible
		const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]');
		const passwordInput = page.locator('input[type="password"]');
		await expect(emailInput).toBeVisible({timeout: 15_000});
		await expect(passwordInput).toBeVisible({timeout: 15_000});
	});

	test('user can log in with valid credentials and reach app shell', async ({page}) => {
		// Generate a dedicated user via API client for clean login test
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `e2e_login_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `login_${timestamp}`;

		await client.register({
			username,
			email,
			password,
			global_name: 'Login Tester',
		});

		await page.goto('/login');

		const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
		const passwordInput = page.locator('input[type="password"]').first();
		const submitButton = page.locator('button[type="submit"]').first();

		await emailInput.fill(email);
		await passwordInput.fill(password);
		await submitButton.click();

		// Verify redirect to authenticated app shell (/channels/@me or main navigation)
		await expect(page).toHaveURL(/.*channels.*/, {timeout: 20_000});
	});
});
