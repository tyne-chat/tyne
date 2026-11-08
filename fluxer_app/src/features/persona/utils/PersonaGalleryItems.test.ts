// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {describe, expect, it} from 'vitest';
import {
	filterGalleryItems,
	galleryItemsFromOwn,
	galleryItemsFromPublic,
	plainBio,
	sortGalleryItems,
} from './PersonaGalleryItems';

const own = (id: string, name: string, extra: Partial<ClientPersona> = {}): ClientPersona =>
	({
		id,
		name,
		use_count: 0,
		last_used_at_ms: null,
		visibility: 'public',
		persona_tags: [],
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		auto_tag_disabled: false,
		...extra,
	}) as ClientPersona;

describe('gallery items', () => {
	it("keeps the server's order of someone else's personas as the most-used order", () => {
		const items = galleryItemsFromPublic([
			{id: '30', name: 'Wren', visibility: 'public'},
			{id: '10', name: 'Ash', visibility: 'public'},
		]);

		expect(sortGalleryItems(items, 'used').map((p) => p.name)).toEqual(['Wren', 'Ash']);
		expect(sortGalleryItems(items, 'name').map((p) => p.name)).toEqual(['Ash', 'Wren']);
		expect(items[0]!.createdAt).toBe(extractTimestamp('30'));
	});

	it('ranks one’s own personas by use, and by last use for Recently used', () => {
		const items = galleryItemsFromOwn([
			own('1', 'Seldom', {use_count: 2, last_used_at_ms: '5000'}),
			own('2', 'Often', {use_count: 40, last_used_at_ms: '1000'}),
			own('3', 'Never'),
		]);

		expect(sortGalleryItems(items, 'used').map((p) => p.name)).toEqual(['Often', 'Seldom', 'Never']);
		expect(sortGalleryItems(items, 'recent').map((p) => p.name)).toEqual(['Seldom', 'Often', 'Never']);
	});

	it('sorts names without regard to case and with numbers in order', () => {
		const items = galleryItemsFromPublic(
			['beta', 'Alpha', 'Item 10', 'Item 2'].map((name, i) => ({id: String(i + 1), name, visibility: 'public'})),
		);

		expect(sortGalleryItems(items, 'name', 'en').map((p) => p.name)).toEqual(['Alpha', 'beta', 'Item 2', 'Item 10']);
	});

	it('searches name, pronouns and bio, without case', () => {
		const items = galleryItemsFromPublic([
			{id: '1', name: 'Wren', pronouns: 'she/her', visibility: 'public'},
			{id: '2', name: 'Marlowe', bio: 'Night-shift WRITER', visibility: 'public'},
		]);

		expect(filterGalleryItems(items, 'writer').map((p) => p.name)).toEqual(['Marlowe']);
		expect(filterGalleryItems(items, 'SHE').map((p) => p.name)).toEqual(['Wren']);
		expect(filterGalleryItems(items, '  ')).toHaveLength(2);
	});

	it('turns a bio into one line of plain text', () => {
		expect(plainBio('# About me\n\n**Bold** and ||spoiler|| with a [link](https://example.com) and <:fox:123>')).toBe(
			'About me Bold and spoiler with a link and :fox:',
		);
		expect(plainBio(null)).toBe('');
	});
});
