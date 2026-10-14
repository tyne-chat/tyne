// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: exports an account's personas as a zip: `pluralkit.json` (a PluralKit export file that
// `pk;import` accepts), every persona's avatar and banner and the tag icon under readable names,
// `tyne.json` (which file belongs to which persona, and what PluralKit has no place for) and a
// README on bringing them back into Tyne or into PluralKit. The mapping itself is in
// `@fluxer/schema/src/domains/persona/PluralKitFormat`, shared with the web app's import.
//
// The zip is streamed. Images are read from storage one at a time and the archive waits for each
// to be written before reading the next, so a large export does not sit in memory. The text files
// go last, because they name the images, whose extensions are only known once they are read.

import type {Readable} from 'node:stream';
import type {UserID} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import type {PersonaImageSourceRow} from '@app/api/database/types/PersonaTypes';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';
import {Logger} from '@app/api/Logger';
import type {Persona} from '@app/api/models/Persona';
import {loadPersonaImageSources} from '@app/api/persona/PersonaImageSourceStore';
import type {PersonaService} from '@app/api/persona/PersonaService';
import {
	assignPersonaFileBaseNames,
	buildPersonaBundleText,
	imageFileExtension,
	isPluralKitImageUrl,
	PERSONA_BUNDLE_FILES,
	type PersonaBundleImage,
	type PersonaBundlePersona,
	type PersonaImageKind,
	type PluralKitAvatarField,
	tyneMediaImageUrl,
} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import {ZipArchive, type ZipEntryData} from 'archiver';

// Stored images can be a little larger than the upload limit: JPEGs are re-encoded when stored.
const MAX_STORED_IMAGE_BYTES = 64 * 1024 * 1024;
const MEDIA_HASH = /^(a_)?[0-9a-f]{8,32}$/;

export interface PersonaExportDeps {
	personaService: PersonaService;
	storageService: IStorageService;
}

export interface PersonaExportArchive {
	fileName: string;
	stream: Readable;
}

function storageKey(kind: PersonaImageKind, userId: UserID, hash: string): string {
	return `${kind === 'avatar' ? 'avatars' : 'banners'}/${userId}/${hash.replace(/^a_/, '')}`;
}

function mediaHost(): string {
	try {
		return new URL(Config.endpoints.media).host;
	} catch {
		return Config.endpoints.media;
	}
}

function decodeDataUri(uri: string): Uint8Array | null {
	const match = /^data:[^;,]*;base64,(.*)$/s.exec(uri);
	return match ? Uint8Array.from(Buffer.from(match[1] ?? '', 'base64')) : null;
}

/** Oldest persona first, which is the order they were created in, and the order an import makes them. */
function byCreation(a: Persona, b: Persona): number {
	const left = BigInt(a.id.toString());
	const right = BigInt(b.id.toString());
	return left < right ? -1 : left > right ? 1 : 0;
}

export function personaExportFileName(now: Date): string {
	return `Tyne personas ${now.toISOString().slice(0, 10)}.zip`;
}

