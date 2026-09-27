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

vi.mock('@app/features/channel/components/PreloadableUserPopout', () => ({
	PreloadableUserPopout: ({children}: {children?: React.ReactNode}) => (
		<div data-testid="mock-popout" data-flx="channel.message-persona-account-test.preloadable-user-popout.mock-popout">
			{children}
		</div>
	),
}));

vi.mock('@app/features/user/utils/NicknameUtils', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getNickname: vi.fn((user: {username: string}) => user.username),
		formatTagForStreamerMode: vi.fn((tag: string) => tag),
	};
});

import {MessagePersonaAccount} from '@app/features/channel/components/MessagePersonaAccount';
import {User} from '@app/features/user/models/User';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('MessagePersonaAccount Component', () => {
	let container: HTMLDivElement;
	let root: Root;

	const mockUser = new User({
		id: '100000000000000001',
		username: 'alice',
		discriminator: '0001',
		avatar: null,
		flags: 0,
	} as any);

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

	it('returns null if message.subprofile is missing', async () => {
		const message = {
			id: '100000000000000099',
			channelId: '100000000000000020',
			authorId: mockUser.id,
			subprofile: undefined,
		} as any;

		await act(async () => {
			root.render(
				<MessagePersonaAccount
					user={mockUser}
					message={message}
					data-flx="channel.message-persona-account-test.message-persona-account"
				/>,
			);
		});

		expect(container.innerHTML).toBe('');
	});

	it('renders tag text and icon when tagText and customIconUrl are provided', async () => {
		const message = {
			id: '100000000000000099',
			channelId: '100000000000000020',
			authorId: mockUser.id,
			subprofile: {
				id: 'p1',
				name: 'Persona One',
			},
		} as any;

		await act(async () => {
			root.render(
				<MessagePersonaAccount
					user={mockUser}
					message={message}
					tagText="SYS"
					customIconUrl="https://example.com/icon.png"
					data-flx="channel.message-persona-account-test.message-persona-account--2"
				/>,
			);
		});

		const tagEl = container.querySelector('[data-flx="persona.tag"]');
		expect(tagEl).not.toBeNull();
		expect(tagEl?.textContent).toContain('SYS');

		const imgEl = tagEl?.querySelector('img');
		expect(imgEl).not.toBeNull();
		expect(imgEl?.getAttribute('src')).toBe('https://example.com/icon.png');
	});

	it('renders standalone custom icon when customIconUrl is provided without tagText', async () => {
		const message = {
			id: '100000000000000099',
			channelId: '100000000000000020',
			authorId: mockUser.id,
			subprofile: {
				id: 'p1',
				name: 'Persona One',
			},
		} as any;

		await act(async () => {
			root.render(
				<MessagePersonaAccount
					user={mockUser}
					message={message}
					customIconUrl="https://example.com/icon.png"
					data-flx="channel.message-persona-account-test.message-persona-account--3"
				/>,
			);
		});

		const iconEl = container.querySelector(
			'[data-flx="channel.user-message.message-avatar-subprofile-custom-icon"]',
		) as HTMLImageElement;
		expect(iconEl).not.toBeNull();
		expect(iconEl.src).toBe('https://example.com/icon.png');
	});

	it('renders root user avatar when neither tagText nor customIconUrl is provided', async () => {
		const message = {
			id: '100000000000000099',
			channelId: '100000000000000020',
			authorId: mockUser.id,
			subprofile: {
				id: 'p1',
				name: 'Persona One',
			},
		} as any;

		await act(async () => {
			root.render(
				<MessagePersonaAccount
					user={mockUser}
					message={message}
					data-flx="channel.message-persona-account-test.message-persona-account--4"
				/>,
			);
		});

		const avatarEl = container.querySelector(
			'[data-flx="channel.user-message.message-avatar-subprofile-main-account"]',
		);
		expect(avatarEl).not.toBeNull();
	});
});
