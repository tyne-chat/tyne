// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {dropRetiredSyncedPreferenceFields} from '@app/api/persona/RetiredSyncedPreferenceFields';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {updateUserSettings} from '@app/api/user/tests/UserTestUtils';
import {create} from '@bufbuild/protobuf';
import {
	decodeSyncedPreferences,
	encodeSyncedPreferences,
	SyncedPreferencesSchema,
} from '@fluxer/schema/src/domains/user/SyncedPreferencesCodec';
import {beforeEach, describe, expect, test} from 'vitest';

const WIRE_VARINT = 0;
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
