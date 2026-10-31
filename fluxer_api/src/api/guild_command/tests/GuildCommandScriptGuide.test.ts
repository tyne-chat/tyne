// SPDX-License-Identifier: AGPL-3.0-or-later

import {readFileSync} from 'node:fs';
import {GuildCommandTemplateError} from '@app/api/guild_command/GuildCommandErrors';
import {
	GuildCommandChannelDrop,
	GuildCommandMentionDrop,
	type GuildCommandScope,
	GuildCommandTemplateEngine,
} from '@app/api/guild_command/GuildCommandTemplateEngine';
import {
	GUILD_COMMAND_TEMPLATE_FILTERS,
	GUILD_COMMAND_TEMPLATE_TAGS,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {describe, expect, it} from 'vitest';

// People and LLMs write scripts from docs/server-command-scripts.md, and much of what it warns about
// fails silently, so what it says is tested: its `template` → `result` pairs, its code blocks, and
// the claims in its prose.

const GUIDE = readFileSync(new URL('../../../../../docs/server-command-scripts.md', import.meta.url), 'utf8');

const PAIRS = [...GUIDE.matchAll(/`((?:\{\{|\{%)[^`]*)`\s*→\s*`([^`]*)`/g)].map((match) => ({
	template: match[1]!,
	result: match[2]!,
}));
const BLOCKS = [...GUIDE.matchAll(/```liquid\n([\s\S]*?)```/g)].map((match) => ({block: match[1]!}));
const REFUSED = [...GUIDE.matchAll(/Anything else, such as ([\s\S]*?), is refused/g)].map((match) =>
	[...match[1]!.matchAll(/`([a-z]+)`/g)].map((name) => name[1]!),
);

const ALICE = new GuildCommandMentionDrop('<@111>', 'Alice');
const BOB = new GuildCommandMentionDrop('<@222>', 'Bob');

function scope(overrides: Partial<GuildCommandScope> = {}): GuildCommandScope {
	return {
		person: ALICE,
		input: '',
		target: null,
		channel: new GuildCommandChannelDrop('<#555>', 'general', 'Home'),
		community: {name: 'Home'},
		...overrides,
	};
}

/** What a member could type. */
const INPUTS: Array<Partial<GuildCommandScope>> = [
	{},
	{input: '   '},
	{input: 'rock'},
	{input: '7'},
	{input: '<@222> hello', target: BOB},
	{input: '<@111>', target: ALICE},
];

describe('docs/server-command-scripts.md', () => {
	const engine = new GuildCommandTemplateEngine();

	function problem(run: () => unknown): string {
		try {
			run();
		} catch (error) {
			if (error instanceof GuildCommandTemplateError) return error.issue.code;
			throw error;
		}
		throw new Error('expected a template error');
	}

	it('still has examples for this test to find', () => {
		expect(PAIRS.length).toBeGreaterThan(40);
		expect(BLOCKS.length).toBeGreaterThan(9);
		expect(REFUSED.map((names) => names.length)).toEqual([6, 6]);
	});

	it.each(PAIRS)('$template', ({template, result}) => {
		expect(engine.render(template, scope())).toBe(result);
	});

	it.each(BLOCKS)('$block runs and posts something, whatever is typed', ({block}) => {
		for (const input of INPUTS) {
			// Repeated so random branches turn up.
			for (let run = 0; run < 25; run++) {
				expect(engine.render(block, scope(input), {hugs: 2})).not.toBe('');
			}
		}
	});

	it('names every tag and filter a script may use', () => {
		for (const tag of GUILD_COMMAND_TEMPLATE_TAGS) expect(GUIDE).toContain(`\`${tag}\``);
		for (const filter of GUILD_COMMAND_TEMPLATE_FILTERS) expect(GUIDE).toMatch(new RegExp(`\\b${filter}\\b`));
	});

	it('is right about what is refused when saving', () => {
		const [tags, filters] = REFUSED;
		for (const tag of tags!) expect(problem(() => engine.validate(`{% ${tag} %}`))).toBe('unknown_tag');
		for (const filter of filters!) {
			expect(problem(() => engine.validate(`{{ 1 | ${filter} }}`))).toBe('unknown_filter');
		}
		expect(problem(() => engine.validate('{% if (a or b) and c %}x{% endif %}'))).toBe('invalid');
		expect(problem(() => engine.validate('{% if a %}x{% else if b %}y{% endif %}'))).toBe('invalid');
		expect(problem(() => engine.validate('{% if a %}x{% elif b %}y{% endif %}'))).toBe('unknown_tag');
		expect(problem(() => engine.validate('{{ a ? 1 : 2 }}'))).toBe('invalid');
	});

	it.each<[string, Partial<GuildCommandScope>, string]>([
		['{% if input %}y{% else %}n{% endif %}', {}, 'y'],
		['{% if input != blank %}y{% else %}n{% endif %}', {}, 'n'],
		['{% if input != blank %}y{% else %}n{% endif %}', {input: '  '}, 'n'],
		['{% if target %}y{% else %}n{% endif %}', {}, 'n'],
		['{% if 1 <> 2 %}y{% else %}n{% endif %}', {}, 'n'],
		['{% if 1 <> 1 %}y{% else %}n{% endif %}', {}, 'n'],
		['{% if false and false or true %}y{% else %}n{% endif %}', {}, 'n'],
		['{{ "x" if false }}', {}, 'x'],
		['{% assign a = ["x", "y"] %}[{{ a }}]', {}, '[]'],
		['{% if "1" == 1 %}y{% else %}n{% endif %}', {}, 'n'],
		['{{ input | plus: 0 }}', {input: 'rock'}, '0'],
		['[{{ (1..0) | one_of }}]', {}, '[]'],
		['{{ input | plus: 0 | at_least: 2 | at_most: 1000 }}', {input: 'rock'}, '2'],
		['{% assign l = "a, b" | split: "," %}[{{ l[1] }}]', {}, '[ b]'],
		['{% if person == target %}y{% else %}n{% endif %}', {target: new GuildCommandMentionDrop('<@111:9>', 'Al')}, 'n'],
		['{% assign input = "x" %}{{ input }}', {input: 'y'}, 'x'],
		['[{{ user }}{{ author }}{{ args }}{{ count }}{{ now }}]', {}, '[]'],
		['[{{ "  " | default: "x" }}]', {}, '[  ]'],
		['{{ false | default: "x" }}', {}, 'x'],
		[
			'{% assign rest = input | remove: target | strip %}{{ rest }}[{{ rest.name }}]',
			{input: '<@222> <@3>', target: BOB},
			'<@3>[]',
		],
		['- {{ input | split: "," | join: "\\n- " }}', {input: 'a,b'}, '- a\n- b'],
		['{{ input | split: " " | slice: 1, 999 | join: " " }}', {input: 'a b c'}, 'b c'],
		[
			'{% if target %}{% assign who = target %}{% else %}{% assign who = person %}{% endif %}{{ who.name }}',
			{target: BOB},
			'Bob',
		],
		[
			'{% if target %}{% assign who = target %}{% else %}{% assign who = person %}{% endif %}{{ who.name }}',
			{},
			'Alice',
		],
		['{% assign name = target.name | default: person.name %}{{ name }}', {target: BOB}, 'Bob'],
		['{% assign name = target.name | default: person.name %}{{ name }}', {}, 'Alice'],
		['{{ "not a date" | date: "%Y" }}', {}, 'not a date'],
		['{{ "Dec 25 2026" | date: "%A" }}', {}, 'Friday'],
		['{{ 1798156800 | date: "%Y" }}', {}, '2026'],
		['{{ "2026-03-05T14:07:09Z" | date: "%-d%q %B", "UTC" }}', {}, '5th March'],
		['{{ "2026-03-05T14:07:09Z" | date: "%F %T %D %R %r" }}', {}, '%F %T %D %R %r'],
	])('%s', (template, input, result) => {
		expect(engine.render(template, scope(input))).toBe(result);
	});

	it('is right that a wrong time zone name fails', () => {
		expect(problem(() => engine.render('{{ "now" | date: "%H", "Nowhere/Fake" }}', scope()))).toBe('failed');
	});
});
