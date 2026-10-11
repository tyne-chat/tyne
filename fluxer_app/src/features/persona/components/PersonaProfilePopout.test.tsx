// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

let mockCurrentUserId = '100000000000000001';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('@app/features/auth/state/Authentication', () => ({
	default: {
		get currentUserId() {
			return mockCurrentUserId;
		},
	},
}));

vi.mock('@app/features/user/state/Users', () => ({
	default: {
		getCurrentUser: vi.fn(),
		getUser: vi.fn(),
	},
}));

vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	fetchPersonaProfile: vi.fn(),
}));

vi.mock('@app/features/user/commands/UserProfileCommands', () => ({
	openUserProfile: vi.fn(),
}));

vi.mock('@app/features/channel/commands/PrivateChannelCommands', () => ({
	openDMChannel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: vi.fn(),
	modal: vi.fn((fn) => fn),
}));

vi.mock('@app/features/messaging/components/markdown', () => ({
	SafeMarkdown: ({content}: {content?: string}) => (
		<div data-testid="markdown" data-flx="persona.persona-profile-popout-test.safe-markdown.markdown">
			{content}
		</div>
	),
}));

vi.mock('@app/features/user/utils/NicknameUtils', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getNickname: vi.fn((user: {username: string}) => user.username),
		formatNicknameForStreamerMode: vi.fn((nick: string) => nick),
		formatTagForStreamerMode: vi.fn((tag: string) => tag),
	};
});