export async function createPersonaExportArchive(
	deps: PersonaExportDeps,
	userId: UserID,
	now: Date = new Date(),
): Promise<PersonaExportArchive> {
	const [personas, settings, sources] = await Promise.all([
		deps.personaService.getPersonas(userId),
		deps.personaService.getSettings(userId),
		loadPersonaImageSources(userId),
	]);
	personas.sort(byCreation);

	const archive = new ZipArchive({zlib: {level: 6}});
	const pending: Array<{resolve(): void; reject(error: unknown): void}> = [];
	let failure: unknown = null;
	const fail = (error: unknown) => {
		if (failure) return;
		failure = error ?? new Error('Persona export failed');
		for (const entry of pending.splice(0)) entry.reject(failure);
		archive.destroy(failure instanceof Error ? failure : new Error('Persona export failed'));
	};
	archive.on('warning', fail);
	archive.on('error', fail);
	archive.on('entry', () => pending.shift()?.resolve());

	const append = (source: Buffer | string, data: ZipEntryData): Promise<void> => {
		if (failure) return Promise.reject(failure);
		const written = new Promise<void>((resolve, reject) => pending.push({resolve, reject}));
		archive.append(source, data);
		return written;
	};

	const readImage = async (kind: PersonaImageKind, hash: string): Promise<Uint8Array | null> => {
		try {
			return await deps.storageService.readObject(
				Config.s3.buckets.cdn,
				storageKey(kind, userId, hash),
				MAX_STORED_IMAGE_BYTES,
			);
		} catch (error) {
			Logger.warn({error, userId: userId.toString(), kind, hash}, 'Persona export could not read an image');
			return null;
		}
	};

	const produce = async () => {
		const baseNames = assignPersonaFileBaseNames(
			personas
				.filter((persona) => persona.avatarHash || persona.bannerHash)
				.map((persona) => ({key: persona.id.toString(), name: persona.name})),
		);

		const placeImage = async (
			persona: Persona,
			kind: PersonaImageKind,
			hash: string | null,
			source: {url: string | null; hash: string | null} | null,
		): Promise<PersonaBundleImage | null> => {
			if (!hash) return null;
			const bytes = await readImage(kind, hash);
			let path: string | null = null;
			if (bytes) {
				const folder = kind === 'avatar' ? PERSONA_BUNDLE_FILES.avatarFolder : PERSONA_BUNDLE_FILES.bannerFolder;
				path = `${folder}/${baseNames.get(persona.id.toString())}.${imageFileExtension(bytes)}`;
				await append(Buffer.from(bytes), {name: path, date: now, store: true});
			}
			// The image's source again, while the persona still has the image that link produced.
			if (source?.url && source.hash === hash && isPluralKitImageUrl(source.url)) {
				return {path, url: source.url, hostedOnTyne: false};
			}
			return {
				path,
				url: tyneMediaImageUrl(Config.endpoints.media, kind, userId.toString(), hash),
				hostedOnTyne: true,
			};
		};

		const bundlePersonas: Array<PersonaBundlePersona> = [];
		for (const persona of personas) {
			const source: PersonaImageSourceRow | undefined = sources.get(persona.id.toString());
			const avatar = await placeImage(
				persona,
				'avatar',
				persona.avatarHash,
				source ? {url: source.avatar_url ?? null, hash: source.avatar_hash ?? null} : null,
			);
			const banner = await placeImage(
				persona,
				'banner',
				persona.bannerHash,
				source ? {url: source.banner_url ?? null, hash: source.banner_hash ?? null} : null,
			);
			const avatarField = source?.avatar_field;
			bundlePersonas.push({
				exportId: persona.externalUuid ?? persona.id.toString(),
				name: persona.name,
				color: persona.color,
				pronouns: persona.pronouns,
				bio: persona.bio,
				personaTags: persona.personaTags,
				visibility: persona.visibility,
				avatarOrigin:
					avatarField === 'avatar_url' || avatarField === 'webhook_avatar_url'
						? {field: avatarField as PluralKitAvatarField, mainAvatarEmpty: source?.avatar_main_empty === true}
						: null,
				avatar,
				banner,
				autoTagDisabled: persona.autoTagDisabled,
				signatureEmojis: persona.signatureEmojis,
			});
		}

		let tagIcon: {path: string} | {url: string} | null = null;
		const icon = settings.display_tag_icon?.trim();
		if (icon) {
			let bytes: Uint8Array | null = null;
			if (MEDIA_HASH.test(icon)) bytes = await readImage('avatar', icon);
			else if (icon.startsWith('data:')) bytes = decodeDataUri(icon);
			else if (icon.startsWith('https://') || icon.startsWith('http://')) tagIcon = {url: icon};
			if (bytes) {
				const path = `${PERSONA_BUNDLE_FILES.tagIconBaseName}.${imageFileExtension(bytes)}`;
				await append(Buffer.from(bytes), {name: path, date: now, store: true});
				tagIcon = {path};
			}
		}

		const text = buildPersonaBundleText({
			exportedAt: now,
			mediaHost: mediaHost(),
			tagText: settings.display_tag_text?.trim() || null,
			tagIcon,
			personas: bundlePersonas,
		});
		await append(text.readme, {name: PERSONA_BUNDLE_FILES.readme, date: now});
		await append(text.pluralKitJson, {name: PERSONA_BUNDLE_FILES.pluralKit, date: now});
		await append(text.manifestJson, {name: PERSONA_BUNDLE_FILES.manifest, date: now});
		await archive.finalize();
	};

	void produce().catch((error: unknown) => {
		Logger.error({error, userId: userId.toString()}, 'Persona export failed');
		fail(error);
	});

	return {fileName: personaExportFileName(now), stream: archive};
}
