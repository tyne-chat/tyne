// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildCommandTemplateError} from '@app/api/guild_command/GuildCommandErrors';
import {
	type GuildCommandKind,
	MAX_GUILD_COMMAND_TEMPLATE_LENGTH,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {Drop, Liquid, type Template} from 'liquidjs';

// Fork: the Liquid engine behind server commands (docs/design/server-commands.md, "Templates").
// Templates are written by community members and rendered on the API's main thread, so the engine is
// locked down: no loops, no other templates or files, and liquidjs's own limits as a second layer.

const REMOVED_TAGS = [
	'for',
	'tablerow',
	'break',
	'continue',
	'cycle',
	'include',
	'render',
	'layout',
	'block',
	'increment',
	'decrement',
] as const;

/** Milliseconds per render, checked by liquidjs between template nodes. */
const RENDER_LIMIT_MS = 50;
/** Characters that filters such as append and join may allocate in one render. */
const MEMORY_LIMIT = 1_000_000;
const PARSED_CACHE_SIZE = 1000;

const ZERO_WIDTH_SPACE = '​';

/**
 * Escapes a display name for use inside a message: every markdown character that could change the
 * message, and a zero-width space after `@` so a name can never become `@everyone` or `@here`.
 */
export function escapeGuildCommandName(name: string): string {
	const escaped = name.replace(/[\\*_~`|[\]<>]/g, (char) => `\\${char}`).replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
	return /^[#>-]/.test(escaped) ? `\\${escaped}` : escaped;
}

/** A person or channel: prints as its mention, `.name` gives the escaped name, and `==` compares mentions. */
export class GuildCommandMentionDrop extends Drop {
	readonly mention: string;
	readonly name: string;

	constructor(mention: string, name: string) {
		super();
		this.mention = mention;
		this.name = escapeGuildCommandName(name);
	}

	override valueOf(): string {
		return this.mention;
	}
}

export class GuildCommandChannelDrop extends GuildCommandMentionDrop {
	readonly community: {name: string} | null;

	constructor(mention: string, name: string, communityName: string | null) {
		super(mention, name);
		this.community = communityName === null ? null : {name: escapeGuildCommandName(communityName)};
	}
}

export interface GuildCommandScope {
	person: GuildCommandMentionDrop;
	input: string;
	target: GuildCommandMentionDrop | null;
	channel: GuildCommandChannelDrop;
	community: {name: string};
}

const BASIC_OUTPUT = /\{\{\s*(?:person|input)\s*\}\}/g;

/**
 * A template is basic when it is only text and the outputs `{{ person }}` and `{{ input }}`; the basic
 * editor can show exactly that. Anything else is a script.
 */
export function classifyGuildCommandTemplate(template: string): GuildCommandKind {
	const rest = template.replace(BASIC_OUTPUT, '');
	return rest.includes('{{') || rest.includes('{%') ? 'script' : 'basic';
}

function createEngine(): Liquid {
	const engine = new Liquid({
		templates: {},
		ownPropertyOnly: true,
		strictFilters: true,
		strictVariables: false,
		parseLimit: MAX_GUILD_COMMAND_TEMPLATE_LENGTH,
		renderLimit: RENDER_LIMIT_MS,
		memoryLimit: MEMORY_LIMIT,
	});
	for (const name of REMOVED_TAGS) {
		delete engine.tags[name];
	}
	return engine;
}

function describeLiquidError(error: unknown): string {
	return error instanceof Error ? error.message : 'The template could not be read';
}

export class GuildCommandTemplateEngine {
	private readonly engine = createEngine();
	private readonly parsed = new Map<string, Array<Template>>();

	/** Parses the template, throwing `GuildCommandTemplateError` when it is not valid. */
	validate(template: string): void {
		this.parse(template);
	}

	render(template: string, scope: GuildCommandScope): string {
		const parsed = this.parse(template);
		try {
			return String(this.engine.renderSync(parsed, scope));
		} catch (error) {
			throw new GuildCommandTemplateError(describeLiquidError(error));
		}
	}

	private parse(template: string): Array<Template> {
		const cached = this.parsed.get(template);
		if (cached) {
			this.parsed.delete(template);
			this.parsed.set(template, cached);
			return cached;
		}
		let parsed: Array<Template>;
		try {
			parsed = this.engine.parse(template);
		} catch (error) {
			throw new GuildCommandTemplateError(describeLiquidError(error));
		}
		this.parsed.set(template, parsed);
		if (this.parsed.size > PARSED_CACHE_SIZE) {
			const oldest = this.parsed.keys().next().value;
			if (oldest !== undefined) this.parsed.delete(oldest);
		}
		return parsed;
	}
}
