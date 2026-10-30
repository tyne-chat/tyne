// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildCommandTemplateIssue} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import type {I18n, MessageDescriptor} from '@lingui/core';
import {msg} from '@lingui/core/macro';

// Fork: what the server reports about a command's template, in the editor's words. The server sends a
// code, the name concerned and the position; the wording is translated here.

const PROBLEMS: Record<GuildCommandTemplateIssue['code'], MessageDescriptor> = {
	unknown_tag: msg({
		message: "There's no tag called {name}.",
		comment: 'Problem in a community command script. {name} is what was written, such as "for". Preserve {name}.',
	}),
	unknown_filter: msg({
		message: "There's no filter called {name}.",
		comment: 'Problem in a community command script. {name} is what was written, such as "upcse". Preserve {name}.',
	}),
	not_closed: msg({
		message: '{name} is never closed.',
		comment:
			'Problem in a community command script. {name} is a piece of the script, such as {% if target %}. Preserve {name}.',
	}),
	too_long: msg({message: 'The script is too long.', comment: 'Problem in a community command script.'}),
	too_large: msg({
		message: 'The script builds too much text.',
		comment: 'Problem in a community command script: it produces more text than is allowed.',
	}),
	too_slow: msg({message: 'The script took too long to run.', comment: 'Problem in a community command script.'}),
	invalid: msg({
		message: "This part can't be read.",
		comment: 'Problem in a community command script: a syntax error at the position given before this text.',
	}),
	failed: msg({
		message: 'This part stopped with an error.',
		comment: 'Problem in a community command script: it failed while running, at the position given before this text.',
	}),
};

const AT_POSITION = msg({
	message: 'Line {line}, column {column}: {problem}',
	comment: 'Where a problem is in a community command script. Preserve {line}, {column} and {problem}.',
});

export function describeTemplateIssue(i18n: I18n, issue: GuildCommandTemplateIssue): string {
	const problem = i18n._(PROBLEMS[issue.code], {name: issue.name ?? ''});
	if (issue.line === null) return problem;
	return i18n._(AT_POSITION, {line: issue.line, column: issue.column ?? 1, problem});
}

/** The template's problem in a failed save, when the server named one. */
export function templateIssueOfError(error: unknown): GuildCommandTemplateIssue | null {
	const body = (error as {body?: {template_issue?: GuildCommandTemplateIssue}} | null)?.body;
	return body?.template_issue ?? null;
}
