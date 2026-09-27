// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ReactionEmoji} from '@app/features/messaging/utils/ReactionUtils';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

export interface ReactionPersonaEntry {
	persona_id: string;
	count: number;
	me?: boolean;
}

export interface ReactionRecord {
	emoji: ReactionEmoji;
	count: number;
	me: boolean;
	me_root?: boolean;
	persona_reactions?: ReadonlyArray<ReactionPersonaEntry>;
	knownReactors: ReadonlySet<string>;
	removedReactors: ReadonlySet<string>;
}

export type ReactionMap = ReadonlyMap<string, ReactionRecord>;

export type ReactionMachineEvent =
	| {
			type: 'reaction.hydrate';
			reactions: ReadonlyArray<MessageReaction> | null | undefined;
			currentUserId?: string | null;
	  }
	| {
			type: 'reaction.add';
			emoji: ReactionEmoji;
			userId: string;
			isCurrentUser: boolean;
			personaId?: string | null;
	  }
	| {
			type: 'reaction.remove';
			emoji: ReactionEmoji;
			userId: string;
			isCurrentUser: boolean;
			personaId?: string | null;
	  }
	| {type: 'reaction.removeAll'}
	| {type: 'reaction.removeEmoji'; emoji: ReactionEmoji}
	| {type: 'reaction.trackReactors'; emoji: ReactionEmoji; userIds: ReadonlyArray<string>};

export function getEmojiKey(emoji: ReactionEmoji): string {
	return `${emoji.id ?? ''}:${emoji.name}`;
}

export function getReactorKey(userId: string, personaId?: string | null): string {
	return personaId && personaId !== '0' ? `${userId}:${personaId}` : userId;
}

export function sameEmoji(left: ReactionEmoji, right: ReactionEmoji): boolean {
	return (left.id ?? null) === (right.id ?? null) && left.name === right.name;
}

export function emptyMap(): ReactionMap {
	return new Map();
}

function recordToReaction(record: ReactionRecord): MessageReaction {
	return Object.freeze({
		emoji: record.emoji,
		count: record.count,
		me: record.me ? true : undefined,
		me_root: record.me_root ? true : undefined,
		persona_reactions:
			record.persona_reactions && record.persona_reactions.length > 0 ? record.persona_reactions : undefined,
	}) as MessageReaction;
}

export function mapToReactions(map: ReactionMap): ReadonlyArray<MessageReaction> {
	const out: Array<MessageReaction> = [];
	for (const record of map.values()) {
		if (record.count > 0) out.push(recordToReaction(record));
	}
	return out.length > 0 ? Object.freeze(out) : EMPTY_REACTIONS;
}

function withRecord(map: ReactionMap, key: string, record: ReactionRecord | null): ReactionMap {
	const next = new Map(map);
	if (record === null) {
		next.delete(key);
	} else {
		next.set(key, record);
	}
	return next;
}

function clamp(n: number): number {
	return n < 0 ? 0 : n;
}

const EMPTY_REACTIONS: ReadonlyArray<MessageReaction> = Object.freeze([]);
const EMPTY_SET: ReadonlySet<string> = new Set();

function addToMap(
	map: ReactionMap,
	emoji: ReactionEmoji,
	userId: string,
	isCurrentUser: boolean,
	personaId?: string | null,
): ReactionMap {
	const key = getEmojiKey(emoji);
	const rKey = getReactorKey(userId, personaId);
	const isPersona = Boolean(personaId && personaId !== '0');
	const existing = map.get(key);
	if (!existing) {
		const reactors = new Set<string>([rKey]);
		const personaReactions: Array<ReactionPersonaEntry> = isPersona
			? [{persona_id: personaId!, count: 1, me: isCurrentUser ? true : undefined}]
			: [];
		return withRecord(map, key, {
			emoji,
			count: 1,
			me: isCurrentUser,
			me_root: !isPersona && isCurrentUser ? true : undefined,
			persona_reactions: personaReactions.length > 0 ? personaReactions : undefined,
			knownReactors: reactors,
			removedReactors: EMPTY_SET,
		});
	}
	let removedReactors = existing.removedReactors;
	if (removedReactors.has(rKey)) {
		const next = new Set(removedReactors);
		next.delete(rKey);
		removedReactors = next;
	}
	if (existing.knownReactors.has(rKey)) {
		if (
			(isCurrentUser && !existing.me) ||
			(isCurrentUser && !isPersona && !existing.me_root) ||
			removedReactors !== existing.removedReactors
		) {
			let personaReactions = existing.persona_reactions;
			if (isCurrentUser && isPersona && personaReactions) {
				personaReactions = personaReactions.map((p) => (p.persona_id === personaId ? {...p, me: true} : p));
			}
			return withRecord(map, key, {
				...existing,
				me: existing.me || isCurrentUser,
				me_root: !isPersona && isCurrentUser ? true : existing.me_root,
				persona_reactions: personaReactions,
				removedReactors,
			});
		}
		return map;
	}
	const reactors = new Set(existing.knownReactors);
	reactors.add(rKey);
	const personaReactions: Array<ReactionPersonaEntry> = existing.persona_reactions
		? [...existing.persona_reactions]
		: [];
	if (isPersona) {
		const idx = personaReactions.findIndex((p) => p.persona_id === personaId);
		if (idx >= 0) {
			const current = personaReactions[idx];
			personaReactions[idx] = {
				...current,
				count: current.count + 1,
				me: isCurrentUser ? true : current.me,
			};
		} else {
			personaReactions.push({
				persona_id: personaId!,
				count: 1,
				me: isCurrentUser ? true : undefined,
			});
		}
	}
	return withRecord(map, key, {
		emoji: existing.emoji,
		count: existing.count + 1,
		me: existing.me || isCurrentUser,
		me_root: !isPersona && isCurrentUser ? true : existing.me_root,
		persona_reactions: personaReactions.length > 0 ? personaReactions : undefined,
		knownReactors: reactors,
		removedReactors,
	});
}

