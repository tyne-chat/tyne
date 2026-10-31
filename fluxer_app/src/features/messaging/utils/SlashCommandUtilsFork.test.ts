// SPDX-License-Identifier: AGPL-3.0-or-later

import {detectAutocompleteTrigger} from '@app/features/messaging/utils/SlashCommandUtils';
import {describe, expect, it} from 'vitest';

// Fork: built-in names carry their slash, so `//` used to search for `/` and list every command
// (tyne-chat/tyne#278).
describe('command trigger', () => {
	it.each(['/', '/h', '/hug', '  /hug', '/tuck-in'])('opens the list for %j', (text) => {
		expect(detectAutocompleteTrigger(text)?.type).toBe('command');
	});

	it('searches for the text after the slash', () => {
		expect(detectAutocompleteTrigger('/hu')?.matchedText).toBe('hu');
	});

	it.each(['//', '///', '//hug', '/a/b', '/usr/bin', '  //'])('leaves %j as ordinary text', (text) => {
		expect(detectAutocompleteTrigger(text)).toBeNull();
	});

	it('still finds a mention later in a message that starts with two slashes', () => {
		expect(detectAutocompleteTrigger('// ask @ali')?.type).toBe('mention');
	});

	it.each([
		['/gif cat', 'gif'],
		['/klipy cat', 'gif'],
		['/sticker cat', 'sticker'],
		['/saved cat', 'meme'],
	])('leaves the search for %j alone', (text, type) => {
		expect(detectAutocompleteTrigger(text)?.type).toBe(type);
	});
});
