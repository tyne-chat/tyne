// SPDX-License-Identifier: AGPL-3.0-or-later

import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {BadRequestError} from '@fluxer/errors/src/domains/core/BadRequestError';
import {NotFoundError} from '@fluxer/errors/src/domains/core/NotFoundError';

export class PersonaNotFoundError extends NotFoundError {
	constructor() {
		super({code: APIErrorCodes.UNKNOWN_PERSONA, message: 'Unknown Persona'});
	}
}

export class PersonaLimitReachedError extends BadRequestError {
	constructor(max: number = 250) {
		super({
			code: APIErrorCodes.PERSONA_LIMIT_REACHED,
			message: `Maximum number of personas reached (${max})`,
		});
	}
}

export class DuplicatePersonaTagError extends BadRequestError {
	constructor(message: string = 'A tag with this prefix and suffix already exists on this account') {
		super({
			code: APIErrorCodes.DUPLICATE_PERSONA_TAG,
			message,
		});
	}
}

export class PersonaTagLimitExceededError extends BadRequestError {
	constructor(max: number = 5) {
		super({
			code: APIErrorCodes.PERSONA_TAG_LIMIT_REACHED,
			message: `A persona can have at most ${max} tags`,
		});
	}
}

export class DuplicateSignatureEmojiError extends BadRequestError {
	constructor(message: string = 'A signature emoji with this name or identifier already exists on this account') {
		super({
			code: APIErrorCodes.DUPLICATE_SIGNATURE_EMOJI,
			message,
		});
	}
}

export class SignatureEmojiLimitExceededError extends BadRequestError {
	constructor(max: number = 20) {
		super({
			code: APIErrorCodes.SIGNATURE_EMOJI_LIMIT_REACHED,
			message: `A persona can have at most ${max} signature emojis`,
		});
	}
}
