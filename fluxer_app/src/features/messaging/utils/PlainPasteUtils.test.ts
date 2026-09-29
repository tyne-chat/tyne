// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {clearShiftPaste, isShiftPasteActive, markShiftPasteActive} from './PlainPasteUtils';

describe('PlainPasteUtils', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		clearShiftPaste();
	});

	afterEach(() => {
		vi.useRealTimers();
		clearShiftPaste();
	});

	it('initially reports shift paste as inactive', () => {
		expect(isShiftPasteActive()).toBe(false);
	});

	it('activates shift paste when marked and auto-clears after 500ms', () => {
		markShiftPasteActive();
		expect(isShiftPasteActive()).toBe(true);

		vi.advanceTimersByTime(250);
		expect(isShiftPasteActive()).toBe(true);

		vi.advanceTimersByTime(251);
		expect(isShiftPasteActive()).toBe(false);
	});

	it('clears shift paste immediately when clearShiftPaste is called', () => {
		markShiftPasteActive();
		expect(isShiftPasteActive()).toBe(true);

		clearShiftPaste();
		expect(isShiftPasteActive()).toBe(false);
	});
});
