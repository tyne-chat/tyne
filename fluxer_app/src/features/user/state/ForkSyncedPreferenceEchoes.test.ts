// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: telling a stale echo of this window's saves from a newer change made elsewhere
// (tyne-chat/tyne#236).

import {SyncedPreferenceEchoes} from '@app/features/user/state/ForkSyncedPreferenceEchoes';
import {describe, expect, it} from 'vitest';

const ACKED = ['emojiPins'] as const;

function echoes(): {echoes: SyncedPreferenceEchoes; advance: (ms: number) => void} {
	let now = 1_000_000;
	return {echoes: new SyncedPreferenceEchoes(() => now), advance: (ms) => (now += ms)};
}

/** Whether a merge of `blob` from the server would keep upstream's acknowledged fields. */
function keeps(e: SyncedPreferenceEchoes, blob: string): boolean {
	e.noteFromServer(blob);
	return e.ackedFieldsToKeep(ACKED).length > 0;
}

describe('SyncedPreferenceEchoes', () => {
	it("keeps upstream's rule for merges of anything but a blob from the server", () => {
		const {echoes: e} = echoes();
		e.recordSave('S0', 'S1');
		expect(e.ackedFieldsToKeep(ACKED)).toEqual(ACKED);
	});

	it('takes a blob from the server when this window has saved nothing', () => {
		const {echoes: e} = echoes();
		expect(keeps(e, 'S7')).toBe(false);
	});

	it('holds the saved fields against a late echo of the blob a save replaced', () => {
		const {echoes: e} = echoes();
		e.recordSave('S0', 'S1');
		expect(keeps(e, 'S0')).toBe(true);
	});

	it('takes a change back to the replaced blob once the echo of the save has come', () => {
		// Pin in this window, then unpin in another: the blob is the one before the pin again.
		const {echoes: e} = echoes();
		e.recordSave('S0', 'S1');
		expect(keeps(e, 'S1')).toBe(false);
		expect(keeps(e, 'S0')).toBe(false);
	});

	it('does not keep a save whose echo came before its response', () => {
		const {echoes: e} = echoes();
		expect(keeps(e, 'S1')).toBe(false);
		e.recordSave('S0', 'S1');
		expect(keeps(e, 'S0')).toBe(false);
	});

	it("holds against an older save's echo while a later save's is still to come", () => {
		const {echoes: e} = echoes();
		e.recordSave('S0', 'S1');
		e.recordSave('S1', 'S2');
		expect(keeps(e, 'S1')).toBe(true);
		expect(keeps(e, 'S2')).toBe(false);
		expect(keeps(e, 'S1')).toBe(false);
	});

	it('takes a newer change made elsewhere, which ends the saves before it', () => {
		const {echoes: e} = echoes();
		e.recordSave('S0', 'S1');
		expect(keeps(e, 'S9')).toBe(false);
		expect(keeps(e, 'S0')).toBe(false);
	});

	it('forgets saves after the minute upstream holds fields for', () => {
		const {echoes: e, advance} = echoes();
		e.recordSave('S0', 'S1');
		advance(60_001);
		expect(keeps(e, 'S0')).toBe(false);
	});

	it('applies a verdict to the next merge only', () => {
		const {echoes: e} = echoes();
		e.noteFromServer('S9');
		expect(e.ackedFieldsToKeep(ACKED)).toEqual([]);
		expect(e.ackedFieldsToKeep(ACKED)).toEqual(ACKED);
	});
});