function removeFromMap(
	map: ReactionMap,
	emoji: ReactionEmoji,
	userId: string,
	isCurrentUser: boolean,
	personaId?: string | null,
): ReactionMap {
	const key = getEmojiKey(emoji);
	const rKey = getReactorKey(userId, personaId);
	const isPersona = Boolean(personaId && personaId !== '0');
	const existing = map.get(key);
	if (!existing) return map;
	if (existing.removedReactors.has(rKey)) {
		if (!existing.knownReactors.has(rKey) && !(isCurrentUser && existing.me)) return map;
		const reactors = new Set(existing.knownReactors);
		reactors.delete(rKey);
		return withRecord(map, key, {
			...existing,
			me: isCurrentUser ? Boolean(existing.persona_reactions?.some((p) => p.me) || existing.me_root) : existing.me,
			knownReactors: reactors,
		});
	}
	const wasKnown = existing.knownReactors.has(rKey);
	const hasPersonaReaction = isPersona && Boolean(existing.persona_reactions?.some((p) => p.persona_id === personaId));
	const hasRootReaction = !isPersona && Boolean(existing.me_root ?? existing.me);

	let nextCount = existing.count;
	let nextReactors = existing.knownReactors;
	if (wasKnown) {
		const reactors = new Set(existing.knownReactors);
		reactors.delete(rKey);
		nextReactors = reactors;
		nextCount = clamp(existing.count - 1);
	} else if (isCurrentUser && (hasPersonaReaction || hasRootReaction)) {
		nextCount = clamp(existing.count - 1);
	} else if (!isCurrentUser) {
		nextCount = clamp(existing.count - 1);
	} else {
		return map;
	}
	if (nextCount <= 0) {
		return withRecord(map, key, null);
	}
	const removed = new Set(existing.removedReactors);
	removed.add(rKey);

	const personaReactions: Array<ReactionPersonaEntry> | undefined = existing.persona_reactions
		? [...existing.persona_reactions]
		: undefined;
	if (isPersona && personaReactions) {
		const idx = personaReactions.findIndex((p) => p.persona_id === personaId);
		if (idx >= 0) {
			const current = personaReactions[idx];
			const newCount = current.count - 1;
			if (newCount <= 0) {
				personaReactions.splice(idx, 1);
			} else {
				personaReactions[idx] = {
					...current,
					count: newCount,
					me: isCurrentUser ? false : current.me,
				};
			}
		}
	}

	const nextMeRoot = isCurrentUser ? (!isPersona ? false : existing.me_root) : existing.me_root;

	const anyPersonaMe = Boolean(personaReactions?.some((p) => p.me));
	const nextMe = isCurrentUser ? Boolean(nextMeRoot || anyPersonaMe) : existing.me;

	return withRecord(map, key, {
		emoji: existing.emoji,
		count: nextCount,
		me: nextMe,
		me_root: nextMeRoot,
		persona_reactions: personaReactions && personaReactions.length > 0 ? personaReactions : undefined,
		knownReactors: nextReactors,
		removedReactors: removed,
	});
}

function removeEmojiFromMap(map: ReactionMap, emoji: ReactionEmoji): ReactionMap {
	const key = getEmojiKey(emoji);
	if (!map.has(key)) return map;
	return withRecord(map, key, null);
}

function removeAllFromMap(map: ReactionMap): ReactionMap {
	if (map.size === 0) return map;
	return emptyMap();
}

function countHydrationTombstones(
	removedReactors: ReadonlySet<string>,
	wireMe: boolean,
	currentUserId?: string | null,
): number {
	if (removedReactors.size === 0) return 0;
	let count = removedReactors.size;
	if (currentUserId != null && !wireMe) {
		for (const key of removedReactors) {
			if (key === currentUserId || key.startsWith(`${currentUserId}:`)) {
				count -= 1;
			}
		}
	}
	return Math.max(0, count);
}

