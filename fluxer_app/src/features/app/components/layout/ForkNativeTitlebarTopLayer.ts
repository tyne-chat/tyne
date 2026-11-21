// SPDX-License-Identifier: AGPL-3.0-or-later

import '@app/features/app/components/layout/ForkNativeTitlebarTopLayer.css';
import type React from 'react';
import {useLayoutEffect} from 'react';

/*
 * Fork: keeps the desktop title bar draggable over scrolled content (tyne-chat/tyne#851).
 *
 * Electron builds the window's drag region from the page's `-webkit-app-region` boxes, later boxes
 * winning over earlier ones, and does not clip a box to its scroll container. The title bar comes
 * first in the DOM, so content scrolled out of view under it (the settings pane, which is `no-drag`)
 * cut a hole in its drag region, whatever the z-index. Shown as a manual popover, the title bar is in
 * the top layer, whose boxes come after the rest of the page's, while its place in the DOM (focus and
 * reading order) stays the same. Tested with Electron 44 in a stand-alone page; see the issue. The
 * stylesheet undoes the browser's popover defaults and hides the popover's backdrop, which would
 * otherwise make the whole window draggable.
 *
 * The top layer also paints above every z-index. The title bar already had the highest one, and the
 * top-layer elements upstream shows later (the Quick CSS panel, element highlights, fullscreen) still
 * come after it.
 */
export function useForkNativeTitlebarTopLayer(titlebarRef: React.RefObject<HTMLElement | null>): void {
	useLayoutEffect(() => {
		const titlebar = titlebarRef.current;
		if (titlebar == null || typeof titlebar.showPopover !== 'function') {
			return;
		}
		titlebar.setAttribute('popover', 'manual');
		try {
			titlebar.showPopover();
		} catch {
			titlebar.removeAttribute('popover');
			return;
		}
		return () => {
			if (titlebar.matches(':popover-open')) {
				titlebar.hidePopover();
			}
			titlebar.removeAttribute('popover');
		};
	}, [titlebarRef]);
}
