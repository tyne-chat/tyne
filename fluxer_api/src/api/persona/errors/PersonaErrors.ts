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
