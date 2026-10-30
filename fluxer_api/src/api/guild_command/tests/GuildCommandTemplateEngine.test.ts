// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildCommandTemplateError} from '@app/api/guild_command/GuildCommandErrors';
import {
	classifyGuildCommandTemplate,
	escapeGuildCommandName,
	GuildCommandChannelDrop,
	GuildCommandMentionDrop,
	type GuildCommandScope,
	GuildCommandTemplateEngine,
} from '@app/api/guild_command/GuildCommandTemplateEngine';
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

	it('refuses unknown filters', () => {
		expect(() => engine.validate('{{ input | nosuch }}')).toThrow(GuildCommandTemplateError);
	});

	it('stops a template that doubles its output on every line', () => {
		const doubling = `{% assign x = "ab" %}${'{% assign x = x | append: x %}'.repeat(40)}{{ x | size }}`;
		expect(() => engine.render(doubling, scope())).toThrow(GuildCommandTemplateError);
	});

	it('does not let a template reach into the scope objects', () => {
		expect(() => engine.render('{{ person.constructor }}', scope())).toThrow(GuildCommandTemplateError);
		expect(engine.render('{{ input.constructor }}|{{ community.constructor }}', scope())).toBe('|');
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
