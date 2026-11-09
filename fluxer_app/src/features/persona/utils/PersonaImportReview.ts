// SPDX-License-Identifier: AGPL-3.0-or-later

// The reviewed import's decisions (tyne-chat/tyne#243): what the preview is asked, what each kind of
// member starts on (always the choice that changes or adds the least), what the footer says, which
// choices would clash, and the actions sent. Pure, so the review and its tests share it. The rules
// for classifying members are the server's (`PersonaImportPlanner`).

import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import type {
	PersonaImportItem,
	PersonaResponse,
	PersonaTag,
	SignatureEmoji,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	PersonaImportAction,
	PersonaImportPreviewEntry,
	PersonaImportPreviewMember,
	PersonaImportPreviewRequest,
	PersonaImportSourceKind,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {
	ownTyneMediaImageHash,
	type PersonaImportStoredImages,
	type PluralKitImportedMember,
	personaImportItem,
	type TyneBundleMemberEntry,
} from '@fluxer/schema/src/domains/persona/PluralKitFormat';

/** A member of the file with a name, as the preview and the apply see it. Unnamed members are left out. */
export interface ReviewMember {
	member: PluralKitImportedMember & {name: string};
	extras: TyneBundleMemberEntry | undefined;
	preview: PersonaImportPreviewMember;
}

export function sourceKindOf(source: PersonaImportSource): PersonaImportSourceKind {
	return source.kind === 'bundle' ? 'tyne' : 'pluralkit';
}

/**
 * The preview request for a file. Pictures go as the file's links (never fetched by the preview);
 * a link to this account's own media goes as its hash. The display tag is the file's system tag (or a
 * Tyne export's full tag), never the system's name.
 */
export function buildPreviewRequest(
	source: PersonaImportSource,
	ownUserId: string | null,
	mediaEndpoint: string | null,
	stored?: ReadonlyMap<number, StoredPictures>,
): {request: PersonaImportPreviewRequest; members: Array<ReviewMember>} {
	const bundle = source.kind === 'bundle' ? source : null;
	const members: Array<ReviewMember> = [];
	for (const member of source.system.members) {
		if (member.name === null) continue;
		const named = {...member, name: member.name};
		const extras = bundle && member.id ? bundle.manifest.members[member.id] : undefined;
		// A picture stored before the review is compared by its hash, the zip's included.
		const storedImages = stored?.get(members.length)?.images;
		const image = (url: string | null, kind: 'avatar' | 'banner') => {
			const hash = storedImages?.[kind]?.hash;
			if (hash) return url ? {url, hash} : {hash};
			if (!url) return null;
			const own = ownUserId && mediaEndpoint ? ownTyneMediaImageHash(url, mediaEndpoint, kind, ownUserId) : null;
			return own ? {url, hash: own} : {url};
		};
		const preview: PersonaImportPreviewMember = {
			name: named.name,
			pronouns: member.pronouns,
			color: member.color,
			bio: extras?.bio ?? member.bio,
			persona_tags: member.personaTags,
			visibility: member.visibility,
			external_uuid: member.id,
			avatar: image(member.avatarUrl, 'avatar'),
			banner: image(member.bannerUrl, 'banner'),
		};
		if (bundle) {
			preview.signature_emojis = extras?.signature_emojis ?? [];
			preview.auto_tag_disabled = extras?.auto_tag_disabled === true;
		}
		members.push({member: named, extras, preview});
	}
	const tagText = (bundle?.manifest.tag_text ?? source.system.tag)?.trim() || null;
	const hasIcon = Boolean(bundle?.manifest.tag_icon || bundle?.manifest.tag_icon_url);
	return {
		request: {
			source: sourceKindOf(source),
			members: members.map((m) => m.preview),
			display_tag: tagText || hasIcon ? {text: tagText, has_icon: hasIcon} : null,
		},
		members,
	};
}

/** Every picture of every member, to store before the review. */
export function allPictures(members: ReadonlyArray<ReviewMember>): Map<number, {avatar: boolean; banner: boolean}> {
	return new Map(members.map((_, index) => [index, {avatar: true, banner: true}]));
}

/**
 * What happens to one member. `keep` leaves a linked persona as it is (or a deleted one deleted);
 * `add` makes a new persona, without the clashing tags when `withTags` is false, and with
 * `replacements` in their place: the tags the person gave it instead. An add with `copy` keeps both
 * versions of a persona that differs (tyne-chat/tyne#568): the file's is added unlinked under its own
 * name, with `replacements` in place of `replacedTags`, while the linked persona stays as it is.
 */
export type ReviewDecision =
	| {choice: 'keep'}
	| {choice: 'use_file'}
	| {choice: 'restore'}
	| {choice: 'link'; personaId: string}
	| {choice: 'add'; withTags: boolean; replacements?: ReadonlyArray<PersonaTag>; copy?: PersonaCopy}
	| {choice: 'skip'};

/**
 * The file's version of a persona, added under a name and tags of its own: next to Tyne's version of a
 * differing persona (unlinked), or a member whose tag another persona has (`linked`, tyne-chat/tyne#570).
 */
export interface PersonaCopy {
	name: string;
	/** Added linked to its member, as a new member is; otherwise unlinked, leaving the link where it is. */
	linked?: boolean;
	/** The file's tags another persona keeps; `replacements` stand in their place. */
	replacedTags: ReadonlyArray<PersonaTag>;
	/** The file's signature emojis another persona keeps, left off the copy. */
	droppedEmojis: ReadonlyArray<SignatureEmoji>;
}

/** How many members need a choice, the dialog's title count: probably-the-same and new ones are listed only. */
export function reviewNeedCount(entries: ReadonlyArray<PersonaImportPreviewEntry>): number {
	return entries.filter(
		(e) => e.kind === 'cant_tell' || e.kind === 'tag_in_use' || e.kind === 'differs' || e.kind === 'deleted',
	).length;
}

/** The safest choice for each kind: nothing existing changes, and no likely duplicate is made. */
export function defaultDecision(entry: PersonaImportPreviewEntry): ReviewDecision {
	switch (entry.kind) {
		case 'probably_same':
			return entry.persona_id ? {choice: 'link', personaId: entry.persona_id} : {choice: 'skip'};
		case 'cant_tell':
		case 'tag_in_use':
			return {choice: 'skip'};
		case 'new':
			return {choice: 'add', withTags: true};
		default:
			return {choice: 'keep'};
	}
}

/** Tags held by another persona, which an add for this member has to leave out. */
export function heldTags(entry: PersonaImportPreviewEntry): Array<PersonaTag> {
	return (entry.clashes ?? []).flatMap((clash) => (clash.tag && clash.held_by_persona_id ? [clash.tag] : []));
}

/** Tags shared with another member of the file, which only one of them can take. */
export function sharedTags(entry: PersonaImportPreviewEntry): Array<PersonaTag> {
	return (entry.clashes ?? []).flatMap((clash) =>
		clash.tag && clash.shared_with_member != null && !clash.held_by_persona_id ? [clash.tag] : [],
	);
}

function heldEmojis(entry: PersonaImportPreviewEntry): Array<SignatureEmoji> {
	return (entry.clashes ?? []).flatMap((clash) => (clash.emoji && clash.held_by_persona_id ? [clash.emoji] : []));
}

function sharedEmojis(entry: PersonaImportPreviewEntry): Array<SignatureEmoji> {
	return (entry.clashes ?? []).flatMap((clash) =>
		clash.emoji && clash.shared_with_member != null && !clash.held_by_persona_id ? [clash.emoji] : [],
	);
}

/** The tags an add leaves out: always those another persona holds, and the shared ones unless kept. */
function droppedTags(entry: PersonaImportPreviewEntry, decision: ReviewDecision): Array<PersonaTag> {
	if (decision.choice !== 'add') return [];
	return [...heldTags(entry), ...(decision.withTags ? [] : sharedTags(entry)), ...(decision.copy?.replacedTags ?? [])];
}

/** The tags a new persona for this member gets: the file's, less those left out, plus the replacements. */
export function addedTags(
	entry: PersonaImportPreviewEntry,
	decision: ReviewDecision,
	fileTags: ReadonlyArray<PersonaTag>,
): Array<PersonaTag> {
	if (decision.choice !== 'add') return [];
	const drop = new Set(droppedTags(entry, decision).map(tagKey));
	const replacements = (decision.replacements ?? []).filter((tag) => !isEmptyTag(tag)).map(cleanTag);
	return [...fileTags.filter((tag) => !drop.has(tagKey(tag))), ...replacements];
}

function droppedEmojis(entry: PersonaImportPreviewEntry, decision: ReviewDecision): Array<SignatureEmoji> {
	if (decision.choice !== 'add') return [];
	return [
		...heldEmojis(entry),
		...(decision.withTags ? [] : sharedEmojis(entry)),
		...(decision.copy?.droppedEmojis ?? []),
	];
}

export interface ReviewSummary {
	link: number;
	add: number;
	restore: number;
	useFile: number;
	skip: number;
	/** Linked personas left as they are: identical ones and those kept as Tyne has them. */
	kept: number;
	stayDeleted: number;
}

export function summarize(
	entries: ReadonlyArray<PersonaImportPreviewEntry>,
	decisions: ReadonlyMap<number, ReviewDecision>,
): ReviewSummary {
	const summary: ReviewSummary = {link: 0, add: 0, restore: 0, useFile: 0, skip: 0, kept: 0, stayDeleted: 0};
	for (const entry of entries) {
		const decision = decisions.get(entry.index) ?? defaultDecision(entry);
		switch (decision.choice) {
			case 'link':
				summary.link++;
				break;
			case 'add':
				summary.add++;
				break;
			case 'restore':
				summary.restore++;
				break;
			case 'use_file':
				summary.useFile++;
				break;
			case 'skip':
				summary.skip++;
				break;
			case 'keep':
				if (entry.kind === 'deleted') summary.stayDeleted++;
				else summary.kept++;
				break;
		}
	}
	return summary;
}

export interface ReviewConflict {
	/** The tag or emoji, as shown. */
	label: string;
	/** The names that would share it. */
	names: Array<string>;
}

function tagLabel(tag: PersonaTag): string {
	return `${(tag.prefix ?? '').trim()}text${(tag.suffix ?? '').trim()}`;
}

function tagKey(tag: PersonaTag): string {
	return JSON.stringify([(tag.prefix ?? '').trim(), (tag.suffix ?? '').trim()]);
}

function emojiKey(emoji: SignatureEmoji): string {
	return emoji.id ? `custom:${emoji.id}` : `unicode:${emoji.name}`;
}

/**
 * Choices that would put one tag (or signature emoji) on two personas once applied, which the server
 * would refuse: for example a linked persona taking the file's tags while a new member with one of
 * them is added. Restores never count: the server leaves off what another persona holds.
 */
type LivePersona = Pick<PersonaResponse, 'id' | 'name' | 'persona_tags' | 'signature_emojis'>;
type TagState = {name: string; tags: Array<PersonaTag>; emojis: Array<SignatureEmoji>};

/** Every persona's tags and emojis once the decisions are applied, keyed by persona id or `member:<index>`. */
function tagStates(
	entries: ReadonlyArray<PersonaImportPreviewEntry>,
	decisions: ReadonlyMap<number, ReviewDecision>,
	members: ReadonlyArray<ReviewMember>,
	livePersonas: ReadonlyArray<LivePersona>,
	fromTyne: boolean,
): Map<string, TagState> {
	const tags = new Map<string, TagState>();
	for (const persona of livePersonas) {
		tags.set(persona.id, {
			name: persona.name,
			tags: persona.persona_tags ?? [],
			emojis: persona.signature_emojis ?? [],
		});
	}
	for (const entry of entries) {
		const decision = decisions.get(entry.index) ?? defaultDecision(entry);
		const member = members[entry.index];
		if (!member) continue;
		const fileTags = member.preview.persona_tags ?? [];
		const fileEmojis = fromTyne ? (member.preview.signature_emojis ?? []) : [];
		if (decision.choice === 'use_file' && entry.persona_id) {
			const current = tags.get(entry.persona_id);
			tags.set(entry.persona_id, {
				name: member.preview.name,
				tags: fileTags,
				emojis: fromTyne ? fileEmojis : (current?.emojis ?? []),
			});
		} else if (decision.choice === 'add') {
			const dropEmojis = new Set(droppedEmojis(entry, decision).map(emojiKey));
			tags.set(`member:${entry.index}`, {
				name: decision.copy?.name.trim() || member.preview.name,
				tags: addedTags(entry, decision, fileTags),
				emojis: fileEmojis.filter((emoji) => !dropEmojis.has(emojiKey(emoji))),
			});
		}
	}
	return tags;
}

export function findConflicts(
	entries: ReadonlyArray<PersonaImportPreviewEntry>,
	decisions: ReadonlyMap<number, ReviewDecision>,
	members: ReadonlyArray<ReviewMember>,
	livePersonas: ReadonlyArray<Pick<PersonaResponse, 'id' | 'name' | 'persona_tags' | 'signature_emojis'>>,
	fromTyne: boolean,
): Array<ReviewConflict> {
	const tags = tagStates(entries, decisions, members, livePersonas, fromTyne);
	const owners = new Map<string, {label: string; names: Array<string>}>();
	for (const state of tags.values()) {
		for (const tag of state.tags) {
			if (!(tag.prefix ?? '').trim() && !(tag.suffix ?? '').trim()) continue;
			const key = `tag:${tagKey(tag)}`;
			const owner = owners.get(key) ?? {label: tagLabel(tag), names: []};
			owner.names.push(state.name);
			owners.set(key, owner);
		}
		for (const emoji of state.emojis) {
			const key = `emoji:${emojiKey(emoji)}`;
			const owner = owners.get(key) ?? {label: emoji.name, names: []};
			owner.names.push(state.name);
			owners.set(key, owner);
		}
	}
	return [...owners.values()].filter((owner) => owner.names.length > 1);
}

/**
 * Who would hold `tag` once the decisions are applied, leaving out the member at `exceptIndex` (whose
 * field is being checked), or null when it is free.
 */
export function tagHolder(
	tag: PersonaTag,
	exceptIndex: number,
	entries: ReadonlyArray<PersonaImportPreviewEntry>,
	decisions: ReadonlyMap<number, ReviewDecision>,
	members: ReadonlyArray<ReviewMember>,
	livePersonas: ReadonlyArray<LivePersona>,
	fromTyne: boolean,
): string | null {
	if (isEmptyTag(tag)) return null;
	const key = tagKey(tag);
	for (const [owner, state] of tagStates(entries, decisions, members, livePersonas, fromTyne)) {
		if (owner === `member:${exceptIndex}`) continue;
		if (state.tags.some((t) => tagKey(t) === key)) return state.name;
	}
	return null;
}

function isEmptyTag(tag: PersonaTag): boolean {
	return !(tag.prefix ?? '').trim() && !(tag.suffix ?? '').trim();
}

/**
 * A tag as the API takes it: each side trimmed, and an empty side left out, never sent as "" (the
 * schema wants a side to be absent or at least one character; "" made the import fail with
 * "Invalid form body").
 */
export function cleanTag(tag: PersonaTag): PersonaTag {
	const prefix = (tag.prefix ?? '').trim();
	const suffix = (tag.suffix ?? '').trim();
	return {...(prefix ? {prefix} : {}), ...(suffix ? {suffix} : {})};
}

/** A tag as typed in one field: `ly:` is a prefix, `-ly` a suffix; `[text]` uses the word text for the message. */
export function parseTagInput(value: string): PersonaTag {
	const trimmed = value.trim();
	const marker = trimmed.indexOf('text');
	if (marker >= 0) return cleanTag({prefix: trimmed.slice(0, marker), suffix: trimmed.slice(marker + 'text'.length)});
	return cleanTag({prefix: trimmed});
}

/** The tag as one field shows it: the prefix alone, or with `text` where the message goes when it has a suffix. */
export function tagInputText(tag: PersonaTag): string {
	const prefix = (tag.prefix ?? '').trim();
	const suffix = (tag.suffix ?? '').trim();
	return suffix ? `${prefix}text${suffix}` : prefix;
}

/** A name's letters that anyone can type: accents dropped, then plain a–z and 0–9 only. */
function typeableLetters(name: string): Array<string> {
	return Array.from(
		name
			.normalize('NFKD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, ''),
	);
}

/**
 * A free tag in the style of `tag` for a member called `name`: the letters of the side that has them
 * become more of the name (`ly:` for Lyra gives `lyr:`, then `lyra:`), keeping the punctuation around
 * them; then the tag itself with a number (`ly2:`, `ly3:`). The name gives only letters anyone can
 * type, so a name in another script or with symbols goes straight to the numbered tag. Null when none
 * of those is free.
 */
export function suggestTag(tag: PersonaTag, name: string, isTaken: (tag: PersonaTag) => boolean): PersonaTag | null {
	const split = (side: string) => {
		const match = /^(\P{L}*?)([\p{L}\p{N}]+)(\P{L}*)$/u.exec(side);
		return match ? {lead: match[1]!, core: match[2]!, trail: match[3]!} : null;
	};
	const prefix = (tag.prefix ?? '').trim();
	const suffix = (tag.suffix ?? '').trim();
	const onPrefix = split(prefix);
	const onSuffix = onPrefix ? null : split(suffix);
	const letters = typeableLetters(name);
	const original = (onPrefix ?? onSuffix)?.core ?? '';
	const shortest = Array.from(original).length + 1;
	const cores: Array<string> = [];
	for (let length = shortest; length <= letters.length; length++) cores.push(letters.slice(0, length).join(''));
	// Then the tag being replaced, numbered; a tag with no letters numbers the name's start, or "p".
	const numbered = original || letters.slice(0, 2).join('') || 'p';
	for (let n = 2; n < 100; n++) cores.push(`${numbered}${n}`);
	// Keep the tag's capital: "Ly:" for Lyra gives "Lyr:".
	const capital = original !== '' && original[0] !== original[0]!.toLowerCase();
	const styled = (core: string) =>
		capital && !core.startsWith(original) ? core.charAt(0).toUpperCase() + core.slice(1) : core;
	const candidateFor = (core: string): PersonaTag => {
		if (onPrefix) return cleanTag({prefix: `${onPrefix.lead}${styled(core)}${onPrefix.trail}`, suffix});
		if (onSuffix) return cleanTag({prefix, suffix: `${onSuffix.lead}${styled(core)}${onSuffix.trail}`});
		// A tag with no letters at all (brackets around the text) gets a plain prefix such as "lyr:".
		return {prefix: `${core}:`};
	};
	for (const core of cores) {
		const candidate = candidateFor(core);
		if (!isTaken(candidate)) return candidate;
	}
	return null;
}

/** The longest persona name the API takes. */
const PERSONA_NAME_MAX = 100;

/**
 * A name no other persona has: the name itself, else with " (2)", " (3)"…, as a file manager names a
 * copy, shortening the name where the number would not fit.
 */
export function copyName(name: string, isTaken: (name: string) => boolean): string {
	const base = name.trim();
	if (!isTaken(base)) return base;
	for (let n = 2; n < 1000; n++) {
		const suffix = ` (${n})`;
		const candidate = `${Array.from(base)
			.slice(0, PERSONA_NAME_MAX - suffix.length)
			.join('')
			.trimEnd()}${suffix}`;
		if (!isTaken(candidate)) return candidate;
	}
	return base;
}

/**
 * Add the file's version under a name and tags of its own: a name no other persona has ("Wren (2)"), a
 * free tag in place of each tag another persona keeps, and without the signature emojis another persona
 * keeps. For a differing persona (Keep both) the copy is unlinked and Tyne's version stays as it is;
 * for a member whose tag is taken (`linked`) it is a new persona linked to its member.
 */
export function keepBothDecision(
	entry: PersonaImportPreviewEntry,
	entries: ReadonlyArray<PersonaImportPreviewEntry>,
	decisions: ReadonlyMap<number, ReviewDecision>,
	members: ReadonlyArray<ReviewMember>,
	livePersonas: ReadonlyArray<LivePersona>,
	fromTyne: boolean,
	linked = false,
): ReviewDecision {
	const member = members[entry.index];
	if (!member) return {choice: 'keep'};
	// The others as they will be, with this persona left as Tyne has it.
	const kept = new Map(decisions);
	kept.set(entry.index, {choice: 'keep'});
	const others = [...tagStates(entries, kept, members, livePersonas, fromTyne)]
		.filter(([owner]) => owner !== `member:${entry.index}`)
		.map(([, state]) => state);
	const held = (tag: PersonaTag) => others.some((state) => state.tags.some((t) => tagKey(t) === tagKey(tag)));
	const replacedTags = (member.preview.persona_tags ?? []).filter(held);
	const replacements: Array<PersonaTag> = [];
	for (const tag of replacedTags) {
		const isTaken = (candidate: PersonaTag) =>
			replacements.some((t) => tagKey(t) === tagKey(candidate)) || held(candidate);
		replacements.push(suggestTag(tag, member.preview.name, isTaken) ?? {});
	}
	const droppedEmojis = fromTyne
		? (member.preview.signature_emojis ?? []).filter((emoji) =>
				others.some((state) => state.emojis.some((e) => emojiKey(e) === emojiKey(emoji))),
			)
		: [];
	const names = new Set(others.map((state) => state.name.trim().toLowerCase()));
	const name = copyName(member.preview.name, (candidate) => names.has(candidate.toLowerCase()));
	return {
		choice: 'add',
		withTags: true,
		replacements,
		copy: {name, replacedTags, droppedEmojis, ...(linked ? {linked} : {})},
	};
}

/** Which of a member's pictures have to be stored before applying its choice. */
export function picturesNeeded(
	entry: PersonaImportPreviewEntry,
	decision: ReviewDecision,
): {avatar: boolean; banner: boolean} {
	if (decision.choice === 'add') return {avatar: true, banner: true};
	if (decision.choice !== 'use_file') return {avatar: false, banner: false};
	const changes = (field: 'avatar' | 'banner') =>
		(entry.differences ?? []).some((d) => d.field === field && (d.change === 'changed' || d.change === 'not_compared'));
	return {avatar: changes('avatar'), banner: changes('banner')};
}

/** What storing a member's pictures gave: hashes, and which the file had but could not be stored. */
export interface StoredPictures {
	images: PersonaImportStoredImages;
	avatarFailed: boolean;
	bannerFailed: boolean;
}

/** The actions sent to apply the review, skipped and kept members left out. */
export function buildActions(
	entries: ReadonlyArray<PersonaImportPreviewEntry>,
	decisions: ReadonlyMap<number, ReviewDecision>,
	members: ReadonlyArray<ReviewMember>,
	stored: ReadonlyMap<number, StoredPictures>,
): Array<PersonaImportAction> {
	const actions: Array<PersonaImportAction> = [];
	for (const entry of entries) {
		const decision = decisions.get(entry.index) ?? defaultDecision(entry);
		const member = members[entry.index];
		if (!member) continue;
		const pictures = stored.get(entry.index);
		const item = (): PersonaImportItem =>
			personaImportItem(member.member, pictures?.images ?? {avatar: null, banner: null}, member.extras);
		switch (decision.choice) {
			case 'add': {
				const dropEmojis = droppedEmojis(entry, decision);
				const replaced = Boolean(decision.copy) || (decision.replacements ?? []).some((tag) => !isEmptyTag(tag));
				// With tags of its own, the item carries the tags it gets; otherwise the server leaves the
				// clashing ones out.
				const dropTags = replaced ? [] : droppedTags(entry, decision);
				const base = item();
				// A copy is added under its own name; one kept next to the linked persona is added unlinked.
				const named = decision.copy
					? {
							...base,
							name: decision.copy.name.trim() || base.name,
							...(decision.copy.linked ? {} : {external_uuid: null}),
						}
					: base;
				actions.push({
					action: 'add',
					item: replaced
						? {...named, persona_tags: addedTags(entry, decision, member.preview.persona_tags ?? [])}
						: named,
					...(dropTags.length > 0 ? {drop_tags: dropTags} : {}),
					...(dropEmojis.length > 0 ? {drop_signature_emojis: dropEmojis} : {}),
				});
				break;
			}
			case 'link':
				actions.push({action: 'link', persona_id: decision.personaId, external_uuid: member.member.id});
				break;
			case 'restore':
				if (entry.persona_id) actions.push({action: 'restore', persona_id: entry.persona_id});
				break;
			case 'use_file': {
				if (!entry.persona_id) break;
				const needed = picturesNeeded(entry, decision);
				const fileHas = {avatar: Boolean(member.preview.avatar), banner: Boolean(member.preview.banner)};
				actions.push({
					action: 'use_file',
					persona_id: entry.persona_id,
					item: item(),
					// A picture that is the same already, or that could not be stored, stays as it is.
					keep_avatar: fileHas.avatar && (!needed.avatar || (pictures?.avatarFailed ?? false)),
					keep_banner: fileHas.banner && (!needed.banner || (pictures?.bannerFailed ?? false)),
				});
				break;
			}
			default:
				break;
		}
	}
	return actions;
}
