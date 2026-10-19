// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	ChannelPersonaMentionItemSchema,
	PersonaResponseSchema,
	PersonaSettingsResponseSchema,
	personaAssetHashOrNull,
} from '../PersonaApiSchemas';
import {MessageSubprofileResponseSchema} from '../PersonaSchemas';

// Persona images (avatar, banner, display tag icon) are hashes of images stored under the account.
// Nothing else is passed on, wherever it was read from.

const NOT_HASHES = [
	'https://tracker.example/pixel.png',
	'http://tracker.example/pixel.png',
	'//tracker.example/pixel.png',
	'data:image/png;base64,iVBORw0KGgo=',
	'icon.png',
	'🦊',
	'1A2B3C4D',
	'1a2b3c4',
	'abcdef0123456789abcdef0123456789',
	'../1a2b3c4d',
];

describe('personaAssetHashOrNull', () => {
	it('passes a hash on, trimmed', () => {
		expect(personaAssetHashOrNull('1a2b3c4d')).toBe('1a2b3c4d');
		expect(personaAssetHashOrNull(' a_1a2b3c4d\n')).toBe('a_1a2b3c4d');
	});

	it.each([...NOT_HASHES, '', '   ', null, undefined, 12345678, {hash: '1a2b3c4d'}])('gives null for %j', (value) => {
		expect(personaAssetHashOrNull(value)).toBeNull();
	});
});

describe('response schemas', () => {
	const persona = {id: '1', name: 'Fox', created_at: 'x', updated_at: 'x'};

	it.each(NOT_HASHES)('refuse %s in every persona image field', (value) => {
		expect(PersonaResponseSchema.safeParse({...persona, avatar_hash: value}).success).toBe(false);
		expect(PersonaResponseSchema.safeParse({...persona, banner_hash: value}).success).toBe(false);
		expect(MessageSubprofileResponseSchema.safeParse({id: '1', name: 'Fox', avatar: value}).success).toBe(false);
		expect(MessageSubprofileResponseSchema.safeParse({id: '1', name: 'Fox', display_tag_icon: value}).success).toBe(
			false,
		);
		expect(PersonaSettingsResponseSchema.safeParse({user_id: '1', display_tag_icon: value}).success).toBe(false);
		expect(
			ChannelPersonaMentionItemSchema.safeParse({
				...persona,
				owner_user_id: '2',
				owner_username: 'a',
				avatar_hash: value,
			}).success,
		).toBe(false);
	});

	it('accept a hash or nothing', () => {
		expect(PersonaResponseSchema.safeParse({...persona, avatar_hash: 'a_1a2b3c4d', banner_hash: null}).success).toBe(
			true,
		);
		expect(MessageSubprofileResponseSchema.safeParse({id: '1', name: 'Fox', avatar: '1a2b3c4d'}).success).toBe(true);
		expect(PersonaSettingsResponseSchema.safeParse({user_id: '1', display_tag_icon: null}).success).toBe(true);
	});
});
