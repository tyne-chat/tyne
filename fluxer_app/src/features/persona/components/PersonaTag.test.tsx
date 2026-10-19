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

import {PersonaTag} from '@app/features/persona/components/PersonaTag';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import {User} from '@app/features/user/models/User';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PersonaTag Component', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
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

	it('renders standalone tag text when no rootUser is provided', async () => {
		await act(async () => {
			root.render(
				<PersonaTag
					subprofile={{
						id: 'p1',
						name: 'TestPersona',
						display_tag_text: 'TEST_TAG',
					}}
					data-flx="persona.persona-tag-test.persona-tag"
				/>,
			);
		});

		const tagEl = container.querySelector('[data-flx="persona.tag"]');
		expect(tagEl).not.toBeNull();
		expect(tagEl?.textContent).toBe('TEST_TAG');
	});

	it.each(['1a2b3c4d', 'https://example.com/icon.png'])(
		'shows no icon without a rootUser, who the icon is stored under (%s)',
		async (icon) => {
			await act(async () => {
				root.render(
					<PersonaTag
						subprofile={{
							id: 'p2',
							name: 'IconPersona',
							display_tag_text: 'TAG',
							display_tag_icon: icon,
						}}
						data-flx="persona.persona-tag-test.persona-tag--2"
					/>,
				);
			});

			expect(container.querySelector('[data-flx="persona.tag"]')?.textContent).toBe('TAG');
			expect(container.querySelector('img')).toBeNull();
		},
	);

	it('shows the icon stored under the rootUser, and never a link', async () => {
		const mockUser = new User({
			id: '100000000000000001',
			username: 'alice',
			discriminator: '0001',
			avatar: null,
			flags: 0,
		} as any);
		const render = (icon: string) =>
			act(async () => {
				root.render(
					<PersonaTag
						rootUser={mockUser}
						subprofile={{id: 'p5', name: 'AlicePersona', display_tag_text: 'ALICE', display_tag_icon: icon}}
						data-flx="persona.persona-tag-test.persona-tag--5"
					/>,
				);
			});

		await render('1a2b3c4d');
		expect(container.querySelector('[data-flx="persona.tag"] img')?.getAttribute('src')).toBe(
			AvatarUtils.getUserAvatarURL({id: mockUser.id, avatar: '1a2b3c4d'}, false, 32),
		);

		await render('https://tracker.example/pixel.png');
		expect(container.querySelector('[data-flx="persona.tag"]')?.textContent).toBe('ALICE');
		expect(container.querySelector('img')).toBeNull();
	});

	it('returns null when subprofile has neither tag text nor icon and no rootUser', async () => {
		await act(async () => {
			root.render(
				<PersonaTag
					subprofile={{
						id: 'p3',
						name: 'PlainPersona',
					}}
					data-flx="persona.persona-tag-test.persona-tag--3"
				/>,
			);
		});

		expect(container.innerHTML).toBe('');
	});

	it('opens user profile on click when rootUser is provided without message', async () => {
		const openProfileSpy = vi.spyOn(UserProfileCommands, 'openUserProfile').mockReturnValue(true);
		const mockUser = new User({
			id: '100000000000000001',
			username: 'alice',
			discriminator: '0001',
			avatar: null,
			flags: 0,
		} as any);

		await act(async () => {
			root.render(
				<PersonaTag
					rootUser={mockUser}
					subprofile={{
						id: 'p4',
						name: 'AlicePersona',
						display_tag_text: 'ALICE_TAG',
					}}
					data-flx="persona.persona-tag-test.persona-tag--4"
				/>,
			);
		});

		const tagEl = container.querySelector('[data-flx="persona.tag"]') as HTMLElement;
		expect(tagEl).not.toBeNull();
		expect(tagEl.textContent).toBe('ALICE_TAG');

		act(() => {
			tagEl.click();
		});

		expect(openProfileSpy).toHaveBeenCalledWith('100000000000000001', undefined);
	});
});
