// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's first persona design (September 2026) kept the active persona and the display
// tag in the account's synced preferences, as fields 120 to 125 of `SyncedPreferences`. Personas
// have lived in their own tables since, and the fork no longer defines those fields, but what was
// written then is still in the stored blobs: a client sends the whole blob back on every save,
// fields it does not know included.
//
// Upstream numbers its own fields in sequence in the same message, so it will give these numbers
// a meaning of its own, and the old bytes would then be read as that. This drops them from a blob
// on its way in. A number the current schema defines is left alone, so the day upstream uses one,
// this stops touching it without anyone having to remember.

import {SyncedPreferencesSchema} from '@fluxer/schema/src/domains/user/SyncedPreferencesCodec';

const RETIRED_FIELD_NUMBERS: ReadonlyArray<number> = [120, 121, 122, 123, 124, 125];

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

function schemaFieldNumbers(): ReadonlySet<number> {
	return new Set(SyncedPreferencesSchema.fields.map((field) => field.number));
}

/** The position after the varint that starts at `pos`, and its value when it fits a tag or a length. */
function readVarint(bytes: Uint8Array, pos: number): {value: number; next: number} | null {
	let value = 0;
	let scale = 1;
	for (let read = 0; read < 10; read += 1) {
		if (pos >= bytes.length) return null;
		const byte = bytes[pos];
		pos += 1;
		value += (byte & 0x7f) * scale;
		scale *= 128;
		if ((byte & 0x80) === 0) return {value, next: pos};
	}
	return null;
}

/** Where the field whose tag ends at `pos` ends, or null when the bytes are not a well-formed field. */
function fieldEnd(bytes: Uint8Array, pos: number, wireType: number): number | null {
	if (wireType === WIRE_VARINT) return readVarint(bytes, pos)?.next ?? null;
	if (wireType === WIRE_FIXED64) return pos + 8;
	if (wireType === WIRE_FIXED32) return pos + 4;
	if (wireType === WIRE_LENGTH_DELIMITED) {
		const length = readVarint(bytes, pos);
		return length ? length.next + length.value : null;
	}
	return null;
}

/**
 * The same blob without the retired fields. A blob that has none comes back as the very string it
 * was, and so does one that cannot be read: saying what is wrong with it is the caller's job.
 */
export function dropRetiredSyncedPreferenceFields(
	encoded: string | null,
	definedFieldNumbers: ReadonlySet<number> = schemaFieldNumbers(),
): string | null {
	if (!encoded) return encoded;
	const retired = new Set(RETIRED_FIELD_NUMBERS.filter((number) => !definedFieldNumbers.has(number)));
	if (retired.size === 0) return encoded;

	const bytes = Buffer.from(encoded, 'base64');
	const kept: Array<Uint8Array> = [];
	let dropped = false;
	let pos = 0;
	while (pos < bytes.length) {
		const tag = readVarint(bytes, pos);
		if (!tag) return encoded;
		const end = fieldEnd(bytes, tag.next, tag.value % 8);
		if (end === null || end > bytes.length) return encoded;
		if (retired.has(Math.floor(tag.value / 8))) {
			dropped = true;
		} else {
			kept.push(bytes.subarray(pos, end));
		}
		pos = end;
	}
	if (!dropped) return encoded;
	const remaining = Buffer.concat(kept);
	return remaining.length === 0 ? null : remaining.toString('base64');
}
