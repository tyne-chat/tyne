// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Completion, CompletionContext, CompletionResult} from '@codemirror/autocomplete';
import {
	GUILD_COMMAND_TEMPLATE_FILTERS,
	GUILD_COMMAND_TEMPLATE_TAGS,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';

// Fork: suggestions in the command script editor. `@codemirror/lang-liquid`'s own source always offers
// Liquid's full list, `for` and `render` included, which the server refuses; this one offers what the
// engine allows (docs/design/server-commands.md, "Tags and filters").

const CLOSING_TAGS = [
	'else',
	'elsif',
	'endcapture',
	'endcase',
	'endcomment',
	'endif',
	'endrandom',
	'endraw',
	'endunless',
];

const TAGS: ReadonlyArray<Completion> = [
	...GUILD_COMMAND_TEMPLATE_TAGS.filter((tag) => tag !== '#'),
	...CLOSING_TAGS,
	'or',
	'when',
].map((label) => ({label, type: 'keyword'}));

const FILTERS: ReadonlyArray<Completion> = GUILD_COMMAND_TEMPLATE_FILTERS.map((label) => ({label, type: 'function'}));

const VARIABLES: ReadonlyArray<Completion> = ['channel', 'community', 'input', 'person', 'target'].map((label) => ({
	label,
	type: 'variable',
}));

const NAME: ReadonlyArray<Completion> = [{label: 'name', type: 'property'}];

const PROPERTIES: Readonly<Record<string, ReadonlyArray<Completion>>> = {
	person: NAME,
	target: NAME,
	community: NAME,
	'channel.community': NAME,
	channel: [...NAME, {label: 'community', type: 'property'}],
};

export function guildCommandLiquidCompletions(context: CompletionContext): CompletionResult | null {
	const line = context.state.doc.lineAt(context.pos);
	const before = line.text.slice(0, context.pos - line.from);
	const open = Math.max(before.lastIndexOf('{{'), before.lastIndexOf('{%'));
	if (open === -1) return null;
	const inside = before.slice(open + 2);
	if (inside.includes('}}') || inside.includes('%}')) return null;

	const word = /[a-z_]*$/i.exec(inside)?.[0] ?? '';
	const from = context.pos - word.length;
	const lead = inside.slice(0, inside.length - word.length);
	if (word === '' && !context.explicit && !/[{%|.\s]$/.test(`{${lead}`)) return null;

	const path = /([a-z_.]+)\.$/i.exec(lead)?.[1];
	let options: ReadonlyArray<Completion> = VARIABLES;
	if (path !== undefined) options = PROPERTIES[path] ?? [];
	else if (/\|\s*$/.test(lead)) options = FILTERS;
	else if (before.startsWith('{%', open) && /^-?\s*$/.test(lead)) options = TAGS;
	return options.length === 0 ? null : {from, options, validFor: /^[a-z_]*$/i};
}
