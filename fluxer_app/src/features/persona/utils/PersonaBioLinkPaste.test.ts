// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {pasteLinkOverSelection} from '@app/features/persona/utils/PersonaBioLinkPaste';
import type React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

const URL_TEXT = 'https://pluralpedia.org/wiki/Headmate';

function paste(value: string, start: number, end: number, clipboard: string, maxLength = 4096) {
	const input = document.createElement('textarea');
	input.maxLength = maxLength;
	input.value = value;
	document.body.append(input);
	input.setSelectionRange(start, end);
	const preventDefault = vi.fn();
	pasteLinkOverSelection({
		currentTarget: input,
		clipboardData: {getData: () => clipboard},
		preventDefault,
	} as unknown as React.ClipboardEvent<HTMLTextAreaElement>);
	return {value: input.value, handled: preventDefault.mock.calls.length > 0};
}

describe('pasteLinkOverSelection', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it('turns the selected text into a Markdown link to the pasted address', () => {
		expect(paste('see my headmate here', 7, 15, URL_TEXT)).toEqual({
			value: `see my [headmate](<${URL_TEXT}>) here`,
			handled: true,
		});
	});

	it('leaves a paste with nothing selected to the browser', () => {
		expect(paste('see', 3, 3, URL_TEXT)).toEqual({value: 'see', handled: false});
	});

	it('leaves pasted text that is not a link to the browser', () => {
		expect(paste('see my headmate', 7, 15, 'not a link')).toEqual({value: 'see my headmate', handled: false});
	});

	it('leaves a link pasted over another link to the browser', () => {
		expect(paste(URL_TEXT, 0, URL_TEXT.length, 'https://example.com/').handled).toBe(false);
	});

	it('leaves a paste the length limit has no room for to the browser', () => {
		expect(paste('see my headmate', 7, 15, URL_TEXT, 30).handled).toBe(false);
	});
});
