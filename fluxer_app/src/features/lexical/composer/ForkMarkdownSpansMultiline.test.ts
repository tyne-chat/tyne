// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: inline formatting (`**...**`, `*...*`, `***...***`, `__...__`, `~~...~~`) spans blank
// lines in the WASM parser and aligns cleanly in the live composer highlighter (tyne-chat/tyne#641).

import {
	computeMarkdownHighlightSpans,
	DEFAULT_COMPOSER_MARKDOWN_FLAGS,
	MarkdownHl,
	splitSpansByLine,
} from '@app/features/lexical/composer/markdownSpans';
import {initializeEmojiParser} from '@app/features/messaging/utils/markdown/EmojiProviderSetup';
import {parseMarkdownAstWithWasm} from '@app/features/messaging/utils/markdown/parser/MarkdownParserWasm';
import {beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/expressions/utils/EmojiUtils', () => ({
	getEmojiURL: () => null,
}));

vi.mock('@lingui/core/macro', () => ({
	msg: (descriptor: unknown) => descriptor,
}));

function describeSpans(source: string) {
	return computeMarkdownHighlightSpans(source, DEFAULT_COMPOSER_MARKDOWN_FLAGS).map((span) => [
		source.slice(span.start, span.end),
		span.role,
		span.format,
	]);
}

function expectFullCoverage(source: string) {
	const spans = computeMarkdownHighlightSpans(source, DEFAULT_COMPOSER_MARKDOWN_FLAGS);
	let cursor = 0;
	for (const span of spans) {
		expect(span.start).toBe(cursor);
		expect(span.end).toBeGreaterThan(span.start);
		cursor = span.end;
	}
	expect(cursor).toBe(source.length);
}

describe('multiline formatting across blank lines (WASM + composer spans)', () => {
	beforeAll(() => {
		initializeEmojiParser();
	});

	it('parses bold across blank lines and keeps emoji offsets aligned', () => {
		expect(
			parseMarkdownAstWithWasm('**Test sentence one\n\nTest sentence 2**', DEFAULT_COMPOSER_MARKDOWN_FLAGS),
		).toEqual({
			nodes: [{type: 'Strong', children: [{type: 'Text', content: 'Test sentence one\n\nTest sentence 2'}]}],
		});

		expect(parseMarkdownAstWithWasm('**a\n   \n😄**', DEFAULT_COMPOSER_MARKDOWN_FLAGS)).toEqual({
			nodes: [
				{
					type: 'Strong',
					children: [
						{type: 'Text', content: 'a\n\n'},
						{type: 'Emoji', kind: {kind: 'Standard', raw: '😄', codepoints: '1f604', name: 'smile'}},
					],
				},
			],
		});
	});

	it('highlights bold across blank lines in the composer without desyncing', () => {
		const source = '**Test sentence one\n\nTest sentence 2**';
		expect(describeSpans(source)).toEqual([
			['**', 'marker', MarkdownHl.bold],
			['Test sentence one\n\nTest sentence 2', 'content', MarkdownHl.bold],
			['**', 'marker', MarkdownHl.bold],
		]);

		const lines = source.split('\n');
		const perLine = splitSpansByLine(computeMarkdownHighlightSpans(source, DEFAULT_COMPOSER_MARKDOWN_FLAGS), lines);
		expect(perLine[0]).toEqual([
			{start: 0, end: 2, role: 'marker', format: MarkdownHl.bold},
			{start: 2, end: 19, role: 'content', format: MarkdownHl.bold},
		]);
		expect(perLine[1]).toEqual([]);
		expect(perLine[2]).toEqual([
			{start: 0, end: 15, role: 'content', format: MarkdownHl.bold},
			{start: 15, end: 17, role: 'marker', format: MarkdownHl.bold},
		]);
	});

	it('highlights whitespace-only blank lines and nested formatting across blank lines', () => {
		expect(describeSpans('**line 1\n   \nline 2**')).toEqual([
			['**', 'marker', MarkdownHl.bold],
			['line 1\n   \nline 2', 'content', MarkdownHl.bold],
			['**', 'marker', MarkdownHl.bold],
		]);

		expect(describeSpans('**line 1\n\n*italic*\n\nline 3**')).toEqual([
			['**', 'marker', MarkdownHl.bold],
			['line 1\n\n', 'content', MarkdownHl.bold],
			['*', 'marker', MarkdownHl.bold | MarkdownHl.italic],
			['italic', 'content', MarkdownHl.bold | MarkdownHl.italic],
			['*', 'marker', MarkdownHl.bold | MarkdownHl.italic],
			['\n\nline 3', 'content', MarkdownHl.bold],
			['**', 'marker', MarkdownHl.bold],
		]);
	});

	it('highlights multiline bold inside blockquotes, including spaced blank quote lines', () => {
		const quotedBold = MarkdownHl.blockquote | MarkdownHl.bold;
		const quotePrefix = MarkdownHl.blockquote | MarkdownHl.blockquoteMarker;

		expect(describeSpans('> **line 1\n> \n> line 2**')).toEqual([
			['> ', 'marker', quotePrefix],
			['**', 'marker', quotedBold],
			['line 1\n', 'content', quotedBold],
			['> ', 'marker', quotePrefix],
			['\n', 'content', quotedBold],
			['> ', 'marker', quotePrefix],
			['line 2', 'content', quotedBold],
			['**', 'marker', quotedBold],
		]);

		expect(describeSpans('> **line 1\n>   \n> line 2**')).toEqual([
			['> ', 'marker', quotePrefix],
			['**', 'marker', quotedBold],
			['line 1\n', 'content', quotedBold],
			['> ', 'marker', quotePrefix],
			['  ', 'content', MarkdownHl.blockquote],
			['\n', 'content', quotedBold],
			['> ', 'marker', quotePrefix],
			['line 2', 'content', quotedBold],
			['**', 'marker', quotedBold],
		]);
	});

	it('covers every character cleanly across formatting and block boundaries', () => {
		for (const sample of [
			'**a\n\nb**',
			'**a\n\n\nb**',
			'*a\n\nb*',
			'***a\n\nb***',
			'__a\n\nb__',
			'~~a\n\nb~~',
			'x ||a\n\nb||',
			'**a**\n\n**b**',
			'**a\n\nb**\n\n- item',
			'**a\n\nb**\n\n# Heading',
			'**a\n\n# Heading\n\nb**',
			'>>> **a\n\nb**',
		]) {
			expectFullCoverage(sample);
		}
	});
});
