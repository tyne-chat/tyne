// SPDX-License-Identifier: AGPL-3.0-or-later

import {UnknownUserError} from '@fluxer/errors/src/domains/user/UnknownUserError';
import {describe, expect, it, vi} from 'vitest';
import {createUserID} from '../../BrandedTypes';
import {UserAccountLookupService} from '../services/UserAccountLookupService';

describe('UserAccountLookupService', () => {
	const userA = createUserID(1001n);
	const userB = createUserID(1002n);

	it('validates profile access for self-lookup without repository access', async () => {
		const mockFindUnique = vi.fn();
		const service = new UserAccountLookupService({
			userAccountRepository: {findUnique: mockFindUnique} as any,
		} as any);

		await expect(service.validateProfileAccess(userA, userA)).resolves.toBeUndefined();
		expect(mockFindUnique).not.toHaveBeenCalled();
	});

	it('throws UnknownUserError when target user is not found', async () => {
		const mockFindUnique = vi.fn().mockResolvedValue(null);
		const service = new UserAccountLookupService({
			userAccountRepository: {findUnique: mockFindUnique} as any,
		} as any);

		await expect(service.validateProfileAccess(userA, userB)).rejects.toThrow(UnknownUserError);
		expect(mockFindUnique).toHaveBeenCalledWith(userB);
	});
});
