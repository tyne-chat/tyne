// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {runInAction} from 'mobx';
import {afterEach, describe, expect, it, vi} from 'vitest';

describe('MobileLayout device detection', () => {
	const originalUserAgent = navigator.userAgent;

	afterEach(() => {
		Object.defineProperty(navigator, 'userAgent', {
			value: originalUserAgent,
			configurable: true,
			writable: true,
		});
		vi.resetModules();
	});

	it('keeps mobile layout disabled on desktop regardless of narrow window width', async () => {
		Object.defineProperty(navigator, 'userAgent', {
			value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			configurable: true,
			writable: true,
		});
		Object.defineProperty(window, 'innerWidth', {
			value: 400,
			configurable: true,
			writable: true,
		});

		const {Platform} = await import('@app/features/platform/types/Platform');
		const {default: MobileLayout} = await import('./MobileLayout');
		const {default: Window} = await import('@app/features/window/state/Window');

		expect(Platform.isMobileDevice).toBe(false);
		expect(Platform.isTabletDevice).toBe(false);
		expect(MobileLayout.enabled).toBe(false);

		// Trigger window resize event below 640px
		runInAction(() => {
			Window.windowSize = {width: 450, height: 800};
		});
		expect(MobileLayout.enabled).toBe(false);

		// Another resize below 320px
		runInAction(() => {
			Window.windowSize = {width: 320, height: 600};
		});
		expect(MobileLayout.enabled).toBe(false);
	});

	it('enables mobile layout on mobile phone user agents', async () => {
		Object.defineProperty(navigator, 'userAgent', {
			value:
				'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
			configurable: true,
			writable: true,
		});

		const {Platform} = await import('@app/features/platform/types/Platform');
		const {default: MobileLayout} = await import('./MobileLayout');

		expect(Platform.isMobileDevice).toBe(true);
		expect(MobileLayout.enabled).toBe(true);
	});

	it('switches layout on tablets based on viewport width', async () => {
		Object.defineProperty(navigator, 'userAgent', {
			value:
				'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/105.0.5195.100 Mobile/15E148 Safari/604.1',
			configurable: true,
			writable: true,
		});
		Object.defineProperty(window, 'innerWidth', {
			value: 1024,
			configurable: true,
			writable: true,
		});

		const {Platform} = await import('@app/features/platform/types/Platform');
		const {default: MobileLayout} = await import('./MobileLayout');
		const {default: Window} = await import('@app/features/window/state/Window');

		expect(Platform.isTabletDevice).toBe(true);
		expect(MobileLayout.enabled).toBe(false);

		// Rotate tablet to portrait / narrow view
		runInAction(() => {
			Window.windowSize = {width: 600, height: 1024};
		});
		expect(MobileLayout.enabled).toBe(true);

		// Rotate back to landscape
		runInAction(() => {
			Window.windowSize = {width: 1024, height: 768};
		});
		expect(MobileLayout.enabled).toBe(false);
	});
});
