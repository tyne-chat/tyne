// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import type {
	PersonaTag,
	PersonaVisibility,
	PublicPersonaResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';

/** One persona as the Personas tab and sheet show it (tyne-chat/tyne#189). */
export interface GalleryPersona {
	id: string;
	name: string;
	avatar: string | null;
	banner: string | null;
	pronouns: string | null;
	color: number | null;
	avatarColor: number | null;
	bio: string | null;
	visibility: PersonaVisibility;
	/** Position in the most-used order: 0 is the most used. */
	usedRank: number;
	/** When it was last used; known for one's own personas only. */
	lastUsedAt: number | null;
	/** Its proxy tags; one's own personas only. */
	tags: ReadonlyArray<PersonaTag>;
	/** When it was made in Tyne, read from its id. */
	createdAt: number;
}

export type PersonaGallerySort = 'name' | 'used' | 'recent';
export type PersonaGalleryView = 'gallery' | 'list' | 'avatars';

export const PERSONA_GALLERY_VIEWS: ReadonlyArray<PersonaGalleryView> = ['gallery', 'list', 'avatars'];

/** Someone else's public personas, in the server's order, which is the most used first. */
export function galleryItemsFromPublic(personas: ReadonlyArray<PublicPersonaResponse>): Array<GalleryPersona> {
	return personas.map((p, index) => ({
		id: p.id,
		name: p.name,
		avatar: p.avatar_hash ?? null,
		banner: p.banner_hash ?? null,
		pronouns: p.pronouns ?? null,
		color: p.color ?? null,
		avatarColor: p.avatar_color ?? null,
		bio: p.bio ?? null,
		visibility: p.visibility,
		usedRank: index,
		lastUsedAt: null,
		tags: [],
		createdAt: extractTimestamp(p.id),
	}));
}

/** One's own personas, all of them; the gallery decides which to show. */
export function galleryItemsFromOwn(personas: ReadonlyArray<ClientPersona>): Array<GalleryPersona> {
	const byUse = [...personas].sort((a, b) => (b.use_count ?? 0) - (a.use_count ?? 0) || compareIds(a.id, b.id));
	const rank = new Map(byUse.map((p, index) => [p.id, index]));
	return personas.map((p) => {
		const lastUsed = p.last_used_at_ms ? Number(p.last_used_at_ms) : null;
		return {
			id: p.id,
			name: p.name,
			avatar: p.avatar_hash ?? null,
			banner: p.banner_hash ?? null,
			pronouns: p.pronouns ?? null,
			color: p.color ?? null,
			avatarColor: p.avatar_color ?? null,
			bio: p.bio ?? null,
			visibility: p.visibility ?? 'unlisted',
			usedRank: rank.get(p.id) ?? 0,
			lastUsedAt: lastUsed !== null && Number.isFinite(lastUsed) ? lastUsed : null,
			tags: p.persona_tags ?? [],
			createdAt: extractTimestamp(p.id),
		};
	});
}

function compareIds(a: string, b: string): number {
	if (a.length !== b.length) return a.length - b.length;
	return a < b ? -1 : 1;
}

/** Name, pronouns and bio, matched without case. */
export function filterGalleryItems(items: ReadonlyArray<GalleryPersona>, query: string): Array<GalleryPersona> {
	const q = query.trim().toLocaleLowerCase();
	if (!q) return [...items];
	return items.filter((p) =>
		[p.name, p.pronouns ?? '', p.bio ?? ''].some((field) => field.toLocaleLowerCase().includes(q)),
	);
}

export function sortGalleryItems(
	items: ReadonlyArray<GalleryPersona>,
	sort: PersonaGallerySort,
	locale?: string,
): Array<GalleryPersona> {
	const byName = (a: GalleryPersona, b: GalleryPersona) =>
		a.name.localeCompare(b.name, locale, {sensitivity: 'base', numeric: true});
	const sorted = [...items];
	switch (sort) {
		case 'used':
			return sorted.sort((a, b) => a.usedRank - b.usedRank || byName(a, b));
		case 'recent':
			return sorted.sort((a, b) => (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1) || a.usedRank - b.usedRank);
		default:
			return sorted.sort(byName);
	}
}

const MARKDOWN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
	[/```[\s\S]*?```/g, ' '],
	[/<a?:(\w+):\d+>/g, ':$1:'],
	[/<[@#][!&]?[\d:]+>/g, ''],
	[/<t:\d+(?::\w)?>/g, ''],
	[/!?\[([^\]]*)\]\([^)]*\)/g, '$1'],
	[/^\s{0,3}(?:#{1,6}|>+|-#)\s+/gm, ''],
	[/^\s*(?:[-*+]|\d+\.)\s+/gm, ''],
	[/(\*\*|__|\*|_|~~|\|\||`)/g, ''],
];

/** A bio as one line of plain text, for a card or a row: no headings, links, spoilers or code. */
export function plainBio(bio: string | null | undefined): string {
	if (!bio) return '';
	let text = bio;
	for (const [pattern, replacement] of MARKDOWN_PATTERNS) {
		text = text.replace(pattern, replacement);
	}
	return text.replace(/\s+/g, ' ').trim();
}
