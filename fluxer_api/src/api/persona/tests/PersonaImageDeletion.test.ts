// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';
import {createPersonaID, createUserID} from '../../BrandedTypes';
import {Config} from '../../Config';
import type {UserPersonaSettingsRow} from '../../database/types/PersonaTypes';
import type {IPurgeQueue} from '../../infrastructure/CachePurgeQueue';
import type {IStorageService} from '../../infrastructure/IStorageService';
import {Persona} from '../../models/Persona';
import type {IPersonaRepository} from '../IPersonaRepository';
import {deletePersonaImagesOfUser} from '../PersonaImageDeletion';

const userId = createUserID(1111111111111111111n);

function persona(id: bigint, avatarHash: string | null, bannerHash: string | null): Persona {
	return new Persona({
		user_id: userId,
		persona_id: createPersonaID(id),
		name: `Persona ${id}`,
		avatar_hash: avatarHash,
		banner_hash: bannerHash,
		pronouns: null,
		color: null,
		avatar_color: null,
		bio: null,
		auto_tag_disabled: false,
		persona_tags: '[]',
		use_count: 0,
		last_used_at_ms: null,
		visibility: 'unlisted',
		external_uuid: null,
		created_at: new Date(),
		updated_at: new Date(),
		version: 1,
	});
}

function settings(icon: string | null): UserPersonaSettingsRow {
	return {
		user_id: userId,
		active_persona_id: null,
		active_persona_mode: 'manual',
		active_persona_scope: 'global',
		is_latched: false,
		display_tag_text: 'SYS',
		display_tag_icon: icon,
		updated_at: new Date(),
		version: 1,
	};
}

function setup(findSettings: () => Promise<UserPersonaSettingsRow | null>, failingKeys: ReadonlyArray<string> = []) {
	const deleted: Array<{prefix: string; key: string}> = [];
	const purged: Array<string> = [];
	const storageService = {
		deleteAvatar: vi.fn(async (params: {prefix: string; key: string}) => {
			if (failingKeys.includes(params.key)) throw new Error('Simulated storage error');
			deleted.push(params);
		}),
	} as unknown as IStorageService;
	const purgeQueue = {
		addUrls: vi.fn(async (urls: Array<string>) => {
			purged.push(...urls);
		}),
	} as unknown as IPurgeQueue;
	const personaRepository = {findSettings: vi.fn(findSettings)} as unknown as IPersonaRepository;
	return {deps: {storageService, purgeQueue, personaRepository}, deleted, purged, storageService};
}

describe('deletePersonaImagesOfUser', () => {
	it('deletes and purges the display tag icon with the persona images', async () => {
		const {deps, deleted, purged} = setup(async () => settings('a_7a7a7a7a'));

		await deletePersonaImagesOfUser(deps, userId, [persona(1n, '1a1a1a1a', 'a_2b2b2b2b')]);

		expect(deleted).toEqual([
			{prefix: 'avatars', key: `${userId}/1a1a1a1a`},
			{prefix: 'banners', key: `${userId}/a_2b2b2b2b`},
			{prefix: 'banners', key: `${userId}/2b2b2b2b`},
			{prefix: 'avatars', key: `${userId}/a_7a7a7a7a`},
			{prefix: 'avatars', key: `${userId}/7a7a7a7a`},
		]);
		expect(purged).toContain(`${Config.endpoints.media}/avatars/${userId}/a_7a7a7a7a`);
		expect(purged).toContain(`${Config.endpoints.media}/avatars/${userId}/7a7a7a7a`);
	});

	it('deletes an image that two personas and the tag share once', async () => {
		const {deps, deleted} = setup(async () => settings('1a1a1a1a'));

		await deletePersonaImagesOfUser(deps, userId, [persona(1n, '1a1a1a1a', null), persona(2n, '1a1a1a1a', null)]);

		expect(deleted).toEqual([{prefix: 'avatars', key: `${userId}/1a1a1a1a`}]);
	});

	it('deletes the tag icon for an account without personas', async () => {
		const {deps, deleted} = setup(async () => settings('3c3c3c3c'));

		await deletePersonaImagesOfUser(deps, userId, []);

		expect(deleted).toEqual([{prefix: 'avatars', key: `${userId}/3c3c3c3c`}]);
	});

	it('still deletes the persona images when the settings cannot be read', async () => {
		const {deps, deleted} = setup(async () => {
			throw new Error('database offline');
		});

		await deletePersonaImagesOfUser(deps, userId, [persona(1n, '1a1a1a1a', null)]);

		expect(deleted).toEqual([{prefix: 'avatars', key: `${userId}/1a1a1a1a`}]);
	});

	it('goes on to the next image when one cannot be deleted', async () => {
		const {deps, deleted, storageService} = setup(async () => settings('3c3c3c3c'), [`${userId}/1a1a1a1a`]);

		await deletePersonaImagesOfUser(deps, userId, [persona(1n, '1a1a1a1a', null)]);

		expect(storageService.deleteAvatar).toHaveBeenCalledWith({prefix: 'avatars', key: `${userId}/1a1a1a1a`});
		expect(deleted).toEqual([{prefix: 'avatars', key: `${userId}/3c3c3c3c`}]);
	});

	it('deletes nothing without a tag icon or persona images', async () => {
		const {deps, storageService} = setup(async () => null);

		await deletePersonaImagesOfUser(deps, userId, [persona(1n, null, null)]);

		expect(storageService.deleteAvatar).not.toHaveBeenCalled();
	});
});
