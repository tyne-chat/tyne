// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	PersonaBulkImportRequestSchema,
	PersonaCreateRequestSchema,
	PersonaTagSchema,
	PersonaUpdateRequestSchema,
	SignatureEmojiSchema,
} from '../PersonaApiSchemas';

describe('PersonaApiSchemas', () => {
	it('validates SignatureEmojiSchema for unicode and custom emojis', () => {
		// Valid unicode emoji (no id)
		const unicodeResult = SignatureEmojiSchema.safeParse({name: '🦊'});
		expect(unicodeResult.success).toBe(true);

		// Valid custom emoji (with snowflake id and animated flag)
		const customResult = SignatureEmojiSchema.safeParse({
			id: '123456789012345678',
			name: 'custom_fox',
			animated: true,
		});
		expect(customResult.success).toBe(true);

		// Rejects empty name
		expect(SignatureEmojiSchema.safeParse({name: ''}).success).toBe(false);

		// Rejects name over 64 characters
		expect(SignatureEmojiSchema.safeParse({name: 'a'.repeat(65)}).success).toBe(false);
	});

	it('validates PersonaTagSchema with prefix, suffix, or both, and rejects empty tags', () => {
		expect(PersonaTagSchema.safeParse({prefix: '['}).success).toBe(true);
		expect(PersonaTagSchema.safeParse({suffix: ']'}).success).toBe(true);
		expect(PersonaTagSchema.safeParse({prefix: '[', suffix: ']'}).success).toBe(true);

		// Rejects empty object
		expect(PersonaTagSchema.safeParse({}).success).toBe(false);
	});

	it('preprocesses and validates PersonaBulkImportRequestSchema for arrays and wrapped objects', () => {
		const sampleItem = {
			name: 'Test Persona',
			persona_tags: [{prefix: 'T:'}],
		};

		// Direct array
		const directParse = PersonaBulkImportRequestSchema.safeParse([sampleItem]);
		expect(directParse.success).toBe(true);
		if (directParse.success) {
			expect(directParse.data).toHaveLength(1);
			expect(directParse.data[0].name).toBe('Test Persona');
		}

		// Wrapped object { personas: [...] }
		const wrappedParse = PersonaBulkImportRequestSchema.safeParse({
			personas: [sampleItem],
		});
		expect(wrappedParse.success).toBe(true);
		if (wrappedParse.success) {
			expect(wrappedParse.data).toHaveLength(1);
			expect(wrappedParse.data[0].name).toBe('Test Persona');
		}

		// Rejects array exceeding 250 items
		const hugeArray = Array.from({length: 251}, (_, i) => ({
			name: `P${i}`,
		}));
		expect(PersonaBulkImportRequestSchema.safeParse(hugeArray).success).toBe(false);
	});

	it('validates PersonaCreateRequestSchema and PersonaUpdateRequestSchema', () => {
		const validCreate = PersonaCreateRequestSchema.safeParse({
			name: 'Alice',
			bio: 'A small bio',
			color: 0xff0000,
			visibility: 'public',
			persona_tags: [{prefix: 'A:'}],
			signature_emojis: [{name: '🦊'}, {id: '123456789012345678', name: 'custom'}],
		});
		expect(validCreate.success).toBe(true);

		const validUpdate = PersonaUpdateRequestSchema.safeParse({
			name: 'Alice Updated',
			auto_tag_disabled: true,
			visibility: 'private',
			signature_emojis: [{name: '🐺'}],
		});
		expect(validUpdate.success).toBe(true);
	});
});
