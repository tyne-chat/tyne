// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	PersonaBulkImportRequestSchema,
	PersonaCreateRequestSchema,
	PersonaTagSchema,
	PersonaUpdateRequestSchema,
} from '../PersonaApiSchemas';

describe('PersonaApiSchemas', () => {
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
		});
		expect(validCreate.success).toBe(true);

		const validUpdate = PersonaUpdateRequestSchema.safeParse({
			name: 'Alice Updated',
			auto_tag_disabled: true,
			visibility: 'private',
		});
		expect(validUpdate.success).toBe(true);
	});
});
