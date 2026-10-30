// SPDX-License-Identifier: AGPL-3.0-or-later

import {CompletionContext, type CompletionResult} from '@codemirror/autocomplete';
import {EditorState} from '@codemirror/state';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const search = vi.hoisted(() => vi.fn());
vi.mock('@app/features/emoji/state/Emoji', () => ({default: {search}}));

import {guildCommandEmojiCompletions} from '@app/features/guild_commands/utils/GuildCommandEmojiCompletions';

const CHANNEL = {id: 'c'} as never;

/** What is offered with the cursor at the `|^` in `text`, and what the query was. */
async function complete(text: string): Promise<CompletionResult | null> {
	const pos = text.indexOf('|^');
	const doc = text.replace('|^', '');
	const context = new CompletionContext(EditorState.create({doc}), pos, false);
	return (await guildCommandEmojiCompletions(CHANNEL)(context)) as CompletionResult | null;
}

describe('emoji in the command script editor', () => {
	beforeEach(() => {
		search.mockReset();
		search.mockReturnValue([
			{uniqueName: 'heart', url: 'https://cdn/heart.svg', surrogates: '❤️'},
			{uniqueName: 'tuck', url: 'https://cdn/tuck.webp'},
		]);
	});

	it('suggests emoji from the message box search, by the name that is saved', async () => {
		const result = await complete('# hello :he|^');
		expect(search).toHaveBeenCalledWith(CHANNEL, 'he', 20);
		expect(result?.options.map((option) => option.label)).toEqual([':heart:', ':tuck:']);
		expect(result?.from).toBe(8);
	});

	it("works at the start of a line, and inside a tag's text", async () => {
		expect(await complete(':he|^')).not.toBeNull();
		expect(await complete('{% random %}:he|^')).not.toBeNull();
		expect(await complete('{{ "warm" | append: ":he|^')).not.toBeNull();
	});

	it.each([
		['one character', 'hi :h|^'],
		['the end of a word', 'note:he|^'],
		['a time', '{{ "now" | date: "%H:%M|^'],
		['a filter argument', '{{ input | append:"x|^'],
		['after a closed shortcode', ':heart:he|^'],
		['a space after the colon', 'hi: he|^'],
	])('stays out of the way for %s', async (_name, text) => {
		expect(await complete(text)).toBeNull();
		expect(search).not.toHaveBeenCalled();
	});

	it('offers nothing when the search finds nothing', async () => {
		search.mockReturnValue([]);
		expect(await complete(':nosuch|^')).toBeNull();
	});
});
