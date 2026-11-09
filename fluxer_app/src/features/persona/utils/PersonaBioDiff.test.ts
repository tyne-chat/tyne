// SPDX-License-Identifier: AGPL-3.0-or-later

import {diffBios} from '@app/features/persona/utils/PersonaBioDiff';
import {describe, expect, it} from 'vitest';

describe('marking what two bios do not share', () => {
	it('marks only an added sentence, and the words that changed on each side', () => {
		expect(diffBios('Keeps the log. Hates fog.', 'Keeps the log.')).toEqual({
			file: [
				{text: 'Keeps the log. ', changed: false},
				{text: 'Hates fog.', changed: true},
			],
			tyne: [{text: 'Keeps the log.', changed: false}],
		});
		const changed = diffBios('I like pink a lot', 'I like blue a lot');
		expect(changed?.file.filter((part) => part.changed).map((part) => part.text)).toEqual(['pink']);
		expect(changed?.tyne.filter((part) => part.changed).map((part) => part.text)).toEqual(['blue']);
	});

	it('keeps line breaks in the text and marks a changed phrase as one part', () => {
		const result = diffBios('Name: Wren\nAge: 30', 'Name: Wren\nAge: thirty one');
		expect(result?.file.map((part) => part.text).join('')).toBe('Name: Wren\nAge: 30');
		expect(result?.tyne.filter((part) => part.changed).map((part) => part.text)).toEqual(['thirty one']);
	});

	it('gives up on bios too long to compare', () => {
		const long = 'word '.repeat(2000);
		expect(diffBios(long, long)).toBeNull();
	});
});
