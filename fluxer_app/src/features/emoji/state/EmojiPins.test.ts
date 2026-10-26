// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: the pinned emojis' store (tyne-chat/tyne#140). Pins live in the account's synced preferences,
// so they survive a reload and follow the account, and the next account starts from its own.

import EmojiPins, {
	encodedEmojiPinsBytes,
	MAX_EMOJI_PINS_ENCODED_BYTES,
	MAX_PINNED_EMOJIS_PER_LIST,
	sanitizePersonaPins,
	sanitizePinList,
} from '@app/features/emoji/state/EmojiPins';
import {setSyncedFieldUserSettings} from '@app/features/user/state/SyncedField';
import {create} from '@bufbuild/protobuf';
import {
	type EmojiPinsState,
	EmojiPinsStateSchema,
} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/fork_emoji_pins_pb';
import {observable, runInAction} from 'mobx';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const remoteEpoch = observable.box(1);
const remoteSnapshot = observable.box<EmojiPinsState | undefined>(undefined, {deep: false});
const pushes: Array<EmojiPinsState> = [];

setSyncedFieldUserSettings({
	isHydrated: () => true,
	getAccountEpoch: () => remoteEpoch.get(),
	getSubPreference: (field) => (field === 'emojiPins' ? remoteSnapshot.get() : undefined) as never,
	setSubPreference: async (field, value) => {
		if (field !== 'emojiPins') return;
		const pushed = value as EmojiPinsState;
		pushes.push(pushed);
		runInAction(() => remoteSnapshot.set(pushed));
	},
});

function remoteState(pinned: Array<string>, personaPins: Record<string, Array<string>> = {}): EmojiPinsState {
	return create(EmojiPinsStateSchema, {
		pinnedEmojiIds: pinned,
		personaPins: Object.fromEntries(Object.entries(personaPins).map(([id, keys]) => [id, {emojiIds: keys}])),
	});
}

function receive(state: EmojiPinsState | undefined, epoch = remoteEpoch.get()): void {
	runInAction(() => {
		remoteEpoch.set(epoch);
		remoteSnapshot.set(state);
	});
}

function unicodeKeys(count: number, prefix = 'e'): Array<string> {
	return Array.from({length: count}, (_, index) => `unicode:${prefix}${index}`);
}

describe('EmojiPins synced through the account', () => {
	it('takes the pins stored in the synced preferences, without sending anything back', async () => {
		receive(remoteState(['unicode:cat', 'unicode:dog'], {'1001': ['unicode:fox']}));
		await vi.waitFor(() => expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual(['unicode:cat', 'unicode:dog']));
		expect(EmojiPins.getPersonaPinnedEmojiKeys('1001')).toEqual(['unicode:fox']);
		expect(pushes).toEqual([]);
	});

	it('saves each pin and unpin with one write of the whole list', async () => {
		EmojiPins.pinEmoji('unicode:star');
		await vi.waitFor(() => expect(pushes).toHaveLength(1));
		expect(pushes[0].pinnedEmojiIds).toEqual(['unicode:cat', 'unicode:dog', 'unicode:star']);
		expect(pushes[0].personaPins['1001']?.emojiIds).toEqual(['unicode:fox']);

		EmojiPins.unpinEmoji('unicode:fox', '1001');
		await vi.waitFor(() => expect(pushes).toHaveLength(2));
		expect(pushes[1].personaPins).toEqual({});
	});

	it('sends nothing for a pin that changes nothing', async () => {
		const before = pushes.length;
		EmojiPins.pinEmoji('unicode:star');
		EmojiPins.unpinEmoji('unicode:never-pinned');
		EmojiPins.forgetPersona('1999');
		await Promise.resolve();
		expect(pushes).toHaveLength(before);
	});

	it('follows a change made on another device', async () => {
		const before = pushes.length;
		receive(remoteState(['unicode:heart'], {'1002': ['unicode:wave']}));
		await vi.waitFor(() => expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual(['unicode:heart']));
		expect(EmojiPins.getPersonaPinnedEmojiKeys('1002')).toEqual(['unicode:wave']);
		expect(pushes).toHaveLength(before);
	});

	it('starts the next account signed in on the device from its own pins', async () => {
		receive(undefined, remoteEpoch.get() + 1);
		await vi.waitFor(() => expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual([]));
		expect(EmojiPins.personaPinnedEmojis).toEqual({});

		receive(remoteState(['unicode:thumbsup']));
		await vi.waitFor(() => expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual(['unicode:thumbsup']));
	});
});

