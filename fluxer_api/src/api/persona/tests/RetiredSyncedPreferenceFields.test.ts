// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createUserID} from '@app/api/BrandedTypes';
import {dropRetiredSyncedPreferenceFields} from '@app/api/persona/RetiredSyncedPreferenceFields';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {UserRepository} from '@app/api/user/repositories/UserRepository';
import {fetchUserSettings, updateUserSettings} from '@app/api/user/tests/UserTestUtils';
import {create} from '@bufbuild/protobuf';
import {
	decodeSyncedPreferences,
	encodeSyncedPreferences,
	SyncedPreferencesSchema,
} from '@fluxer/schema/src/domains/user/SyncedPreferencesCodec';
import {beforeEach, describe, expect, test} from 'vitest';

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;

function varint(value: number): Array<number> {
	const out: Array<number> = [];
	let rest = value;
	while (rest >= 0x80) {
		out.push((rest % 0x80) | 0x80);
		rest = Math.floor(rest / 0x80);
	}
	out.push(rest);
	return out;
}

function stringField(number: number, text: string): Uint8Array {
	const payload = Buffer.from(text, 'utf8');
	return Uint8Array.from([...varint(number * 8 + WIRE_LENGTH_DELIMITED), ...varint(payload.length), ...payload]);
}

function boolField(number: number, value: boolean): Uint8Array {
	return Uint8Array.from([...varint(number * 8 + WIRE_VARINT), value ? 1 : 0]);
}

function doubleField(number: number, value: number): Uint8Array {
	const payload = Buffer.alloc(8);
	payload.writeDoubleLE(value);
	return Uint8Array.from([...varint(number * 8 + WIRE_FIXED64), ...payload]);
}

function messageField(number: number, ...fields: Array<Uint8Array>): Uint8Array {
	const payload = Buffer.concat(fields);
	return Uint8Array.from([...varint(number * 8 + WIRE_LENGTH_DELIMITED), ...varint(payload.length), ...payload]);
}

function withFields(encoded: string, ...fields: Array<Uint8Array>): string {
	return Buffer.concat([Buffer.from(encoded, 'base64'), ...fields]).toString('base64');
}

const current = encodeSyncedPreferences(create(SyncedPreferencesSchema, {sanitizeUrls: true}));

// What an account that used personas in September 2026 still carries.
const oldPersonaFields = [
	stringField(121, '1523146531119562752'),
	boolField(122, true),
	stringField(123, 'manual'),
	stringField(124, 'The Example System'),
	stringField(125, ''),
];

describe('dropRetiredSyncedPreferenceFields', () => {
	test('removes the old persona fields and keeps everything else byte for byte', () => {
		expect(dropRetiredSyncedPreferenceFields(withFields(current, ...oldPersonaFields))).toBe(current);
	});

	test('removes them wherever they sit in the blob', () => {
		const leading = Buffer.concat([oldPersonaFields[0], Buffer.from(current, 'base64'), oldPersonaFields[1]]);
		expect(dropRetiredSyncedPreferenceFields(leading.toString('base64'))).toBe(current);
	});

	test('removes the old persona list, which was a nested message', () => {
		const persona = Buffer.concat([stringField(1, '42'), stringField(2, 'Alice')]);
		const list = Uint8Array.from([...varint(120 * 8 + WIRE_LENGTH_DELIMITED), ...varint(persona.length), ...persona]);
		expect(dropRetiredSyncedPreferenceFields(withFields(current, list, list))).toBe(current);
	});

	test('returns the very same string when there is nothing to remove', () => {
		expect(dropRetiredSyncedPreferenceFields(current)).toBe(current);
	});

	test('leaves fields it does not know alone when their numbers were never the fork’s', () => {
		const other = withFields(current, stringField(119, 'next'), stringField(126, 'after'), boolField(2221, true));
		expect(dropRetiredSyncedPreferenceFields(other)).toBe(other);
	});

	test('leaves a retired number alone once the schema defines it', () => {
		const reused = withFields(current, stringField(121, 'now upstream’s'), boolField(122, true));
		const defined = new Set([...SyncedPreferencesSchema.fields.map((field) => field.number), 121]);
		expect(dropRetiredSyncedPreferenceFields(reused, defined)).toBe(
			withFields(current, stringField(121, 'now upstream’s')),
		);
	});

	test('a blob that held nothing else becomes no blob', () => {
		const onlyOld = Buffer.concat(oldPersonaFields).toString('base64');
		expect(dropRetiredSyncedPreferenceFields(onlyOld)).toBeNull();
	});

	test('passes through what it is not given or cannot read', () => {
		expect(dropRetiredSyncedPreferenceFields(null)).toBeNull();
		expect(dropRetiredSyncedPreferenceFields('')).toBe('');
		const truncated = Buffer.concat([Buffer.from(current, 'base64'), stringField(121, 'abcdef').subarray(0, 4)]);
		expect(dropRetiredSyncedPreferenceFields(truncated.toString('base64'))).toBe(truncated.toString('base64'));
	});
});

