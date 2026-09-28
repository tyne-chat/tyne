// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {UserPartial} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
	},
}));

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';

installVoiceMenuTestBootstrap();

const {User} = await import('@app/features/user/models/User');
const {createReactionUsersSnapshot, transitionReactionUsersSnapshot} = await import('./ReactionUsersStateMachine');

const ROOT_USER_ID = '1546374142368940032';
const PERSONA_1_ID = '1548497538401697792';
const PERSONA_2_ID = '1548497688004132864';

function makeUserPartial(personaId?: string | null, name?: string): UserPartial {
	return {
		id: ROOT_USER_ID,
		username: 'chiara',
		discriminator: '5797',
		global_name: 'Chiara',
		avatar: null,
		persona_id: personaId ?? null,
		subprofile: personaId
			? {
					id: personaId,
					name: name ?? `Persona ${personaId}`,
					avatar: null,
					avatar_color: null,
					display_tag_text: 'SYS',
					system_name: 'System',
					pronouns: 'she/her',
				}
			: null,
	} as any;
}

describe('ReactionUsersStateMachine: persona support', () => {
	it('retains multiple reactions from the same root user with different personas on fetch.success', () => {
		let snapshot = createReactionUsersSnapshot();
		const rootReactor = makeUserPartial(null);
		const persona1Reactor = makeUserPartial(PERSONA_1_ID, 'Alice');
		const persona2Reactor = makeUserPartial(PERSONA_2_ID, 'Bob');

		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'fetch.success',
			mode: 'replace',
			users: [rootReactor, persona1Reactor, persona2Reactor],
		});

		expect(snapshot.context.users.size).toBe(3);
		expect(snapshot.context.userSnapshot.length).toBe(3);

		const names = snapshot.context.userSnapshot.map((u) => u.subprofile?.name ?? u.globalName);
		expect(names).toEqual(['Chiara', 'Alice', 'Bob']);

		const keys = Array.from(snapshot.context.users.keys());
		expect(keys).toEqual([ROOT_USER_ID, `${ROOT_USER_ID}:${PERSONA_1_ID}`, `${ROOT_USER_ID}:${PERSONA_2_ID}`]);
	});

	it('adds distinct persona reactions via user.add without clobbering root reaction', () => {
		let snapshot = createReactionUsersSnapshot();
		const rootUser = new User(makeUserPartial(null));
		const persona1User = new User(makeUserPartial(PERSONA_1_ID, 'Alice'));

		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'user.add',
			user: rootUser,
		});
		expect(snapshot.context.users.size).toBe(1);

		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'user.add',
			user: persona1User,
		});
		expect(snapshot.context.users.size).toBe(2);
		expect(snapshot.context.userSnapshot.length).toBe(2);

		// Duplicate add of persona 1 is ignored
		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'user.add',
			user: persona1User,
		});
		expect(snapshot.context.users.size).toBe(2);
	});

	it('removes specific persona reaction without affecting root reaction or other personas', () => {
		let snapshot = createReactionUsersSnapshot();
		const rootReactor = makeUserPartial(null);
		const persona1Reactor = makeUserPartial(PERSONA_1_ID, 'Alice');
		const persona2Reactor = makeUserPartial(PERSONA_2_ID, 'Bob');

		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'fetch.success',
			mode: 'replace',
			users: [rootReactor, persona1Reactor, persona2Reactor],
		});
		expect(snapshot.context.users.size).toBe(3);

		// Remove persona 1
		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'user.remove',
			userId: ROOT_USER_ID,
			personaId: PERSONA_1_ID,
		});
		expect(snapshot.context.users.size).toBe(2);
		expect(snapshot.context.userSnapshot.map((u) => u.subprofile?.name ?? u.globalName)).toEqual(['Chiara', 'Bob']);

		// Remove root reaction
		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'user.remove',
			userId: ROOT_USER_ID,
			personaId: null,
		});
		expect(snapshot.context.users.size).toBe(1);
		expect(snapshot.context.userSnapshot.map((u) => u.subprofile?.name)).toEqual(['Bob']);
	});

	it('updates persona name and metadata on matching reactors via persona.update and increments version', () => {
		let snapshot = createReactionUsersSnapshot();
		const rootReactor = makeUserPartial(null);
		const persona1Reactor = makeUserPartial(PERSONA_1_ID, 'Kenoma WyldFlower');
		const persona2Reactor = makeUserPartial(PERSONA_2_ID, 'Bob');

		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'fetch.success',
			mode: 'replace',
			users: [rootReactor, persona1Reactor, persona2Reactor],
		});

		const initialVersion = snapshot.context.version;
		expect(snapshot.context.userSnapshot[1].subprofile?.name).toBe('Kenoma WyldFlower');

		// Renaming persona 1: remove surname to 'Kenoma'
		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'persona.update',
			persona: {
				id: PERSONA_1_ID,
				name: 'Kenoma',
				avatar: 'new_avatar_hash',
				color: 0x990000,
			},
		});

		expect(snapshot.context.version).toBeGreaterThan(initialVersion);
		expect(snapshot.context.userSnapshot.length).toBe(3);
		expect(snapshot.context.userSnapshot[1].subprofile?.name).toBe('Kenoma');
		expect(snapshot.context.userSnapshot[1].subprofile?.avatar).toBe('new_avatar_hash');
		expect(snapshot.context.userSnapshot[1].subprofile?.color).toBe(0x990000);

		// Order is strictly preserved
		const names = snapshot.context.userSnapshot.map((u) => u.subprofile?.name ?? u.globalName);
		expect(names).toEqual(['Chiara', 'Kenoma', 'Bob']);

		// Updating a non-existent persona does not increment version
		const versionBeforeNoop = snapshot.context.version;
		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'persona.update',
			persona: {
				id: '9999999999999999999',
				name: 'Non Existent',
			},
		});
		expect(snapshot.context.version).toBe(versionBeforeNoop);
	});

	it('updates author display tags on matching reactor subprofiles via displayTag.update', () => {
		let snapshot = createReactionUsersSnapshot();
		const persona1Reactor = makeUserPartial(PERSONA_1_ID, 'Kenoma');

		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'fetch.success',
			mode: 'replace',
			users: [persona1Reactor],
		});

		expect(snapshot.context.userSnapshot[0].subprofile?.display_tag_text).toBe('SYS');

		snapshot = transitionReactionUsersSnapshot(snapshot, {
			type: 'displayTag.update',
			userId: ROOT_USER_ID,
			display_tag_text: 'SERAPHIM HYPERSYSTEM',
			display_tag_icon: 'https://cdn.example.com/icon.png',
		});

		expect(snapshot.context.userSnapshot[0].subprofile?.display_tag_text).toBe('SERAPHIM HYPERSYSTEM');
		expect(snapshot.context.userSnapshot[0].subprofile?.display_tag_icon).toBe('https://cdn.example.com/icon.png');
	});
});
