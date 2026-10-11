// SPDX-License-Identifier: AGPL-3.0-or-later

import {useLayoutEffect, useRef} from 'react';

// Fork: Enter in the search box picks the first result, so show that result as
// selected whenever the search text changes, and clear the selection again when
// the search is emptied.
export function useForkSearchFirstResultSelection({
	searchTerm,
	hasResults,
	selectFirst,
	clearSelection,
}: {
	searchTerm: string;
	hasResults: boolean;
	selectFirst: () => void;
	clearSelection: () => void;
}): void {
	const handledSearchTermRef = useRef(searchTerm);
	useLayoutEffect(() => {
		if (handledSearchTermRef.current === searchTerm) {
			return;
		}
		handledSearchTermRef.current = searchTerm;
		if (searchTerm && hasResults) {
			selectFirst();
		} else {
			clearSelection();
		}
	}, [searchTerm, hasResults, selectFirst, clearSelection]);
}
