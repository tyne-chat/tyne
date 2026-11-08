// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

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
vi.mock('@app/features/persona/utils/usePersonaDirectory', () => ({
	usePersonaDirectory: () => ({
		status: 'loaded',
		items: [],
		publicCount: 3,
		displayTagText: 'THE SYSTEM',
		displayTagIcon: null,
		isOwn: false,
		retry: () => {},
	}),
}));
vi.mock('@app/features/persona/utils/PersonaGalleryOpen', () => ({openPersonaGallery: vi.fn()}));

import {AccountPersonaNameExtras} from '@app/features/persona/components/PersonasPill';
import {openPersonaGallery} from '@app/features/persona/utils/PersonaGalleryOpen';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import {User} from '@app/features/user/models/User';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const account = new User({
	id: '100000000000000001',
	username: 'moon',
	discriminator: '0001',
	avatar: null,
	flags: 0,
} as any);

// The display tag and the Personas pill after an account's name on its profile (tyne-chat/tyne#189).
describe('AccountPersonaNameExtras', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	const tag = () => container.querySelector('[data-flx="persona.tag"]') as HTMLElement;
	const pill = () => container.querySelector('[data-flx="persona.personas-pill"]') as HTMLElement;

	// tyne-chat/tyne#576: each click on the tag opened the same profile window again on top.
	it('opens no profile from the tag in the account’s own profile window, and the pill switches its tab', async () => {
		const openProfileSpy = vi.spyOn(UserProfileCommands, 'openUserProfile').mockReturnValue(true);
		await act(async () => {
			root.render(
				<AccountPersonaNameExtras
					user={account}
					guildId="200000000000000001"
					inProfile
					data-flx="persona.personas-pill-test.extras"
				/>,
			);
		});

		expect(tag().textContent).toBe('THE SYSTEM');
		act(() => {
			tag().click();
			tag().click();
		});
		expect(openProfileSpy).not.toHaveBeenCalled();

		act(() => pill().click());
		expect(openPersonaGallery).toHaveBeenCalledWith(account, {guildId: '200000000000000001', profileOpen: true});
		expect(openProfileSpy).not.toHaveBeenCalled();
	});

	it('closes the popout and opens the profile in its server from the tag, as the pill does', async () => {
		const calls: Array<string> = [];
		vi.spyOn(UserProfileCommands, 'openUserProfile').mockImplementation((userId, guildId) => {
			calls.push(`open ${userId} ${guildId}`);
			return true;
		});
		await act(async () => {
			root.render(
				<AccountPersonaNameExtras
					user={account}
					guildId="200000000000000001"
					onBeforeOpen={() => calls.push('close popout')}
					data-flx="persona.personas-pill-test.extras--2"
				/>,
			);
		});

		act(() => tag().click());
		expect(calls).toEqual(['close popout', 'open 100000000000000001 200000000000000001']);
	});
});
