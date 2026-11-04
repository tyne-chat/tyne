// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

const openFromEvent = vi.hoisted(() => vi.fn());

vi.mock('@app/features/ui/commands/ContextMenuCommands', () => ({openFromEvent}));

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {usePersonaImageMenus} from '@app/features/persona/utils/usePersonaImageMenus';
import {getUserMenuAvatarUrl, getUserMenuBannerUrl} from '@app/features/ui/action_menu/items/UserImageMenuItems';
import {User} from '@app/features/user/models/User';
import {toOriginalImageUrl} from '@app/features/user/utils/ForkOriginalImageUrl';
import type React from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER_ID = '100000000000000001';
const MEDIA = RuntimeConfig.mediaEndpoint;

function owner(avatar: string | null): User {
	return new User({id: OWNER_ID, username: 'alice', discriminator: '0001', avatar, flags: 0} as never);
}

type Menus = ReturnType<typeof usePersonaImageMenus>;

describe('usePersonaImageMenus', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		openFromEvent.mockReset();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	function renderMenus(user: User, avatarHash: string | null, bannerHash: string | null): Menus {
		let menus: Menus | null = null;
		function Probe() {
			menus = usePersonaImageMenus({user, avatarHash, bannerHash});
			return null;
		}
		act(() => root.render(<Probe data-flx="persona.use-persona-image-menus-test.render-menus.probe" />));
		if (!menus) throw new Error('hook did not run');
		return menus;
	}

	/** Opens a menu and returns the address its "Open in browser" and "Copy URL" use. */
	function openedMenuUrl(open: ((event: React.MouseEvent) => void) | undefined): string | null {
		expect(open).toBeDefined();
		open?.({} as React.MouseEvent);
		expect(openFromEvent).toHaveBeenCalledTimes(1);
		const render = openFromEvent.mock.calls[0][1] as (props: {onClose: () => void}) => React.ReactElement;
		const props = render({onClose: () => {}}).props as Parameters<typeof getUserMenuAvatarUrl>[0] & {
			variant: 'avatar' | 'banner';
		};
		const url = props.variant === 'avatar' ? getUserMenuAvatarUrl(props) : getUserMenuBannerUrl(props);
		openFromEvent.mockReset();
		return toOriginalImageUrl(url);
	}

	it("offers the persona's own avatar and banner, as the stored images", () => {
		const menus = renderMenus(owner('fedcba98'), 'a_abcdef12', '12345678');
		expect(openedMenuUrl(menus.onAvatarContextMenu)).toBe(`${MEDIA}/avatars/${OWNER_ID}/abcdef12.png?original=true`);
		expect(openedMenuUrl(menus.onBannerContextMenu)).toBe(`${MEDIA}/banners/${OWNER_ID}/12345678.png?original=true`);
	});

	it("offers the account's avatar for a persona without one, as the profile shows it", () => {
		const menus = renderMenus(owner('fedcba98'), null, null);
		expect(openedMenuUrl(menus.onAvatarContextMenu)).toBe(`${MEDIA}/avatars/${OWNER_ID}/fedcba98.png?original=true`);
	});

	it('has no menu where the profile shows no image of its own', () => {
		const menus = renderMenus(owner(null), null, null);
		expect(menus.onAvatarContextMenu).toBeUndefined();
		expect(menus.onBannerContextMenu).toBeUndefined();
	});

	it('ignores a value that is not an image hash', () => {
		const menus = renderMenus(owner(null), 'https://elsewhere.test/a.png', 'https://elsewhere.test/b.png');
		expect(menus.onAvatarContextMenu).toBeUndefined();
		expect(menus.onBannerContextMenu).toBeUndefined();
	});
});
