// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: how a reviewed import classifies each member of a file against the account's personas
// (tyne-chat/tyne#243; the design is tyne-tools notes/persona-import-redesign.md). Pure: the caller
// loads the personas and the image sources, and nothing here writes.
//
// The passes, each over every member still open before the next starts, so strong evidence claims
// a persona before weak evidence can:
//   1. The PluralKit id: a live persona linked to the member (identical or different), else the
//      deleted one (the most used of several).
//   2. Name and tag, one to one: the one unclaimed persona with the same name and a shared tag, when
//      no other member matches it the same way. A persona linked to another member is never this.
//   3. Name or tag: unclaimed personas with the same name, or a tag in common (also one differing
//      only in case). The member's identity is the person's call.
//   4. A tag (or, from a Tyne export, a signature emoji) held by a live persona or shared with
//      another member still open: both go to review, neither wins by file order. Otherwise new.

import type {PersonaImageSourceRow} from '@app/api/database/types/PersonaTypes';
import type {Persona} from '@app/api/models/Persona';
import {getTagKey, normalizeTag, tagKeys} from '@app/api/persona/PersonaTagKeys';
import type {PersonaTag, SignatureEmoji} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	PersonaImportCandidate,
	PersonaImportClash,
	PersonaImportDifference,
	PersonaImportImageRef,
	PersonaImportPreviewEntry,
	PersonaImportPreviewMember,
	PersonaImportSourceKind,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {tyneMediaLinkHash} from '@fluxer/schema/src/domains/persona/PluralKitFormat';

/** An animated picture's hash carries `a_`; the stored file is the same either way. */
function withoutAnimationFlag(hash: string): string {
	return hash.replace(/^a_/, '');
}

export interface PersonaImportPlanInput {
	source: PersonaImportSourceKind;
	members: ReadonlyArray<PersonaImportPreviewMember>;
	live: ReadonlyArray<Persona>;
	deleted: ReadonlyArray<Persona>;
	/** What earlier imports recorded about each persona's pictures, by persona id. */
	imageSources: ReadonlyMap<string, PersonaImageSourceRow>;
	/** The hash in a link to one of the account's own pictures on this instance, else null. */
	ownImageHash: (url: string, kind: 'avatar' | 'banner') => string | null;
}

export interface PersonaImportPlan {
	entries: Array<PersonaImportPreviewEntry>;
	/** Every persona the entries name. */
	referencedIds: Set<string>;
	/** Live personas no member matched. */
	untouched: number;
}

/** Names compare after trimming and Unicode normalisation; case and every other character count. */
function normalizePersonaName(name: string | null | undefined): string {
	return (name ?? '').trim().normalize('NFC');
}

function foldedTagKeys(tags: ReadonlyArray<PersonaTag> | null | undefined): Array<string> {
	return tagKeys(tags).map((key) => key.toLowerCase());
}

function emojiKey(emoji: SignatureEmoji): string {
	return emoji.id ? `custom:${emoji.id}` : `unicode:${emoji.name}`;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
	return (a ?? '').trim() === (b ?? '').trim();
}

function textDifference(
	field: 'pronouns' | 'bio',
	tyne: string | null | undefined,
	file: string | null | undefined,
): PersonaImportDifference | null {
	if (sameText(tyne, file)) return null;
	return {field, change: (file ?? '').trim() === '' ? 'removed' : 'changed'};
}

function sameKeySet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
	const left = new Set(a);
	const right = new Set(b);
	return left.size === right.size && [...left].every((key) => right.has(key));
}

/** Newer persona ids first, for an order that does not depend on how the rows were read. */
function compareIdsDescending(a: Persona, b: Persona): number {
	if (b.id === a.id) return 0;
	return b.id > a.id ? 1 : -1;
}

function matchedOn(sameName: boolean, sharesTag: boolean): PersonaImportCandidate['matched_on'] {
	if (sameName && sharesTag) return 'name_and_tag';
	if (sameName) return 'name';
	return sharesTag ? 'tag' : 'tag_case';
}

/** The member's linked id, when the file gives one. */
function memberId(member: PersonaImportPreviewMember): string | null {
	const id = member.external_uuid?.trim();
	return id ? id : null;
}

