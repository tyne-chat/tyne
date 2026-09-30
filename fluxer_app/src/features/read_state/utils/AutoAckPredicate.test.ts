// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest';
import {shouldAutoAck} from './AutoAckPredicate';

describe('shouldAutoAck', () => {
	const baseConditions = {
		channelActive: true,
		windowFocused: true,
		atBottom: true,
		textChatVisible: true,
		manualAck: false,
		blockingModalOpen: false,
	};

	it('returns true when all conditions are satisfied and afk is false', () => {
		expect(shouldAutoAck({...baseConditions, afk: false})).toBe(true);
	});

	it('returns true when afk is omitted or undefined', () => {
		expect(shouldAutoAck(baseConditions)).toBe(true);
	});

	it('returns false when afk is true', () => {
		expect(shouldAutoAck({...baseConditions, afk: true})).toBe(false);
	});

	it('returns false if window is not focused even if not afk', () => {
		expect(shouldAutoAck({...baseConditions, windowFocused: false, afk: false})).toBe(false);
	});

	it('returns false if manualAck is true', () => {
		expect(shouldAutoAck({...baseConditions, manualAck: true, afk: false})).toBe(false);
	});
});
