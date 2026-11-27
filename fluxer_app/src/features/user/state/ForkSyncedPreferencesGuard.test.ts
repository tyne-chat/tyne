// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: guards for SyncedPreferences protobuf field numbering and web round-trip stability
// (tyne-chat/tyne#125, tyne-chat/tyne#145, tyne-chat/tyne#947).

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SyncedFieldConfig} from '@app/features/user/state/SyncedField';
import {create, type MessageInitShape, ScalarType} from '@bufbuild/protobuf';
import {
	type AccessibilitySettings,
	AccessibilitySettingsSchema,
} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/accessibility_pb';
import {describe, expect, it, vi} from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const PROTO_DIR = path.join(REPO_ROOT, 'packages/schema/proto/fluxer/user/preferences/v1');
const RETIRED_NUMBERS = new Set([66, 67, 68, 120, 121, 122, 123, 124, 125]);

function stripComments(line: string): string {
	const idx = line.indexOf('//');
	return idx === -1 ? line : line.slice(0, idx);
}

function parseProtoMessages(source: string): Array<{
	name: string;
	fields: Array<{name: string; num: number; inForkBlock: boolean; line: number}>;
	reserved: Set<number>;
}> {
	const messages: Array<{
		name: string;
		fields: Array<{name: string; num: number; inForkBlock: boolean; line: number}>;
		reserved: Set<number>;
	}> = [];
	let current: (typeof messages)[number] | null = null;
	let depth = 0;
	let inForkBlock = false;
	const lines = source.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (/\/\/\s*Fork fields\./.test(raw)) {
			inForkBlock = true;
		}
		const line = stripComments(raw).trim();
		if (current && inForkBlock && raw.trim() === '') {
			inForkBlock = false;
		}
		const msgMatch = /^message\s+([A-Za-z0-9_]+)\s*\{/.exec(line);
		if (msgMatch && depth === 0) {
			current = {name: msgMatch[1], fields: [], reserved: new Set()};
			messages.push(current);
			depth = 1;
			inForkBlock = false;
			continue;
		}
		if (!current) continue;

		if (depth === 1) {
			const resMatch = /^reserved\s+([^;]+);/.exec(line);
			if (resMatch) {
				for (const part of resMatch[1].split(',')) {
					const trimmed = part.trim();
					if (/^\d+$/.test(trimmed)) current.reserved.add(Number(trimmed));
					const rangeMatch = /^(\d+)\s+to\s+(\d+)$/.exec(trimmed);
					if (rangeMatch) {
						for (let n = Number(rangeMatch[1]); n <= Number(rangeMatch[2]); n++) current.reserved.add(n);
					}
				}
			}
			const fieldMatch =
				/^(?:optional|repeated)?\s*(?:map<[^>]+>|[A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*=\s*(\d+)\s*;/.exec(line);
			if (fieldMatch) {
				current.fields.push({name: fieldMatch[1], num: Number(fieldMatch[2]), inForkBlock, line: i + 1});
			}
		}

		for (const ch of line) {
			if (ch === '{') depth++;
			else if (ch === '}') {
				depth--;
				if (depth === 0) {
					current = null;
					inForkBlock = false;
				}
			}
		}
	}
	return messages;
}

describe('SyncedPreferences protobuf fork range and web preservation guards', () => {
	it('keeps every fork field in upstream proto files at >= 2200 without colliding with reserved or retired numbers', () => {
		const protoFiles = fs.readdirSync(PROTO_DIR).filter((f) => f.endsWith('.proto'));
		expect(protoFiles.length).toBeGreaterThanOrEqual(3);

		let forkFieldCount = 0;
		for (const file of protoFiles) {
			const src = fs.readFileSync(path.join(PROTO_DIR, file), 'utf8');
			const isForkOwnedFile = file.startsWith('fork_');
			const messages = parseProtoMessages(src);
			for (const msg of messages) {
				const seen = new Set<number>();
				for (const field of msg.fields) {
					expect(seen.has(field.num), `${file}:${field.line} duplicate field number ${field.num}`).toBe(false);
					seen.add(field.num);
					expect(
						msg.reserved.has(field.num),
						`${file}:${field.line} field ${field.name} reuses reserved number ${field.num}`,
					).toBe(false);
					if (!isForkOwnedFile && field.inForkBlock) {
						forkFieldCount++;
						expect(field.num, `${file}:${field.line} fork field ${field.name} must be >= 2200`).toBeGreaterThanOrEqual(
							2200,
						);
						expect(
							RETIRED_NUMBERS.has(field.num),
							`${file}:${field.line} fork field ${field.name} reuses retired number ${field.num}`,
						).toBe(false);
					}
				}
			}
		}
		expect(forkFieldCount).toBeGreaterThanOrEqual(10);
	});

	it('preserves every AccessibilitySettings fork field (>= 2200) across web applyMessage -> toMessage round-trips', async () => {
		vi.resetModules();
		const syncedFieldMod = await import('@app/features/user/state/SyncedField');
		let captured: SyncedFieldConfig<Record<string, unknown>, 'accessibility', AccessibilitySettings> | null = null;
		const spy = vi.spyOn(syncedFieldMod, 'makeSyncedField').mockImplementation(async (_store, config) => {
			if (config.field === 'accessibility') {
				captured = config as unknown as SyncedFieldConfig<
					Record<string, unknown>,
					'accessibility',
					AccessibilitySettings
				>;
			}
		});
		try {
			const Accessibility = (await import('@app/features/accessibility/state/Accessibility')).default;
			expect(captured).not.toBeNull();

			const forkFields = AccessibilitySettingsSchema.fields.filter((f) => f.number >= 2200);
			expect(forkFields.length).toBeGreaterThanOrEqual(9);

			// Test two distinct non-default values for every boolean and distinct finite numbers for numeric fields
			// so a hardcoded default cannot slip past by matching one direction.
			for (const boolVal of [false, true]) {
				const init: Record<string, unknown> = {};
				for (const field of forkFields) {
					if (field.fieldKind === 'scalar' && field.scalar === ScalarType.BOOL) {
						init[field.localName] = boolVal;
					} else if (field.fieldKind === 'scalar' && field.scalar === ScalarType.DOUBLE) {
						init[field.localName] = boolVal ? 18.5 : 14.5;
					} else {
						throw new Error(`Unhandled fork AccessibilitySettings scalar kind on ${field.localName}`);
					}
				}

				const store = Object.create(Object.getPrototypeOf(Accessibility)) as Record<string, unknown>;
				Object.assign(store, Accessibility);
				const incoming = create(
					AccessibilitySettingsSchema,
					init as MessageInitShape<typeof AccessibilitySettingsSchema>,
				);
				captured!.applyMessage(store, incoming);
				const roundTripped = create(AccessibilitySettingsSchema, captured!.toMessage(store));

				for (const field of forkFields) {
					expect(
						(roundTripped as Record<string, unknown>)[field.localName],
						`web save dropped/altered fork field ${field.localName} (#${field.number}) for value ${String(init[field.localName])}`,
					).toEqual(init[field.localName]);
				}
			}
		} finally {
			spy.mockRestore();
		}
	});

	it('preserves upstream mobile AccessibilitySettings fields (#33, #64, #67) across web applyMessage -> toMessage round-trips', async () => {
		vi.resetModules();
		const syncedFieldMod = await import('@app/features/user/state/SyncedField');
		let captured: SyncedFieldConfig<Record<string, unknown>, 'accessibility', AccessibilitySettings> | null = null;
		const spy = vi.spyOn(syncedFieldMod, 'makeSyncedField').mockImplementation(async (_store, config) => {
			if (config.field === 'accessibility') {
				captured = config as unknown as SyncedFieldConfig<
					Record<string, unknown>,
					'accessibility',
					AccessibilitySettings
				>;
			}
		});
		try {
			const Accessibility = (await import('@app/features/accessibility/state/Accessibility')).default;
			expect(captured).not.toBeNull();

			const mobileFields = [
				'showSelectedChannelTypingIndicator',
				'mobileSplashZoomAnimation',
				'announceCallJoinsAndLeaves',
			] as const;

			for (const boolVal of [false, true]) {
				const store = Object.create(Object.getPrototypeOf(Accessibility)) as Record<string, unknown>;
				Object.assign(store, Accessibility);
				const incoming = create(AccessibilitySettingsSchema, {
					showSelectedChannelTypingIndicator: boolVal,
					mobileSplashZoomAnimation: boolVal,
					announceCallJoinsAndLeaves: boolVal,
				});
				captured!.applyMessage(store, incoming);
				const msg = captured!.toMessage(store);
				const roundTripped = create(AccessibilitySettingsSchema, msg);
				for (const fieldName of mobileFields) {
					expect(roundTripped[fieldName], `field ${fieldName} for ${String(boolVal)}`).toBe(boolVal);
				}
			}

			// When unset on server, web must leave them undefined rather than writing default false
			const unsetStore = Object.create(Object.getPrototypeOf(Accessibility)) as Record<string, unknown>;
			Object.assign(unsetStore, Accessibility);
			captured!.applyMessage(unsetStore, create(AccessibilitySettingsSchema, {}));
			const unsetMsg = captured!.toMessage(unsetStore);
			for (const fieldName of mobileFields) {
				expect((unsetMsg as Record<string, unknown>)[fieldName], `unset ${fieldName}`).toBeUndefined();
			}
		} finally {
			spy.mockRestore();
		}
	});
});
