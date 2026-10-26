// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: issue shorthands unfurl like the issue's URL, matched as the parser links them
// (packages/markdown_parser/rust/src/fork_issue_links.rs).

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandForkIssueShorthands} from '@app/api/utils/ForkIssueShorthands';
import {extractURLs} from '@app/api/utils/UnfurlerUtils';
import {URL_REGEX} from '@fluxer/constants/src/Core';
import {describe, expect, it} from 'vitest';

const CASES_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../packages/markdown_parser/rust/tests/fork_issue_shorthand_cases.json',
);

interface ShorthandCase {
	input: string;
	links: Array<string>;
}

const {cases} = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8')) as {cases: Array<ShorthandCase>};

const issue = (number: number) => `https://github.com/tyne-chat/tyne/issues/${number}`;

describe('expandForkIssueShorthands', () => {
	it.each(cases)('expands the tyne shorthands the parser links in $input', ({input, links}) => {
		const expected = links
			.filter((link) => link.startsWith('tyne/'))
			.map((link) => `https://github.com/tyne-chat/${link.replace('/', '/issues/')}`);
		expect(expandForkIssueShorthands(input).match(URL_REGEX) ?? []).toEqual(expected);
	});
});

describe('extractURLs with issue shorthands', () => {
	it('unfurls a shorthand without the punctuation after it', () => {
		expect(extractURLs('fixed in tyne/101.')).toEqual([issue(101)]);
		expect(extractURLs('(tyne/101)')).toEqual([issue(101)]);
	});

	it('does not unfurl tyne-tools shorthands, whose issues are private', () => {
		expect(extractURLs('tyne-tools/14')).toEqual([]);
	});

	it('skips shorthands in code and in masked link text', () => {
		expect(extractURLs('`tyne/101`')).toEqual([]);
		expect(extractURLs('```\ntyne/101\n```')).toEqual([]);
		expect(extractURLs('[tyne/101](https://example.com/a)')).toEqual(['https://example.com/a']);
	});

	it('leaves a shorthand inside a URL alone', () => {
		expect(extractURLs('https://example.com/?q=tyne/1')).toEqual(['https://example.com/?q=tyne/1']);
	});

	it('keeps the message order and drops repeats', () => {
		expect(extractURLs(`https://example.com/a tyne/101 ${issue(101)} ||tyne/102||`)).toEqual([
			'https://example.com/a',
			issue(101),
			issue(102),
		]);
	});
});
