// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: regression guard proving PersonaProfilePopout and PersonaProfileMobileSheet must react when
// GuildMembers populates after initial render instead of freezing inside useMemo (tyne-chat/tyne#937, tyne-chat/tyne#947).

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/auth/state/Authentication', () => ({
	default: {currentUserId: '100000000000000001'},
}));
vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	fetchPersonaProfile: vi.fn().mockResolvedValue({status: 'unavailable'}),
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
		<div data-flx="persona.persona-profile-guild-member-test.safe-markdown.div">{content}</div>
	),
}));
vi.mock('@app/features/ui/action_menu/items/MediaMenuData', () => ({
	mediaMenuItemIds: {
		copy: 'copy',
		download: 'download',
		copyLink: 'copy-link',
		openLink: 'open-link',
		favorite: 'favorite',
		editAltText: 'edit-alt-text',
	},
	useMediaMenuData: vi.fn(),
}));

import {GuildMember} from '@app/features/member/models/GuildMember';
import GuildMembers from '@app/features/member/state/GuildMembers';
import {PersonaProfileMobileSheet} from '@app/features/persona/components/PersonaProfileMobileSheet';
import {PersonaProfilePopout} from '@app/features/persona/components/PersonaProfilePopout';
import PersonaProfileMobile from '@app/features/persona/state/PersonaProfileMobile';
import {User} from '@app/features/user/models/User';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('PersonaProfile resolvedGuildMember reactivity', () => {
	let container: HTMLDivElement;
	let root: Root;

	const guildId = '200000000000000001';
	const targetUser = new User({
		id: '100000000000000002',
		username: 'bob_handle',
		discriminator: '0002',
		avatar: null,
		flags: 0,
	} as never);
	const subprofile = {
		id: '300000000000000001',
		name: 'Boreal',
		avatar: null,
	};

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		PersonaProfileMobile.close();
		runInAction(() => {
			delete GuildMembers.members[guildId];
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.replaceChildren();
		PersonaProfileMobile.close();
		runInAction(() => {
			delete GuildMembers.members[guildId];
		});
	});

	function hydrateGuildNickname(nick: string): void {
		const member = new GuildMember(
			guildId,
			{
				user: {
					id: targetUser.id,
					username: targetUser.username,
					discriminator: '0002',
					avatar: null,
					flags: 0,
				},
				roles: [],
				joined_at: '2026-01-01T00:00:00.000Z',
				deaf: false,
				mute: false,
				nick,
			} as never,
			{cacheUser: false},
		);
		runInAction(() => {
			GuildMembers.members[guildId] = {[targetUser.id]: member};
		});
	}

	it('updates PersonaProfilePopout when GuildMembers hydrates the member after initial render', async () => {
		await act(async () => {
			root.render(
				<PersonaProfilePopout
					user={targetUser}
					subprofile={subprofile}
					guildId={guildId}
					data-flx="persona.persona-profile-guild-member-test.persona-profile-popout"
				/>,
			);
		});
		expect(container.textContent).toContain('bob_handle');

		await act(async () => {
			hydrateGuildNickname('Guild Nick Popout');
		});
		expect(container.textContent).toContain('Guild Nick Popout');
	});

	it('updates PersonaProfileMobileSheet when GuildMembers hydrates the member after initial render', async () => {
		await act(async () => {
			root.render(
				<PersonaProfileMobileSheet data-flx="persona.persona-profile-guild-member-test.persona-profile-mobile-sheet" />,
			);
			PersonaProfileMobile.open(subprofile, targetUser, guildId);
		});
		expect(document.body.textContent).toContain('bob_handle');

		await act(async () => {
			hydrateGuildNickname('Guild Nick Sheet');
		});
		expect(document.body.textContent).toContain('Guild Nick Sheet');
	});
});
