// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the breadcrumb of a DM thread opened in full view (tyne-chat/tyne#699).

import {GroupDMAvatar} from '@app/features/app/components/shared/GroupDMAvatar';
import {useChannelHeaderData} from '@app/features/channel/components/channel_header/useChannelHeaderData';
import type {Channel} from '@app/features/channel/models/Channel';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import crumbStyles from '@app/features/threads/components/ThreadParentCrumb.module.css';
import {StatusAwareAvatar} from '@app/features/ui/components/StatusAwareAvatar';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {CaretRightIcon} from '@app/features/ui/icons/DirectionalIcons';
import {ME} from '@fluxer/constants/src/AppConstants';
import {observer} from 'mobx-react-lite';

const CRUMB_AVATAR_SIZE_PX = 16;

// In place of upstream's "#channel ›" before a thread's name: the DM's person, or the group DM, as its header shows
// them. Clicking it goes back to the DM.
export const DmThreadParentCrumb = observer(({parent, iconClassName}: {parent: Channel; iconClassName?: string}) => {
	const {isDM, recipient, directMessageName, groupDMName} = useChannelHeaderData(parent);
	return (
		<>
			<FocusRing offset={-2} data-flx="threads.fork-dm-thread-parent-crumb.crumb-focus-ring">
				<button
					type="button"
					className={crumbStyles.crumb}
					onClick={() => NavigationCommands.selectChannel(ME, parent.id)}
					data-flx="threads.fork-dm-thread-parent-crumb.crumb.select-parent"
				>
					<span className={iconClassName} data-flx="threads.fork-dm-thread-parent-crumb.crumb-avatar">
						{isDM && recipient ? (
							<StatusAwareAvatar
								user={recipient}
								size={CRUMB_AVATAR_SIZE_PX}
								data-flx="threads.fork-dm-thread-parent-crumb.crumb-user-avatar"
							/>
						) : (
							<GroupDMAvatar
								channel={parent}
								size={CRUMB_AVATAR_SIZE_PX}
								data-flx="threads.fork-dm-thread-parent-crumb.crumb-group-avatar"
							/>
						)}
					</span>
					<span className={crumbStyles.crumbName} data-flx="threads.fork-dm-thread-parent-crumb.crumb-name">
						{isDM ? directMessageName : groupDMName}
					</span>
				</button>
			</FocusRing>
			<CaretRightIcon
				className={crumbStyles.separator}
				weight="bold"
				data-flx="threads.fork-dm-thread-parent-crumb.separator"
			/>
		</>
	);
});
