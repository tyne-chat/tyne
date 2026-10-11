// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

installVoiceMenuTestBootstrap();

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

vi.mock('framer-motion', async () => {
	const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
	return {
		...actual,
		motion: {
			div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
				<div ref={ref} data-flx="persona.persona-profile-mobile-sheet-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="persona.persona-profile-mobile-sheet-test.span" {...props} />
			)),
		},
	};
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: React.ReactNode}) => <>{children}</>,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) => {
				let msg = descriptor?.message ?? '';
				if (values) {
					for (const [k, v] of Object.entries(values)) {
						msg = msg.replace(`{${k}}`, String(v));
					}
				}
				return msg;
			},
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/messaging/components/markdown', () => ({
	SafeMarkdown: ({content}: {content: string}) => (
		<div data-flx="persona.persona-profile-mobile-sheet-test.safe-markdown.div">{content}</div>
	),
}));

const mockOpenUserProfile = vi.fn();
vi.mock('@app/features/user/commands/UserProfileCommands', () => ({
	openUserProfile: (...args: Array<unknown>) => mockOpenUserProfile(...args),
}));

const mockOpenDMChannel = vi.fn();
vi.mock('@app/features/channel/commands/PrivateChannelCommands', () => ({
	openDMChannel: (...args: Array<unknown>) => mockOpenDMChannel(...args),
}));

vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	fetchPersonaProfile: vi.fn().mockResolvedValue({status: 'unavailable'}),
}));

const {PersonaProfileMobileSheet} = await import('./PersonaProfileMobileSheet');
const {default: PersonaProfileMobile} = await import('../state/PersonaProfileMobile');
const PersonaCommands = await import('@app/features/persona/commands/PersonaCommands');

describe('PersonaProfileMobileSheet', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		PersonaProfileMobile.close();
		vi.clearAllMocks();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.replaceChildren();
		PersonaProfileMobile.close();
		vi.clearAllMocks();
	});

	const mockUser = {
		id: '123456789012345678',
		username: 'testuser',
		tag: 'testuser#0001',
	} as unknown as User;

	const mockSubprofile: MessageSubprofileResponse = {
		id: 'sub_123',
		name: 'Caelum',
		avatar: null,
		display_tag_text: 'Starlight',
		pronouns: 'they/them',
	};

	it('renders nothing when closed', () => {
		act(() => {
			root.render(
				<PersonaProfileMobileSheet data-flx="persona.persona-profile-mobile-sheet-test.persona-profile-mobile-sheet" />,
			);
		});

		expect(document.querySelector('[data-flx="persona.persona-profile-mobile-sheet.bottom-sheet"]')).toBeNull();
	});

	it('renders bottom sheet when opened with persona info', async () => {
		act(() => {
			root.render(
				<PersonaProfileMobileSheet data-flx="persona.persona-profile-mobile-sheet-test.persona-profile-mobile-sheet--2" />,
			);
		});

		act(() => {
			PersonaProfileMobile.open(mockSubprofile, mockUser, 'guild_456');
		});

		await act(async () => {
			await Promise.resolve();
		});

		const sheet = document.querySelector('[data-flx="persona.persona-profile-mobile-sheet.container"]');
		expect(sheet).not.toBeNull();

		const username = document.querySelector('[data-flx="persona.persona-profile-mobile-sheet.username"]');
		expect(username?.textContent).toBe('Caelum');

		const pronouns = document.querySelector('[data-flx="persona.persona-profile-mobile-sheet.pronouns"]');
		expect(pronouns?.textContent).toBe('they/them');

		const rootAccountButton = document.querySelector(
			'[data-flx="persona.persona-profile-mobile-sheet.root-account-button"]',
		);
		expect(rootAccountButton).not.toBeNull();
		expect(rootAccountButton?.textContent).toContain('@testuser');
	});

	it('says the profile is private when the server refuses it as private', async () => {
		vi.mocked(PersonaCommands.fetchPersonaProfile).mockResolvedValueOnce({status: 'private'});
		act(() => {
			root.render(
				<PersonaProfileMobileSheet data-flx="persona.persona-profile-mobile-sheet-test.persona-profile-mobile-sheet--3" />,
			);
		});
		act(() => {
			PersonaProfileMobile.open({...mockSubprofile, id: 'sub_private'}, mockUser, 'guild_456');
		});
		await act(async () => {
			await Promise.resolve();
		});

		const notice = document.querySelector('[data-flx="persona.persona-profile-mobile-sheet.private-notice"]');
		expect(notice?.textContent).toBe('This persona’s profile is private.');
		expect(document.querySelector('[data-flx="persona.persona-profile-mobile-sheet.bio-section"]')).toBeNull();
	});

	it('navigates to main account profile on root account click and closes sheet', async () => {
		act(() => {
			root.render(
				<PersonaProfileMobileSheet data-flx="persona.persona-profile-mobile-sheet-test.persona-profile-mobile-sheet--4" />,
			);
		});

		act(() => {
			PersonaProfileMobile.open(mockSubprofile, mockUser, 'guild_456');
		});

		await act(async () => {
			await Promise.resolve();
		});

		const rootAccountButton = document.querySelector<HTMLButtonElement>(
			'[data-flx="persona.persona-profile-mobile-sheet.root-account-button"]',
		);
		expect(rootAccountButton).not.toBeNull();

		act(() => {
			rootAccountButton?.click();
		});

		expect(mockOpenUserProfile).toHaveBeenCalledWith('123456789012345678', 'guild_456');
		expect(PersonaProfileMobile.isOpen).toBe(false);
	});

	it('triggers direct message action on message button click', async () => {
		act(() => {
			root.render(
				<PersonaProfileMobileSheet data-flx="persona.persona-profile-mobile-sheet-test.persona-profile-mobile-sheet--5" />,
			);
		});

		act(() => {
			PersonaProfileMobile.open(mockSubprofile, mockUser, 'guild_456');
		});

		await act(async () => {
			await Promise.resolve();
		});

		const messageButton = document.querySelector<HTMLButtonElement>(
			'[data-flx="persona.persona-profile-mobile-sheet.action-card.message"]',
		);
		expect(messageButton).not.toBeNull();

		act(() => {
			messageButton?.click();
		});

		expect(mockOpenDMChannel).toHaveBeenCalledWith('123456789012345678');
		expect(PersonaProfileMobile.isOpen).toBe(false);
	});
});
