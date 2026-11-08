// SPDX-License-Identifier: AGPL-3.0-or-later

import type {HoverFloatingTooltipResult} from '@app/features/ui/tooltip/useHoverFloatingTooltip';
import {useLayoutEffect} from 'react';

/**
 * Fork: keeps a hover tooltip closed while `hidden` holds. A reaction chip's tooltip would otherwise
 * open over "Your reactions" (it sits on a higher layer than popouts) and take the clicks meant for
 * its rows (tyne-chat/tyne#86).
 */
export function useHideTooltipWhile(tooltip: HoverFloatingTooltipResult, hidden: boolean): void {
	const {isOpen} = tooltip.state;
	const {hide} = tooltip;
	useLayoutEffect(() => {
		if (hidden && isOpen) hide();
	}, [hidden, isOpen, hide]);
}
