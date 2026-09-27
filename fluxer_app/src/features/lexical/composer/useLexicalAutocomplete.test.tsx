// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

export const mockGetCachedMessages = vi.fn();
let currentMockUserId = 'current_user_id';

vi.mock('@app/features/auth/state/Authentication', () => ({
	default: {
		get currentUserId() {
			return currentMockUserId;
		},
	},
}));

vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {
		getCachedMessages: (...args: Array<unknown>) => mockGetCachedMessages(...args),
		getMessages: () => ({toArray: () => []}),
	},
}));

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('@app/features/member/state/MemberSearch', () => ({
	default: {
		initialize: vi.fn(),
		getSearchContext: vi.fn(() => ({
			search: vi.fn(),
			beginSearch: vi.fn(),
			cancelSearch: vi.fn(),
			destroy: vi.fn(),
		})),
	},
}));

import {Channel} from '@app/features/channel/models/Channel';
import {useLexicalAutocomplete} from '@app/features/lexical/composer/useLexicalAutocomplete';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

const mockI18n = {
	_: (descriptor: {message?: string}) => descriptor?.message ?? '',
	locale: 'en',
} as any;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('useLexicalAutocomplete - Persona Mentions', () => {
	let container: HTMLDivElement;
	let root: Root;
	const testChannel = new Channel({
		id: '1546500000000000099',
		name: 'general',
		type: 0,
		guild_id: '1546500000000000001',
	});

	beforeEach(() => {
		currentMockUserId = 'current_user_id';
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	function createMockMessageList(messages: Array<any>) {
		return {
			forEach: (callback: (msg: any) => boolean | undefined) => {
				for (const m of messages) {
					if (callback(m) === false) break;
				}
			},
		};
	}

	it('extracts in-channel recent personas and includes them in mention autocomplete', async () => {
		const msg1 = {
			id: '1001',
			channel_id: testChannel.id,
			author: {
				id: 'author_1',
				username: 'user_one',
				discriminator: '0001',
				globalName: null,
			},
			timestamp: new Date(),
			subprofile: {
				id: 'sub_fox',
				name: 'Foxy',
				avatar: null,
				avatar_color: 0xff0000,
				display_tag_text: 'FOX',
				visibility: 'public',
			},
		};

		mockGetCachedMessages.mockReturnValue(createMockMessageList([msg1]));
		currentMockUserId = 'current_user_id';

		let hookResult: ReturnType<typeof useLexicalAutocomplete> | null = null;

		function TestHarness() {
			hookResult = useLexicalAutocomplete({
				channel: testChannel,
				i18n: mockI18n,
				handleRef: {
					current: {
						getTextUpToCursor: () => '@Fox',
						getActiveSlotAutocompleteContext: () => null,
						getActiveOptionalContext: () => null,
						insertPayload: vi.fn(),
						replaceTextRange: vi.fn(),
					} as any,
				},
			});
			return null;
		}

		await act(async () => {
			root.render(<TestHarness data-flx="lexical.composer.use-lexical-autocomplete-test.test-harness" />);
		});

		expect(hookResult).not.toBeNull();
		const options = hookResult!.autocompleteOptions;
		const personaOption = options.find((opt: any) => opt.type === 'mention' && opt.kind === 'persona');
		expect(personaOption).toBeDefined();
		if (personaOption && personaOption.type === 'mention' && personaOption.kind === 'persona') {
			expect(personaOption.persona.name).toBe('Foxy');
			expect(personaOption.persona.id).toBe('sub_fox');
			expect(personaOption.persona.display_tag_text).toBe('FOX');
			expect(personaOption.persona.owner_user_id).toBe('author_1');
		}
	});

	it('skips private personas authored by another user', async () => {
		const privateMsgOtherUser = {
			id: '1002',
			channel_id: testChannel.id,
			author: {
				id: 'other_user',
				username: 'other',
				discriminator: '0002',
				globalName: null,
			},
			timestamp: new Date(),
			subprofile: {
				id: 'sub_secret',
				name: 'SecretPersona',
				visibility: 'private',
			},
		};

		mockGetCachedMessages.mockReturnValue(createMockMessageList([privateMsgOtherUser]));
		currentMockUserId = 'me_123';

		let hookResult: ReturnType<typeof useLexicalAutocomplete> | null = null;

		function TestHarness() {
			hookResult = useLexicalAutocomplete({
				channel: testChannel,
				i18n: mockI18n,
				handleRef: {
					current: {
						getTextUpToCursor: () => '@Secret',
						getActiveSlotAutocompleteContext: () => null,
						getActiveOptionalContext: () => null,
						insertPayload: vi.fn(),
						replaceTextRange: vi.fn(),
					} as any,
				},
			});
			return null;
		}

		await act(async () => {
			root.render(<TestHarness data-flx="lexical.composer.use-lexical-autocomplete-test.test-harness--2" />);
		});

		expect(hookResult).not.toBeNull();
		const personaOption = hookResult!.autocompleteOptions.find(
			(opt: any) => opt.type === 'mention' && opt.kind === 'persona',
		);
		expect(personaOption).toBeUndefined();
	});

	it('selects persona and inserts wire representation into composer', async () => {
		const recordKnownSpy = vi.spyOn(PersonaStore, 'recordKnownPersona');
		const insertPayloadMock = vi.fn();

		let hookResult: ReturnType<typeof useLexicalAutocomplete> | null = null;

		const personaOption = {
			type: 'mention' as const,
			kind: 'persona' as const,
			persona: {
				id: 'persona_selected',
				name: 'Selectable',
				avatar_hash: 'avatar123',
				color: 0x00ff00,
				pronouns: 'they/them',
				display_tag_text: 'SEL',
				display_tag_icon: null,
				owner_user_id: 'user_owner_99',
				owner_username: 'owner_user',
				owner_discriminator: '0001',
				owner_global_name: 'Owner',
				owner_nickname: null,
			},
		};

		function TestHarness() {
			hookResult = useLexicalAutocomplete({
				channel: testChannel,
				i18n: mockI18n,
				handleRef: {
					current: {
						getTextUpToCursor: () => '@Select',
						getDisplayValue: () => '@Select',
						getSegments: () => [],
						getActiveSlotAutocompleteContext: () => null,
						getActiveOptionalContext: () => null,
						insertPayload: insertPayloadMock,
						replaceRange: insertPayloadMock,
						clear: vi.fn(),
					} as any,
				},
			});
			return null;
		}

		await act(async () => {
			root.render(<TestHarness data-flx="lexical.composer.use-lexical-autocomplete-test.test-harness--3" />);
		});

		await act(async () => {
			hookResult!.handleSelect(personaOption);
		});

		expect(recordKnownSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'persona_selected',
				name: 'Selectable',
			}),
		);
		expect(insertPayloadMock).toHaveBeenCalledWith(
			0,
			7,
			expect.objectContaining({
				kind: 'mention',
				mentionType: 'user',
				id: 'user_owner_99',
				display: '@Selectable',
				wire: '<@user_owner_99:persona_selected>',
			}),
			expect.anything(),
		);
	});
});
