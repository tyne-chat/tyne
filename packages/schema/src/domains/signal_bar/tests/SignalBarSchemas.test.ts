// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {MAX_SIGNAL_BAR_SIGNALS, SignalBarConfigSchema, SignalBarUpdateRequestSchema} from '../SignalBarSchemas';

describe('SignalBarSchemas', () => {
	it('defines MAX_SIGNAL_BAR_SIGNALS as 50', () => {
		expect(MAX_SIGNAL_BAR_SIGNALS).toBe(50);
	});

	it('validates SignalBarUpdateRequestSchema allows up to 50 signals and rejects 51', () => {
		const fiftySignals = Array.from({length: 50}, (_, i) => ({
			emoji_name: 'test',
			label: `Signal ${i + 1}`,
		}));
		expect(SignalBarUpdateRequestSchema.safeParse({signals: fiftySignals}).success).toBe(true);

		const fiftyOneSignals = Array.from({length: 51}, (_, i) => ({
			emoji_name: 'test',
			label: `Signal ${i + 1}`,
		}));
		expect(SignalBarUpdateRequestSchema.safeParse({signals: fiftyOneSignals}).success).toBe(false);
	});

	it('validates SignalBarConfigSchema allows up to 50 signals and rejects 51', () => {
		const fiftySignals = Array.from({length: 50}, (_, i) => ({
			id: `sig${i}`,
			emoji_id: null,
			emoji_name: 'test',
			animated: false,
			label: null,
		}));
		expect(SignalBarConfigSchema.safeParse({version: 1, signals: fiftySignals}).success).toBe(true);

		const fiftyOneSignals = Array.from({length: 51}, (_, i) => ({
			id: `sig${i}`,
			emoji_id: null,
			emoji_name: 'test',
			animated: false,
			label: null,
		}));
		expect(SignalBarConfigSchema.safeParse({version: 1, signals: fiftyOneSignals}).success).toBe(false);
	});
});
