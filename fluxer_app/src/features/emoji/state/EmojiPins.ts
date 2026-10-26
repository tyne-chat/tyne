// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Tyne's pinned emojis (tyne-chat/tyne#140). They are kept in the fork's `emoji_pins` field of
// the account's synced preferences, so they follow the account to every device, and the next account
// signed in on the same device starts from its own. The mobile app reads and writes the same field.

import {isValidUsageKey} from '@app/features/emoji/state/UsageFrecency';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import {makeSyncedField} from '@app/features/user/state/SyncedField';
import {create, type MessageInitShape, toBinary} from '@bufbuild/protobuf';
import {
	type EmojiPinsState,
	EmojiPinsStateSchema,
	type PersonaEmojiPins,
} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/fork_emoji_pins_pb';
import {makeAutoObservable, reaction} from 'mobx';

const logger = new Logger('EmojiPins');

/**
 * The size of the picker's frequently used section (`MAX_FRECENT_EMOJIS` in `EmojiPicker.ts`), so a
 * list never holds pins the section cannot show. The account's and a persona's pins still share it
 * (EM-12, tyne-chat/tyne#170).
 */
export const MAX_PINNED_EMOJIS_PER_LIST = 42;

/**
 * What all pins may take in the synced preferences, below the 64 KiB a synced field may send. The
 * lists are capped, but personas are not few (up to 250), so a pin that would go past it is refused.
 */
export const MAX_EMOJI_PINS_ENCODED_BYTES = 48_000;

const PERSONA_ID_PATTERN = /^\d{1,20}$/;

/** The prefixes of the picker's usage keys (`getEmojiUsageKey` in `EmojiPicker.ts`, which imports this file). */
function isPinKey(key: string): boolean {
	return isValidUsageKey(key) && (key.startsWith('unicode:') || key.startsWith('custom:'));
}

export function sanitizePinList(keys: ReadonlyArray<string>): Array<string> {
	const result: Array<string> = [];
	const seen = new Set<string>();
	for (const key of keys) {
		if (!isPinKey(key) || seen.has(key)) continue;
		seen.add(key);
		result.push(key);
		if (result.length >= MAX_PINNED_EMOJIS_PER_LIST) break;
	}
	return result;
}

export function sanitizePersonaPins(
	personaPins: Readonly<Record<string, Readonly<Pick<PersonaEmojiPins, 'emojiIds'>>>>,
): Record<string, Array<string>> {
	const result: Record<string, Array<string>> = {};
	for (const [personaId, pins] of Object.entries(personaPins)) {
		if (!PERSONA_ID_PATTERN.test(personaId)) continue;
		const keys = sanitizePinList(pins.emojiIds);
		if (keys.length > 0) result[personaId] = keys;
	}
	return result;
}

function toPinsMessage(
	pinnedEmojis: ReadonlyArray<string>,
	personaPinnedEmojis: Readonly<Record<string, ReadonlyArray<string>>>,
): MessageInitShape<typeof EmojiPinsStateSchema> {
	return {
		pinnedEmojiIds: [...pinnedEmojis],
		personaPins: Object.fromEntries(
			Object.entries(personaPinnedEmojis).map(([personaId, keys]) => [personaId, {emojiIds: [...keys]}]),
		),
	};
}

export function encodedEmojiPinsBytes(
	pinnedEmojis: ReadonlyArray<string>,
	personaPinnedEmojis: Readonly<Record<string, ReadonlyArray<string>>>,
): number {
	return toBinary(EmojiPinsStateSchema, create(EmojiPinsStateSchema, toPinsMessage(pinnedEmojis, personaPinnedEmojis)))
		.length;
}

