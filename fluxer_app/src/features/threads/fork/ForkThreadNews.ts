// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: what a parent's threads have that is new (tyne-chat/tyne#699, design section 10). The Threads button, the
// thread chip, the Threads list and a DM's row show it with the marks header buttons and the channel list already
// use: a red count of mentions (in a DM every message from someone else is one), or a white dot for unread messages
// that notify nobody. Only followed threads that are not muted count, as in the channel list; a muted thread keeps
// its greyed count in lists.

import type {Channel} from '@app/features/channel/models/Channel';
import ReadStates from '@app/features/read_state/state/ReadStates';
import ChannelThreads from '@app/features/threads/state/ChannelThreads';
import ThreadMemberships from '@app/features/threads/state/ThreadMemberships';
import {isSidebarThreadUnread} from '@app/features/threads/utils/SidebarThreadActivity';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';

export interface ThreadNews {
	readonly mentionCount: number;
	readonly hasUnread: boolean;
}

const NO_NEWS: ThreadNews = {mentionCount: 0, hasUnread: false};

export function threadMentionCount(thread: Channel): number {
	return ThreadMemberships.isMember(thread.id) ? ReadStates.getMentionCount(thread.id) : 0;
}

export function threadHasNews(thread: Channel): boolean {
	return threadMentionCount(thread) > 0 || isSidebarThreadUnread(thread);
}

export function parentThreadNews(parentId: string | null | undefined): ThreadNews {
	if (!parentId) return NO_NEWS;
	let mentionCount = 0;
	let hasUnread = false;
	for (const thread of ChannelThreads.getThreadsForParent(parentId)) {
		if (thread.isArchived || ThreadMemberships.isMuted(thread.id)) continue;
		mentionCount += threadMentionCount(thread);
		if (isSidebarThreadUnread(thread)) hasUnread = true;
	}
	return mentionCount === 0 && !hasUnread ? NO_NEWS : {mentionCount, hasUnread};
}

// A DM's place in the DM list: its newest message, or a newer one in a thread it follows (design section 5). The
// DM's own last message id stays as it is, so the thread's message does not mark the DM itself unread.
export function latestDmThreadActivity(dm: Channel, baseId: string): string {
	let latest = baseId;
	for (const thread of ChannelThreads.getThreadsForParent(dm.id)) {
		if (!ThreadMemberships.isMember(thread.id) || ThreadMemberships.isMuted(thread.id)) continue;
		const threadLast = thread.lastMessageId;
		if (threadLast != null && SnowflakeUtils.compare(threadLast, latest) > 0) latest = threadLast;
	}
	return latest;
}
