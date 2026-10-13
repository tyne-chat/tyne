// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/threads/state/ChannelThreads', () => ({default: {getThread: () => null}}));

const {originalPosterTagApplies} = await import('@app/features/persona/utils/OriginalPosterPersona');

describe('originalPosterTagApplies', () => {
	it('tags the account on a post it started as itself', () => {
		expect(originalPosterTagApplies(null, null)).toBe(true);
		expect(originalPosterTagApplies(undefined, undefined)).toBe(true);
	});

	it('does not tag the account on a post it started as a persona', () => {
		expect(originalPosterTagApplies(null, 'fox')).toBe(false);
		expect(originalPosterTagApplies(undefined, 'fox')).toBe(false);
	});

	it('tags the persona that started the post', () => {
		expect(originalPosterTagApplies('fox', 'fox')).toBe(true);
	});

	it('does not tag another persona of the same account', () => {
		expect(originalPosterTagApplies('owl', 'fox')).toBe(false);
	});

	it('does not tag a persona when the post was started as the account', () => {
		expect(originalPosterTagApplies('fox', null)).toBe(false);
		expect(originalPosterTagApplies('fox', undefined)).toBe(false);
	});
});
