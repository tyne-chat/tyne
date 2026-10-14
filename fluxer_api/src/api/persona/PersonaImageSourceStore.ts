// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: where an imported persona's avatar and banner came from. The export links to an image's
// source again (usually PluralKit's own image hosting) for as long as the persona still has the
// image that link produced; once the image is changed in Tyne, the export links to Tyne's copy.
// That check is made against the stored hash at export time, so nothing has to clear these rows
// when a persona is edited.
//
// The avatar's PluralKit field is kept even without a link, so the export can write the avatar
// back to the field it came from.
//
// One partition per account: the export reads them in one go and deleting an account removes them
// in one write.

import type {PersonaID, UserID} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import {deleteOneOrMany, fetchMany, upsertOne} from '@app/api/database/CassandraQueryExecution';
import type {PersonaImageSourceRow} from '@app/api/database/types/PersonaTypes';
import type {Persona} from '@app/api/models/Persona';
import {PersonaImageSources} from '@app/api/Tables';
import type {PersonaImportImageSources} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';

const FETCH_BY_USER = PersonaImageSources.select({where: PersonaImageSources.where.eq('user_id')});

export async function loadPersonaImageSources(userId: UserID): Promise<Map<string, PersonaImageSourceRow>> {
	const rows = await fetchMany<PersonaImageSourceRow>(FETCH_BY_USER.bind({user_id: userId}));
	return new Map(rows.map((row) => [row.persona_id.toString(), row]));
}

// A link to this instance's own media is not a source worth keeping: the export links to the
// persona's current copy here anyway, under its own account.
function externalSourceUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const media = new URL(Config.endpoints.media);
		return new URL(url).hostname.toLowerCase() === media.hostname.toLowerCase() ? null : url;
	} catch {
		return null;
	}
}

/** Records what an import said about a persona's images, replacing what an earlier import said. */
export async function storePersonaImageSources(
	userId: UserID,
	persona: Persona,
	sources: PersonaImportImageSources | null,
): Promise<void> {
	const avatar = sources?.avatar ?? null;
	const banner = sources?.banner ?? null;
	if (!avatar && !banner) {
		await forgetPersonaImageSources(userId, persona.id);
		return;
	}
	const avatarUrl = avatar ? externalSourceUrl(avatar.url) : null;
	const bannerUrl = banner ? externalSourceUrl(banner.url) : null;
	await upsertOne(
		PersonaImageSources.upsertAll({
			user_id: userId,
			persona_id: persona.id,
			avatar_field: avatar?.field ?? null,
			avatar_main_empty: avatar ? avatar.main_avatar_empty === true : null,
			avatar_url: avatarUrl,
			avatar_hash: avatarUrl ? persona.avatarHash : null,
			banner_url: bannerUrl,
			banner_hash: bannerUrl ? persona.bannerHash : null,
			updated_at: new Date(),
		}),
	);
}

export async function forgetPersonaImageSources(userId: UserID, personaId: PersonaID): Promise<void> {
	await deleteOneOrMany(PersonaImageSources.deleteByPk({user_id: userId, persona_id: personaId}));
}

export async function forgetPersonaImageSourcesOfUser(userId: UserID): Promise<void> {
	await deleteOneOrMany(PersonaImageSources.deletePartition({user_id: userId}));
}
