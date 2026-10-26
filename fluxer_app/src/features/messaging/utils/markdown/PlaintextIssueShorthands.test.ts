// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: issue shorthands (`tyne/101`) are links in the web's tree and read as typed in plaintext
// (notifications, copied text).

import {describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => ({
	msg: (descriptor: unknown) => descriptor,
}));
vi.mock('@app/features/expressions/utils/EmojiUtils', () => ({
	getEmojiURL: () => null,
}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {getUser: () => null},
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {getCachedMessages: () => null},
}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {getChannel: () => null},
}));

const {parseAndRenderToPlaintext} = await import('@app/features/messaging/utils/markdown/Plaintext');
const {ParserFlags} = await import('@app/features/messaging/utils/markdown/parser/Enums');
const {WasmParser} = await import('@app/features/messaging/utils/markdown/parser/WasmParser');

const FLAGS = ParserFlags.ALLOW_AUTOLINKS | ParserFlags.ALLOW_MASKED_LINKS;

const render = (content: string, options: {preserveMarkdown?: boolean; includeLinkUrls?: boolean}) =>
	parseAndRenderToPlaintext(content, FLAGS, {
		channelId: 'c1',
		...options,
		i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? ''} as never,
	});

describe('issue shorthands on the web', () => {
	it('parse to a link shown as typed', () => {
		expect(new WasmParser('see tyne-tools/14', FLAGS).parse().nodes).toEqual([
			{type: 'Text', content: 'see '},
			{
				type: 'Link',
				url: 'https://github.com/tyne-chat/tyne-tools/issues/14',
				escaped: false,
				text: {type: 'Text', content: 'tyne-tools/14'},
			},
		]);
	});

	it('stay as typed in notifications, which keep markdown', () => {
		expect(render('see tyne/101.', {preserveMarkdown: true})).toBe('see tyne/101.');
	});

	it('stay as typed in copied text, which spells out link URLs', () => {
		expect(render('see tyne/101', {includeLinkUrls: true})).toBe('see tyne/101');
	});

	it('leave other links as upstream renders them', () => {
		expect(render('[tyne/101](https://example.com/a)', {preserveMarkdown: true})).toBe(
			'[tyne/101](https://example.com/a)',
		);
	});
});
