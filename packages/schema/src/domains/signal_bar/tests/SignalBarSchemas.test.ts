// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	EMPTY_GUILD_SIGNAL_BAR_SETTINGS,
	MAX_SIGNAL_BAR_SIGNALS,
	resolveSignalBarEnabled,
	SignalBarConfigSchema,
	SignalBarUpdateRequestSchema,
} from '../SignalBarSchemas';

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

	describe('resolveSignalBarEnabled', () => {
		const settings = {default: true, categories: {games: false}, channels: {quiet: false, loud: true}};

		it('takes a setting on the channel over its category and the community default', () => {
			expect(resolveSignalBarEnabled(settings, 'loud', 'games')).toBe(true);
			expect(resolveSignalBarEnabled(settings, 'quiet', null)).toBe(false);
		});

		it('takes the category over the community default when the channel has no setting', () => {
			expect(resolveSignalBarEnabled(settings, 'chat', 'games')).toBe(false);
		});

		it('falls back to the community default', () => {
			expect(resolveSignalBarEnabled(settings, 'chat', 'other')).toBe(true);
			expect(resolveSignalBarEnabled(settings, 'chat', null)).toBe(true);
			expect(resolveSignalBarEnabled(EMPTY_GUILD_SIGNAL_BAR_SETTINGS, 'chat', 'games')).toBe(false);
		});
	});
});
