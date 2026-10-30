// SPDX-License-Identifier: AGPL-3.0-or-later

import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {BadRequestError} from '@fluxer/errors/src/domains/core/BadRequestError';
import {NotFoundError} from '@fluxer/errors/src/domains/core/NotFoundError';

export class UnknownGuildCommandError extends NotFoundError {
	constructor() {
		super({code: APIErrorCodes.UNKNOWN_GUILD_COMMAND, message: 'Unknown command'});
	}
}

export class GuildCommandNameTakenError extends BadRequestError {
	constructor() {
		super({
			code: APIErrorCodes.GUILD_COMMAND_NAME_TAKEN,
			message: 'This community already has a command with that name, or it is a built-in command',
		});
	}
}

export class GuildCommandLimitReachedError extends BadRequestError {
	constructor(max: number) {
		super({code: APIErrorCodes.GUILD_COMMAND_LIMIT_REACHED, message: `Maximum number of commands reached (${max})`});
	}
}

/** A template that does not parse, does not render, or is not allowed yet (scripts, before phase 2). */
export class GuildCommandTemplateError extends BadRequestError {
	constructor(message: string) {
		super({code: APIErrorCodes.GUILD_COMMAND_TEMPLATE_INVALID, message});
	}
}

export class GuildCommandInputError extends BadRequestError {
	constructor(message: string) {
		super({code: APIErrorCodes.GUILD_COMMAND_INPUT_INVALID, message});
	}
}
