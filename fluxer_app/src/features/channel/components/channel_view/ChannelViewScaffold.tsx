// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/channel/components/ChannelIndexPage.module.css';
import {clsx} from 'clsx';
import type React from 'react';

// Fork imports.

import MemberList from '@app/features/member/state/MemberList';
import LayoutState from '@app/features/ui/state/LayoutState';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {observer} from 'mobx-react-lite';
import {useEffect} from 'react';

interface ChannelViewScaffoldProps {
	header: React.ReactNode;
	chatArea: React.ReactNode;
	sidePanel?: React.ReactNode | null;
	showMemberListDivider?: boolean;
	hasMemberList?: boolean;
	className?: string;
	voiceTextSplitView?: boolean;
	chatAreaInert?: boolean;
}

const ChannelViewScaffoldBase: React.FC<ChannelViewScaffoldProps> = ({
	header,
	chatArea,
	sidePanel = null,
	showMemberListDivider = false,
	hasMemberList = true,
	className,
	voiceTextSplitView = false,
	chatAreaInert = false,
}) => {
	useEffect(() => {
		LayoutState.setCanRightPeek(hasMemberList);
		return () => {
			LayoutState.setCanRightPeek(false);
		};
	}, [hasMemberList]);

	const shouldShowPeekStrip =
		hasMemberList &&
		LayoutState.edgeHoverPeekEnabled &&
		!MemberList.isMembersOpen &&
		!MobileLayout.enabled &&
		(!sidePanel || LayoutState.isRightHoverPeeking);

	return (
		<div
			className={clsx(styles.channelGrid, className)}
			data-voice-text-split-view={voiceTextSplitView ? 'true' : undefined}
			data-flx="channel.channel-view.channel-view-scaffold.channel-grid"
		>
			<div data-flx="channel.channel-view.channel-view-scaffold.div">{header}</div>
			<div
				className={clsx(styles.contentGrid, shouldShowPeekStrip && styles.contentGridWithPeekStrip)}
				data-flx="channel.channel-view.channel-view-scaffold.content-grid"
			>
				{showMemberListDivider && (
					<div
						className={styles.memberListDivider}
						data-flx="channel.channel-view.channel-view-scaffold.member-list-divider"
					/>
				)}
				<div
					className={styles.chatAreaSlot}
					aria-hidden={chatAreaInert ? true : undefined}
					inert={chatAreaInert ? true : undefined}
					data-flx="channel.channel-view.channel-view-scaffold.chat-area-slot"
				>
					{chatArea}
				</div>
				{sidePanel}
			</div>
		</div>
	);
};

// Fork: an observer, so the peek strip follows the layout and member list stores.
export const ChannelViewScaffold = observer(ChannelViewScaffoldBase);
