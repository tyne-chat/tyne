// SPDX-License-Identifier: AGPL-3.0-or-later

import {personaColor} from '@app/features/persona/utils/PersonaColor';
import {describe, expect, it} from 'vitest';

describe('personaColor', () => {
	it('uses the accent colour when one is set, whatever the avatar', () => {
		expect(personaColor({color: 0x55ff55, avatar_color: 0x8f1e1e, avatar: 'a1b2c3d4'})).toBe(0x55ff55);
		expect(personaColor({color: 0x55ff55})).toBe(0x55ff55);
	});

	it('falls back to the colour of the persona’s own avatar', () => {
		expect(personaColor({color: null, avatar_color: 0x8f1e1e, avatar: 'a1b2c3d4'})).toBe(0x8f1e1e);
		expect(personaColor({color: 0, avatar_color: 0x8f1e1e, avatar_hash: 'a1b2c3d4'})).toBe(0x8f1e1e);
	});

	it('ignores the avatar colour of a persona that shows the account’s avatar', () => {
		expect(personaColor({color: null, avatar_color: 0x8f1e1e, avatar: null})).toBeNull();
		expect(personaColor({avatar_color: 0x8f1e1e})).toBeNull();
	});

	it('gives nothing when there is no colour to show', () => {
		expect(personaColor(null)).toBeNull();
		expect(personaColor(undefined)).toBeNull();
		expect(personaColor({color: null, avatar_color: null, avatar: 'a1b2c3d4'})).toBeNull();
		expect(personaColor({color: 0, avatar_color: 0, avatar: 'a1b2c3d4'})).toBeNull();
	});
});
