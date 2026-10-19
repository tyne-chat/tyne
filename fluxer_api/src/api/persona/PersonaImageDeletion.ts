// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: deletes an account's persona images when the account is deleted. Every persona avatar and
// banner, and the display tag icon, is an image stored under the account's own prefixes
// (`avatars/<user id>/`, `banners/<user id>/`), like the account's avatar. Called from
// `UserDeletionService` before the persona rows and settings are removed, since it reads both.

import type {UserID} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import type {IPurgeQueue} from '@app/api/infrastructure/CachePurgeQueue';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';
import {Logger} from '@app/api/Logger';
import type {Persona} from '@app/api/models/Persona';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';

interface PersonaImageDeletionDeps {
	storageService: IStorageService;
	purgeQueue: IPurgeQueue;
	personaRepository: IPersonaRepository;
}

interface StoredImage {
	prefix: 'avatars' | 'banners';
	hash: string;
	/** For the log. */
	what: 'persona avatar' | 'persona banner' | 'display tag icon';
	personaId?: string;
}

/**
 * Deletes from storage, and purges from the media cache, the images of `personas` (deleted ones
 * included, as the caller passes them) and the account's display tag icon. A failure is logged and
 * the next image is tried, as for the account's own avatar.
 */
export async function deletePersonaImagesOfUser(
	deps: PersonaImageDeletionDeps,
	userId: UserID,
	personas: ReadonlyArray<Persona>,
): Promise<void> {
	const images: Array<StoredImage> = [];
	for (const persona of personas) {
		const personaId = persona.id.toString();
		if (persona.avatarHash)
			images.push({prefix: 'avatars', hash: persona.avatarHash, what: 'persona avatar', personaId});
		if (persona.bannerHash)
			images.push({prefix: 'banners', hash: persona.bannerHash, what: 'persona banner', personaId});
	}
	let tagIcon: string | null = null;
	try {
		tagIcon = (await deps.personaRepository.findSettings(userId))?.display_tag_icon ?? null;
	} catch (error) {
		Logger.error({error, userId}, 'Failed to read the display tag icon to delete');
	}
	if (tagIcon) images.push({prefix: 'avatars', hash: tagIcon, what: 'display tag icon'});

	// Two personas, or a persona and the tag, can share one image.
	const seen = new Set<string>();
	for (const image of images) {
		const id = `${image.prefix}/${image.hash}`;
		if (seen.has(id)) continue;
		seen.add(id);
		await deleteStoredImage(deps, userId, image);
	}
}

async function deleteStoredImage(deps: PersonaImageDeletionDeps, userId: UserID, image: StoredImage): Promise<void> {
	const {prefix, hash} = image;
	// Images are stored under the hash without its `a_`; both keys are deleted, as for the account's avatar.
	const rawHash = hash.replace(/^a_/, '');
	try {
		await deps.storageService.deleteAvatar({prefix, key: `${userId}/${hash}`});
		if (rawHash !== hash) {
			await deps.storageService.deleteAvatar({prefix, key: `${userId}/${rawHash}`});
		}
		await deps.purgeQueue.addUrls([
			`${Config.endpoints.media}/${prefix}/${userId}/${hash}`,
			`${Config.endpoints.media}/${prefix}/${userId}/${rawHash}`,
		]);
		Logger.debug({userId, personaId: image.personaId, hash, rawHash}, `Deleted ${image.what}`);
	} catch (error) {
		Logger.error({error, userId, personaId: image.personaId}, `Failed to delete ${image.what}`);
	}
}
