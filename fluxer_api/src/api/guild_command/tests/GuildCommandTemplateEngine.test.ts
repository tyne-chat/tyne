// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildCommandTemplateError} from '@app/api/guild_command/GuildCommandErrors';
import {
	escapeGuildCommandName,
	GuildCommandChannelDrop,
	GuildCommandMentionDrop,
	type GuildCommandScope,
	GuildCommandTemplateEngine,
} from '@app/api/guild_command/GuildCommandTemplateEngine';
import {
	classifyGuildCommandTemplate,
	GUILD_COMMAND_TEMPLATE_FILTERS,
	GUILD_COMMAND_TEMPLATE_TAGS,
	type GuildCommandTemplateIssue,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {describe, expect, it} from 'vitest';

function scope(overrides: Partial<GuildCommandScope> = {}): GuildCommandScope {
	return {
		person: new GuildCommandMentionDrop('<@1:2>', 'Chiara'),
		input: '<@3> please',
		target: new GuildCommandMentionDrop('<@3>', 'Yami'),
		channel: new GuildCommandChannelDrop('<#4>', 'general', 'The Temple'),
		community: {name: 'The Temple'},
		...overrides,
	};
}

describe('GuildCommandTemplateEngine', () => {
	const engine = new GuildCommandTemplateEngine();

	function problem(run: () => unknown): GuildCommandTemplateIssue {
		try {
			run();
		} catch (error) {
			if (error instanceof GuildCommandTemplateError) return error.issue;
			throw error;
		}
		throw new Error('expected a template error');
	}

	it('prints people as mentions and gives their escaped names', () => {
		expect(engine.render('{{ person }} tucks {{ input }}', scope())).toBe('<@1:2> tucks <@3> please');
		expect(engine.render('{{ person.name }}, {{ target.name }}', scope())).toBe('Chiara, Yami');
		expect(engine.render('{{ channel }} {{ channel.name }} {{ channel.community.name }}', scope())).toBe(
			'<#4> general The Temple',
		);
	});

	it('compares people by their mentions', () => {
		const self = scope({target: new GuildCommandMentionDrop('<@1:2>', 'Chiara')});
		const template = '{% if person == target %}self{% else %}other{% endif %}';
		expect(engine.render(template, self)).toBe('self');
		expect(engine.render(template, scope())).toBe('other');
	});

	it('treats a missing target as false and prints nothing for it', () => {
		const none = scope({target: null});
		expect(engine.render('{% if target %}yes{% else %}no{% endif %}', none)).toBe('no');
		expect(engine.render('[{{ target }}][{{ target.name }}]', none)).toBe('[][]');
	});

	it.each([
		'{% for i in (1..3) %}{{ i }}{% endfor %}',
		'{% tablerow i in (1..3) %}{{ i }}{% endtablerow %}',
		"{% include 'other' %}",
		"{% render 'other' %}",
		"{% layout 'other' %}",
		'{% increment n %}',
		'{% cycle "a", "b" %}',
	])('refuses removed tags: %s', (template) => {
		expect(() => engine.validate(template)).toThrow(GuildCommandTemplateError);
	});

	it.each(['where_exp', 'group_by', 'map', 'sha256', 'json', 'inspect', 'base64_decode', 'sample'])(
		'refuses the filter %s',
		(name) => {
			expect(problem(() => engine.validate(`{{ input | ${name} }}`))).toMatchObject({
				code: 'unknown_filter',
				name,
			});
		},
	);

	it('has every filter and tag the editors suggest', () => {
		for (const name of GUILD_COMMAND_TEMPLATE_FILTERS) {
			expect(problem(() => engine.validate(`{{ input | ${name} }}{% nosuch %}`)).code, name).toBe('unknown_tag');
		}
		for (const name of GUILD_COMMAND_TEMPLATE_TAGS) {
			const template = `{% ${name} x %}`;
			expect(() => engine.validate(template), name).not.toThrow(/not found/);
		}
	});

	it('keeps the tags and filters scripts are written with', () => {
		const template = `
			{% assign shout = input | upcase | truncate: 8, "" %}
			{% capture greeting %}{{ shout | append: "!" }}{% endcapture %}
			{% unless target %}nobody{% endunless %}
			{% case person.name %}{% when "Chiara" %}hi{% else %}who{% endcase %}
			{% if input contains "please" %}{{ greeting }}{% endif %}
			{%- comment %}gone{% endcomment -%}
			{% # also gone %}
			{% raw %}{{ left alone }}{% endraw %}
			{{ "a,b" | split: "," | reverse | join: "-" }} {{ 7 | plus: 3 | divided_by: 2 }}
			{% liquid
				echo "done"
			%}`;
		expect(engine.render(template, scope()).replace(/\s+/g, ' ')).toBe('hi <@3> PLE! {{ left alone }} b-a 5 done');
	});

	it('keeps a person through default, with their name', () => {
		const template = '{% assign who = target | default: person %}{{ who }} {{ who.name }}';
		expect(engine.render(template, scope())).toBe('<@3> Yami');
		expect(engine.render(template, scope({target: null}))).toBe('<@1:2> Chiara');
	});

	it('still falls back from an empty channel with default', () => {
		const channel = new GuildCommandChannelDrop('', '', null);
		expect(engine.render('{{ channel | default: "here" }}', scope({channel}))).toBe('here');
	});

	it('trims the spacing left by tags on lines of their own', () => {
		const template = `{% if target %}
{{ person }} hugs {{ target }}
{% else %}
{{ person }} hugs the air
{% endif %}
`;
		expect(engine.render(template, scope())).toBe('<@1:2> hugs <@3>');
	});

	it('picks one branch of random, without the spacing around it', () => {
		const template = `{% random %}
# one
{% or %}
# two
{% or %}
# three
{% endrandom %}`;
		const seen = new Set(Array.from({length: 200}, () => engine.render(template, scope())));
		expect([...seen].sort()).toEqual(['# one', '# three', '# two']);
	});

	it('renders what is inside a random branch', () => {
		const template = '{% random %}{{ person }} {% if target %}yes{% else %}no{% endif %}{% endrandom %}';
		expect(engine.render(template, scope())).toBe('<@1:2> yes');
	});

	it('picks one of the values with one_of, from arguments or a list', () => {
		const pick = (template: string) =>
			[...new Set(Array.from({length: 200}, () => engine.render(template, scope())))].sort();
		expect(pick('{{ "warm" | one_of: "gentle", "big" }}')).toEqual(['big', 'gentle', 'warm']);
		expect(pick('{{ "a,b" | split: "," | one_of }}')).toEqual(['a', 'b']);
	});

	it.each([
		[0, '0 times'],
		[1, '1 time'],
		[2, '2 times'],
		[21, '21 times'],
	])('picks the word for %s with plural', (count, expected) => {
		expect(engine.render(`{{ n }} {{ n | plural: "time", "times" }}`, {...scope(), n: count} as never)).toBe(expected);
	});

	it.each([
		[1, '1st'],
		[2, '2nd'],
		[3, '3rd'],
		[4, '4th'],
		[11, '11th'],
		[12, '12th'],
		[13, '13th'],
		[21, '21st'],
		[102, '102nd'],
		['5', '5th'],
		['many', 'many'],
		['', ''],
		[1.5, '1.5'],
	])('writes %s with ordinal', (value, expected) => {
		expect(engine.render('{{ n | ordinal }}', {...scope(), n: value} as never)).toBe(expected);
	});

	it('leaves a missing value empty with ordinal', () => {
		expect(engine.render('[{{ nothing | ordinal }}]', scope())).toBe('[]');
	});

	it('reports what is wrong and where', () => {
		expect(problem(() => engine.validate('line one\n  {% nosuch %}'))).toEqual({
			code: 'unknown_tag',
			line: 2,
			column: 3,
			name: 'nosuch',
		});
		expect(problem(() => engine.validate('\n\n{{ input | nosuch: 1 }}'))).toMatchObject({
			code: 'unknown_filter',
			line: 3,
			name: 'nosuch',
		});
		expect(problem(() => engine.validate('{% if target %}open'))).toMatchObject({
			code: 'not_closed',
			line: 1,
			name: '{% if target %}',
		});
		expect(problem(() => engine.validate('{% random %}open'))).toMatchObject({
			code: 'not_closed',
			name: '{% random %}',
		});
		expect(problem(() => engine.validate('{{ input'))).toMatchObject({code: 'not_closed', name: '{{ input'});
		expect(problem(() => engine.validate('{% or %}'))).toMatchObject({code: 'unknown_tag', name: 'or'});
		expect(problem(() => engine.validate('{% if %}x{% endif %}'))).toMatchObject({code: 'invalid', line: 1});
		expect(problem(() => engine.validate('x'.repeat(4001)))).toMatchObject({code: 'too_long'});
	});

	it('reports a problem while running with its position', () => {
		expect(problem(() => engine.render('ok\n{{ person.constructor }}', scope()))).toMatchObject({
			code: 'failed',
			line: 2,
		});
	});

	it('stops a template that doubles its output on every line', () => {
		const doubling = `{% assign x = "ab" %}${'{% assign x = x | append: x %}'.repeat(40)}{{ x | size }}`;
		expect(problem(() => engine.render(doubling, scope()))).toMatchObject({code: 'too_large'});
	});

	it('counts what capture stores, so levels of repeats stop early', () => {
		let template = '{% capture a0 %}0123456789{% endcapture %}';
		for (let level = 1; level <= 7; level++) {
			template += `{% capture a${level} %}${`{{ a${level - 1} }}`.repeat(10)}{% endcapture %}`;
		}
		expect(problem(() => engine.render(`${template}{{ a7 | slice: 0, 1 }}`, scope()))).toMatchObject({
			code: 'too_large',
		});
	});

	it('counts what a random branch builds', () => {
		const inner = '{{x}}'.repeat(300);
		const template = `{% assign x = "0123456789" %}{% capture x %}${inner}{% endcapture %}{% random %}${inner}{% endrandom %}`;
		expect(problem(() => engine.render(template, scope()))).toMatchObject({code: 'too_large'});
	});

	it('refuses an output too big to be a message, without building it', () => {
		const big = `{% assign x = "0123456789" %}${'{% assign x = x | append: x %}'.repeat(9)}${'{{x}}'.repeat(600)}`;
		expect(problem(() => engine.render(big, scope()))).toMatchObject({code: 'too_large', line: null});
	});

	it('refuses a range too long to build', () => {
		expect(problem(() => engine.render('{% assign r = (1..100000000) %}', scope()))).toMatchObject({code: 'too_large'});
	});

	it('runs the worst lists of its filters quickly', () => {
		const list = `{% assign x = "ab" %}${'{% assign x = x | append: x %}'.repeat(13)}`;
		const start = performance.now();
		engine.render(`${list}{{ x | split: "" | sort | uniq | size }}`, scope());
		expect(performance.now() - start).toBeLessThan(200);
	});

	it('does not let an assignment reach beyond the render', () => {
		engine.render('{% assign __proto__ = "a,b" | split: "," %}{% capture constructor %}x{% endcapture %}', scope());
		expect(({} as Record<string, unknown>).length).toBeUndefined();
		expect(engine.render('[{{ length }}][{{ first }}]', scope())).toBe('[][]');
	});

	it('does not count one template against the next', () => {
		const big = 'x'.repeat(3000);
		for (let i = 0; i < 5; i++) expect(engine.render(`${big}{% assign n = ${i} %}`, scope())).toBe(big);
	});

	it('does not let a template reach into the scope objects', () => {
		expect(() => engine.render('{{ person.constructor }}', scope())).toThrow(GuildCommandTemplateError);
		expect(engine.render('{{ input.constructor }}|{{ community.constructor }}', scope())).toBe('|');
		expect(() => engine.render('{{ person.__proto__.constructor }}', scope())).toThrow(GuildCommandTemplateError);
		expect(() => engine.render('{{ person.__proto__.__proto__.constructor }}', scope())).toThrow(
			GuildCommandTemplateError,
		);
		expect(engine.render('[{{ person.__proto__.__proto__.__proto__ }}]', scope())).toBe('[]');
		expect(engine.render('[{{ person.valueOf.constructor }}]', scope())).toBe('[]');
		expect(engine.render('[{{ channel.community.constructor }}]', scope())).toBe('[]');
	});
});

describe('escapeGuildCommandName', () => {
	it('escapes markdown and mention syntax', () => {
		expect(escapeGuildCommandName('a_b*c~d`e|f[g]h<i>j\\k')).toBe('a\\_b\\*c\\~d\\`e\\|f\\[g\\]h\\<i\\>j\\\\k');
	});

	it('escapes a heading, quote or list marker at the start', () => {
		expect(escapeGuildCommandName('# Big')).toBe('\\# Big');
		expect(escapeGuildCommandName('> quote')).toBe('\\> quote');
		expect(escapeGuildCommandName('- item')).toBe('\\- item');
	});

	it('keeps a name from becoming @everyone or @here', () => {
		expect(escapeGuildCommandName('@everyone')).toBe('@\u200Beveryone');
	});
});

describe('classifyGuildCommandTemplate', () => {
	it.each([
		['# **{{ person }} tucks {{ input }} in to sleep!**', 'basic'],
		['{{person}}{{  input  }}', 'basic'],
		['plain text', 'basic'],
		['{{ person.name }}', 'script'],
		['{{ input | upcase }}', 'script'],
		['{% if target %}x{% endif %}', 'script'],
		['{{ target }}', 'script'],
	] as const)('%s is %s', (template, kind) => {
		expect(classifyGuildCommandTemplate(template)).toBe(kind);
	});
});
