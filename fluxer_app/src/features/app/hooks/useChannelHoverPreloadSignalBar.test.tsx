// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

// Fork: upstream's hover and click preload also starts the chat's signal bar, so a chat not opened
// before shows its bar with the composer instead of popping in after it (tyne-chat/tyne#645). The
// store's own rules (once, only with a bar) are tested in SignalBarStore.test.ts.
const preloadChannel = vi.hoisted(() => vi.fn<(channelId: string) => void>());
vi.mock('@app/features/signal_bar/state/SignalBarStore', () => ({default: {preloadChannel}}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {preloadLatestPage: () => true, getCachedMessages: () => null},
}));
vi.mock('@app/features/messaging/commands/MessageCommands', () => ({ensureMembersForMessages: vi.fn()}));
vi.mock('@app/features/threads/state/ThreadGuilds', () => ({default: {isActive: () => true}}));

const {useChannelHoverPreload} = await import('@app/features/app/hooks/useChannelHoverPreload');
type Options = Parameters<typeof useChannelHoverPreload>[0];
type Preload = ReturnType<typeof useChannelHoverPreload>;

const CHANNEL_ID = '1555752678099779590';

function channel(type: number): Options['channel'] {
	return {
		id: CHANNEL_ID,
		type,
		guildId: '1555752678099779591',
		isThreadOnly: () => false,
		isThread: () => false,
	} as unknown as Options['channel'];
}

let root: Root | null = null;
let preload: Preload | null = null;

function Item({options}: {options: Options}) {
	preload = useChannelHoverPreload(options);
	return null;
}

function mount(options: Options) {
	const container = document.createElement('div');
	root = createRoot(container);
	act(() =>
		root?.render(<Item options={options} data-flx="app.use-channel-hover-preload-signal-bar-test.mount.item" />),
	);
}

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	preload = null;
	preloadChannel.mockClear();
	vi.useRealTimers();
});

describe('the channel preload and the signal bar', () => {
	it('starts the bar of a text channel pressed or hovered for long enough', () => {
		vi.useFakeTimers();
		mount({channel: channel(ChannelTypes.GUILD_TEXT)});

		act(() => preload?.preloadChannelNow());
		expect(preloadChannel).toHaveBeenCalledWith(CHANNEL_ID);

		preloadChannel.mockClear();
		act(() => preload?.scheduleChannelPreload());
		expect(preloadChannel).not.toHaveBeenCalled();
		act(() => {
			vi.runAllTimers();
		});
		expect(preloadChannel).toHaveBeenCalledTimes(1);
	});

	it('leaves a passing pointer and a category alone', () => {
		vi.useFakeTimers();
		mount({channel: channel(ChannelTypes.GUILD_CATEGORY)});
		act(() => preload?.preloadChannelNow());
		expect(preloadChannel).not.toHaveBeenCalled();

		act(() => root?.unmount());
		mount({channel: channel(ChannelTypes.GUILD_TEXT)});
		act(() => {
			preload?.scheduleChannelPreload();
			preload?.cancelChannelPreload();
			vi.runAllTimers();
		});
		expect(preloadChannel).not.toHaveBeenCalled();
	});
});
