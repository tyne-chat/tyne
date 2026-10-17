// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

const preferencesMap = new Map<string, unknown>();

vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {
		getSubPreference: (field: string) => preferencesMap.get(field),
		setSubPreference: (field: string, value: unknown) => {
			preferencesMap.set(field, value);
			return Promise.resolve();
		},
	},
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

vi.mock('@app/features/ui/commands/ToastCommands', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/ui/commands/ToastCommands')>()),
	error: vi.fn(() => 'toast'),
}));

installVoiceMenuTestBootstrap();

const {PersonaStoreClass, normalizePersona, normalizeSubprofile} = await import('./PersonaStore');
const {http} = await import('@app/features/platform/transport/RestTransport');
const Toast = await import('@app/features/ui/commands/ToastCommands');
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
type PersonaStoreInstance = InstanceType<typeof PersonaStoreClass>;

describe('PersonaStore', () => {
	let store: PersonaStoreInstance;

	beforeEach(() => {
		preferencesMap.clear();
		store = new PersonaStoreClass();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('initializes with empty state', () => {
		expect(store.personas).toEqual([]);
		expect(store.activePersonaId).toBeNull();
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersona).toBeNull();
		expect(store.rankedPersonas).toEqual([]);
	});

	it('holds a persona as the server sends it', () => {
		const persona = addTestPersona(store, {
			name: 'Alice',
			pronouns: 'she/her',
			color: 0xff0000,
			bio: 'Curiouser and curiouser',
			persona_tags: [{prefix: '[', suffix: ']'}],
		});

		expect(persona.id).toMatch(/^\d+$/);
		expect(persona.name).toBe('Alice');
		expect(persona.pronouns).toBe('she/her');
		expect(persona.persona_tags).toEqual([{prefix: '[', suffix: ']'}]);
		expect(store.personas.length).toBe(1);
	});

	it('replaces a persona when the server sends it again', () => {
		const persona = addTestPersona(store, {name: 'Alice'});
		store.upsertPersona({...persona, pronouns: 'they/them'});

		expect(store.personas.length).toBe(1);
		expect(store.getPersona(persona.id)?.pronouns).toBe('they/them');
	});

	it('removes a persona and unlatches if it was active', async () => {
		const persona = addTestPersona(store, {name: 'Alice'});
		await store.setActivePersona(persona.id, true);
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaId).toBe(persona.id);

		store.removePersona(persona.id);
		expect(store.personas.length).toBe(0);
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('latches and unlatches active persona', async () => {
		const persona = addTestPersona(store, {name: 'Alice'});
		await store.setActivePersona(persona.id, true);
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersona?.name).toBe('Alice');

		await store.unlatch();
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('sorts personas by name without changing the stored order', async () => {
		addTestPersona(store, {name: 'mallory'});
		addTestPersona(store, {name: 'Zed'});
		addTestPersona(store, {name: 'alice'});
		addTestPersona(store, {name: 'Bob'});

		expect(store.sortedPersonas.map((p) => p.name)).toEqual(['alice', 'Bob', 'mallory', 'Zed']);
		expect(store.personas.map((p) => p.name)).toEqual(['mallory', 'Zed', 'alice', 'Bob']);
	});

	it('files decorated persona names under their first letter or digit', async () => {
		for (const name of ['Zoe', '✨Élodie', '🌙 Luna', '𝓐𝓶𝔂', '[Mika]', 'Ⓑⓔⓝ', '✨✨', 'Dana', '★ 2B']) {
			addTestPersona(store, {name});
		}

		expect(store.sortedPersonas.map((p) => p.name)).toEqual([
			'✨✨',
			'★ 2B',
			'𝓐𝓶𝔂',
			'Ⓑⓔⓝ',
			'Dana',
			'✨Élodie',
			'🌙 Luna',
			'[Mika]',
			'Zoe',
		]);
	});

	it('sorts numbers in persona names by value', async () => {
		addTestPersona(store, {name: 'Alex 10'});
		addTestPersona(store, {name: 'Alex 2'});

		expect(store.sortedPersonas.map((p) => p.name)).toEqual(['Alex 2', 'Alex 10']);
	});

	it('calculates decay frecency accurately', async () => {
		addTestPersona(store, {name: 'P1'});
		addTestPersona(store, {name: 'P2'});

		const p1Id = store.personas[0].id;
		const p2Id = store.personas[1].id;

		await store.recordPersonaUse(p1Id);
		await store.recordPersonaUse(p2Id);
		await store.recordPersonaUse(p2Id);

		expect(store.rankedPersonas[0].name).toBe('P2');
		expect(store.rankedPersonas[1].name).toBe('P1');
	});

	it('handles in-chat latch commands', async () => {
		addTestPersona(store, {name: 'Alice'});
		addTestPersona(store, {name: 'Bob'});

		await store.setActivePersona(store.personas[0].id, true);
		expect(store.isPersonaLatched).toBe(true);

		// in-chat command "\\" clears latch
		const res = store.handleInChatCommand(null, '\\\\');
		expect(res.handled).toBe(true);
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('matches outgoing messages with persona tags and updates frecency', async () => {
		addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: '[', suffix: ']'}],
		});

		const result = store.matchOutgoingMessage(null, '[Hello from Alice!]');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Alice');
		expect(result.strippedContent).toBe('Hello from Alice!');
	});

	it('preserves latch when escaping with single backslash \\ in manual mode', async () => {
		const alice = addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		await store.setActivePersona(alice.id, true, 'manual');
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaMode).toBe('manual');

		// Single backslash escape in manual mode: sends as root account, strips slash, PRESERVES latch
		const result = store.matchOutgoingMessage(null, '\\Hello from root');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Hello from root');
		expect(result.clearedLatch).toBeFalsy();
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaId).toBe(alice.id);
		expect(store.activePersonaMode).toBe('manual');
	});

	it('unlatches when escaping with single backslash \\ in last-used mode while preserving last mode', async () => {
		const alice = addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		await store.setActivePersona(alice.id, true, 'last');
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaMode).toBe('last');

		// Single backslash escape in last-used mode: sends as root account, UNLATCHES, keeps mode as 'last'
		const result = store.matchOutgoingMessage(null, '\\Hello from root');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Hello from root');
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
		expect(store.activePersonaMode).toBe('last');

		// Next untagged message continues as root account
		const untagged = store.matchOutgoingMessage(null, 'Still root account');
		expect(untagged.matched).toBe(false);
		expect(untagged.strippedContent).toBe('Still root account');
	});

	it('clears latch when escaping with double backslash \\\\ followed by message', async () => {
		const alice = addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		await store.setActivePersona(alice.id, true, 'last');
		expect(store.isPersonaLatched).toBe(true);

		// Double backslash escape with message: sends as root account, strips slashes, CLEARS latch
		const result = store.matchOutgoingMessage(null, '\\\\ Hello from root');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Hello from root');
		expect(result.clearedLatch).toBe(true);
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('does not intercept commands or strip slashes when root account is already selected', async () => {
		addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: '[', suffix: ']'}],
		});
		// Ensure root account is active (not latched)
		await store.unlatch();
		expect(store.activePersona).toBeNull();

		// Standalone \\ in chat should not be treated as a command
		const cmdRes = store.handleInChatCommand(null, '\\\\');
		expect(cmdRes.handled).toBe(false);
		expect(cmdRes.isCommand).toBe(false);

		// Message starting with single backslash should retain the slash
		const singleSlashRes = store.matchOutgoingMessage(null, '\\hello world');
		expect(singleSlashRes.matched).toBe(false);
		expect(singleSlashRes.wasEscaped).toBeFalsy();
		expect(singleSlashRes.strippedContent).toBe('\\hello world');

		// Message starting with double backslash should retain the slashes
		const doubleSlashRes = store.matchOutgoingMessage(null, '\\\\hello world');
		expect(doubleSlashRes.matched).toBe(false);
		expect(doubleSlashRes.wasEscaped).toBeFalsy();
		expect(doubleSlashRes.clearedLatch).toBeFalsy();
		expect(doubleSlashRes.strippedContent).toBe('\\\\hello world');

		// Standalone \\ message match should retain the slashes
		const standaloneRes = store.matchOutgoingMessage(null, '\\\\');
		expect(standaloneRes.matched).toBe(false);
		expect(standaloneRes.wasEscaped).toBeFalsy();
		expect(standaloneRes.clearedLatch).toBeFalsy();
		expect(standaloneRes.strippedContent).toBe('\\\\');
	});

	it('correctly handles message editing with matchEditMessage', async () => {
		const alice = addTestPersona(store, {
			name: 'Alice',
			persona_tags: [
				{prefix: '[', suffix: ']'},
				{prefix: 'A:', suffix: ''},
			],
		});
		const bob = addTestPersona(store, {
			name: 'Bob',
			persona_tags: [{prefix: 'B:', suffix: ''}],
		});

		// 1. Root message edited to include Alice's persona tag
		const res1 = store.matchEditMessage('[Hello Alice!]', null);
		expect(res1.finalContent).toBe('Hello Alice!');
		expect(res1.subprofile?.id).toBe(alice.id);
		expect(res1.subprofile?.name).toBe('Alice');

		// 2. Alice message edited to Bob's tag -> switches to Bob and strips B:
		const currentAliceSubprofile = {
			id: alice.id,
			name: 'Alice',
		};
		const res2 = store.matchEditMessage('B: Hello Bob!', currentAliceSubprofile);
		expect(res2.finalContent).toBe('Hello Bob!');
		expect(res2.subprofile?.id).toBe(bob.id);
		expect(res2.subprofile?.name).toBe('Bob');

		// 3. Alice message edited without any tags -> says nothing about the persona, so it stays Alice's
		const res3 = store.matchEditMessage('Plain edit with no tags', currentAliceSubprofile);
		expect(res3.finalContent).toBe('Plain edit with no tags');
		expect(res3.subprofile).toBeUndefined();

		// 4. Alice message edited with leading backslash -> escapes and resets to root
		const res4 = store.matchEditMessage('\\Plain edit meant for root', currentAliceSubprofile);
		expect(res4.finalContent).toBe('Plain edit meant for root');
		expect(res4.subprofile).toBeNull();

		// 5. Root message edited without any tags -> remains root (undefined subprofile)
		const res5 = store.matchEditMessage('Plain root edit', null);
		expect(res5.finalContent).toBe('Plain root edit');
		expect(res5.subprofile).toBeUndefined();

		// 6. Attachment-only message edited with prefix only (e.g. 'B:') -> sets Bob, empty content
		const res6 = store.matchEditMessage('B:', null, {hasAttachments: true, originalContent: ''});
		expect(res6.finalContent).toBe('');
		expect(res6.subprofile?.id).toBe(bob.id);
		expect(res6.subprofile?.name).toBe('Bob');

		// 7. Text message edited with prefix only (e.g. 'B:') -> sets Bob, empty content
		const res7 = store.matchEditMessage('B:', currentAliceSubprofile, {
			hasAttachments: false,
			originalContent: 'Original message text',
		});
		expect(res7.finalContent).toBe('');
		expect(res7.subprofile?.id).toBe(bob.id);
		expect(res7.subprofile?.name).toBe('Bob');

		// 7b. Text message prepended with prefix (e.g. 'B: Original message text') -> sets Bob, preserves text
		const res7b = store.matchEditMessage('B: Original message text', currentAliceSubprofile, {
			hasAttachments: false,
			originalContent: 'Original message text',
		});
		expect(res7b.finalContent).toBe('Original message text');
		expect(res7b.subprofile?.id).toBe(bob.id);
		expect(res7b.subprofile?.name).toBe('Bob');

		// 8. Text message edited with escape backslash only -> unproxies, empty content
		const res8 = store.matchEditMessage('\\', currentAliceSubprofile, {
			hasAttachments: false,
			originalContent: 'Original message text',
		});
		expect(res8.finalContent).toBe('');
		expect(res8.subprofile).toBeNull();

		// 8b. Text message prepended with escape backslash -> unproxies, preserves text
		const res8b = store.matchEditMessage('\\Original message text', currentAliceSubprofile, {
			hasAttachments: false,
			originalContent: 'Original message text',
		});
		expect(res8b.finalContent).toBe('Original message text');
		expect(res8b.subprofile).toBeNull();

		// 9. Attachment-only message currently Alice edited to Bob with 'B:' -> sets Bob, empty content
		const res9 = store.matchEditMessage('B:', currentAliceSubprofile, {
			hasAttachments: true,
			originalContent: '',
		});
		expect(res9.finalContent).toBe('');
		expect(res9.subprofile?.id).toBe(bob.id);
		expect(res9.subprofile?.name).toBe('Bob');

		// 10. Attachment-only message where content was bugged 'A:' edited to Bob with 'B:' -> strips bugged prefix, sets Bob
		const res10 = store.matchEditMessage('B:', currentAliceSubprofile, {
			hasAttachments: true,
			originalContent: 'A:',
		});
		expect(res10.finalContent).toBe('');
		expect(res10.subprofile?.id).toBe(bob.id);
		expect(res10.subprofile?.name).toBe('Bob');

		// 11. Attachment-only message currently Alice edited with escape backslash only -> unproxies, empty content
		const res11 = store.matchEditMessage('\\', currentAliceSubprofile, {
			hasAttachments: true,
			originalContent: '',
		});
		expect(res11.finalContent).toBe('');
		expect(res11.subprofile).toBeNull();

		// 12. Captioned attachment message edited to Bob with prepended 'B: Look at my dog' -> sets Bob, preserves caption
		const res12 = store.matchEditMessage('B: Look at my dog', currentAliceSubprofile, {
			hasAttachments: true,
			originalContent: 'Look at my dog',
		});
		expect(res12.finalContent).toBe('Look at my dog');
		expect(res12.subprofile?.id).toBe(bob.id);
		expect(res12.subprofile?.name).toBe('Bob');
	});

	it('setPersonas unlatches if active persona is not in new persona set', async () => {
		const persona = addTestPersona(store, {name: 'Alice'});
		await store.setActivePersona(persona.id, true);
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaId).toBe(persona.id);

		store.setPersonas([]);
		expect(store.personas.length).toBe(0);
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('appends personas alongside existing ones', async () => {
		addTestPersona(store, {name: 'Alice'});

		const newPersona = {
			id: '1540000000000009002',
			name: 'Bob',
			persona_tags: [],
		};

		store.upsertPersonas([newPersona as any]);
		expect(store.personas.length).toBe(2);
		expect(store.personas[0].name).toBe('Alice');
		expect(store.personas[1].name).toBe('Bob');
	});

	it('auto-activates on persona tag match when activePersonaMode is "last"', async () => {
		const alice = addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		const bob = addTestPersona(store, {
			name: 'Bob',
			persona_tags: [{prefix: 'b:', suffix: ''}],
		});

		await store.setActivePersonaMode('last');
		expect(store.activePersonaMode).toBe('last');
		expect(store.isPersonaLatched).toBe(false);

		// Initially active as Alice
		await store.setActivePersona(alice.id, true, 'last');
		expect(store.activePersonaId).toBe(alice.id);
		expect(store.isPersonaLatched).toBe(true);

		// Bob speaks with prefix => switches activePersona to Bob
		const result = store.matchOutgoingMessage(null, 'b: Hello everyone');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Hello everyone');
		expect(store.activePersonaId).toBe(bob.id);

		// Next untagged message automatically sends as Bob
		const untagged = store.matchOutgoingMessage(null, 'I am speaking without tags');
		expect(untagged.matched).toBe(true);
		expect(untagged.persona?.name).toBe('Bob');
		expect(untagged.strippedContent).toBe('I am speaking without tags');
	});

	it('does NOT switch activePersona on persona tag match when activePersonaMode is "manual"', async () => {
		const alice = addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		const bob = addTestPersona(store, {
			name: 'Bob',
			persona_tags: [{prefix: 'b:', suffix: ''}],
		});

		await store.setActivePersona(alice.id, true, 'manual');
		expect(store.activePersonaMode).toBe('manual');
		expect(store.activePersonaId).toBe(alice.id);

		// Bob speaks with prefix => sent as Bob, but activePersona remains Alice
		const result = store.matchOutgoingMessage(null, 'b: Quick message from Bob');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.persona?.id).toBe(bob.id);
		expect(store.activePersonaId).toBe(alice.id);

		// Next untagged message sends as Alice
		const untagged = store.matchOutgoingMessage(null, 'Back to Alice');
		expect(untagged.matched).toBe(true);
		expect(untagged.persona?.name).toBe('Alice');
	});

	it('does NOT send as persona for untagged messages when in "manual" mode with root account selected', async () => {
		addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});

		await store.unlatch();
		expect(store.activePersonaMode).toBe('manual');
		expect(store.activePersonaId).toBeNull();
		expect(store.isPersonaLatched).toBe(false);

		const untagged = store.matchOutgoingMessage(null, 'Normal message');
		expect(untagged.matched).toBe(false);
		expect(untagged.strippedContent).toBe('Normal message');
	});

	it('switching to "last" while on root starts on root without auto-selecting first persona', async () => {
		addTestPersona(store, {
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		const bob = addTestPersona(store, {
			name: 'Bob',
			persona_tags: [{prefix: 'b:', suffix: ''}],
		});

		await store.unlatch();
		expect(store.activePersonaMode).toBe('manual');
		expect(store.activePersonaId).toBeNull();
		expect(store.isPersonaLatched).toBe(false);

		// Switch directly to 'last'
		await store.setActivePersonaMode('last');
		expect(store.activePersonaMode).toBe('last');
		// Must NOT auto-select Alice (first persona)
		expect(store.activePersonaId).toBeNull();
		expect(store.isPersonaLatched).toBe(false);

		// Untagged message sends as root account
		const untagged = store.matchOutgoingMessage(null, 'Normal message');
		expect(untagged.matched).toBe(false);
		expect(untagged.strippedContent).toBe('Normal message');

		// First tagged message latches Bob
		const tagged = store.matchOutgoingMessage(null, 'b: Hello Bob');
		expect(tagged.matched).toBe(true);
		expect(tagged.persona?.name).toBe('Bob');
		expect(store.activePersonaId).toBe(bob.id);
		expect(store.isPersonaLatched).toBe(true);

		// Subsequent untagged message now sends as Bob
		const nextUntagged = store.matchOutgoingMessage(null, 'Speaking as Bob now');
		expect(nextUntagged.matched).toBe(true);
		expect(nextUntagged.persona?.name).toBe('Bob');
	});

	describe('getEffectivePersonaForText', () => {
		it('says so while the text could still become another persona tag', async () => {
			const alice = addTestPersona(store, {name: 'Alice', persona_tags: [{prefix: 'a:'}]});
			addTestPersona(store, {name: 'Bob', persona_tags: [{prefix: 'b:'}]});
			await store.setActivePersona(alice.id, true);

			// One character into Bob's tag: still Alice for now, and not to be shown to anyone yet.
			const partial = store.getEffectivePersonaForText(null, 'b');
			expect(partial.persona?.id).toBe(alice.id);
			expect(partial.isTagUnfinished).toBe(true);

			expect(store.getEffectivePersonaForText(null, 'b:').isTagUnfinished).toBe(false);
			expect(store.getEffectivePersonaForText(null, 'bye').isTagUnfinished).toBe(false);
			// The start of Alice's own tag changes nothing about who is typing.
			expect(store.getEffectivePersonaForText(null, 'a').isTagUnfinished).toBe(false);
		});

		it('returns tag-matched persona and isFromTag=true on tag match', async () => {
			const alice = addTestPersona(store, {
				name: 'Alice',
				persona_tags: [{prefix: '[', suffix: ']'}],
			});
			const bob = addTestPersona(store, {
				name: 'Bob',
				persona_tags: [{prefix: 'b:', suffix: ''}],
			});

			// No active persona, unlatched in manual mode
			await store.unlatch();

			// Types Alice tag
			const preview1 = store.getEffectivePersonaForText(null, '[Hello world]');
			expect(preview1.persona?.id).toBe(alice.id);
			expect(preview1.isFromTag).toBe(true);

			// Types Bob tag
			const preview2 = store.getEffectivePersonaForText(null, 'b: Speaking as Bob');
			expect(preview2.persona?.id).toBe(bob.id);
			expect(preview2.isFromTag).toBe(true);

			// Types incomplete tag -> returns null (root)
			const preview3 = store.getEffectivePersonaForText(null, '[Hello');
			expect(preview3.persona).toBeNull();
			expect(preview3.isFromTag).toBe(false);
		});

		it('falls back to active latched persona with isFromTag=false when untagged', async () => {
			const alice = addTestPersona(store, {
				name: 'Alice',
				persona_tags: [{prefix: '[', suffix: ']'}],
			});
			const bob = addTestPersona(store, {
				name: 'Bob',
				persona_tags: [{prefix: 'b:', suffix: ''}],
			});

			await store.setActivePersona(alice.id, true, 'manual');

			// Untagged -> returns Alice (latched)
			const preview1 = store.getEffectivePersonaForText(null, 'Normal message');
			expect(preview1.persona?.id).toBe(alice.id);
			expect(preview1.isFromTag).toBe(false);

			// Tagged as Bob -> returns Bob (isFromTag=true)
			const preview2 = store.getEffectivePersonaForText(null, 'b: Hey');
			expect(preview2.persona?.id).toBe(bob.id);
			expect(preview2.isFromTag).toBe(true);

			// Tag removed -> reverts to Alice
			const preview3 = store.getEffectivePersonaForText(null, 'Hey');
			expect(preview3.persona?.id).toBe(alice.id);
			expect(preview3.isFromTag).toBe(false);

			// Escaped with \ -> returns null (root)
			const preview4 = store.getEffectivePersonaForText(null, '\\ b: Hey');
			expect(preview4.persona).toBeNull();
			expect(preview4.isFromTag).toBe(false);
		});
	});

	describe('display tag settings', () => {
		it('reads and updates account-level display tag text and icon', async () => {
			expect(store.displayTagText).toBe('');
			expect(store.displayTagIcon).toBeNull();

			await store.setDisplayTag('Wonderland', 'https://example.com/icon.png');
			expect(store.displayTagText).toBe('Wonderland');
			expect(store.displayTagIcon).toBe('https://example.com/icon.png');

			await store.setDisplayTag('', null);
			expect(store.displayTagText).toBe('');
			expect(store.displayTagIcon).toBeNull();
		});

		it('populates display_tag_text and display_tag_icon on matchEditMessage', async () => {
			const alice = addTestPersona(store, {
				name: 'Alice',
				persona_tags: [{prefix: '[', suffix: ']'}],
			});
			await store.setDisplayTag('Wonderland', 'https://example.com/icon.png');

			const res = store.matchEditMessage('[Hello]');
			expect(res.subprofile?.id).toBe(alice.id);
			expect(res.subprofile?.display_tag_text).toBe('Wonderland');
			expect(res.subprofile?.display_tag_icon).toBe('https://example.com/icon.png');
		});
	});

	describe('known personas', () => {
		it('caches and retrieves known personas via recordKnownPersona and getKnownPersona', () => {
			expect(store.getKnownPersona('p_ext')).toBeNull();

			store.recordKnownPersona({
				id: 'p_ext',
				name: 'Fox Persona',
				avatar: 'https://example.com/fox.png',
				avatar_color: 0x123456,
				display_tag_text: 'Fox System',
				display_tag_icon: null,
				pronouns: 'they/them',
				color: 0x123456,
			});

			const known = store.getKnownPersona('p_ext');
			expect(known).not.toBeNull();
			expect(known?.id).toBe('p_ext');
			expect(known?.name).toBe('Fox Persona');
			expect(known?.display_tag_text).toBe('Fox System');
			expect(known?.pronouns).toBe('they/them');
		});

		it('retrieves owned persona via getKnownPersona formatted as MessageSubprofileResponse', async () => {
			await store.setDisplayTag('Wonderland', null);
			const alice = addTestPersona(store, {
				name: 'Alice',
				pronouns: 'she/her',
			});

			const known = store.getKnownPersona(alice.id);
			expect(known).not.toBeNull();
			expect(known?.id).toBe(alice.id);
			expect(known?.name).toBe('Alice');
			expect(known?.display_tag_text).toBe('Wonderland');
			expect(known?.pronouns).toBe('she/her');
		});
	});

	describe('signature emojis & reaction persona resolution', () => {
		it('normalizes persona with signature emojis', () => {
			const normalized = normalizePersona({
				id: 'p_sig',
				name: 'Sig Persona',
				signature_emojis: [{name: '🦊'}, {id: '12345', name: 'custom_fox', animated: true}],
			});

			expect(normalized.signature_emojis).toEqual([
				{id: null, name: '🦊', animated: null},
				{id: '12345', name: 'custom_fox', animated: true},
			]);
			expect(normalized.signature_emojis).toEqual([
				{id: null, name: '🦊', animated: null},
				{id: '12345', name: 'custom_fox', animated: true},
			]);
		});

		it('finds persona by signature emoji (unicode, surrogate, and custom ID)', () => {
			store.setPersonas([
				{
					id: 'p_fox',
					name: 'Fox Persona',
					signature_emojis: [
						{id: null, name: '🦊'},
						{id: 'custom_100', name: 'custom_fox'},
					],
				} as any,
				{
					id: 'p_cat',
					name: 'Cat Persona',
					signature_emojis: [{id: null, name: '🐱'}],
				} as any,
			]);

			// Matches unicode by name
			expect(store.getPersonaBySignatureEmoji({name: '🦊'})?.id).toBe('p_fox');
			// Matches unicode by surrogates
			expect(store.getPersonaBySignatureEmoji({name: 'fox', surrogates: '🦊'})?.id).toBe('p_fox');
			// Matches custom emoji by ID
			expect(store.getPersonaBySignatureEmoji({id: 'custom_100', name: 'whatever'})?.id).toBe('p_fox');
			// Returns null for non-matching emoji
			expect(store.getPersonaBySignatureEmoji({name: '🐶'})).toBeNull();
		});

		it('resolves effective reaction persona by signature emoji, then draft text, then active persona', () => {
			store.setPersonas([
				{
					id: 'p_fox',
					name: 'Fox Persona',
					persona_tags: [{prefix: 'f:'}],
					signature_emojis: [{id: null, name: '🦊'}],
				} as any,
				{
					id: 'p_active',
					name: 'Active Persona',
				} as any,
			]);
			store.setActivePersona('p_active');

			// 1. Signature emoji takes precedence
			const forEmoji = store.getEffectiveReactionPersona(null, {name: '🦊'}, 'unrelated text');
			expect(forEmoji?.id).toBe('p_fox');

			// 2. Draft text tag match when emoji is not signature emoji
			const forText = store.getEffectiveReactionPersona(null, {name: '⭐'}, 'f: hello world');
			expect(forText?.id).toBe('p_fox');

			// 3. Fallback to active persona
			const forFallback = store.getEffectiveReactionPersona(null, {name: '⭐'}, 'plain text without tag');
			expect(forFallback?.id).toBe('p_active');
		});
	});

	describe('normalizeSubprofile', () => {
		it('normalizes REST API PersonaResponse with snake_case hashes', () => {
			const subprofile = normalizeSubprofile({
				id: 'persona_api_1',
				name: 'Alice Api',
				avatar_hash: 'api_avatar_hash_123',
				banner_hash: 'api_banner_hash_456',
				avatar_color: 0x112233,
				color: 0x445566,
				bio: 'Api bio',
				pronouns: 'she/her',
				visibility: 'public',
			} as any);

			expect(subprofile).toEqual({
				id: 'persona_api_1',
				name: 'Alice Api',
				avatar: 'api_avatar_hash_123',
				avatar_color: 0x112233,
				display_tag_text: undefined,
				display_tag_icon: undefined,
				pronouns: 'she/her',
				color: 0x445566,
				visibility: 'public',
			});
		});

		it('normalizes wire MessageSubprofileResponse snapshot and applies display tag overrides', () => {
			const subprofile = normalizeSubprofile(
				{
					id: 'persona_snapshot_1',
					name: 'Charlie Snapshot',
					avatar: 'snapshot_avatar_val',
					avatar_color: 0x990011,
					color: 0x223344,
					display_tag_text: 'OLD_TAG',
					display_tag_icon: 'https://cdn.example.com/old.png',
					pronouns: 'they/them',
					visibility: 'private',
				},
				{
					display_tag_text: 'NEW_TAG',
					display_tag_icon: null,
				},
			);

			expect(subprofile).toEqual({
				id: 'persona_snapshot_1',
				name: 'Charlie Snapshot',
				avatar: 'snapshot_avatar_val',
				avatar_color: 0x990011,
				display_tag_text: 'NEW_TAG',
				display_tag_icon: null,
				pronouns: 'they/them',
				color: 0x223344,
				visibility: 'private',
			});
		});

		it('preserves undefined for unprovided fields to prevent stomping existing message properties', () => {
			const subprofile = normalizeSubprofile({
				id: 'partial_1',
				name: 'Partial Persona',
				avatar_hash: 'new_hash_only',
			} as any);

			expect(subprofile.id).toBe('partial_1');
			expect(subprofile.name).toBe('Partial Persona');
			expect(subprofile.avatar).toBe('new_hash_only');
			expect(subprofile.avatar_color).toBeUndefined();
			expect(subprofile.display_tag_text).toBeUndefined();
			expect(subprofile.display_tag_icon).toBeUndefined();
			expect(subprofile.pronouns).toBeUndefined();
			expect(subprofile.color).toBeUndefined();
			expect(subprofile.visibility).toBeUndefined();
		});
	});

	describe('when the server refuses a change', () => {
		beforeEach(() => {
			vi.mocked(http.patch).mockRejectedValueOnce(new Error('offline'));
			vi.mocked(Toast.error).mockClear();
		});

		it('puts the display tag back', async () => {
			store.updateSettings({display_tag_text: 'old', display_tag_icon: 'https://example.test/old.png'});

			await store.setDisplayTag('  new  ', 'https://example.test/new.png');

			expect(store.displayTagText).toBe('old');
			expect(store.displayTagIcon).toBe('https://example.test/old.png');
			expect(Toast.error).toHaveBeenCalledTimes(1);
		});

		it('puts the persona mode, persona and latch back', async () => {
			const persona = addTestPersona(store, {name: 'Alice'});
			store.updateSettings({active_persona_mode: 'last', active_persona_id: persona.id, is_latched: true});

			await store.setActivePersonaMode('manual');

			expect(store.activePersonaMode).toBe('last');
			expect(store.activePersonaId).toBe(persona.id);
			expect(store.isPersonaLatched).toBe(true);
			expect(Toast.error).toHaveBeenCalledTimes(1);
		});

		it('puts the previous persona back when selecting another fails', async () => {
			const alice = addTestPersona(store, {name: 'Alice'});
			const bob = addTestPersona(store, {name: 'Bob'});
			store.updateSettings({active_persona_mode: 'manual', active_persona_id: alice.id, is_latched: true});

			await store.setActivePersona(bob.id, false, 'last');

			expect(store.activePersonaId).toBe(alice.id);
			expect(store.isPersonaLatched).toBe(true);
			expect(store.activePersonaMode).toBe('manual');
			expect(Toast.error).toHaveBeenCalledTimes(1);
		});

		it('keeps the persona latched when clearing it fails', async () => {
			const persona = addTestPersona(store, {name: 'Alice'});
			store.updateSettings({active_persona_id: persona.id, is_latched: true});

			await store.unlatch();

			expect(store.activePersonaId).toBe(persona.id);
			expect(store.isPersonaLatched).toBe(true);
			expect(Toast.error).toHaveBeenCalledTimes(1);
		});
	});
});