// What an account that used the fork's mobile settings before 2026-10-16 still carries inside
// `AccessibilitySettings` (field 1): font size and message spacing as doubles at 66 to 68, next to a
// field the fork still defines (2221, show_personas_button).
const ACCESSIBILITY = 1;
const keptAccessibilityField = boolField(2221, true);
const oldMobileDoubles = [doubleField(66, 1.15), doubleField(67, 0), doubleField(68, 4)];

describe('dropRetiredSyncedPreferenceFields: the old mobile doubles in accessibility (tyne-chat/tyne#125)', () => {
	test('removes them and keeps the rest of accessibility and the blob byte for byte', () => {
		const old = withFields(current, messageField(ACCESSIBILITY, keptAccessibilityField, ...oldMobileDoubles));
		expect(dropRetiredSyncedPreferenceFields(old)).toBe(
			withFields(current, messageField(ACCESSIBILITY, keptAccessibilityField)),
		);
	});

	test('keeps a bool at 66, as upstream defines it now', () => {
		const upstreams = withFields(current, messageField(ACCESSIBILITY, boolField(66, true), keptAccessibilityField));
		expect(dropRetiredSyncedPreferenceFields(upstreams)).toBe(upstreams);
	});

	test('keeps a 64-bit value at a number the schema defines as 64-bit', () => {
		const defined = new Set(SyncedPreferencesSchema.fields.map((field) => field.number));
		const blob = withFields(current, messageField(ACCESSIBILITY, doubleField(66, 2)));
		expect(dropRetiredSyncedPreferenceFields(blob, defined, new Set([66]))).toBe(blob);
	});

	test('leaves the same numbers alone outside accessibility', () => {
		const elsewhere = withFields(current, messageField(2, doubleField(66, 1)));
		expect(dropRetiredSyncedPreferenceFields(elsewhere)).toBe(elsewhere);
	});

	test('an accessibility message that held only them stays, empty', () => {
		const onlyOld = withFields(current, messageField(ACCESSIBILITY, ...oldMobileDoubles));
		expect(dropRetiredSyncedPreferenceFields(onlyOld)).toBe(withFields(current, messageField(ACCESSIBILITY)));
	});

	test('removes them together with the old persona fields', () => {
		const both = withFields(current, ...oldPersonaFields, messageField(ACCESSIBILITY, ...oldMobileDoubles));
		expect(dropRetiredSyncedPreferenceFields(both)).toBe(withFields(current, messageField(ACCESSIBILITY)));
	});

	test('the cleaned blob still decodes with the current schema', () => {
		const old = withFields(current, messageField(ACCESSIBILITY, keptAccessibilityField, ...oldMobileDoubles));
		const decoded = decodeSyncedPreferences(dropRetiredSyncedPreferenceFields(old)!);
		expect(decoded.sanitizeUrls).toBe(true);
		expect(decoded.accessibility?.showPersonasButton).toBe(true);
	});
});

describe('saving and reading settings with the old mobile doubles', () => {
	let harness: ApiTestHarness;
	beforeEach(async () => {
		harness = await createApiTestHarness();
	});

	const old = withFields(current, messageField(ACCESSIBILITY, keptAccessibilityField, ...oldMobileDoubles));
	const cleaned = withFields(current, messageField(ACCESSIBILITY, keptAccessibilityField));

	test('a save removes them before the blob is read', async () => {
		const account = await createTestAccount(harness);
		const {json} = await updateUserSettings(harness, account.token, {synced_preferences: old});
		// A save stores the blob re-encoded in the schema's order.
		expect(json.synced_preferences).toBe(encodeSyncedPreferences(decodeSyncedPreferences(cleaned)));
	});

	test('a blob stored before the fix is served without them', async () => {
		const account = await createTestAccount(harness);
		const users = new UserRepository();
		const settings = await users.findSettings(createUserID(BigInt(account.userId)));
		await users.upsertSettings({...settings!.toRow(), synced_preferences: old});
		const {json} = await fetchUserSettings(harness, account.token);
		expect(json.synced_preferences).toBe(cleaned);
	});
});

describe('saving settings with the old persona fields', () => {
	let harness: ApiTestHarness;
	beforeEach(async () => {
		harness = await createApiTestHarness();
	});

	test('stores and returns the preferences without them', async () => {
		const account = await createTestAccount(harness);
		const {json} = await updateUserSettings(harness, account.token, {
			synced_preferences: withFields(current, ...oldPersonaFields),
		});
		expect(json.synced_preferences).toBe(current);
		expect(decodeSyncedPreferences(json.synced_preferences).sanitizeUrls).toBe(true);
	});

	test('stores a blob that never had them exactly as before', async () => {
		const account = await createTestAccount(harness);
		const {json} = await updateUserSettings(harness, account.token, {synced_preferences: current});
		expect(json.synced_preferences).toBe(current);
	});
});