describe('EmojiPins rules', () => {
	beforeEach(() => {
		EmojiPins.reset();
	});

	it('keeps the account pins and each persona pins apart, in pin order', () => {
		EmojiPins.pinEmoji('unicode:dog');
		EmojiPins.pinEmoji('unicode:cat', '1001');
		EmojiPins.pinEmoji('unicode:fox');
		EmojiPins.pinEmoji('unicode:cat', '1002');

		expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual(['unicode:dog', 'unicode:fox']);
		expect(EmojiPins.isPinned('unicode:cat')).toBe(false);
		expect(EmojiPins.isPinned('unicode:cat', '1001')).toBe(true);
		expect(EmojiPins.isPinned('unicode:dog', '1001')).toBe(true);
		expect(EmojiPins.getAllEffectivePinnedEmojiKeys('1001')).toEqual(['unicode:dog', 'unicode:fox', 'unicode:cat']);
	});

	it('refuses invalid keys and persona ids', () => {
		expect(EmojiPins.pinEmoji('cat')).toBe(false);
		expect(EmojiPins.pinEmoji('unicode:cat', 'persona-a')).toBe(false);
		expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual([]);
		expect(EmojiPins.personaPinnedEmojis).toEqual({});
	});

	it(`refuses a pin past ${MAX_PINNED_EMOJIS_PER_LIST} in one list`, () => {
		for (const key of unicodeKeys(MAX_PINNED_EMOJIS_PER_LIST)) {
			expect(EmojiPins.pinEmoji(key)).toBe(true);
		}
		expect(EmojiPins.pinEmoji('unicode:one-too-many')).toBe(false);
		expect(EmojiPins.getGloballyPinnedEmojiKeys()).toHaveLength(MAX_PINNED_EMOJIS_PER_LIST);
		expect(EmojiPins.pinEmoji('unicode:one-too-many', '1001')).toBe(true);
	});

	it('refuses a pin that would take the pins past their share of the synced preferences', () => {
		const longKey = (persona: number, index: number) => `custom:${'9'.repeat(19)}:${persona}${'0'.repeat(14)}${index}`;
		let refused = false;
		for (let persona = 1000; persona < 1250 && !refused; persona += 1) {
			for (let index = 0; index < MAX_PINNED_EMOJIS_PER_LIST; index += 1) {
				if (!EmojiPins.pinEmoji(longKey(persona, index), String(persona))) {
					refused = true;
					break;
				}
			}
		}
		expect(refused).toBe(true);
		expect(encodedEmojiPinsBytes(EmojiPins.pinnedEmojis, EmojiPins.personaPinnedEmojis)).toBeLessThanOrEqual(
			MAX_EMOJI_PINS_ENCODED_BYTES,
		);
	});

	it("drops a deleted persona's pins and nobody else's", () => {
		EmojiPins.pinEmoji('unicode:cat', '1001');
		EmojiPins.pinEmoji('unicode:dog', '1002');
		EmojiPins.forgetPersona('1001');
		expect(EmojiPins.personaPinnedEmojis).toEqual({'1002': ['unicode:dog']});
	});

	it('cleans what it reads: bad keys, repeats, bad persona ids, empty lists, too many', () => {
		expect(
			sanitizePinList(['unicode:cat', 'cat', '', 'unicode:cat', 'custom:1:2', `unicode:${'x'.repeat(300)}`]),
		).toEqual(['unicode:cat', 'custom:1:2']);
		expect(sanitizePinList(unicodeKeys(MAX_PINNED_EMOJIS_PER_LIST + 5))).toHaveLength(MAX_PINNED_EMOJIS_PER_LIST);
		expect(
			sanitizePersonaPins({
				'1001': {emojiIds: ['unicode:cat']},
				'1002': {emojiIds: ['nope']},
				'persona-a': {emojiIds: ['unicode:dog']},
			}),
		).toEqual({'1001': ['unicode:cat']});
	});
});
