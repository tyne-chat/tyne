// SPDX-License-Identifier: AGPL-3.0-or-later

import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {BadRequestError} from '@fluxer/errors/src/domains/core/BadRequestError';
import {NotFoundError} from '@fluxer/errors/src/domains/core/NotFoundError';
import type {GuildCommandTemplateIssue} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';

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

/** A template that does not parse or does not render; `issue` says where and why, for its editors. */
export class GuildCommandTemplateError extends BadRequestError {
	readonly issue: GuildCommandTemplateIssue;

	constructor(issue: GuildCommandTemplateIssue) {
		super({
			code: APIErrorCodes.GUILD_COMMAND_TEMPLATE_INVALID,
			message: 'The template has a problem',
			data: {template_issue: issue},
		});
		this.issue = issue;
	}
}

/** What a member running a broken command gets: the details are for those who can edit it. */
export class GuildCommandBrokenError extends BadRequestError {
	constructor() {
		super({code: APIErrorCodes.GUILD_COMMAND_TEMPLATE_INVALID, message: 'This command has a problem'});
	}
}

export class GuildCommandInputError extends BadRequestError {
	constructor(message: string) {
		super({code: APIErrorCodes.GUILD_COMMAND_INPUT_INVALID, message});
	}
}
