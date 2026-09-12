// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Persona} from './PersonaStore';

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

installVoiceMenuTestBootstrap();

const {PersonaStoreClass} = await import('./PersonaStore');
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

	it('adds a new persona', async () => {
		const persona = await store.addPersona({
			name: 'Alice',
			system_name: 'Wonderland',
			pronouns: 'she/her',
			color: 0xff0000,
			bio: 'Curiouser and curiouser',
			persona_tags: [{prefix: '[', suffix: ']'}],
		});

		expect(persona.name).toBe('Alice');
		expect(persona.systemName).toBe('Wonderland');
		expect(persona.pronouns).toBe('she/her');
		expect(persona.personaTags?.length).toBe(1);
		expect(persona.personaTags?.[0].prefix).toBe('[');
		expect(persona.personaTags?.[0].suffix).toBe(']');
		expect(store.personas.length).toBe(1);
	});

	it('finds persona by name with case-insensitivity and prefix matching', async () => {
		await store.addPersona({name: 'Alice'});
		await store.addPersona({name: 'Bob'});

		expect(store.findPersonaByName('alice')?.name).toBe('Alice');
		expect(store.findPersonaByName('ALICE')?.name).toBe('Alice');
		expect(store.findPersonaByName('Bo')?.name).toBe('Bob');
		expect(store.findPersonaByName('Unknown')).toBeNull();
	});

	it('updates a persona', async () => {
		const persona = await store.addPersona({name: 'Alice'});
		await store.updatePersona(persona.id, {pronouns: 'they/them'});

		const updated = store.personas.find((p: Persona) => p.id === persona.id);
		expect(updated?.pronouns).toBe('they/them');
	});

	it('deletes a persona and unlatches if it was active', async () => {
		const persona = await store.addPersona({name: 'Alice'});
		await store.setActivePersona(persona.id, true);
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaId).toBe(persona.id);

		await store.deletePersona(persona.id);
		expect(store.personas.length).toBe(0);
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('latches and unlatches active persona', async () => {
		const persona = await store.addPersona({name: 'Alice'});
		await store.setActivePersona(persona.id, true);
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersona?.name).toBe('Alice');

		await store.unlatch();
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('calculates decay frecency accurately', async () => {
		await store.addPersona({name: 'P1'});
		await store.addPersona({name: 'P2'});

		const p1Id = store.personas[0].id;
		const p2Id = store.personas[1].id;

		await store.recordPersonaUse(p1Id);
		await store.recordPersonaUse(p2Id);
		await store.recordPersonaUse(p2Id);

		expect(store.rankedPersonas[0].name).toBe('P2');
		expect(store.rankedPersonas[1].name).toBe('P1');
	});

	it('handles in-chat latch commands', async () => {
		await store.addPersona({name: 'Alice'});
		await store.addPersona({name: 'Bob'});

		await store.setActivePersona(store.personas[0].id, true);
		expect(store.isPersonaLatched).toBe(true);

		// in-chat command "\\" clears latch
		const res = store.handleInChatCommand('\\\\');
		expect(res.handled).toBe(true);
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('matches outgoing messages with persona tags and updates frecency', async () => {
		await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: '[', suffix: ']'}],
		});

		const result = store.matchOutgoingMessage('[Hello from Alice!]');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Alice');
		expect(result.strippedContent).toBe('Hello from Alice!');
	});

	it('preserves latch when escaping with single backslash \\ in manual mode', async () => {
		const alice = await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		await store.setActivePersona(alice.id, true, 'manual');
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaMode).toBe('manual');

		// Single backslash escape in manual mode: sends as root account, strips slash, PRESERVES latch
		const result = store.matchOutgoingMessage('\\Hello from root');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Hello from root');
		expect(result.clearedLatch).toBeFalsy();
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaId).toBe(alice.id);
		expect(store.activePersonaMode).toBe('manual');
	});

	it('unlatches when escaping with single backslash \\ in last-used mode while preserving last mode', async () => {
		const alice = await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		await store.setActivePersona(alice.id, true, 'last');
		expect(store.isPersonaLatched).toBe(true);
		expect(store.activePersonaMode).toBe('last');

		// Single backslash escape in last-used mode: sends as root account, UNLATCHES, keeps mode as 'last'
		const result = store.matchOutgoingMessage('\\Hello from root');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Hello from root');
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
		expect(store.activePersonaMode).toBe('last');

		// Next untagged message continues as root account
		const untagged = store.matchOutgoingMessage('Still root account');
		expect(untagged.matched).toBe(false);
		expect(untagged.strippedContent).toBe('Still root account');
	});

	it('clears latch when escaping with double backslash \\\\ followed by message', async () => {
		const alice = await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		await store.setActivePersona(alice.id, true, 'last');
		expect(store.isPersonaLatched).toBe(true);

		// Double backslash escape with message: sends as root account, strips slashes, CLEARS latch
		const result = store.matchOutgoingMessage('\\\\ Hello from root');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Hello from root');
		expect(result.clearedLatch).toBe(true);
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('does not intercept commands or strip slashes when root account is already selected', async () => {
		await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: '[', suffix: ']'}],
		});
		// Ensure root account is active (not latched)
		await store.unlatch();
		expect(store.activePersona).toBeNull();

		// Standalone \\ in chat should not be treated as a command
		const cmdRes = store.handleInChatCommand('\\\\');
		expect(cmdRes.handled).toBe(false);
		expect(cmdRes.isCommand).toBe(false);

		// Message starting with single backslash should retain the slash
		const singleSlashRes = store.matchOutgoingMessage('\\hello world');
		expect(singleSlashRes.matched).toBe(false);
		expect(singleSlashRes.wasEscaped).toBeFalsy();
		expect(singleSlashRes.strippedContent).toBe('\\hello world');

		// Message starting with double backslash should retain the slashes
		const doubleSlashRes = store.matchOutgoingMessage('\\\\hello world');
		expect(doubleSlashRes.matched).toBe(false);
		expect(doubleSlashRes.wasEscaped).toBeFalsy();
		expect(doubleSlashRes.clearedLatch).toBeFalsy();
		expect(doubleSlashRes.strippedContent).toBe('\\\\hello world');

		// Standalone \\ message match should retain the slashes
		const standaloneRes = store.matchOutgoingMessage('\\\\');
		expect(standaloneRes.matched).toBe(false);
		expect(standaloneRes.wasEscaped).toBeFalsy();
		expect(standaloneRes.clearedLatch).toBeFalsy();
		expect(standaloneRes.strippedContent).toBe('\\\\');
	});

	it('correctly handles message editing with matchEditMessage', async () => {
		const alice = await store.addPersona({
			name: 'Alice',
			persona_tags: [
				{prefix: '[', suffix: ']'},
				{prefix: 'A:', suffix: ''},
			],
		});
		const bob = await store.addPersona({
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

		// 3. Alice message edited without any tags -> preserves Alice
		const res3 = store.matchEditMessage('Plain edit with no tags', currentAliceSubprofile);
		expect(res3.finalContent).toBe('Plain edit with no tags');
		expect(res3.subprofile?.id).toBe(alice.id);
		expect(res3.subprofile?.name).toBe('Alice');

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

		// 7. Text message edited with prefix only (e.g. 'B:') -> reproxies to Bob, preserves original text
		const res7 = store.matchEditMessage('B:', currentAliceSubprofile, {
			hasAttachments: false,
			originalContent: 'Original message text',
		});
		expect(res7.finalContent).toBe('Original message text');
		expect(res7.subprofile?.id).toBe(bob.id);
		expect(res7.subprofile?.name).toBe('Bob');

		// 8. Text message edited with escape backslash only -> unproxies, preserves original text
		const res8 = store.matchEditMessage('\\', currentAliceSubprofile, {
			hasAttachments: false,
			originalContent: 'Original message text',
		});
		expect(res8.finalContent).toBe('Original message text');
		expect(res8.subprofile).toBeNull();

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

		// 12. Captioned attachment message edited to Bob with 'B:' -> sets Bob, preserves caption
		const res12 = store.matchEditMessage('B:', currentAliceSubprofile, {
			hasAttachments: true,
			originalContent: 'Look at my dog',
		});
		expect(res12.finalContent).toBe('Look at my dog');
		expect(res12.subprofile?.id).toBe(bob.id);
		expect(res12.subprofile?.name).toBe('Bob');
	});

	it('replaces all personas and unlatches if previous active was removed', async () => {
		const p1 = await store.addPersona({name: 'Alice'});
		await store.setActivePersona(p1.id, true);

		const newPersona = {
			id: 'new_1',
			name: 'Bob',
			personaTags: [],
		};

		await store.replaceAllPersonas([newPersona as any]);
		expect(store.personas.length).toBe(1);
		expect(store.personas[0].name).toBe('Bob');
		expect(store.isPersonaLatched).toBe(false);
		expect(store.activePersonaId).toBeNull();
	});

	it('appends personas alongside existing ones', async () => {
		await store.addPersona({name: 'Alice'});

		const newPersona = {
			id: 'new_2',
			name: 'Bob',
			personaTags: [],
		};

		await store.appendPersonas([newPersona as any]);
		expect(store.personas.length).toBe(2);
		expect(store.personas[0].name).toBe('Alice');
		expect(store.personas[1].name).toBe('Bob');
	});

	it('auto-activates on persona tag match when activePersonaMode is "last"', async () => {
		const alice = await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		const bob = await store.addPersona({
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
		const result = store.matchOutgoingMessage('b: Hello everyone');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Hello everyone');
		expect(store.activePersonaId).toBe(bob.id);

		// Next untagged message automatically sends as Bob
		const untagged = store.matchOutgoingMessage('I am speaking without tags');
		expect(untagged.matched).toBe(true);
		expect(untagged.persona?.name).toBe('Bob');
		expect(untagged.strippedContent).toBe('I am speaking without tags');
	});

	it('does NOT switch activePersona on persona tag match when activePersonaMode is "manual"', async () => {
		const alice = await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		const bob = await store.addPersona({
			name: 'Bob',
			persona_tags: [{prefix: 'b:', suffix: ''}],
		});

		await store.setActivePersona(alice.id, true, 'manual');
		expect(store.activePersonaMode).toBe('manual');
		expect(store.activePersonaId).toBe(alice.id);

		// Bob speaks with prefix => sent as Bob, but activePersona remains Alice
		const result = store.matchOutgoingMessage('b: Quick message from Bob');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.persona?.id).toBe(bob.id);
		expect(store.activePersonaId).toBe(alice.id);

		// Next untagged message sends as Alice
		const untagged = store.matchOutgoingMessage('Back to Alice');
		expect(untagged.matched).toBe(true);
		expect(untagged.persona?.name).toBe('Alice');
	});

	it('does NOT send as persona for untagged messages when activePersonaMode is "off"', async () => {
		await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});

		await store.setActivePersonaMode('off');
		expect(store.activePersonaMode).toBe('off');
		expect(store.isPersonaLatched).toBe(false);

		const untagged = store.matchOutgoingMessage('Normal message');
		expect(untagged.matched).toBe(false);
		expect(untagged.strippedContent).toBe('Normal message');
	});

	it('switching from "off" to "last" starts on root without auto-selecting first persona', async () => {
		await store.addPersona({
			name: 'Alice',
			persona_tags: [{prefix: 'a:', suffix: ''}],
		});
		const bob = await store.addPersona({
			name: 'Bob',
			persona_tags: [{prefix: 'b:', suffix: ''}],
		});

		await store.setActivePersonaMode('off');
		expect(store.activePersonaMode).toBe('off');
		expect(store.activePersonaId).toBeNull();
		expect(store.isPersonaLatched).toBe(false);

		// Switch directly to 'last'
		await store.setActivePersonaMode('last');
		expect(store.activePersonaMode).toBe('last');
		// Must NOT auto-select Alice (first persona)
		expect(store.activePersonaId).toBeNull();
		expect(store.isPersonaLatched).toBe(false);

		// Untagged message sends as root account
		const untagged = store.matchOutgoingMessage('Normal message');
		expect(untagged.matched).toBe(false);
		expect(untagged.strippedContent).toBe('Normal message');

		// First tagged message latches Bob
		const tagged = store.matchOutgoingMessage('b: Hello Bob');
		expect(tagged.matched).toBe(true);
		expect(tagged.persona?.name).toBe('Bob');
		expect(store.activePersonaId).toBe(bob.id);
		expect(store.isPersonaLatched).toBe(true);

		// Subsequent untagged message now sends as Bob
		const nextUntagged = store.matchOutgoingMessage('Speaking as Bob now');
		expect(nextUntagged.matched).toBe(true);
		expect(nextUntagged.persona?.name).toBe('Bob');
	});

	describe('getEffectivePersonaForText', () => {
		it('returns tag-matched persona and isFromTag=true on tag match', async () => {
			const alice = await store.addPersona({
				name: 'Alice',
				persona_tags: [{prefix: '[', suffix: ']'}],
			});
			const bob = await store.addPersona({
				name: 'Bob',
				persona_tags: [{prefix: 'b:', suffix: ''}],
			});

			// No active persona, off mode
			await store.setActivePersonaMode('off');

			// Types Alice tag
			const preview1 = store.getEffectivePersonaForText('[Hello world]');
			expect(preview1.persona?.id).toBe(alice.id);
			expect(preview1.isFromTag).toBe(true);

			// Types Bob tag
			const preview2 = store.getEffectivePersonaForText('b: Speaking as Bob');
			expect(preview2.persona?.id).toBe(bob.id);
			expect(preview2.isFromTag).toBe(true);

			// Types incomplete tag -> returns null (root)
			const preview3 = store.getEffectivePersonaForText('[Hello');
			expect(preview3.persona).toBeNull();
			expect(preview3.isFromTag).toBe(false);
		});

		it('falls back to active latched persona with isFromTag=false when untagged', async () => {
			const alice = await store.addPersona({
				name: 'Alice',
				persona_tags: [{prefix: '[', suffix: ']'}],
			});
			const bob = await store.addPersona({
				name: 'Bob',
				persona_tags: [{prefix: 'b:', suffix: ''}],
			});

			await store.setActivePersona(alice.id, true, 'manual');

			// Untagged -> returns Alice (latched)
			const preview1 = store.getEffectivePersonaForText('Normal message');
			expect(preview1.persona?.id).toBe(alice.id);
			expect(preview1.isFromTag).toBe(false);

			// Tagged as Bob -> returns Bob (isFromTag=true)
			const preview2 = store.getEffectivePersonaForText('b: Hey');
			expect(preview2.persona?.id).toBe(bob.id);
			expect(preview2.isFromTag).toBe(true);

			// Tag removed -> reverts to Alice
			const preview3 = store.getEffectivePersonaForText('Hey');
			expect(preview3.persona?.id).toBe(alice.id);
			expect(preview3.isFromTag).toBe(false);

			// Escaped with \ -> returns null (root)
			const preview4 = store.getEffectivePersonaForText('\\ b: Hey');
			expect(preview4.persona).toBeNull();
			expect(preview4.isFromTag).toBe(false);
		});
	});
});
