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
//
// The same holds one level down, in `AccessibilitySettings` (field 1): until 2026-10-16 the fork kept
// three mobile settings there as fields 66 to 68, all doubles (64-bit on the wire); they are 2224 to
// 2226 now. Upstream numbers its own fields there in sequence too, and gave 66 to a bool on
// 2026-10-17 (`message_double_click_actions`). A protobuf decoder that expects a bool and finds a
// double cannot read the rest of the message, so one of these old values would make the whole blob
// unreadable (tyne-chat/tyne#125). This drops a 64-bit value at those numbers, on the way in and on
// the way out, unless the current schema itself defines the number as a 64-bit field. It is a
// workaround: remove it once no Android build before 1.2.2 or iOS build 2026.10.100 is in use and no
// stored blob carries the bytes (tyne-chat/tyne#127).

import {ScalarType} from '@bufbuild/protobuf';
import {SyncedPreferencesSchema} from '@fluxer/schema/src/domains/user/SyncedPreferencesCodec';

const RETIRED_FIELD_NUMBERS: ReadonlyArray<number> = [120, 121, 122, 123, 124, 125];
const ACCESSIBILITY_FIELD_NUMBER = 1;
const RETIRED_ACCESSIBILITY_DOUBLES: ReadonlyArray<number> = [66, 67, 68];
const SCALARS_SENT_AS_64_BITS: ReadonlySet<ScalarType> = new Set([
	ScalarType.DOUBLE,
	ScalarType.FIXED64,
	ScalarType.SFIXED64,
]);

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

let definedFieldNumbersCache: ReadonlySet<number> | undefined;
let accessibility64BitFieldNumbersCache: ReadonlySet<number> | undefined;

function schemaFieldNumbers(): ReadonlySet<number> {
	definedFieldNumbersCache ??= new Set(SyncedPreferencesSchema.fields.map((field) => field.number));
	return definedFieldNumbersCache;
}

/** The numbers the current `AccessibilitySettings` schema itself sends as 64-bit values. */
function accessibility64BitFieldNumbers(): ReadonlySet<number> {
	if (accessibility64BitFieldNumbersCache) return accessibility64BitFieldNumbersCache;
	const accessibility = SyncedPreferencesSchema.fields.find((field) => field.number === ACCESSIBILITY_FIELD_NUMBER);
	accessibility64BitFieldNumbersCache = new Set(
		accessibility?.fieldKind === 'message'
			? accessibility.message.fields
					.filter((field) => field.fieldKind === 'scalar' && SCALARS_SENT_AS_64_BITS.has(field.scalar))
					.map((field) => field.number)
			: [],
	);
	return accessibility64BitFieldNumbersCache;
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

function writeVarint(value: number): Array<number> {
	const out: Array<number> = [];
	let rest = value;
	while (rest >= 0x80) {
		out.push((rest % 0x80) | 0x80);
		rest = Math.floor(rest / 0x80);
	}
	out.push(rest);
	return out;
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

interface WireField {
	number: number;
	wireType: number;
	start: number;
	valueStart: number;
	end: number;
}

/** A message's fields in order, or null when the bytes are not a well-formed message. */
function splitFields(bytes: Uint8Array): Array<WireField> | null {
	const fields: Array<WireField> = [];
	let pos = 0;
	while (pos < bytes.length) {
		const tag = readVarint(bytes, pos);
		if (!tag) return null;
		const wireType = tag.value % 8;
		const end = fieldEnd(bytes, tag.next, wireType);
		if (end === null || end > bytes.length) return null;
		fields.push({number: Math.floor(tag.value / 8), wireType, start: pos, valueStart: tag.next, end});
		pos = end;
	}
	return fields;
}

/** The accessibility message without the old 64-bit values, or null when it has none or cannot be read. */
function withoutRetiredAccessibilityDoubles(message: Uint8Array, kept64Bit: ReadonlySet<number>): Uint8Array | null {
	const fields = splitFields(message);
	if (!fields) return null;
	const isRetired = (field: WireField) =>
		field.wireType === WIRE_FIXED64 &&
		RETIRED_ACCESSIBILITY_DOUBLES.includes(field.number) &&
		!kept64Bit.has(field.number);
	if (!fields.some(isRetired)) return null;
	return Buffer.concat(
		fields.filter((field) => !isRetired(field)).map((field) => message.subarray(field.start, field.end)),
	);
}

/**
 * The same blob without the retired fields. A blob that has none comes back as the very string it
 * was, and so does one that cannot be read: saying what is wrong with it is the caller's job.
 */
export function dropRetiredSyncedPreferenceFields(
	encoded: string | null,
	definedFieldNumbers: ReadonlySet<number> = schemaFieldNumbers(),
	accessibility64Bit: ReadonlySet<number> = accessibility64BitFieldNumbers(),
): string | null {
	if (!encoded) return encoded;
	const retired = new Set(RETIRED_FIELD_NUMBERS.filter((number) => !definedFieldNumbers.has(number)));

	const bytes = Buffer.from(encoded, 'base64');
	const fields = splitFields(bytes);
	if (!fields) return encoded;
	const kept: Array<Uint8Array> = [];
	let changed = false;
	for (const field of fields) {
		if (retired.has(field.number)) {
			changed = true;
			continue;
		}
		if (field.number === ACCESSIBILITY_FIELD_NUMBER && field.wireType === WIRE_LENGTH_DELIMITED) {
			const length = readVarint(bytes, field.valueStart);
			const cleaned = length
				? withoutRetiredAccessibilityDoubles(bytes.subarray(length.next, field.end), accessibility64Bit)
				: null;
			if (cleaned) {
				kept.push(
					Uint8Array.from([...writeVarint(field.number * 8 + WIRE_LENGTH_DELIMITED), ...writeVarint(cleaned.length)]),
					cleaned,
				);
				changed = true;
				continue;
			}
		}
		kept.push(bytes.subarray(field.start, field.end));
	}
	if (!changed) return encoded;
	const remaining = Buffer.concat(kept);
	return remaining.length === 0 ? null : remaining.toString('base64');
}
