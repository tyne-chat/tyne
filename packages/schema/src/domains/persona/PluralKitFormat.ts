// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: the one mapping between Tyne personas and PluralKit's export file (format version 2). The
 * web app's import and the API's export both go through this file, which is what lets the round
 * trip be tested: a PluralKit file that only uses the fields below comes back out of Tyne the same,
 * apart from formatting.
 *
 * PluralKit's rules, from its importer (`PluralKit.Core/Utils/BulkImporter`, `Models/Patch`, read
 * at commit c4679ccf):
 * - A file counts as a PluralKit export when it has a `switches` key. `members` is required, and
 *   every member needs an `id`.
 * - Members are matched by `id`, then by exact name, and updated in place. A key missing from the
 *   file leaves PluralKit's value alone; a key set to null clears it. So the export leaves out
 *   everything Tyne does not keep (birthday, display name, groups, front history...).
 * - Image fields must be absolute https links of at most 256 characters, descriptions at most 1000
 *   characters, the system tag at most 79, colours six hex digits. One bad value fails the whole
 *   import, so the export shortens text to fit and only writes links PluralKit accepts.
 */

import type {PersonaImportItem, PersonaTag, PersonaVisibility, SignatureEmoji} from './PersonaApiSchemas';

export const PLURALKIT_EXPORT_VERSION = 2;

export const PLURALKIT_LIMITS = {
	description: 1000,
	systemTag: 79,
	url: 256,
} as const;

/** Tyne's own limits on a persona's tags (`PersonaTagSchema`, `PersonaCreateRequestSchema`). */
export const TYNE_PERSONA_TAG_LIMITS = {
	perPersona: 5,
	partLength: 32,
} as const;

/** In the order PluralKit writes them. */
export const PLURALKIT_MEMBER_PRIVACY_KEYS = [
	'visibility',
	'name_privacy',
	'description_privacy',
	'banner_privacy',
	'birthday_privacy',
	'pronoun_privacy',
	'avatar_privacy',
	'metadata_privacy',
	'proxy_privacy',
] as const;
export type PluralKitMemberPrivacyKey = (typeof PLURALKIT_MEMBER_PRIVACY_KEYS)[number];
export type PluralKitPrivacyLevel = 'public' | 'private';
export type PluralKitMemberPrivacy = Record<PluralKitMemberPrivacyKey, PluralKitPrivacyLevel>;

export interface PluralKitProxyTag {
	prefix: string | null;
	suffix: string | null;
}

/** A member as the export writes it. Keys that are absent are ones Tyne leaves to PluralKit. */
export interface PluralKitExportMember {
	id: string;
	name: string;
	color: string | null;
	pronouns: string | null;
	avatar_url?: string | null;
	webhook_avatar_url: string | null;
	banner: string | null;
	description: string | null;
	proxy_tags: Array<PluralKitProxyTag>;
	privacy: PluralKitMemberPrivacy;
}

export interface PluralKitExportFile {
	version: typeof PLURALKIT_EXPORT_VERSION;
	tag: string | null;
	members: Array<PluralKitExportMember>;
	groups: Array<never>;
	switches: Array<never>;
}

// Privacy

/**
 * Tyne has three privacy states where PluralKit has nine switches. The export writes these three
 * patterns; the import maps any pattern to the strictest state it implies, so going through Tyne
 * never makes a member less private.
 */
export function pluralKitPrivacyFromVisibility(visibility: PersonaVisibility): PluralKitMemberPrivacy {
	const privacy = {} as PluralKitMemberPrivacy;
	for (const key of PLURALKIT_MEMBER_PRIVACY_KEYS) {
		const isPrivate = visibility === 'private' || (visibility === 'unlisted' && key === 'visibility');
		privacy[key] = isPrivate ? 'private' : 'public';
	}
	return privacy;
}

/**
 * All public: public. Only hidden from the member list: unlisted. Anything else private: private.
 * A member without privacy settings (a file not written by its owner) is unlisted, which is what
 * Tyne gives a new persona.
 */
