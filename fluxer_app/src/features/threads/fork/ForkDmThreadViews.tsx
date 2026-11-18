// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the views of a DM with threads (tyne-chat/tyne#699). A DM opens its threads beside it in upstream's side
// panel, as a guild channel does; a DM thread in full view gets the parts of upstream's guild channel view a thread
// uses (header, messages, thread composer), without the guild ones.

import {ChannelChatLayout} from '@app/features/channel/components/ChannelChatLayout';
import {ChannelHeader} from '@app/features/channel/components/ChannelHeader';
import {Messages} from '@app/features/channel/components/ChannelMessages';
import {ChannelViewScaffold} from '@app/features/channel/components/channel_view/ChannelViewScaffold';
import {DMChannelView} from '@app/features/channel/components/channel_view/DMChannelView';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import {ThreadComposerArea} from '@app/features/threads/components/ThreadComposerArea';
import {ThreadSplitView} from '@app/features/threads/components/ThreadSidePanel';
import {isDmThread, isDmThreadParent} from '@app/features/threads/fork/ForkDmThreads';
import {ME} from '@fluxer/constants/src/AppConstants';
import {observer} from 'mobx-react-lite';
import type {ReactNode} from 'react';

export const DmChannelWithThreads = observer(({channel}: {channel: Channel}) => (
	<ThreadSplitView parent={channel} data-flx="threads.fork-dm-thread-views.thread-split-view">
		<DMChannelView channelId={channel.id} data-flx="threads.fork-dm-thread-views.dm-channel-view" />
	</ThreadSplitView>
));

export const DmThreadFullView = observer(({thread}: {thread: Channel}) => (
	<ChannelViewScaffold
		header={
			<ChannelHeader
				channel={thread}
				showMembersToggle={false}
				showPins={true}
				onBackClick={() => {
					if (thread.parentId) NavigationCommands.selectChannel(ME, thread.parentId);
				}}
				data-flx="threads.fork-dm-thread-views.channel-header"
			/>
		}
		chatArea={
			<ChannelChatLayout
				messages={<Messages key={thread.id} channel={thread} data-flx="threads.fork-dm-thread-views.messages" />}
				textarea={<ThreadComposerArea thread={thread} data-flx="threads.fork-dm-thread-views.thread-composer-area" />}
				data-flx="threads.fork-dm-thread-views.channel-chat-layout"
			/>
		}
		sidePanel={null}
		showMemberListDivider={false}
		data-flx="threads.fork-dm-thread-views.channel-view-scaffold"
	/>
));

// What a DM route shows for a DM or a DM thread, or null for upstream's view. Upstream draws DMs in two places, its
// DM layout and the channel page (favourites), and both hand over here.
export function forkDmThreadView(channelId: string | undefined): ReactNode {
	const channel = channelId ? Channels.getChannel(channelId) : undefined;
	if (channel && isDmThreadParent(channel)) {
		return <DmChannelWithThreads channel={channel} data-flx="threads.fork-dm-thread-views.dm-channel-with-threads" />;
	}
	if (channel && isDmThread(channel)) {
		return <DmThreadFullView thread={channel} data-flx="threads.fork-dm-thread-views.dm-thread-full-view" />;
	}
	return null;
}