class EmojiPins {
	/** Pinned whoever the account writes as, in pin order. */
	pinnedEmojis: ReadonlyArray<string> = [];
	/** Pinned for one persona, by persona id; a persona without pins has no entry. */
	personaPinnedEmojis: Readonly<Record<string, ReadonlyArray<string>>> = {};

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
		// The lists are replaced on every change, local or synced, so this sees each one once.
		reaction(
			() => [this.pinnedEmojis, this.personaPinnedEmojis],
			() => ComponentBus.dispatch('EMOJI_PICKER_RERENDER'),
		);
		initializeStore(this, () => this.initPersistence());
	}

	private async initPersistence(): Promise<void> {
		await makeSyncedField(this, {
			field: 'emojiPins',
			schema: EmojiPinsStateSchema,
			persist: ['pinnedEmojis', 'personaPinnedEmojis'],
			toMessage: (s) => toPinsMessage(s.pinnedEmojis, s.personaPinnedEmojis),
			applyMessage: (s, m: EmojiPinsState) => {
				s.pinnedEmojis = sanitizePinList(m.pinnedEmojiIds);
				s.personaPinnedEmojis = sanitizePersonaPins(m.personaPins);
			},
		});
	}

	/** @internal */
	reset(): void {
		this.pinnedEmojis = [];
		this.personaPinnedEmojis = {};
	}

	getGloballyPinnedEmojiKeys(): ReadonlyArray<string> {
		return this.pinnedEmojis;
	}

	getPersonaPinnedEmojiKeys(personaId: string): ReadonlyArray<string> {
		return this.personaPinnedEmojis[personaId] ?? [];
	}

	/** The account's pins, then the persona's, each key once. */
	getAllEffectivePinnedEmojiKeys(personaId?: string | null): ReadonlyArray<string> {
		if (!personaId) return this.pinnedEmojis;
		const personaPins = this.getPersonaPinnedEmojiKeys(personaId);
		if (personaPins.length === 0) return this.pinnedEmojis;
		return [...new Set([...this.pinnedEmojis, ...personaPins])];
	}

	isGloballyPinned(key: string): boolean {
		return this.pinnedEmojis.includes(key);
	}

	isPersonaPinned(key: string, personaId: string): boolean {
		return this.getPersonaPinnedEmojiKeys(personaId).includes(key);
	}

	isPinned(key: string, personaId?: string | null): boolean {
		return (personaId != null && this.isPersonaPinned(key, personaId)) || this.isGloballyPinned(key);
	}

	togglePin(key: string, personaId?: string | null): void {
		const pinned = personaId ? this.isPersonaPinned(key, personaId) : this.isGloballyPinned(key);
		if (pinned) {
			this.unpinEmoji(key, personaId);
		} else {
			this.pinEmoji(key, personaId);
		}
	}

	/** Whether the emoji is pinned afterwards. Refused for an invalid key, or past the caps. */
	pinEmoji(key: string, personaId?: string | null): boolean {
		if (!isPinKey(key) || (personaId != null && !PERSONA_ID_PATTERN.test(personaId))) {
			logger.warn(`Ignored pin of ${key} for ${personaId ?? 'the account'}: invalid key or persona id`);
			return false;
		}
		const current = personaId ? this.getPersonaPinnedEmojiKeys(personaId) : this.pinnedEmojis;
		if (current.includes(key)) return true;
		if (current.length >= MAX_PINNED_EMOJIS_PER_LIST) {
			logger.warn(`Pin limit of ${MAX_PINNED_EMOJIS_PER_LIST} reached; ignoring ${key}`);
			return false;
		}
		const nextList = [...current, key];
		const nextAccount = personaId ? this.pinnedEmojis : nextList;
		const nextPersonas = personaId ? {...this.personaPinnedEmojis, [personaId]: nextList} : this.personaPinnedEmojis;
		if (encodedEmojiPinsBytes(nextAccount, nextPersonas) > MAX_EMOJI_PINS_ENCODED_BYTES) {
			logger.warn(`Pins would exceed ${MAX_EMOJI_PINS_ENCODED_BYTES} bytes; ignoring ${key}`);
			return false;
		}
		this.pinnedEmojis = nextAccount;
		this.personaPinnedEmojis = nextPersonas;
		return true;
	}

	unpinEmoji(key: string, personaId?: string | null): void {
		if (!personaId) {
			if (this.isGloballyPinned(key)) this.pinnedEmojis = this.pinnedEmojis.filter((pin) => pin !== key);
			return;
		}
		if (!this.isPersonaPinned(key, personaId)) return;
		const rest = this.getPersonaPinnedEmojiKeys(personaId).filter((pin) => pin !== key);
		this.setPersonaPins(personaId, rest);
	}

	/** Drops a deleted persona's pins. */
	forgetPersona(personaId: string): void {
		if (personaId in this.personaPinnedEmojis) this.setPersonaPins(personaId, []);
	}

	private setPersonaPins(personaId: string, keys: ReadonlyArray<string>): void {
		const {[personaId]: _previous, ...others} = this.personaPinnedEmojis;
		this.personaPinnedEmojis = keys.length > 0 ? {...others, [personaId]: keys} : others;
	}
}

export default new EmojiPins();