/** Whether a persona is linked to this PluralKit id (a Tyne export writes a Tyne-made persona's own id). */
function isLinkedTo(persona: Persona, id: string): boolean {
	return persona.externalUuid === id || persona.id.toString() === id;
}

export function planPersonaImport(input: PersonaImportPlanInput): PersonaImportPlan {
	const {members, live, deleted, imageSources, ownImageHash} = input;
	const entries: Array<PersonaImportPreviewEntry | undefined> = members.map(() => undefined);
	const referencedIds = new Set<string>();
	const fileIds = new Set(members.map(memberId).filter((id): id is string => id !== null));
	const fromTyne = input.source === 'tyne';

	// A stored copy of a picture the file names, when one is known: a link to the account's own media,
	// or a link an earlier import recorded for some persona, with the hash it stored then.
	const storedByUrl: Record<'avatar' | 'banner', Map<string, string>> = {avatar: new Map(), banner: new Map()};
	for (const row of imageSources.values()) {
		if (row.avatar_url && row.avatar_hash) storedByUrl.avatar.set(row.avatar_url, row.avatar_hash);
		if (row.banner_url && row.banner_hash) storedByUrl.banner.set(row.banner_url, row.banner_hash);
	}
	const storedHash = (ref: PersonaImportImageRef, kind: 'avatar' | 'banner'): string | null => {
		if (ref?.hash) return ref.hash;
		if (!ref?.url) return null;
		return ownImageHash(ref.url, kind) ?? storedByUrl[kind].get(ref.url) ?? null;
	};
	const imageDifference = (
		kind: 'avatar' | 'banner',
		ref: PersonaImportImageRef,
		current: string | null,
	): PersonaImportDifference | null => {
		const fileHasPicture = Boolean(ref?.url || ref?.hash);
		if (!fileHasPicture) return current ? {field: kind, change: 'removed'} : null;
		if (!current) return {field: kind, change: 'changed'};
		// A link to Tyne media names the stored file by its hash: the same hash is the same file, even
		// when the copy stored from the link (converted to the link's format) has another.
		const linked = ref?.url ? tyneMediaLinkHash(ref.url, kind) : null;
		if (linked && withoutAnimationFlag(linked) === withoutAnimationFlag(current)) return null;
		const known = storedHash(ref, kind);
		if (known === null) return {field: kind, change: 'not_compared'};
		return known === current ? null : {field: kind, change: 'changed'};
	};
	const differencesOf = (persona: Persona, member: PersonaImportPreviewMember): Array<PersonaImportDifference> => {
		const differences: Array<PersonaImportDifference> = [];
		if (normalizePersonaName(persona.name) !== normalizePersonaName(member.name)) {
			differences.push({field: 'name', change: 'changed'});
		}
		for (const difference of [
			textDifference('pronouns', persona.pronouns, member.pronouns),
			textDifference('bio', persona.bio, member.bio),
		]) {
			if (difference) differences.push(difference);
		}
		if ((persona.color ?? null) !== (member.color ?? null)) {
			differences.push({field: 'color', change: member.color == null ? 'removed' : 'changed'});
		}
		const fileTags = tagKeys(member.persona_tags);
		if (!sameKeySet(tagKeys(persona.personaTags), fileTags)) {
			differences.push({field: 'persona_tags', change: fileTags.length === 0 ? 'removed' : 'changed'});
		}
		for (const difference of [
			imageDifference('avatar', member.avatar, persona.avatarHash),
			imageDifference('banner', member.banner, persona.bannerHash),
		]) {
			if (difference) differences.push(difference);
		}
		if (fromTyne) {
			const fileEmojis = (member.signature_emojis ?? []).map(emojiKey);
			if (!sameKeySet(persona.signatureEmojis.map(emojiKey), fileEmojis)) {
				differences.push({field: 'signature_emojis', change: fileEmojis.length === 0 ? 'removed' : 'changed'});
			}
			if (persona.autoTagDisabled !== Boolean(member.auto_tag_disabled)) {
				differences.push({field: 'auto_tag_disabled', change: 'changed'});
			}
		}
		if (member.visibility && member.visibility !== persona.visibility) {
			differences.push({field: 'visibility', change: 'info'});
		}
		return differences;
	};
	const images = (member: PersonaImportPreviewMember) => ({
		avatar_hash: storedHash(member.avatar, 'avatar'),
		banner_hash: storedHash(member.banner, 'banner'),
	});

	// Pass 1: the PluralKit id.
	const claimed = new Set<string>();
	for (const persona of live) {
		for (const id of fileIds) {
			if (isLinkedTo(persona, id)) claimed.add(persona.id.toString());
		}
	}
	members.forEach((member, index) => {
		const id = memberId(member);
		if (!id) return;
		const linkedLive = live.filter((persona) => isLinkedTo(persona, id));
		if (linkedLive.length > 1) {
			entries[index] = {
				index,
				kind: 'cant_tell',
				candidates: linkedLive.map((persona) => ({
					persona_id: persona.id.toString(),
					matched_on: 'name_and_tag',
					linked_elsewhere: false,
				})),
				...images(member),
			};
			for (const persona of linkedLive) referencedIds.add(persona.id.toString());
			return;
		}
		const linked = linkedLive[0];
		if (linked) {
			const differences = differencesOf(linked, member);
			const differs = differences.some((d) => d.change === 'changed' || d.change === 'removed');
			entries[index] = {
				index,
				kind: differs ? 'differs' : 'up_to_date',
				persona_id: linked.id.toString(),
				differences,
				...images(member),
			};
			referencedIds.add(linked.id.toString());
			return;
		}
		const linkedDeleted = deleted
			.filter((persona) => isLinkedTo(persona, id))
			.sort(
				(a, b) =>
					b.useCount - a.useCount ||
					(b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0) ||
					compareIdsDescending(a, b),
			)[0];
		if (linkedDeleted) {
			entries[index] = {index, kind: 'deleted', persona_id: linkedDeleted.id.toString(), ...images(member)};
			referencedIds.add(linkedDeleted.id.toString());
		}
	});

	// The personas the later passes may match: live, and claimed by no member of this file.
	const unclaimed = live.filter((persona) => !claimed.has(persona.id.toString()));
	const linkedElsewhere = (persona: Persona) => persona.externalUuid !== null && persona.externalUuid !== undefined;
	const open = () => members.map((_, index) => index).filter((index) => entries[index] === undefined);

	// Pass 2: name and tag, one to one, over the personas unclaimed after pass 1.
	const nameAndTag = new Map<number, Array<Persona>>();
	const matchedBy = new Map<string, Array<number>>();
	for (const index of open()) {
		const member = members[index]!;
		const name = normalizePersonaName(member.name);
		const keys = new Set(tagKeys(member.persona_tags));
		const matches = unclaimed.filter(
			(persona) =>
				normalizePersonaName(persona.name) === name && tagKeys(persona.personaTags).some((key) => keys.has(key)),
		);
		if (matches.length === 0) continue;
		nameAndTag.set(index, matches);
		for (const persona of matches) {
			const id = persona.id.toString();
			matchedBy.set(id, [...(matchedBy.get(id) ?? []), index]);
		}
	}
	const claimedInPass2 = new Set<string>();
	for (const [index, matches] of nameAndTag) {
		const only = matches.length === 1 ? matches[0] : undefined;
		if (only && !linkedElsewhere(only) && matchedBy.get(only.id.toString())?.length === 1) {
			entries[index] = {index, kind: 'probably_same', persona_id: only.id.toString(), ...images(members[index]!)};
			claimedInPass2.add(only.id.toString());
			referencedIds.add(only.id.toString());
		}
	}

	// Pass 3: name or tag. Includes the members pass 2 found more than one way to match.
	const stillUnclaimed = unclaimed.filter((persona) => !claimedInPass2.has(persona.id.toString()));
	for (const index of open()) {
		const member = members[index]!;
		const name = normalizePersonaName(member.name);
		const keys = new Set(tagKeys(member.persona_tags));
		const folded = new Set(foldedTagKeys(member.persona_tags));
		const candidates: Array<PersonaImportCandidate> = [];
		for (const persona of stillUnclaimed) {
			const sameName = normalizePersonaName(persona.name) === name;
			const sharesTag = tagKeys(persona.personaTags).some((key) => keys.has(key));
			const sharesFolded = !sharesTag && foldedTagKeys(persona.personaTags).some((key) => folded.has(key));
			if (!sameName && !sharesTag && !sharesFolded) continue;
			candidates.push({
				persona_id: persona.id.toString(),
				matched_on: matchedOn(sameName, sharesTag),
				linked_elsewhere: linkedElsewhere(persona),
			});
		}
		if (candidates.length === 0) continue;
		entries[index] = {index, kind: 'cant_tell', candidates, ...images(member)};
		for (const candidate of candidates) referencedIds.add(candidate.persona_id);
	}

	// Pass 4: tags and signature emojis held elsewhere, then new.
	const tagHolders = new Map<string, Persona>();
	const emojiHolders = new Map<string, Persona>();
	for (const persona of live) {
		for (const key of tagKeys(persona.personaTags)) tagHolders.set(key, persona);
		for (const emoji of persona.signatureEmojis) emojiHolders.set(emojiKey(emoji), persona);
	}
	const remaining = open();
	const tagUsers = new Map<string, Array<number>>();
	const emojiUsers = new Map<string, Array<number>>();
	for (const index of remaining) {
		for (const key of new Set(tagKeys(members[index]!.persona_tags))) {
			tagUsers.set(key, [...(tagUsers.get(key) ?? []), index]);
		}
		if (fromTyne) {
			for (const key of new Set((members[index]!.signature_emojis ?? []).map(emojiKey))) {
				emojiUsers.set(key, [...(emojiUsers.get(key) ?? []), index]);
			}
		}
	}
	for (const index of remaining) {
		const member = members[index]!;
		const clashes: Array<PersonaImportClash> = [];
		for (const tag of member.persona_tags ?? []) {
			const norm = normalizeTag(tag);
			if (!norm.prefix && !norm.suffix) continue;
			const key = getTagKey(norm);
			const holder = tagHolders.get(key);
			if (holder) {
				clashes.push({tag, held_by_persona_id: holder.id.toString()});
				referencedIds.add(holder.id.toString());
				continue;
			}
			const other = tagUsers.get(key)?.find((otherIndex) => otherIndex !== index);
			if (other !== undefined) clashes.push({tag, shared_with_member: other});
		}
		if (fromTyne) {
			for (const emoji of member.signature_emojis ?? []) {
				const key = emojiKey(emoji);
				const holder = emojiHolders.get(key);
				if (holder) {
					clashes.push({emoji, held_by_persona_id: holder.id.toString()});
					referencedIds.add(holder.id.toString());
					continue;
				}
				const other = emojiUsers.get(key)?.find((otherIndex) => otherIndex !== index);
				if (other !== undefined) clashes.push({emoji, shared_with_member: other});
			}
		}
		entries[index] = {
			index,
			kind: clashes.length > 0 ? 'tag_in_use' : 'new',
			...(clashes.length > 0 ? {clashes} : {}),
			...images(member),
		};
	}

	// What a plain add would clash on, for the members that may be added separately (2 and 3).
	for (const entry of entries) {
		if (!entry || (entry.kind !== 'probably_same' && entry.kind !== 'cant_tell')) continue;
		const member = members[entry.index]!;
		const clashes: Array<PersonaImportClash> = [];
		for (const tag of member.persona_tags ?? []) {
			const holder = tagHolders.get(getTagKey(normalizeTag(tag)));
			if (holder) clashes.push({tag, held_by_persona_id: holder.id.toString()});
		}
		if (fromTyne) {
			for (const emoji of member.signature_emojis ?? []) {
				const holder = emojiHolders.get(emojiKey(emoji));
				if (holder) clashes.push({emoji, held_by_persona_id: holder.id.toString()});
			}
		}
		if (clashes.length > 0) entry.clashes = clashes;
	}

	// Untouched: no member is linked to it, probably it, or may be it.
	const matched = new Set<string>([...claimed, ...claimedInPass2]);
	for (const entry of entries) {
		for (const candidate of entry?.candidates ?? []) matched.add(candidate.persona_id);
	}
	return {
		entries: entries.map((entry, index) => entry ?? {index, kind: 'new'}),
		referencedIds,
		untouched: live.filter((persona) => !matched.has(persona.id.toString())).length,
	};
}
