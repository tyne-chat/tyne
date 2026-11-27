// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {getAdaptiveVisiblePageCount} from '@app/features/channel/components/channel_search_results/ChannelSearchResultsShared';
import {clearRemScaleCache} from '@app/features/theme/layout/RemFromPx';
import {getAppRemScale} from '@app/features/ui/utils/AppZoomUtils';
import {afterEach, describe, expect, it} from 'vitest';

describe('getAdaptiveVisiblePageCount zoom scaling', () => {
	const originalInnerWidth = window.innerWidth;
	const originalRootFontSize = document.documentElement.style.fontSize;

	afterEach(() => {
		Object.defineProperty(window, 'innerWidth', {value: originalInnerWidth, configurable: true, writable: true});
		document.documentElement.style.fontSize = originalRootFontSize;
		clearRemScaleCache();
	});

	it('scales viewport breakpoints by getAppRemScale() under desktop zoom', () => {
		document.documentElement.style.fontSize = '16px';
		clearRemScaleCache();
		Object.defineProperty(window, 'innerWidth', {value: 600, configurable: true, writable: true});
		expect(getAppRemScale()).toBe(1);
		expect(getAdaptiveVisiblePageCount()).toBe(5);

		// At 150% zoom (24px root font size), 600 physical px is 400 logical px (<= 420 breakpoint).
		document.documentElement.style.fontSize = '24px';
		clearRemScaleCache();
		expect(getAppRemScale()).toBe(1.5);
		expect(getAdaptiveVisiblePageCount()).toBe(3);

		// At 150% zoom, 800 physical px is ~533 logical px (<= 640 breakpoint).
		Object.defineProperty(window, 'innerWidth', {value: 800, configurable: true, writable: true});
		expect(getAdaptiveVisiblePageCount()).toBe(5);
	});
});