function hydrateMap(
	map: ReactionMap,
	wire: ReadonlyArray<MessageReaction> | null | undefined,
	currentUserId?: string | null,
): ReactionMap {
	if (!wire || wire.length === 0) {
		return map.size === 0 ? map : emptyMap();
	}
	const next = new Map<string, ReactionRecord>();
	for (const reaction of wire) {
		const wireCount = Math.max(0, Math.floor(reaction.count ?? 0));
		if (wireCount === 0) continue;
		const key = getEmojiKey(reaction.emoji);
		const wireMe = Boolean(reaction.me);
		const wireMeRoot = Boolean(reaction.me_root ?? (reaction.me && !reaction.persona_reactions?.some((p) => p.me)));
		const prev = map.get(key);
		if (!prev) {
			next.set(key, {
				emoji: reaction.emoji,
				count: wireCount,
				me: wireMe,
				me_root: wireMeRoot ? true : undefined,
				persona_reactions: reaction.persona_reactions ?? undefined,
				knownReactors: EMPTY_SET,
				removedReactors: EMPTY_SET,
			});
			continue;
		}
		const reactors = new Set<string>();
		for (const userId of prev.knownReactors) {
			if (!prev.removedReactors.has(userId)) reactors.add(userId);
		}
		const hydrationTombstones = countHydrationTombstones(prev.removedReactors, wireMe, currentUserId);
		const count = Math.max(clamp(wireCount - hydrationTombstones), reactors.size);
		const currentUserWasRemoved =
			currentUserId != null &&
			(prev.removedReactors.has(currentUserId) ||
				Array.from(prev.removedReactors).some((r) => r.startsWith(`${currentUserId}:`)));
		next.set(key, {
			emoji: reaction.emoji,
			count,
			me: currentUserWasRemoved ? wireMe && !prev.removedReactors.has(currentUserId) : wireMe || prev.me,
			me_root: currentUserWasRemoved
				? wireMeRoot && !prev.removedReactors.has(currentUserId)
				: wireMeRoot || prev.me_root,
			persona_reactions: reaction.persona_reactions ?? prev.persona_reactions,
			knownReactors: reactors,
			removedReactors: prev.removedReactors,
		});
	}
	if (mapsEqual(map, next)) return map;
	return next;
}

function trackReactorInMap(map: ReactionMap, emoji: ReactionEmoji, userId: string): ReactionMap {
	const key = getEmojiKey(emoji);
	const existing = map.get(key);
	if (!existing) return map;
	if (existing.knownReactors.has(userId)) return map;
	const reactors = new Set(existing.knownReactors);
	reactors.add(userId);
	const count = Math.max(existing.count, reactors.size);
	return withRecord(map, key, {...existing, count, knownReactors: reactors});
}

function trackReactorsInMap(map: ReactionMap, emoji: ReactionEmoji, userIds: ReadonlyArray<string>): ReactionMap {
	if (userIds.length === 0 || !map.has(getEmojiKey(emoji))) return map;
	let next = map;
	for (const userId of userIds) next = trackReactorInMap(next, emoji, userId);
	return next;
}

export function transitionReactionMap(
	map: ReactionMap,
	event: ReactionMachineEvent,
	currentUserId?: string | null,
): ReactionMap {
	switch (event.type) {
		case 'reaction.hydrate':
			return hydrateMap(map, event.reactions, event.currentUserId ?? currentUserId);
		case 'reaction.add':
			return addToMap(map, event.emoji, event.userId, event.isCurrentUser, event.personaId);
		case 'reaction.remove':
			return removeFromMap(map, event.emoji, event.userId, event.isCurrentUser, event.personaId);
		case 'reaction.removeAll':
			return removeAllFromMap(map);
		case 'reaction.removeEmoji':
			return removeEmojiFromMap(map, event.emoji);
		case 'reaction.trackReactors':
			return trackReactorsInMap(map, event.emoji, event.userIds);
	}
}

function personaReactionsEqual(
	a?: ReadonlyArray<ReactionPersonaEntry> | null,
	b?: ReadonlyArray<ReactionPersonaEntry> | null,
): boolean {
	if (a === b) return true;
	const aEmpty = !a || a.length === 0;
	const bEmpty = !b || b.length === 0;
	if (aEmpty && bEmpty) return true;
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].persona_id !== b[i].persona_id || a[i].count !== b[i].count || Boolean(a[i].me) !== Boolean(b[i].me)) {
			return false;
		}
	}
	return true;
}

function mapsEqual(a: ReactionMap, b: ReactionMap): boolean {
	if (a === b) return true;
	if (a.size !== b.size) return false;
	for (const [key, left] of a) {
		const right = b.get(key);
		if (!right) return false;
		if (left.count !== right.count || left.me !== right.me) return false;
		if (Boolean(left.me_root) !== Boolean(right.me_root)) return false;
		if (!personaReactionsEqual(left.persona_reactions, right.persona_reactions)) return false;
		if (!sameEmoji(left.emoji, right.emoji)) return false;
		if (left.knownReactors.size !== right.knownReactors.size) return false;
		for (const id of left.knownReactors) {
			if (!right.knownReactors.has(id)) return false;
		}
		if (left.removedReactors.size !== right.removedReactors.size) return false;
		for (const id of left.removedReactors) {
			if (!right.removedReactors.has(id)) return false;
		}
	}
	return true;
}
