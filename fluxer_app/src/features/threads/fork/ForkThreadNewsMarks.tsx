// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the marks of threads' news (tyne-chat/tyne#699, ForkThreadNews.ts): a thread's own count on its chip and on
// its "started a thread" notice, and the Threads mark on a DM's row (the Threads button at half size, with the red count of its threads' mentions).

import type {Channel} from '@app/features/channel/models/Channel';
import {parentThreadNews, threadHasNews, threadMentionCount} from '@app/features/threads/fork/ForkThreadNews';
import styles from '@app/features/threads/fork/ForkThreadNewsMarks.module.css';
import ThreadMemberships from '@app/features/threads/state/ThreadMemberships';
import * as D from '@app/features/threads/utils/ThreadMessageDescriptors';
import {MentionBadge} from '@app/features/ui/components/MentionBadge';
import {useLingui} from '@lingui/react/macro';
import {ChatsIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

function chipMentionCount(thread: Channel): number {
	return ThreadMemberships.isMuted(thread.id) ? 0 : threadMentionCount(thread);
}

export const ThreadChipNews = observer(({thread}: {thread: Channel}) => {
	const count = chipMentionCount(thread);
	if (count === 0) return null;
	return <MentionBadge mentionCount={count} size="small" data-flx="threads.fork-thread-news-marks.chip-badge" />;
});

// A thread started from the + menu has no chip, only its notice: the same count goes at the end of that.
export const ThreadCreatedNews = observer(({thread}: {thread: Channel | undefined}) => {
	const count = thread ? chipMentionCount(thread) : 0;
	if (count === 0) return null;
	return (
		<span className={styles.createdNews} data-flx="threads.fork-thread-news-marks.created-news">
			<MentionBadge mentionCount={count} size="small" data-flx="threads.fork-thread-news-marks.created-badge" />
		</span>
	);
});

export const DmThreadsMark = observer(({channel}: {channel: Channel}) => {
	const {i18n} = useLingui();
	const news = parentThreadNews(channel.id);
	if (news.mentionCount === 0 && !news.hasUnread) return null;
	return (
		<span
			className={styles.dmThreadsMark}
			role="img"
			aria-label={i18n._(D.THREADS_DESCRIPTOR)}
			data-flx="threads.fork-thread-news-marks.dm-threads-mark"
		>
			<ChatsIcon
				className={styles.dmThreadsIcon}
				weight="bold"
				data-flx="threads.fork-thread-news-marks.dm-threads-icon"
			/>
			{news.mentionCount > 0 && (
				<span className={styles.dmThreadsCount} data-flx="threads.fork-thread-news-marks.dm-threads-count">
					<MentionBadge
						mentionCount={news.mentionCount}
						size="small"
						data-flx="threads.fork-thread-news-marks.dm-threads-badge"
					/>
				</span>
			)}
		</span>
	);
});

// In the Threads list: the thread's count, or a white dot when it is only unread.
export const ThreadBrowserNews = observer(({thread}: {thread: Channel}) => {
	if (ThreadMemberships.isMuted(thread.id) || !threadHasNews(thread)) return null;
	const count = threadMentionCount(thread);
	return (
		<span className={styles.browserNews} data-flx="threads.fork-thread-news-marks.browser-news">
			{count > 0 ? (
				<MentionBadge mentionCount={count} size="small" data-flx="threads.fork-thread-news-marks.browser-badge" />
			) : (
				<span className={styles.browserUnreadDot} data-flx="threads.fork-thread-news-marks.browser-unread-dot" />
			)}
		</span>
	);
});

// Threads with news first, as the channel list puts them in view.
export function compareThreadNews(a: Channel, b: Channel): number {
	return Number(threadHasNews(b)) - Number(threadHasNews(a));
}
