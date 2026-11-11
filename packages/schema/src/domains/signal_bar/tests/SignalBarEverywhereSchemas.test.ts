// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	MAX_USER_SIGNAL_CHATS,
	SignalBarConfigSchema,
	SignalBarUpdateRequestSchema,
	UserSignalsSnapshotSchema,
	UserSignalsUpdateRequestSchema,
} from '../SignalBarSchemas';

describe('signals everywhere schemas', () => {
	it('reads a stored bar without the everywhere flag as not settable everywhere', () => {
		const parsed = SignalBarConfigSchema.parse({
			version: 3,
			signals: [{id: 'a1', emoji_id: null, emoji_name: '💤', animated: false, label: null}],
		});
		expect(parsed.signals[0]?.everywhere).toBe(false);
	});

	it('lets a bar edit leave the flag out, or set it', () => {
		expect(SignalBarUpdateRequestSchema.parse({signals: [{emoji_name: '💤'}]}).signals[0]?.everywhere).toBeUndefined();
		expect(
			SignalBarUpdateRequestSchema.parse({signals: [{emoji_name: '💤', everywhere: true}]}).signals[0]?.everywhere,
		).toBe(true);
	});

	it('takes a signal id or null for everything off, with an optional open chat and persona', () => {
		expect(UserSignalsUpdateRequestSchema.safeParse({signal_id: null}).success).toBe(true);
		expect(
			UserSignalsUpdateRequestSchema.safeParse({signal_id: 'a1b2c3', channel_id: '123', persona_id: '456'}).success,
		).toBe(true);
		expect(UserSignalsUpdateRequestSchema.safeParse({}).success).toBe(false);
		expect(UserSignalsUpdateRequestSchema.safeParse({signal_id: null, channel_id: 'not a snowflake'}).success).toBe(
			false,
		);
	});

	it('keeps at most 200 chats in a restore snapshot', () => {
		const snapshot = (count: number) => ({
			created_at: 1,
			action: {kind: 'off', signal_id: null},
			chats: Array.from({length: count}, (_, i) => ({channel_id: String(1000 + i), signals: []})),
		});
		expect(MAX_USER_SIGNAL_CHATS).toBe(200);
		expect(UserSignalsSnapshotSchema.safeParse(snapshot(200)).success).toBe(true);
		expect(UserSignalsSnapshotSchema.safeParse(snapshot(201)).success).toBe(false);
	});
});