import * as PrivateChannelCommands from '@app/features/channel/commands/PrivateChannelCommands';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {PersonaProfilePopout} from '@app/features/persona/components/PersonaProfilePopout';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PersonaProfilePopout Component', () => {
	let container: HTMLDivElement;
	let root: Root;

	const currentUser = new User({
		id: '100000000000000001',
		username: 'alice',
		discriminator: '0001',
		avatar: null,
		flags: 0,
	} as any);

	const otherUser = new User({
		id: '100000000000000002',
		username: 'bob',
		discriminator: '0002',
		avatar: null,
		flags: 0,
	} as any);

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
		mockCurrentUserId = currentUser.id;
		vi.mocked(Users.getCurrentUser).mockReturnValue(currentUser);
		runInAction(() => {
			PersonaStore.reset();
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it('renders local persona profile with Edit persona button for current user', async () => {
		const localPersona = {
			id: '100000000000000011',
			name: 'My Persona',
			pronouns: 'she/they',
			bio: 'Hello from local bio',
			avatar_hash: null,
		} as any;

		runInAction(() => {
			PersonaStore.setPersonas([localPersona]);
			(PersonaStore as any)._displayTagText = 'HOST';
		});

		const subprofile = {
			id: localPersona.id,
			name: localPersona.name,
			avatar: null,
		};

		const onClose = vi.fn();

		await act(async () => {
			root.render(
				<PersonaProfilePopout
					user={currentUser}
					subprofile={subprofile}
					onClose={onClose}
					data-flx="persona.persona-profile-popout-test.persona-profile-popout"
				/>,
			);
		});

		expect(container.textContent).toContain('My Persona');
		expect(container.textContent).toContain('she/they');
		expect(container.textContent).toContain('Hello from local bio');
		expect(container.textContent).toContain('HOST');

		const editBtn = container.querySelector(
			'[data-flx="persona.persona-profile-popout.button.edit-persona"]',
		) as HTMLButtonElement | null;
		expect(editBtn).not.toBeNull();

		await act(async () => {
			editBtn?.click();
		});

		expect(ModalCommands.push).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('fetches and renders public persona with Message button for other user', async () => {
		const subprofile = {
			id: '100000000000000099',
			name: 'Bobs Persona',
			avatar: null,
			pronouns: 'he/him',
		};

		vi.mocked(PersonaCommands.fetchPersonaProfile).mockResolvedValue({
			status: 'ready',
			profile: {
				id: subprofile.id,
				name: subprofile.name,
				avatar_hash: null,
				banner_hash: null,
				pronouns: 'he/they',
				color: null,
				avatar_color: null,
				bio: 'Public bio from remote API',
				visibility: 'public',
			},
		});

		const onClose = vi.fn();

		await act(async () => {
			root.render(
				<PersonaProfilePopout
					user={otherUser}
					subprofile={subprofile}
					onClose={onClose}
					data-flx="persona.persona-profile-popout-test.persona-profile-popout--2"
				/>,
			);
		});

		expect(PersonaCommands.fetchPersonaProfile).toHaveBeenCalledWith(otherUser.id, subprofile.id);
		expect(container.textContent).toContain('Bobs Persona');
		expect(container.textContent).toContain('he/they');
		expect(container.textContent).toContain('Public bio from remote API');

		const msgBtn = container.querySelector(
			'[data-flx="persona.persona-profile-popout.button.message"]',
		) as HTMLButtonElement | null;
		expect(msgBtn).not.toBeNull();

		await act(async () => {
			msgBtn?.click();
		});

		expect(PrivateChannelCommands.openDMChannel).toHaveBeenCalledWith(otherUser.id);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('says the profile is private when the server refuses it as private, and shows no bio', async () => {
		// A message cached before the server stopped sending a bio with it could still carry one.
		const subprofile = {
			id: '100000000000000099',
			name: 'Bobs Persona',
			avatar: null,
			pronouns: 'he/him',
			bio: 'Bio left on an old message',
			banner: 'old_banner_hash',
		};
		vi.mocked(PersonaCommands.fetchPersonaProfile).mockResolvedValue({status: 'private'});

		await act(async () => {
			root.render(
				<PersonaProfilePopout
					user={otherUser}
					subprofile={subprofile}
					data-flx="persona.persona-profile-popout-test.persona-profile-popout--3"
				/>,
			);
		});

		expect(container.querySelector('[data-flx="persona.persona-profile-popout.private-notice"]')?.textContent).toBe(
			'This persona’s profile is private.',
		);
		expect(container.textContent).not.toContain('Bio left on an old message');
		expect(container.innerHTML).not.toContain('old_banner_hash');
		expect(container.textContent).toContain('Bobs Persona');
		expect(container.textContent).toContain('he/him');
	});

	it('shows neither a bio nor the private notice when the profile could not be fetched', async () => {
		const subprofile = {
			id: '100000000000000099',
			name: 'Bobs Persona',
			avatar: null,
			bio: 'Bio left on an old message',
		};
		vi.mocked(PersonaCommands.fetchPersonaProfile).mockResolvedValue({status: 'unavailable'});

		await act(async () => {
			root.render(
				<PersonaProfilePopout
					user={otherUser}
					subprofile={subprofile}
					data-flx="persona.persona-profile-popout-test.persona-profile-popout--4"
				/>,
			);
		});

		expect(container.querySelector('[data-flx="persona.persona-profile-popout.private-notice"]')).toBeNull();
		expect(container.querySelector('[data-flx="persona.persona-profile-popout.bio-container"]')).toBeNull();
		expect(container.textContent).not.toContain('Bio left on an old message');
	});

	it('opens root user profile when clicking main account button', async () => {
		const subprofile = {
			id: '100000000000000099',
			name: 'Bobs Persona',
			avatar: null,
		};

		vi.mocked(PersonaCommands.fetchPersonaProfile).mockResolvedValue({
			status: 'ready',
			profile: {
				id: subprofile.id,
				name: subprofile.name,
				avatar_hash: null,
				banner_hash: null,
				pronouns: null,
				color: null,
				avatar_color: null,
				bio: null,
				visibility: 'public',
			},
		});

		const onClose = vi.fn();

		await act(async () => {
			root.render(
				<PersonaProfilePopout
					user={otherUser}
					subprofile={subprofile}
					guildId="100000000000000050"
					onClose={onClose}
					data-flx="persona.persona-profile-popout-test.persona-profile-popout--5"
				/>,
			);
		});

		const rootBtn = container.querySelector(
			'[data-flx="persona.persona-profile-popout.root-account-button"]',
		) as HTMLButtonElement | null;
		expect(rootBtn).not.toBeNull();

		await act(async () => {
			rootBtn?.click();
		});

		expect(UserProfileCommands.openUserProfile).toHaveBeenCalledWith(otherUser.id, '100000000000000050');
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
