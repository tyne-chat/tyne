// SPDX-License-Identifier: AGPL-3.0-or-later

import {LimitConfigUpdateRequest} from '@fluxer/schema/src/domains/admin/AdminSchemas';
import {describe, expect, it} from 'vitest';

describe('LimitConfigUpdateRequest', () => {
	it('accepts max_bio_length within allowed bounds', () => {
		const result = LimitConfigUpdateRequest.safeParse({
			limit_config: {
				rules: [
					{
						id: 'default',
						limits: {
							max_bio_length: 10000,
						},
					},
				],
			},
		});
		expect(result.success).toBe(true);
	});

	it('rejects max_bio_length exceeding middleware limit of 10000', () => {
		const result = LimitConfigUpdateRequest.safeParse({
			limit_config: {
				rules: [
					{
						id: 'default',
						limits: {
							max_bio_length: 10001,
						},
					},
				],
			},
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues.find((i) => i.path.includes('max_bio_length'));
			expect(issue?.message).toBe('Max Bio Length cannot exceed 10000');
		}
	});

	it('rejects max_bio_length below minimum bound of 1', () => {
		const result = LimitConfigUpdateRequest.safeParse({
			limit_config: {
				rules: [
					{
						id: 'default',
						limits: {
							max_bio_length: 0,
						},
					},
				],
			},
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues.find((i) => i.path.includes('max_bio_length'));
			expect(issue?.message).toBe('Max Bio Length must be at least 1');
		}
	});
});
