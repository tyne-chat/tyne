// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the "Open in new window" entry this fork adds to the community, channel and conversation
// menus. On desktop it opens another app window, on the web a new tab.

import {Routes} from '@app/app/Routes';
import type {Channel} from '@app/features/channel/models/Channel';
import {OPEN_IN_NEW_WINDOW_DESCRIPTOR} from '@app/features/platform/utils/ForkAppWindowMessageDescriptors';
import {openRouteInNewWindow} from '@app/features/platform/utils/ForkAppWindows';
import {OpenLinkIcon} from '@app/features/ui/action_menu/ContextMenuIcons';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import type {MenuItemType} from '@app/features/ui/menu_bottom_sheet/MenuBottomSheet';
import type {I18n} from '@lingui/core';
import {useLingui} from '@lingui/react/macro';
import type React from 'react';

export function channelWindowRoute(channel: Channel): string {
	return channel.guildId ? Routes.guildChannel(channel.guildId, channel.id) : Routes.dmChannel(channel.id);
}

export function buildOpenInNewWindowMenuItem(i18n: I18n, route: string, onClose: () => void): MenuItemType {
	return {
		icon: <OpenLinkIcon size={20} data-flx="ui.action-menu.items.fork-open-in-new-window-menu-item.open-link-icon" />,
		label: i18n._(OPEN_IN_NEW_WINDOW_DESCRIPTOR),
		onClick: () => {
			onClose();
			openRouteInNewWindow(route);
		},
	};
}

interface OpenInNewWindowContextMenuItemProps {
	readonly route: string;
	readonly onClose: () => void;
}

// The same entry for the context menus that are written as components.
export const OpenInNewWindowContextMenuItem: React.FC<OpenInNewWindowContextMenuItemProps> = ({route, onClose}) => {
	const {i18n} = useLingui();
	return (
		<MenuItem
			icon={<OpenLinkIcon data-flx="ui.action-menu.items.fork-open-in-new-window-menu-item.context-open-link-icon" />}
			onClick={() => {
				onClose();
				openRouteInNewWindow(route);
			}}
			data-flx="ui.action-menu.items.fork-open-in-new-window-menu-item.menu-item.open-in-new-window"
		>
			{i18n._(OPEN_IN_NEW_WINDOW_DESCRIPTOR)}
		</MenuItem>
	);
};
