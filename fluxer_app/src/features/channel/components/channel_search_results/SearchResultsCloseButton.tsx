// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: closes the search from its results panel (tyne-chat/tyne#518). In a narrow window the search
// box collapses to a magnifier as soon as it loses focus (channel_header/HeaderOverflow.tsx) and takes
// its ✕ with it, so the panel needs a close of its own. It does what that ✕ does: clear the query and
// close the panel. The button goes away with the panel, so focus moves to the message box.

import ownStyles from '@app/features/channel/components/channel_search_results/SearchResultsCloseButton.module.css';
import {useChannelSearchState} from '@app/features/channel/components/channel_view/useChannelSearchState';
import type {Channel} from '@app/features/channel/models/Channel';
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import {Button} from '@app/features/ui/button/Button';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {XIcon} from '@phosphor-icons/react';
import {useCallback} from 'react';

const CLOSE_SEARCH_DESCRIPTOR = msg({
	message: 'Close search',
	comment: 'Button at the end of the search results panel header. Clears the search and closes the panel.',
});

export function SearchResultsCloseButton({channel}: {channel: Channel}) {
	const {i18n} = useLingui();
	const {handleSearchClose} = useChannelSearchState(channel);
	const close = useCallback(() => {
		handleSearchClose();
		ComponentBus.dispatch('FOCUS_TEXTAREA', {channelId: channel.id});
	}, [channel.id, handleSearchClose]);
	return (
		<Button
			type="button"
			variant="secondary"
			square
			compact
			fitContent
			className={ownStyles.closeButton}
			icon={<XIcon size={18} weight="bold" data-flx="channel.search-results-close-button.icon" />}
			onClick={close}
			aria-label={i18n._(CLOSE_SEARCH_DESCRIPTOR)}
			data-flx="channel.search-results-close-button.button"
		/>
	);
}
