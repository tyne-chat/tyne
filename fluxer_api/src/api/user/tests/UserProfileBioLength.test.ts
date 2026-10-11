// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {ensureSessionStarted} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

interface ValidationErrorResponse {
	code: string;
	message?: string;
	errors?: Array<{
		path?: string;
		code?: string;
		message?: string;
	}>;
}

describe('User bio length (the fork allows up to 10000 characters)', () => {
	let harness: ApiTestHarness;
	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});
	it('includes min/max in bio length validation message', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const json = await createBuilder<ValidationErrorResponse>(harness, account.token)
			.patch('/users/@me')
			.body({bio: 'a'.repeat(10001)})
			.expect(HTTP_STATUS.BAD_REQUEST, 'INVALID_FORM_BODY')
			.execute();
		const error = json.errors?.find((e) => e.path === 'bio');
		expect(error?.code).toBe(ValidationErrorCodes.STRING_LENGTH_INVALID);
		expect(error?.message).toBe('String length must be between 1 and 10000 characters.');
		expect(error?.message).not.toContain('undefined');
	});
	it('allows bios longer than 320 characters up to maxBioLength', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const longBio = 'b'.repeat(1000);
		const res = await createBuilder<{bio: string | null}>(harness, account.token)
			.patch('/users/@me')
			.body({bio: longBio})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(res.bio).toBe(longBio);
	});
});
