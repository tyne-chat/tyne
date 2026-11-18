// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the people of a group DM's thread are the group's (tyne-chat/tyne#699). Thread member lists come per guild
// over the gateway, so the side panel's Members button shows the group DM's own member list instead; a 1:1 DM's
// thread has no Members button.

import {ChannelMembers} from '@app/features/channel/components/ChannelMembers';
import {ChannelHeaderIcon} from '@app/features/channel/components/channel_header_components/ChannelHeaderIcon';
import type {Channel} from '@app/features/channel/models/Channel';
import styles from '@app/features/threads/components/ThreadSidePanel.module.css';
import * as D from '@app/features/threads/utils/ThreadMessageDescriptors';
import {usePopout} from '@app/features/ui/hooks/usePopout';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {useLingui} from '@lingui/react/macro';
import {UsersIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

export const DmThreadPeopleButton = observer(({thread, parent}: {thread: Channel; parent: Channel}) => {
	const {i18n} = useLingui();
	const {isOpen, openProps} = usePopout(`dm-thread-people-${thread.id}`);
	return (
		<Popout
			{...openProps}
			position="bottom-end"
			render={() => (
				<div className={styles.membersPopout} data-flx="threads.fork-dm-thread-people.members-popout">
					<ChannelMembers channel={parent} data-flx="threads.fork-dm-thread-people.channel-members" />
				</div>
			)}
			data-flx="threads.fork-dm-thread-people.popout"
		>
			<ChannelHeaderIcon
				icon={UsersIcon}
				label={i18n._(D.THREAD_MEMBERS_DESCRIPTOR)}
				isSelected={isOpen}
				aria-haspopup={true}
				aria-expanded={isOpen}
				data-flx="threads.fork-dm-thread-people.channel-header-icon"
			/>
		</Popout>
	);
});
