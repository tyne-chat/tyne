// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: a thread's count on its "started a thread" notice (tyne-chat/tyne#699), the same count as on its chip.

import type {Channel} from '@app/features/channel/models/Channel';
import {ThreadCreatedNews} from '@app/features/threads/fork/ForkThreadNewsMarks';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({counts: new Map<string, number>(), muted: new Set<string>()}));

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/threads/fork/ForkThreadNews', () => ({
	threadMentionCount: (thread: {id: string}) => state.counts.get(thread.id) ?? 0,
	parentThreadNews: () => ({mentionCount: 0, hasUnread: false}),
	threadHasNews: () => false,
}));
vi.mock('@app/features/threads/state/ThreadMemberships', () => ({
	default: {isMuted: (threadId: string) => state.muted.has(threadId)},
}));
vi.mock('@app/features/ui/components/MentionBadge', () => ({
	MentionBadge: ({mentionCount}: {mentionCount: number}) => (
		<span data-testid="badge" data-flx="threads.fork.fork-thread-news-marks-test.mention-badge.badge">
			{mentionCount}
		</span>
	),
}));

const thread = (id: string) => ({id}) as Channel;

describe("a thread's count on its notice", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		state.counts.clear();
		state.muted.clear();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	const render = (target: Channel | undefined) => {
		act(() =>
			root.render(
				<ThreadCreatedNews thread={target} data-flx="threads.fork.fork-thread-news-marks-test.thread-created-news" />,
			),
		);
		return container.querySelector('[data-testid="badge"]')?.textContent ?? null;
	};

	it('shows the unread mentions of a thread one follows', () => {
		state.counts.set('30', 2);
		expect(render(thread('30'))).toBe('2');
	});

	it('shows nothing with no mentions, for a muted thread, or before the thread is known', () => {
		expect(render(thread('30'))).toBeNull();
		state.counts.set('31', 4);
		state.muted.add('31');
		expect(render(thread('31'))).toBeNull();
		expect(render(undefined)).toBeNull();
	});
});
