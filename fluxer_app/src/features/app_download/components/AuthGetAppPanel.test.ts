// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {shouldShowAuthGetAppPanel} from '@app/features/app_download/components/AuthGetAppPanel';
import {describe, expect, it} from 'vitest';

describe('shouldShowAuthGetAppPanel', () => {
	it('shows the panel on the login, register and invite pages', () => {
		expect(shouldShowAuthGetAppPanel('/login')).toBe(true);
		expect(shouldShowAuthGetAppPanel('/register')).toBe(true);
		expect(shouldShowAuthGetAppPanel('/invite/abc123')).toBe(true);
		expect(shouldShowAuthGetAppPanel('/invite/abc123/login')).toBe(true);
	});

	it('leaves the other sign-in pages alone', () => {
		expect(shouldShowAuthGetAppPanel('/forgot')).toBe(false);
		expect(shouldShowAuthGetAppPanel('/reset')).toBe(false);
		expect(shouldShowAuthGetAppPanel('/gift/abc123')).toBe(false);
		expect(shouldShowAuthGetAppPanel('/report')).toBe(false);
		expect(shouldShowAuthGetAppPanel('/invite')).toBe(false);
	});
});
