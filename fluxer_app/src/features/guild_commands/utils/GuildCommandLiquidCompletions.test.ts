// SPDX-License-Identifier: AGPL-3.0-or-later

import {guildCommandLiquidCompletions} from '@app/features/guild_commands/utils/GuildCommandLiquidCompletions';
import {CompletionContext} from '@codemirror/autocomplete';
import {EditorState} from '@codemirror/state';
import {describe, expect, it} from 'vitest';

/** The labels offered with the cursor at the `|` in `text`. */
function labels(text: string, explicit = false): Array<string> | null {
	const pos = text.indexOf('|^');
	const doc = text.replace('|^', '');
	const result = guildCommandLiquidCompletions(new CompletionContext(EditorState.create({doc}), pos, explicit));
	return result ? result.options.map((option) => option.label) : null;
}

describe('command script suggestions', () => {
	it('offers nothing outside a tag or an output', () => {
		expect(labels('hello |^')).toBeNull();
		expect(labels('{{ person }} he|^')).toBeNull();
		expect(labels('{% if target %}he|^')).toBeNull();
	});

	it('offers the allowed tags, and never the removed ones', () => {
		const tags = labels('{% |^');
		expect(tags).toEqual(expect.arrayContaining(['if', 'assign', 'random', 'or', 'endrandom', 'else']));
		expect(tags).not.toContain('for');
		expect(tags).not.toContain('render');
		expect(tags).not.toContain('include');
		expect(labels('{%- ra|^')).toContain('random');
	});

	it('offers the variables in outputs and after a tag name', () => {
		expect(labels('{{ |^')).toEqual(['channel', 'community', 'input', 'person', 'target']);
		expect(labels('{{ per|^')).toContain('person');
		expect(labels('{% if tar|^')).toContain('target');
	});

	it("offers the allowed filters after a pipe, the fork's included", () => {
		const filters = labels('{{ input | |^');
		expect(filters).toEqual(expect.arrayContaining(['upcase', 'one_of', 'plural', 'ordinal']));
		expect(filters).not.toContain('where_exp');
		expect(labels('{{ input | up|^')).toContain('upcase');
	});

	it('offers the properties of each variable', () => {
		expect(labels('{{ person.|^')).toEqual(['name']);
		expect(labels('{{ channel.|^')).toEqual(['name', 'community']);
		expect(labels('{{ channel.community.|^')).toEqual(['name']);
		expect(labels('{{ input.|^')).toBeNull();
	});
});
