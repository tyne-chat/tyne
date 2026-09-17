// SPDX-License-Identifier: AGPL-3.0-or-later

import {personaMentionStyle} from '@app/features/persona/utils/PersonaMentionStyle';
import {describe, expect, it} from 'vitest';

describe('personaMentionStyle', () => {
	it('colours the mention with the persona colour, the fill a tenth of it', () => {
		expect(personaMentionStyle(0xff8800)).toEqual({
			'--text-link': '#ff8800',
			'--markup-mention-fill': 'rgba(255, 136, 0, 0.1)',
			'--markup-interactive-hover-fill': 'rgba(255, 136, 0, 0.2)',
		});
	});

	it('leaves a persona without a colour to the usual mention colours', () => {
		expect(personaMentionStyle(null)).toBeUndefined();
		expect(personaMentionStyle(undefined)).toBeUndefined();
		expect(personaMentionStyle(0)).toBeUndefined();
	});
});
