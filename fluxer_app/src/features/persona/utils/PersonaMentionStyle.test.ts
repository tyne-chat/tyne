// SPDX-License-Identifier: AGPL-3.0-or-later

import {personaMentionStyle} from '@app/features/persona/utils/PersonaMentionStyle';
import {describe, expect, it} from 'vitest';

describe('personaMentionStyle', () => {
	it('colours the mention with the persona colour, the fill a tenth of it', () => {
		expect(personaMentionStyle({color: 0xff8800})).toEqual({
			'--text-link': '#ff8800',
			'--markup-mention-fill': 'rgba(255, 136, 0, 0.1)',
			'--markup-interactive-hover-fill': 'rgba(255, 136, 0, 0.2)',
		});
	});

	it('leaves a persona without a colour to the usual mention colours', () => {
		expect(personaMentionStyle(null)).toBeUndefined();
		expect(personaMentionStyle(undefined)).toBeUndefined();
		expect(personaMentionStyle({color: 0})).toBeUndefined();
		expect(personaMentionStyle({color: null, avatar_color: 0x8f1e1e, avatar: null})).toBeUndefined();
	});

	// tyne-chat/tyne#254: a persona without an accent colour is drawn in its avatar's colour, as its profile is.
	it('colours the mention of a persona without an accent colour by its own avatar', () => {
		expect(personaMentionStyle({color: null, avatar_color: 0x8f1e1e, avatar: 'a1b2c3d4'})).toEqual({
			'--text-link': '#8f1e1e',
			'--markup-mention-fill': 'rgba(143, 30, 30, 0.1)',
			'--markup-interactive-hover-fill': 'rgba(143, 30, 30, 0.2)',
		});
	});
});
