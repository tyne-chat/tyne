// SPDX-License-Identifier: AGPL-3.0-or-later

import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {describe, expect, it} from 'vitest';
import {
	DuplicatePersonaTagError,
	DuplicateSignatureEmojiError,
	PersonaLimitReachedError,
	PersonaNotFoundError,
	PersonaTagLimitExceededError,
	SignatureEmojiLimitExceededError,
} from '../errors/PersonaErrors';

describe('PersonaErrors', () => {
	it('instantiates DuplicateSignatureEmojiError with correct code and default message', () => {
		const err = new DuplicateSignatureEmojiError();
		expect(err.code).toBe(APIErrorCodes.DUPLICATE_SIGNATURE_EMOJI);
		expect(err.message).toBe('A signature emoji with this name or identifier already exists on this account');
	});

	it('instantiates DuplicateSignatureEmojiError with custom message', () => {
		const err = new DuplicateSignatureEmojiError('Custom duplicate error');
		expect(err.code).toBe(APIErrorCodes.DUPLICATE_SIGNATURE_EMOJI);
		expect(err.message).toBe('Custom duplicate error');
	});

	it('instantiates SignatureEmojiLimitExceededError with max count', () => {
		const defaultErr = new SignatureEmojiLimitExceededError();
		expect(defaultErr.code).toBe(APIErrorCodes.SIGNATURE_EMOJI_LIMIT_REACHED);
		expect(defaultErr.message).toBe('A persona can have at most 10000 signature emojis');

		const customErr = new SignatureEmojiLimitExceededError(50);
		expect(customErr.code).toBe(APIErrorCodes.SIGNATURE_EMOJI_LIMIT_REACHED);
		expect(customErr.message).toBe('A persona can have at most 50 signature emojis');
	});

	it('instantiates DuplicatePersonaTagError with default and custom message', () => {
		const defaultErr = new DuplicatePersonaTagError();
		expect(defaultErr.code).toBe(APIErrorCodes.DUPLICATE_PERSONA_TAG);
		expect(defaultErr.message).toBe('A tag with this prefix and suffix already exists on this account');

		const customErr = new DuplicatePersonaTagError('Tag collision');
		expect(customErr.message).toBe('Tag collision');
	});

	it('instantiates PersonaTagLimitExceededError with default and custom max', () => {
		const defaultErr = new PersonaTagLimitExceededError();
		expect(defaultErr.code).toBe(APIErrorCodes.PERSONA_TAG_LIMIT_REACHED);
		expect(defaultErr.message).toBe('A persona can have at most 5 tags');

		const customErr = new PersonaTagLimitExceededError(10);
		expect(customErr.message).toBe('A persona can have at most 10 tags');
	});

	it('instantiates PersonaLimitReachedError and PersonaNotFoundError', () => {
		const limitErr = new PersonaLimitReachedError(100);
		expect(limitErr.code).toBe(APIErrorCodes.PERSONA_LIMIT_REACHED);
		expect(limitErr.message).toBe('Maximum number of personas reached (100)');

		const notFoundErr = new PersonaNotFoundError();
		expect(notFoundErr.code).toBe(APIErrorCodes.UNKNOWN_PERSONA);
		expect(notFoundErr.message).toBe('Unknown Persona');
	});
});
