// SPDX-License-Identifier: AGPL-3.0-or-later

import {randomInt} from 'node:crypto';
import {GuildCommandTemplateError} from '@app/api/guild_command/GuildCommandErrors';
import {
	GUILD_COMMAND_TEMPLATE_FILTERS,
	GUILD_COMMAND_TEMPLATE_TAGS,
	type GuildCommandTemplateIssue,
	MAX_GUILD_COMMAND_TEMPLATE_LENGTH,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {
	CaptureTag,
	type Context,
	Drop,
	type Emitter,
	Liquid,
	LiquidError,
	type Parser,
	Tag,
	type TagToken,
	type Template,
	type TopLevelToken,
} from 'liquidjs';

// Fork: the Liquid engine behind server commands (docs/design/server-commands.md, "Templates").
// Anyone who creates a community can write templates, and they render on the API's main thread, so
// the engine is locked down: tags and filters are allowlists (a liquidjs upgrade adds nothing by
// itself), there are no loops, no other templates or files, and liquidjs's limits are a second layer.

/** Milliseconds per render, checked by liquidjs between template nodes. */
const RENDER_LIMIT_MS = 50;
/** Characters a render may allocate; a message holds at most 4,000. */
const MEMORY_LIMIT = 100_000;
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

/** liquidjs's `capture`, counting what it stores against the memory limit. */
class CountedCaptureTag extends CaptureTag {
	override *render(ctx: Context): Generator<unknown, void, string> {
		yield* super.render(ctx);
		ctx.memoryLimit.use(String(ctx.bottom()[this.variable as never]).length);
	}
}

/** `{% random %}a{% or %}b{% endrandom %}`: one branch, picked as it runs, without the spacing around it. */
class RandomTag extends Tag {
	private readonly branches: Array<Array<Template>> = [[]];

	constructor(token: TagToken, remainTokens: Array<TopLevelToken>, liquid: Liquid, parser: Parser) {
		super(token, remainTokens, liquid);
		let branch = this.branches[0];
		const stream = parser.parseStream(remainTokens);
		stream
			.on('tag:or', () => {
				branch = [];
				this.branches.push(branch);
			})
			.on('template', (template: Template) => {
				branch.push(template);
			})
			.on('tag:endrandom', () => {
				stream.stop();
			})
			.on('end', () => {
				throw new Error(`tag ${token.getText()} not closed`);
			})
			.start();
	}

	*render(ctx: Context, emitter: Emitter): Generator<unknown, void, string> {
		const branch = this.branches[randomInt(this.branches.length)];
		const text = yield this.liquid.renderer.renderTemplates(branch, ctx);
		ctx.memoryLimit.use(text.length);
		emitter.write(text.trim());
	}
}

/** `{{ "warm" | one_of: "gentle", "big" }}`, or `{{ list | one_of }}`: one of them, at random. */
function oneOf(value: unknown, ...others: Array<unknown>): unknown {
	const options = [...(Array.isArray(value) ? value : [value]), ...others];
	return options.length === 0 ? '' : options[randomInt(options.length)];
}

/** `{{ hugs | plural: "time", "times" }}`. Communities have no stored language, so 1 is the only singular. */
function plural(value: unknown, one: unknown, other: unknown): unknown {
	return Number(value) === 1 ? one : (other ?? one);
}

const ORDINAL_RULES = new Intl.PluralRules('en', {type: 'ordinal'});
const ORDINAL_SUFFIXES: Partial<Record<Intl.LDMLPluralRule, string>> = {one: 'st', two: 'nd', few: 'rd'};

/** `{{ hugs | ordinal }}`: "12th". Anything that is not a whole number stays as it is. */
function ordinal(value: unknown): unknown {
	const number = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
	if (value === null || value === undefined || !Number.isInteger(number)) return value;
	return `${number}${ORDINAL_SUFFIXES[ORDINAL_RULES.select(number)] ?? 'th'}`;
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
	for (const name of Object.keys(engine.tags)) {
		if (!GUILD_COMMAND_TEMPLATE_TAGS.includes(name)) delete engine.tags[name];
	}
	for (const name of Object.keys(engine.filters)) {
		if (!GUILD_COMMAND_TEMPLATE_FILTERS.includes(name)) delete engine.filters[name];
	}
	engine.registerTag('capture', CountedCaptureTag);
	engine.registerTag('random', RandomTag);
	engine.registerFilter('one_of', oneOf);
	engine.registerFilter('plural', plural);
	engine.registerFilter('ordinal', ordinal);
	return engine;
}

/** liquidjs's English errors, as the codes the editors translate. Its wording is pinned by the tests. */
function describeTemplateProblem(error: unknown, otherwise: 'invalid' | 'failed'): GuildCommandTemplateIssue {
	const text = error instanceof Error ? error.message : '';
	const [line, column] = LiquidError.is(error) ? error.token.getPosition() : [null, null];
	const issue = (code: GuildCommandTemplateIssue['code'], name: string | null = null): GuildCommandTemplateIssue => ({
		code,
		line,
		column,
		name,
	});
	const unknownTag = /^tag "([^"]+)" not found/.exec(text);
	if (unknownTag) return issue('unknown_tag', unknownTag[1]);
	const unknownFilter = /^undefined filter: (\S+?),? /.exec(`${text} `);
	if (unknownFilter) return issue('unknown_filter', unknownFilter[1]);
	const notClosed = /^(?:tag|output|raw) "?(.+?)"? not closed/s.exec(text);
	if (notClosed) return issue('not_closed', notClosed[1]);
	if (text.startsWith('parse length limit exceeded')) return issue('too_long');
	if (text.startsWith('memory alloc limit exceeded') || text.startsWith('Invalid string length')) {
		return issue('too_large');
	}
	if (text.startsWith('template render limit exceeded')) return issue('too_slow');
	return issue(otherwise);
}

export class GuildCommandTemplateEngine {
	private readonly engine = createEngine();
	private readonly parsed = new Map<string, Array<Template>>();

	/** Parses the template, throwing `GuildCommandTemplateError` when it is not valid. */
	validate(template: string): void {
		this.parse(template);
	}

	/** The filled-in message, without the spacing that tags on lines of their own leave around it. */
	render(template: string, scope: GuildCommandScope): string {
		const parsed = this.parse(template);
		let output: string;
		try {
			output = String(this.engine.renderSync(parsed, scope));
		} catch (error) {
			throw new GuildCommandTemplateError(describeTemplateProblem(error, 'failed'));
		}
		// Plain outputs are not counted as they are written, and trimming copies the text.
		if (output.length > MEMORY_LIMIT) {
			throw new GuildCommandTemplateError({code: 'too_large', line: null, column: null, name: null});
		}
		return output.trim();
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
			throw new GuildCommandTemplateError(describeTemplateProblem(error, 'invalid'));
		}
		this.parsed.set(template, parsed);
		if (this.parsed.size > PARSED_CACHE_SIZE) {
			const oldest = this.parsed.keys().next().value;
			if (oldest !== undefined) this.parsed.delete(oldest);
		}
		return parsed;
	}
}
