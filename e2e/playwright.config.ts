import {defineConfig, devices} from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

export default defineConfig({
	testDir: './web',
	timeout: 60_000,
	expect: {
		timeout: 10_000,
	},
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: [['list'], ['html', {outputFolder: 'playwright-report', open: 'never'}]],
	outputDir: 'test-results',
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'desktop-chromium',
			testIgnore: /.*mobile\/.*/,
			use: {
				...devices['Desktop Chrome'],
				viewport: {width: 1280, height: 720},
			},
		},
		{
			name: 'mobile-chromium',
			use: {
				...devices['Pixel 7'],
			},
		},
	],
});
