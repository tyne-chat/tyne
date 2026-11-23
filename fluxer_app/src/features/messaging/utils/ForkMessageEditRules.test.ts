// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: tyne-chat/tyne#904. What an edit leaves once its persona tag is taken off, and when an edit that leaves no
// text removes it.

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('@app/app/I18n', () => ({default: {_: (descriptor: {message?: string}) => descriptor.message ?? ''}}));
vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {getSubPreference: () => undefined, setSubPreference: () => Promise.resolve()},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {
		get: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		post: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		patch: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		delete: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		configure: vi.fn(),
	},
}));

installVoiceMenuTestBootstrap();

const {PersonaStore} = await import('@app/features/persona/state/PersonaStore');
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
const AdvancedSettings = (await import('@app/features/user/state/AdvancedSettings')).default;
const {canRemoveText, hasNoTextToRemove, resolveEditText} = await import('./ForkMessageEditRules');

const photo = [{id: '9'}];
const sticker = [{id: '7'}];

function message(
	fields: {
		content?: string;
		attachments?: ReadonlyArray<{id: string}>;
		stickers?: ReadonlyArray<{id: string}>;
		subprofile?: {id: string; name: string} | null;
	} = {},
) {
	return {content: 'hi', attachments: [], ...fields};
}

describe('the edit rules of tyne-chat/tyne#904', () => {
	let bob: {id: string; name: string};

	beforeAll(() => {
		const stored = addTestPersona(PersonaStore, {name: 'Bob', persona_tags: [{prefix: 'B:', suffix: ''}]});
		bob = {id: stored.id, name: 'Bob'};
	});

	afterEach(() => {
		AdvancedSettings.setKeepAttachmentsOnEmptyMessageEdit(true);
	});

	describe('resolveEditText', () => {
		it('keeps text without a tag, and names no persona', () => {
			expect(resolveEditText('hello', message())).toEqual({text: 'hello', subprofile: undefined});
		});

		it('takes the tag off the text and names its persona', () => {
			const edit = resolveEditText('B: hello', message());
			expect(edit.text).toBe('hello');
			expect(edit.subprofile?.id).toBe(bob.id);
		});

		it('counts a tag with nothing after it as no text, and still names its persona', () => {
			for (const typed of ['B:', 'B:   ']) {
				const edit = resolveEditText(typed, message());
				expect(edit.text).toBe('');
				expect(edit.subprofile?.id).toBe(bob.id);
			}
		});

		it('counts an empty box as no text', () => {
			expect(resolveEditText('', message())).toEqual({text: '', subprofile: undefined});
		});

		it('counts a backslash alone on a persona message as no text, back to the account', () => {
			expect(resolveEditText('\\', message({subprofile: bob}))).toEqual({text: '', subprofile: null});
		});

		it('leaves text that only looks like a tag of nobody', () => {
			expect(resolveEditText('Z:', message()).text).toBe('Z:');
		});
	});

	describe('when an edit that leaves no text removes it', () => {
		it('removes the text of a message with attachments or stickers', () => {
			expect(canRemoveText(message({attachments: photo}))).toBe(true);
			expect(canRemoveText(message({stickers: sticker}))).toBe(true);
		});

		it('never empties a message with nothing else', () => {
			expect(canRemoveText(message())).toBe(false);
		});

		it('follows the setting when someone turned it off', () => {
			AdvancedSettings.setKeepAttachmentsOnEmptyMessageEdit(false);
			expect(canRemoveText(message({attachments: photo}))).toBe(false);
			expect(canRemoveText(message({stickers: sticker}))).toBe(false);
		});

		it('sees no text to remove on an attachment or sticker without text', () => {
			expect(hasNoTextToRemove(message({content: '', attachments: photo}))).toBe(true);
			expect(hasNoTextToRemove(message({content: '', stickers: sticker}))).toBe(true);
			expect(hasNoTextToRemove(message({attachments: photo}))).toBe(false);
			expect(hasNoTextToRemove(message({content: ''}))).toBe(false);
		});
	});
});
