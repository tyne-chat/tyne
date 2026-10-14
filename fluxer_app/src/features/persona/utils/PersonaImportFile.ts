// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: reads what someone picks in the PluralKit import dialog: a PluralKit export (.json), or a
// Tyne persona export (.zip) holding `pluralkit.json`, `tyne.json` and the images. Only the files
// `tyne.json` names are unpacked, each with a size cap, so a hostile zip cannot fill memory.

import {
	PERSONA_BUNDLE_FILES,
	type PluralKitImportedSystem,
	readPluralKitExport,
	readTyneBundleManifest,
	type TyneBundleManifest,
} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import {unzipSync} from 'fflate';

const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_FILE_BYTES = 16 * 1024 * 1024;

export type PersonaImportSource =
	| {kind: 'pluralkit'; system: PluralKitImportedSystem}
	| {
			kind: 'bundle';
			system: PluralKitImportedSystem;
			manifest: TyneBundleManifest;
			/** The images `tyne.json` names, by their path in the zip. */
			images: ReadonlyMap<string, Uint8Array>;
	  };

export type PersonaImportFileError = 'not_object' | 'no_members' | 'invalid_json' | 'zip_unreadable' | 'zip_not_export';

export type PersonaImportFileResult =
	| {ok: true; source: PersonaImportSource}
	| {ok: false; error: PersonaImportFileError};

function isZip(bytes: Uint8Array): boolean {
	return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function parseJson(bytes: Uint8Array): unknown {
	return JSON.parse(new TextDecoder().decode(bytes));
}

function readBundle(bytes: Uint8Array): PersonaImportFileResult {
	let texts: Record<string, Uint8Array>;
	try {
		texts = unzipSync(bytes, {
			filter: (entry) => entry.name === PERSONA_BUNDLE_FILES.manifest && entry.originalSize <= MAX_TEXT_FILE_BYTES,
		});
	} catch {
		return {ok: false, error: 'zip_unreadable'};
	}
	const manifestBytes = texts[PERSONA_BUNDLE_FILES.manifest];
	if (!manifestBytes) return {ok: false, error: 'zip_not_export'};
	let manifest: TyneBundleManifest | null;
	try {
		manifest = readTyneBundleManifest(parseJson(manifestBytes));
	} catch {
		return {ok: false, error: 'zip_not_export'};
	}
	if (!manifest) return {ok: false, error: 'zip_not_export'};

	const wanted = new Set<string>();
	if (manifest.tag_icon) wanted.add(manifest.tag_icon);
	for (const entry of Object.values(manifest.members)) {
		if (entry.avatar) wanted.add(entry.avatar);
		if (entry.banner) wanted.add(entry.banner);
	}
	const pluralKitFile = manifest.pluralkit_file;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (entry) =>
				(entry.name === pluralKitFile && entry.originalSize <= MAX_TEXT_FILE_BYTES) ||
				(wanted.has(entry.name) && entry.originalSize <= MAX_IMAGE_FILE_BYTES),
		});
	} catch {
		return {ok: false, error: 'zip_unreadable'};
	}
	const pluralKitBytes = files[pluralKitFile];
	if (!pluralKitBytes) return {ok: false, error: 'zip_not_export'};
	let read: ReturnType<typeof readPluralKitExport>;
	try {
		read = readPluralKitExport(parseJson(pluralKitBytes));
	} catch {
		return {ok: false, error: 'zip_not_export'};
	}
	if (!read.ok) return {ok: false, error: read.reason};
	const images = new Map<string, Uint8Array>();
	for (const [name, data] of Object.entries(files)) {
		if (name !== pluralKitFile) images.set(name, data);
	}
	return {ok: true, source: {kind: 'bundle', system: read.system, manifest, images}};
}

export async function readPersonaImportFile(file: Blob): Promise<PersonaImportFileResult> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (isZip(bytes)) return readBundle(bytes);
	let raw: unknown;
	try {
		raw = parseJson(bytes);
	} catch {
		return {ok: false, error: 'invalid_json'};
	}
	const read = readPluralKitExport(raw);
	return read.ok ? {ok: true, source: {kind: 'pluralkit', system: read.system}} : {ok: false, error: read.reason};
}
