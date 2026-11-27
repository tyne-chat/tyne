import {describe, expect, it} from 'vitest';

import {DiscoveryAdminCategoryListingQuery, DiscoverySearchQuery} from './GuildDiscoverySchemas';

describe('GuildDiscoverySchemas empty/boolean query coercion guards', () => {
	it('rejects empty string, null, and booleans for DiscoverySearchQuery.category', () => {
		for (const invalid of ['', '   ', null, true, false, '1.5']) {
			expect(DiscoverySearchQuery.safeParse({category: invalid}).success).toBe(false);
		}
		expect(DiscoverySearchQuery.parse({category: '0'}).category).toBe(0);
		expect(DiscoverySearchQuery.parse({}).category).toBeUndefined();
		expect(DiscoverySearchQuery.parse({category: undefined}).category).toBeUndefined();
	});

	it('rejects empty string, null, and booleans for DiscoverySearchQuery.offset', () => {
		for (const invalid of ['', '   ', null, true, false, '1.5']) {
			expect(DiscoverySearchQuery.safeParse({offset: invalid}).success).toBe(false);
		}
		expect(DiscoverySearchQuery.parse({offset: '0'}).offset).toBe(0);
		expect(DiscoverySearchQuery.parse({}).offset).toBe(0);
		expect(DiscoverySearchQuery.parse({offset: undefined}).offset).toBe(0);
	});

	it('rejects empty string, null, and booleans for DiscoveryAdminCategoryListingQuery.offset', () => {
		for (const invalid of ['', '   ', null, true, false, '1.5']) {
			expect(DiscoveryAdminCategoryListingQuery.safeParse({offset: invalid}).success).toBe(false);
		}
		expect(DiscoveryAdminCategoryListingQuery.parse({offset: '0'}).offset).toBe(0);
		expect(DiscoveryAdminCategoryListingQuery.parse({}).offset).toBe(0);
		expect(DiscoveryAdminCategoryListingQuery.parse({offset: undefined}).offset).toBe(0);
	});
});
