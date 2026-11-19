// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {effectiveMentionableBy, isPersonaSuggested} from '../PersonaMentionableBy';
import {
	buildPersonaBundleText,
	type PersonaBundlePersona,
	personaImportItem,
	readTyneBundleManifest,
} from '../PluralKitFormat';

describe('the mention setting (tyne-chat/tyne#652)', () => {
	it('follows visibility until chosen, as suggestions did before it existed', () => {
		expect(effectiveMentionableBy(null, 'public')).toBe('everyone');
		expect(effectiveMentionableBy(null, 'unlisted')).toBe('everyone');
		expect(effectiveMentionableBy(undefined, 'private')).toBe('self');
		expect(effectiveMentionableBy(null, null)).toBe('everyone');
	});

	it('is what was chosen, whatever the visibility', () => {
		expect(effectiveMentionableBy('nobody', 'public')).toBe('nobody');
		expect(effectiveMentionableBy('everyone', 'private')).toBe('everyone');
		expect(effectiveMentionableBy('self', 'unlisted')).toBe('self');
	});

	it('suggests a persona to its owner unless it is for nobody, and to others only when it is for everyone', () => {
		expect([isPersonaSuggested('everyone', true), isPersonaSuggested('everyone', false)]).toEqual([true, true]);
		expect([isPersonaSuggested('self', true), isPersonaSuggested('self', false)]).toEqual([true, false]);
		expect([isPersonaSuggested('nobody', true), isPersonaSuggested('nobody', false)]).toEqual([false, false]);
	});

	describe('in a Tyne export', () => {
		const persona = (exportId: string, overrides: Partial<PersonaBundlePersona> = {}): PersonaBundlePersona => ({
			exportId,
			name: `Persona ${exportId}`,
			color: null,
			pronouns: null,
			bio: null,
			personaTags: [],
			visibility: 'unlisted',
			avatarOrigin: null,
			avatar: null,
			banner: null,
			autoTagDisabled: false,
			signatureEmojis: [],
			...overrides,
		});

		it('comes back on import when chosen, and stays out when it follows visibility', () => {
			const text = buildPersonaBundleText({
				exportedAt: new Date('2026-11-18T12:00:00Z'),
				mediaHost: 'media.example.com',
				tagText: null,
				tagIcon: null,
				personas: [persona('clone', {mentionableBy: 'nobody'}), persona('untouched', {mentionableBy: null})],
			});
			const manifest = readTyneBundleManifest(JSON.parse(text.manifestJson));
			expect(manifest?.members).toEqual({clone: {mentionable_by: 'nobody'}, untouched: {}});

			const member = {
				index: 0,
				id: 'clone',
				name: 'Persona clone',
				color: null,
				pronouns: null,
				bio: null,
				personaTags: [],
				droppedTagCount: 0,
				visibility: 'unlisted' as const,
				avatarUrl: null,
				avatarOrigin: null,
				bannerUrl: null,
			};
			const noImages = {avatar: null, banner: null};
			expect(personaImportItem(member, noImages, manifest?.members.clone).mentionable_by).toBe('nobody');
			expect(personaImportItem(member, noImages, manifest?.members.untouched)).not.toHaveProperty('mentionable_by');
			expect(personaImportItem(member, noImages)).not.toHaveProperty('mentionable_by');
		});

		it('ignores a value it does not know', () => {
			const manifest = readTyneBundleManifest({
				format: 'tyne-personas',
				version: 1,
				members: {a: {mentionable_by: 'friends'}},
			});
			expect(manifest?.members.a).toEqual({});
		});
	});
});