export function visibilityFromPluralKitPrivacy(privacy: Readonly<Record<string, unknown>> | null): PersonaVisibility {
	if (!privacy) return 'unlisted';
	let hiddenFromList = false;
	for (const key of PLURALKIT_MEMBER_PRIVACY_KEYS) {
		if (!(key in privacy)) continue;
		if (privacy[key] === 'public') continue;
		if (key !== 'visibility') return 'private';
		hiddenFromList = true;
	}
	return hiddenFromList ? 'unlisted' : 'public';
}

function memberPrivacyOf(member: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | null {
	const nested = member.privacy;
	if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
		return nested as Record<string, unknown>;
	}
	// Old PluralKit files kept the privacy switches beside the member's other fields.
	const legacy: Record<string, unknown> = {};
	let found = false;
	for (const key of PLURALKIT_MEMBER_PRIVACY_KEYS) {
		if (key in member) {
			legacy[key] = member[key];
			found = true;
		}
	}
	return found ? legacy : null;
}

// Values

function cleanText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function colorFromPluralKit(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const hex = value.trim().replace(/^#/, '');
	return /^[0-9a-fA-F]{6}$/.test(hex) ? Number.parseInt(hex, 16) : null;
}

export function colorToPluralKit(value: number | null | undefined): string | null {
	if (value === null || value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffffff) {
		return null;
	}
	return value.toString(16).padStart(6, '0');
}

/** Whether PluralKit accepts this as an image link: absolute https, at most 256 characters. */
export function isPluralKitImageUrl(url: string): boolean {
	if (url.length > PLURALKIT_LIMITS.url) return false;
	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Cuts text to PluralKit's limit, ending with "…". Lengths are counted in UTF-16 units, as both
 * JavaScript and PluralKit (.NET) count them, and a character made of two units is never split.
 */
export function shortenForPluralKit(value: string, limit: number): string {
	if (value.length <= limit) return value;
	let cut = value.slice(0, limit - 1);
	if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
	return `${cut.trimEnd()}…`;
}

// Import

export type PluralKitAvatarField = 'avatar_url' | 'webhook_avatar_url';

/**
 * Where a persona's avatar came from in a PluralKit file. Remembered so the export can write it
 * back to the same field: PluralKit shows `webhook_avatar_url` (the proxy avatar) on messages when
 * it is set, and `avatar_url` on the member card.
 */
export interface PluralKitAvatarOrigin {
	field: PluralKitAvatarField;
	/** The member's `avatar_url` was empty, so the export can write it back as null. */
	mainAvatarEmpty: boolean;
}

export interface PluralKitImportedMember {
	/** Position in the file's member list. */
	index: number;
	/** The member's `id`; Tyne keeps it as the persona's external ID. */
	id: string | null;
	/** Null when the member has no name; such a member cannot be imported. */
	name: string | null;
	color: number | null;
	pronouns: string | null;
	bio: string | null;
	personaTags: Array<PersonaTag>;
	/** Proxy tags left out because Tyne allows at most 5 per persona of at most 32 characters. */
	droppedTagCount: number;
	visibility: PersonaVisibility;
	avatarUrl: string | null;
	avatarOrigin: PluralKitAvatarOrigin | null;
	bannerUrl: string | null;
}

export interface PluralKitImportedSystem {
	name: string | null;
	tag: string | null;
	members: Array<PluralKitImportedMember>;
}

export type PluralKitReadResult =
	| {ok: true; system: PluralKitImportedSystem}
	| {ok: false; reason: 'not_object' | 'no_members'};

function personaTagsFromPluralKit(raw: unknown): {tags: Array<PersonaTag>; dropped: number} {
	const tags: Array<PersonaTag> = [];
	const seen = new Set<string>();
	let dropped = 0;
	if (!Array.isArray(raw)) return {tags, dropped};
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const prefix = cleanText((entry as Record<string, unknown>).prefix) ?? undefined;
		const suffix = cleanText((entry as Record<string, unknown>).suffix) ?? undefined;
		if (!prefix && !suffix) continue;
		const key = `${prefix ?? ''}\u0000${suffix ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const tooLong =
			(prefix?.length ?? 0) > TYNE_PERSONA_TAG_LIMITS.partLength ||
			(suffix?.length ?? 0) > TYNE_PERSONA_TAG_LIMITS.partLength;
		if (tooLong || tags.length >= TYNE_PERSONA_TAG_LIMITS.perPersona) {
			dropped++;
			continue;
		}
		const tag: PersonaTag = {};
		if (prefix) tag.prefix = prefix;
		if (suffix) tag.suffix = suffix;
		tags.push(tag);
	}
	return {tags, dropped};
}

/**
 * The proxy avatar wins when both are set: it is the one PluralKit shows on messages, which is
 * what a Tyne persona's avatar is for. PluralKit itself ignores a proxy avatar equal to the main one.
 */
function avatarOf(member: Readonly<Record<string, unknown>>): {url: string; origin: PluralKitAvatarOrigin} | null {
	const main = cleanText(member.avatar_url);
	const proxy = cleanText(member.webhook_avatar_url);
	if (proxy && proxy !== main) {
		return {url: proxy, origin: {field: 'webhook_avatar_url', mainAvatarEmpty: main === null}};
	}
	if (main) return {url: main, origin: {field: 'avatar_url', mainAvatarEmpty: false}};
	return null;
}

export function readPluralKitExport(raw: unknown): PluralKitReadResult {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {ok: false, reason: 'not_object'};
	const file = raw as Record<string, unknown>;
	if (!Array.isArray(file.members)) return {ok: false, reason: 'no_members'};
	const members: Array<PluralKitImportedMember> = [];
	file.members.forEach((entry, index) => {
		const member = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
		const {tags, dropped} = personaTagsFromPluralKit(member.proxy_tags);
		const avatar = avatarOf(member);
		const id = typeof member.id === 'string' && member.id.trim() ? member.id.trim() : null;
		members.push({
			index,
			id,
			name: cleanText(member.name) ?? cleanText(member.display_name),
			color: colorFromPluralKit(member.color),
			pronouns: cleanText(member.pronouns),
			bio: cleanText(member.description),
			personaTags: tags,
			droppedTagCount: dropped,
			visibility: visibilityFromPluralKitPrivacy(memberPrivacyOf(member)),
			avatarUrl: avatar?.url ?? null,
			avatarOrigin: avatar?.origin ?? null,
			bannerUrl: cleanText(member.banner),
		});
	});
	return {ok: true, system: {name: cleanText(file.name), tag: cleanText(file.tag), members}};
}

/** Images the import has already stored for a member, by the hash Tyne gave them. */
export interface PersonaImportStoredImages {
	avatar: {hash: string; avatarColor: number | null} | null;
	banner: {hash: string} | null;
}

/**
 * The import request for one member. `extras` is the member's entry in `tyne.json` when the file
 * came in a Tyne export, and gives back what PluralKit has no place for.
 */
export function personaImportItem(
	member: PluralKitImportedMember & {name: string},
	images: PersonaImportStoredImages,
	extras?: TyneBundleMemberEntry,
): PersonaImportItem {
	const item: PersonaImportItem = {
		name: member.name,
		avatar_hash: images.avatar?.hash,
		avatar_color: images.avatar?.avatarColor ?? undefined,
		banner_hash: images.banner?.hash,
		pronouns: member.pronouns ?? undefined,
		color: member.color ?? undefined,
		bio: extras?.bio ?? member.bio ?? undefined,
		persona_tags: member.personaTags,
		visibility: member.visibility,
		external_uuid: member.id ?? undefined,
		image_sources: {
			avatar: member.avatarOrigin
				? {
						url: member.avatarUrl,
						field: member.avatarOrigin.field,
						main_avatar_empty: member.avatarOrigin.mainAvatarEmpty,
					}
				: null,
			banner: member.bannerUrl ? {url: member.bannerUrl} : null,
		},
	};
	if (extras?.auto_tag_disabled) item.auto_tag_disabled = true;
	if (extras?.signature_emojis && extras.signature_emojis.length > 0) item.signature_emojis = extras.signature_emojis;
	return item;
}

// Export

export interface PluralKitExportPersona {
	/** The member `id` to write: the persona's external ID, or its Tyne ID for one made in Tyne. */
	exportId: string;
	name: string;
	color: number | null;
	pronouns: string | null;
	bio: string | null;
	personaTags: ReadonlyArray<PersonaTag>;
	visibility: PersonaVisibility;
	avatarUrl: string | null;
	/** Set for a persona imported from PluralKit, even after its avatar was changed or removed. */
	avatarOrigin: PluralKitAvatarOrigin | null;
	bannerUrl: string | null;
}

export interface PluralKitShortenedText {
	/** Null for the system tag. */
	exportId: string | null;
	field: 'description' | 'tag';
	fullText: string;
}

export interface PluralKitExportResult {
	file: PluralKitExportFile;
	shortened: Array<PluralKitShortenedText>;
}

function pluralKitMember(
	persona: PluralKitExportPersona,
	shortened: Array<PluralKitShortenedText>,
): PluralKitExportMember {
	let description = persona.bio && persona.bio.length > 0 ? persona.bio : null;
	if (description !== null && description.length > PLURALKIT_LIMITS.description) {
		shortened.push({exportId: persona.exportId, field: 'description', fullText: description});
		description = shortenForPluralKit(description, PLURALKIT_LIMITS.description);
	}
	const avatarUrl = persona.avatarUrl && isPluralKitImageUrl(persona.avatarUrl) ? persona.avatarUrl : null;
	const member = {
		id: persona.exportId,
		name: persona.name,
		color: colorToPluralKit(persona.color),
		pronouns: persona.pronouns && persona.pronouns.length > 0 ? persona.pronouns : null,
	} as PluralKitExportMember;
	if (persona.avatarOrigin?.field === 'webhook_avatar_url') {
		// The member's main avatar was never imported, so it is left to PluralKit unless it was empty.
		if (persona.avatarOrigin.mainAvatarEmpty) member.avatar_url = null;
		member.webhook_avatar_url = avatarUrl;
	} else {
		// Clearing the proxy avatar makes PluralKit show this avatar on messages, as Tyne does.
		member.avatar_url = avatarUrl;
		member.webhook_avatar_url = null;
	}
	member.banner = persona.bannerUrl && isPluralKitImageUrl(persona.bannerUrl) ? persona.bannerUrl : null;
	member.description = description;
	member.proxy_tags = persona.personaTags.map((tag) => ({prefix: tag.prefix ?? null, suffix: tag.suffix ?? null}));
	member.privacy = pluralKitPrivacyFromVisibility(persona.visibility);
	return member;
}

export function buildPluralKitExport(input: {
	tag: string | null;
	personas: ReadonlyArray<PluralKitExportPersona>;
}): PluralKitExportResult {
	const shortened: Array<PluralKitShortenedText> = [];
	let tag = input.tag && input.tag.length > 0 ? input.tag : null;
	if (tag !== null && tag.length > PLURALKIT_LIMITS.systemTag) {
		shortened.push({exportId: null, field: 'tag', fullText: tag});
		tag = shortenForPluralKit(tag, PLURALKIT_LIMITS.systemTag);
	}
	const members = input.personas.map((persona) => pluralKitMember(persona, shortened));
	return {
		file: {version: PLURALKIT_EXPORT_VERSION, tag, members, groups: [], switches: []},
		shortened,
	};
}

// Images on this instance

export type PersonaImageKind = 'avatar' | 'banner';

const MEDIA_FOLDER: Record<PersonaImageKind, string> = {avatar: 'avatars', banner: 'banners'};

/**
 * The public link of a persona image on this instance's media server, as PluralKit and Discord
 * can fetch it. Persona images are stored under the owning account.
 */
export function tyneMediaImageUrl(
	mediaEndpoint: string,
	kind: PersonaImageKind,
	ownerUserId: string,
	hash: string,
): string {
	const base = `${mediaEndpoint.replace(/\/+$/, '')}/${MEDIA_FOLDER[kind]}/${ownerUserId}`;
	return hash.startsWith('a_') ? `${base}/${hash}.gif?animated=true` : `${base}/${hash}.png`;
}

const OWN_MEDIA_PATH = /^\/(avatars|banners)\/(\d{1,20})\/((?:a_)?[0-9a-f]{8})\.(?:png|webp|gif|jpe?g|avif)$/;

/**
 * The image hash in a link to one of this account's own persona images on this instance, or null
 * for any other link. Lets a re-imported file keep those images without fetching them: the media
 * server refuses to fetch from itself.
 */
export function ownTyneMediaImageHash(
	url: string,
	mediaEndpoint: string,
	kind: PersonaImageKind,
	ownerUserId: string,
): string | null {
	let parsed: URL;
	let base: URL;
	try {
		parsed = new URL(url);
		base = new URL(mediaEndpoint);
	} catch {
		return null;
	}
	if (parsed.origin !== base.origin) return null;
	const basePath = base.pathname.replace(/\/+$/, '');
	if (!parsed.pathname.startsWith(`${basePath}/`)) return null;
	const match = OWN_MEDIA_PATH.exec(parsed.pathname.slice(basePath.length));
	if (!match || match[1] !== MEDIA_FOLDER[kind] || match[2] !== ownerUserId) return null;
	return match[3] ?? null;
}

// The bundle

export const PERSONA_BUNDLE_FILES = {
	pluralKit: 'pluralkit.json',
	manifest: 'tyne.json',
	readme: 'README.txt',
	avatarFolder: 'avatars',
	bannerFolder: 'banners',
	tagIconBaseName: 'Tag icon',
} as const;

export const TYNE_BUNDLE_FORMAT = 'tyne-personas';
export const TYNE_BUNDLE_VERSION = 1;

/** What `tyne.json` holds for one member, keyed by the member's `id` in `pluralkit.json`. */
export interface TyneBundleMemberEntry {
	/** Path of the avatar inside the zip. */
	avatar?: string;
	banner?: string;
	/** The full bio, when `pluralkit.json` has it shortened. */
	bio?: string;
	auto_tag_disabled?: true;
	signature_emojis?: Array<SignatureEmoji>;
}

export interface TyneBundleManifest {
	format: typeof TYNE_BUNDLE_FORMAT;
	version: typeof TYNE_BUNDLE_VERSION;
	pluralkit_file: string;
	/** The full tag, when `pluralkit.json` has it shortened. */
	tag_text?: string;
	/** Path of the tag icon inside the zip. */
	tag_icon?: string;
	/** The tag icon's link, when it is a link rather than an image stored on Tyne. */
	tag_icon_url?: string;
	members: Record<string, TyneBundleMemberEntry>;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
	return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : undefined;
}

/** Reads `tyne.json` from a bundle, keeping only well-formed values. Null when it is not one. */
export function readTyneBundleManifest(raw: unknown): TyneBundleManifest | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const file = raw as Record<string, unknown>;
	if (file.format !== TYNE_BUNDLE_FORMAT || file.version !== TYNE_BUNDLE_VERSION) return null;
	const manifest: TyneBundleManifest = {
		format: TYNE_BUNDLE_FORMAT,
		version: TYNE_BUNDLE_VERSION,
		pluralkit_file: optionalString(file.pluralkit_file, 255) ?? PERSONA_BUNDLE_FILES.pluralKit,
		members: {},
	};
	const tagText = optionalString(file.tag_text, 100);
	if (tagText) manifest.tag_text = tagText;
	const tagIcon = optionalString(file.tag_icon, 255);
	if (tagIcon) manifest.tag_icon = tagIcon;
	const tagIconUrl = optionalString(file.tag_icon_url, 256);
	if (tagIconUrl) manifest.tag_icon_url = tagIconUrl;
	const members = file.members;
	if (members && typeof members === 'object' && !Array.isArray(members)) {
		for (const [id, value] of Object.entries(members as Record<string, unknown>)) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			const source = value as Record<string, unknown>;
			const entry: TyneBundleMemberEntry = {};
			const avatar = optionalString(source.avatar, 255);
			if (avatar) entry.avatar = avatar;
			const banner = optionalString(source.banner, 255);
			if (banner) entry.banner = banner;
			const bio = optionalString(source.bio, 4096);
			if (bio) entry.bio = bio;
			if (source.auto_tag_disabled === true) entry.auto_tag_disabled = true;
			if (Array.isArray(source.signature_emojis)) {
				entry.signature_emojis = source.signature_emojis.filter(
					(emoji): emoji is SignatureEmoji =>
						Boolean(emoji) && typeof emoji === 'object' && typeof (emoji as SignatureEmoji).name === 'string',
				);
			}
			manifest.members[id] = entry;
		}
	}
	return manifest;
}

// File names inside the bundle

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Characters Windows or macOS refuse in a file name, control characters, and the invisible
// direction marks that can make a name display with a different extension than it has.
const UNSAFE_FILE_NAME_CHARACTERS = /[\p{Cc}\p{Bidi_Control}<>:"/\\|?*]/gu;
const MAX_FILE_BASE_NAME_BYTES = 150;

/** A persona name made safe to use as a file name on Windows, macOS and Linux. */
export function safeFileBaseName(name: string): string {
	let base = name
		.normalize('NFC')
		.replace(UNSAFE_FILE_NAME_CHARACTERS, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[. ]+/, '')
		.replace(/[. ]+$/, '');
	const encoder = new TextEncoder();
	if (encoder.encode(base).length > MAX_FILE_BASE_NAME_BYTES) {
		const characters = Array.from(base);
		while (characters.length > 0 && encoder.encode(characters.join('')).length > MAX_FILE_BASE_NAME_BYTES) {
			characters.pop();
		}
		base = characters.join('').replace(/[. ]+$/, '');
	}
	if (base.length === 0) base = 'Persona';
	if (WINDOWS_RESERVED_NAME.test(base)) base = `${base}_`;
	return base;
}

/**
 * One file name per persona, from its name, unique ignoring case: the second "Alice" is
 * "Alice (2)". Each persona's avatar and banner use the same name in their own folder.
 */
export function assignPersonaFileBaseNames(
	personas: ReadonlyArray<{key: string; name: string}>,
	reserved: ReadonlyArray<string> = [],
): Map<string, string> {
	const used = new Set(reserved.map((name) => name.toLowerCase()));
	const assigned = new Map<string, string>();
	for (const persona of personas) {
		const base = safeFileBaseName(persona.name);
		let candidate = base;
		for (let n = 2; used.has(candidate.toLowerCase()); n++) {
			candidate = `${base} (${n})`;
		}
		used.add(candidate.toLowerCase());
		assigned.set(persona.key, candidate);
	}
	return assigned;
}

/** The file extension for an image, read from its first bytes. */
export function imageFileExtension(bytes: Uint8Array): string {
	const startsWith = (signature: ReadonlyArray<number>, offset = 0) =>
		signature.every((byte, i) => bytes[offset + i] === byte);
	const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
	if (startsWith([0x89, 0x50, 0x4e, 0x47])) return 'png';
	if (startsWith([0xff, 0xd8, 0xff])) return 'jpg';
	if (ascii(0, 4) === 'GIF8') return 'gif';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
	if (ascii(4, 4) === 'ftyp') {
		const brand = ascii(8, 4);
		if (brand === 'avif' || brand === 'avis') return 'avif';
		if (brand.startsWith('hei') || brand === 'mif1') return 'heic';
	}
	if (startsWith([0xff, 0x0a]) || startsWith([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return 'jxl';
	const head = ascii(0, Math.min(bytes.length, 256)).trimStart();
	if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
	return 'bin';
}

// The whole bundle's text files

export interface PersonaBundleImage {
	/** Path inside the zip; null when the image could not be read and is not in the zip. */
	path: string | null;
	/** Where the image is linked from in `pluralkit.json`. */
	url: string | null;
	/** The link points at this instance's media server rather than at where the image came from. */
	hostedOnTyne: boolean;
}

export interface PersonaBundlePersona extends Omit<PluralKitExportPersona, 'avatarUrl' | 'bannerUrl'> {
	avatar: PersonaBundleImage | null;
	banner: PersonaBundleImage | null;
	autoTagDisabled: boolean;
	signatureEmojis: ReadonlyArray<SignatureEmoji>;
}

export interface PersonaBundleInput {
	exportedAt: Date;
	/** Host name of this instance's media server, named in the README. */
	mediaHost: string;
	tagText: string | null;
	tagIcon: {path: string} | {url: string} | null;
	personas: ReadonlyArray<PersonaBundlePersona>;
}

export interface PersonaBundleText {
	pluralKitJson: string;
	manifestJson: string;
	readme: string;
}

/** `pluralkit.json`, `tyne.json` and `README.txt` for a bundle whose images have been placed. */
export function buildPersonaBundleText(input: PersonaBundleInput): PersonaBundleText {
	const {file, shortened} = buildPluralKitExport({
		tag: input.tagText,
		personas: input.personas.map((persona) => ({
			...persona,
			avatarUrl: persona.avatar?.url ?? null,
			bannerUrl: persona.banner?.url ?? null,
		})),
	});

	const manifest: TyneBundleManifest = {
		format: TYNE_BUNDLE_FORMAT,
		version: TYNE_BUNDLE_VERSION,
		pluralkit_file: PERSONA_BUNDLE_FILES.pluralKit,
		members: {},
	};
	if (shortened.some((entry) => entry.field === 'tag') && input.tagText) manifest.tag_text = input.tagText;
	if (input.tagIcon && 'path' in input.tagIcon) manifest.tag_icon = input.tagIcon.path;
	if (input.tagIcon && 'url' in input.tagIcon) manifest.tag_icon_url = input.tagIcon.url;
	const shortenedBios = new Map(
		shortened.filter((entry) => entry.field === 'description').map((entry) => [entry.exportId, entry.fullText]),
	);
	for (const persona of input.personas) {
		const entry: TyneBundleMemberEntry = {};
		if (persona.avatar?.path) entry.avatar = persona.avatar.path;
		if (persona.banner?.path) entry.banner = persona.banner.path;
		const fullBio = shortenedBios.get(persona.exportId);
		if (fullBio) entry.bio = fullBio;
		if (persona.autoTagDisabled) entry.auto_tag_disabled = true;
		if (persona.signatureEmojis.length > 0) entry.signature_emojis = [...persona.signatureEmojis];
		manifest.members[persona.exportId] = entry;
	}

	return {
		pluralKitJson: `${JSON.stringify(file, null, '\t')}\n`,
		manifestJson: `${JSON.stringify(manifest, null, '\t')}\n`,
		readme: buildPersonaBundleReadme(input, shortened),
	};
}

const PLURALKIT_MEMBER_ID = /^[a-z]{5,6}$/i;

/** How to name a member in a PluralKit command: its PluralKit ID when it has one, else its name. */
export function pluralKitMemberReference(exportId: string, name: string): string {
	if (PLURALKIT_MEMBER_ID.test(exportId)) return exportId.toLowerCase();
	return /\s/.test(name) ? `"${name}"` : name;
}

function buildPersonaBundleReadme(input: PersonaBundleInput, shortened: ReadonlyArray<PluralKitShortenedText>): string {
	const date = input.exportedAt.toISOString().slice(0, 10);
	const lines: Array<string> = [];
	const hasAvatars = input.personas.some((persona) => persona.avatar?.path);
	const hasBanners = input.personas.some((persona) => persona.banner?.path);
	const tagIconPath = input.tagIcon && 'path' in input.tagIcon ? input.tagIcon.path : null;

	lines.push(`Personas exported from Tyne on ${date}`, '');
	lines.push('What is in here', '');
	lines.push(
		`  ${PERSONA_BUNDLE_FILES.pluralKit}   your ${input.personas.length} persona(s) as a PluralKit export file`,
	);
	lines.push(`  ${PERSONA_BUNDLE_FILES.manifest}        which image belongs to which persona, and details`);
	lines.push('                   PluralKit has no place for');
	if (hasAvatars)
		lines.push(`  ${PERSONA_BUNDLE_FILES.avatarFolder}/         persona avatars, named after the personas`);
	if (hasBanners)
		lines.push(`  ${PERSONA_BUNDLE_FILES.bannerFolder}/         persona banners, named after the personas`);
	if (tagIconPath) lines.push(`  ${tagIconPath}     the icon shown next to your system tag in Tyne`);
	lines.push('');
	lines.push('Two personas with the same name get files like "Alice.png" and "Alice (2).png".');
	lines.push('');

	lines.push('Bringing these personas back into Tyne', '');
	lines.push('In Tyne, open User Settings, then Personas, choose "Import from PluralKit" and pick');
	lines.push('this .zip file itself, not the unzipped folder. The images are read from the zip.');
	lines.push('Personas that are already in your account are updated instead of added twice.');
	lines.push('');

	lines.push('Importing into PluralKit', '');
	lines.push(`1. In Discord, send "pk;import" with ${PERSONA_BUNDLE_FILES.pluralKit} attached.`);
	lines.push('');
	lines.push('   PluralKit reads images from links, not from files. Images that came from');
	lines.push('   PluralKit and were not changed in Tyne link to where PluralKit had them. All');
	lines.push(`   others link to Tyne's media server (${input.mediaHost}), and keep working for as`);
	lines.push('   long as your Tyne account keeps them.');
	lines.push('');

	const attach: Array<string> = [];
	for (const persona of input.personas) {
		const reference = pluralKitMemberReference(persona.exportId, persona.name);
		if (persona.avatar?.path && persona.avatar.hostedOnTyne) {
			const field = persona.avatarOrigin?.field === 'webhook_avatar_url' ? 'proxyavatar' : 'avatar';
			attach.push(`   pk;member ${reference} ${field}`, `      attach: ${persona.avatar.path}`);
		}
		if (persona.banner?.path && persona.banner.hostedOnTyne) {
			attach.push(`   pk;member ${reference} banner`, `      attach: ${persona.banner.path}`);
		}
	}
	if (attach.length > 0) {
		lines.push("2. Optional: to move the images that link to Tyne onto PluralKit's own image");
		lines.push('   hosting, so they keep working without Tyne, send each command below in');
		lines.push('   Discord with the named file attached. PluralKit copies images sent as');
		lines.push('   attachments to its own server.');
		lines.push('');
		lines.push(...attach);
		lines.push('');
		lines.push('   Personas made in Tyne get a new ID in PluralKit, so their commands use the');
		lines.push('   name. If two members share a name, use the ID "pk;system list" shows instead.');
		lines.push('');
	}

	lines.push('Good to know', '');
	lines.push('- PluralKit matches each persona to a member it already has by ID first, then by');
	lines.push('  exact name. A persona with the same name as an existing member updates that member.');
	lines.push('- Members that are not in the file are left alone, and so is everything Tyne does');
	lines.push('  not keep: birthdays, display names, groups, front history and the like.');
	lines.push('- Privacy: public personas are written as fully public, unlisted ones as hidden from');
	lines.push('  the member list, and private ones with every privacy setting private.');
	if (tagIconPath) {
		lines.push('- PluralKit has no tag icon, so the tag icon is only in this zip and in Tyne.');
	}
	for (const entry of shortened) {
		if (entry.field === 'tag') {
			lines.push(
				`- Your system tag was cut to ${PLURALKIT_LIMITS.systemTag} characters for PluralKit. The full tag is in`,
				`  ${PERSONA_BUNDLE_FILES.manifest} and comes back when you import this zip into Tyne.`,
			);
		} else {
			const persona = input.personas.find((candidate) => candidate.exportId === entry.exportId);
			lines.push(
				`- The bio of ${persona?.name ?? entry.exportId} was cut to ${PLURALKIT_LIMITS.description} characters for PluralKit. The full`,
				`  text is in ${PERSONA_BUNDLE_FILES.manifest} and comes back when you import this zip into Tyne.`,
			);
		}
	}
	lines.push('');
	return lines.join('\n');
}
