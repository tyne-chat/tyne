// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {Channel} from '@app/features/channel/models/Channel';
import type {FavoriteMeme} from '@app/features/expressions/models/FavoriteMeme';
import type {Guild} from '@app/features/guild/models/Guild';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {useMobxMemo} from '@app/features/platform/hooks/useMobxMemo';
import type {User} from '@app/features/user/models/User';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {runInAction} from 'mobx';
import {observer} from 'mobx-react-lite';
import {act, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const stores = await vi.hoisted(async () => {
	const {observable} = await import('mobx');
	return {
		channels: observable.map<string, unknown>(),
		guilds: observable.map<string, unknown>(),
		users: observable.map<string, {id: string; displayName: string}>(),
		memeScores: observable.map<string, number>(),
		flags: observable({canAccess: false}),
	};
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	Plural: () => null,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}) => descriptor.message ?? '',
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/channel/state/Channels', () => ({
	default: {getChannel: (id: string) => stores.channels.get(id)},
}));

vi.mock('@app/features/guild/state/Guilds', () => ({
	default: {getGuild: (id: string) => stores.guilds.get(id)},
}));

vi.mock('@app/features/user/state/Users', () => ({
	default: {getUser: (id: string) => stores.users.get(id)},
}));

vi.mock('@app/features/emoji/state/MemesPicker', () => ({
	default: {getFrecencyScoreForMeme: (meme: {id: string}) => stores.memeScores.get(meme.id) ?? 0},
}));

vi.mock('@app/features/permissions/state/Permission', () => ({
	default: {can: () => stores.flags.canAccess},
}));

vi.mock('@app/features/channel/utils/ChannelUtils', () => ({
	getDMDisplayName: () => 'DM Name',
}));

vi.mock('@app/features/app/components/dialogs/ConfirmModal', () => ({
	ConfirmModal: ({description}: {description: ReactNode}) => (
		<div data-flx="platform.hooks.fork-mobx-stale-memo-test.confirm-modal">{description}</div>
	),
}));

const {useFilteredMemes} = await import('@app/features/channel/components/pickers/memes/useFilteredMemes');
const {useForwardedMessageContext} = await import('@app/features/messaging/utils/ForwardedMessageUtils');
const {UnaddableRecipientsConfirmModal} = await import(
	'@app/features/channel/components/modals/UnaddableRecipientsConfirmModal'
);

describe('MobX memoization and reactivity (tyne-chat/tyne#937, #948)', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		runInAction(() => {
			stores.channels.clear();
			stores.guilds.clear();
			stores.users.clear();
			stores.memeScores.clear();
			stores.flags.canAccess = false;
		});
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it('useMobxMemo skips recomputation on unrelated re-renders and invalidates across multiple observable updates', () => {
		let factoryCalls = 0;
		const ids = ['u-1', 'u-2'];
		let latestResult: Array<string | undefined> = [];

		const Probe = observer(({unrelatedProp}: {unrelatedProp: number}) => {
			latestResult = useMobxMemo(() => {
				factoryCalls += 1;
				return ids.map((id) => stores.users.get(id)?.displayName);
			}, [ids]);
			return (
				<span data-flx="platform.hooks.fork-mobx-stale-memo-test.probe">
					{unrelatedProp}:{latestResult.join(',')}
				</span>
			);
		});

		act(() => {
			root.render(<Probe unrelatedProp={1} data-flx="platform.hooks.fork-mobx-stale-memo-test.probe-instance" />);
		});
		expect(factoryCalls).toBe(1);
		expect(latestResult).toEqual([undefined, undefined]);

		// Unrelated prop change must reuse the cached computed value without rerunning factory.
		act(() => {
			root.render(<Probe unrelatedProp={2} data-flx="platform.hooks.fork-mobx-stale-memo-test.probe-instance" />);
		});
		expect(factoryCalls).toBe(1);

		// First MobX mutation inside the loop recomputes the memoized list.
		act(() => {
			runInAction(() => {
				stores.users.set('u-1', {id: 'u-1', displayName: 'Alice'});
			});
		});
		expect(factoryCalls).toBe(2);
		expect(latestResult).toEqual(['Alice', undefined]);

		// Second MobX mutation also invalidates cleanly.
		act(() => {
			runInAction(() => {
				stores.users.set('u-2', {id: 'u-2', displayName: 'Bob'});
			});
		});
		expect(factoryCalls).toBe(3);
		expect(latestResult).toEqual(['Alice', 'Bob']);
	});

	it('useForwardedMessageContext reacts when Channels, Guilds, Users, and Permission populate after mount', () => {
		const message = {
			messageReference: {channel_id: 'ch-1', guild_id: 'g-1'},
		} as unknown as Message;
		const state: {snapshot: ReturnType<typeof useForwardedMessageContext> | null} = {snapshot: null};

		const Probe = observer(() => {
			state.snapshot = useForwardedMessageContext(message);
			return null;
		});

		act(() => {
			root.render(<Probe data-flx="platform.hooks.fork-mobx-stale-memo-test.forward-probe" />);
		});
		expect(state.snapshot?.sourceChannel).toBeNull();
		expect(state.snapshot?.sourceGuild).toBeNull();
		expect(state.snapshot?.sourceUser).toBeNull();
		expect(state.snapshot?.hasAccessToSource).toBe(false);

		const dmChannel = {
			id: 'ch-1',
			guildId: null,
			type: ChannelTypes.DM,
			recipientIds: ['u-9'],
		} as unknown as Channel;
		const dmUser = {id: 'u-9', displayName: 'Peer'} as unknown as User;
		const sourceGuild = {id: 'g-1', name: 'Source'} as unknown as Guild;

		act(() => {
			runInAction(() => {
				stores.channels.set('ch-1', dmChannel);
				stores.guilds.set('g-1', sourceGuild);
				stores.users.set('u-9', dmUser as unknown as {id: string; displayName: string});
			});
		});
		expect(state.snapshot?.sourceChannel).toEqual(dmChannel);
		expect(state.snapshot?.sourceGuild).toEqual(sourceGuild);
		expect(state.snapshot?.sourceUser).toEqual(dmUser);
		expect(state.snapshot?.hasAccessToSource).toBe(true);
	});

	it('UnaddableRecipientsConfirmModal updates user names when Users store hydrates after mount', () => {
		act(() => {
			root.render(
				<UnaddableRecipientsConfirmModal
					unaddableRecipients={[{userId: 'u-1', reason: 'unknown_user'}]}
					addableCount={0}
					onConfirm={() => {}}
					data-flx="platform.hooks.fork-mobx-stale-memo-test.unaddable-modal"
				/>,
			);
		});
		expect(container.textContent).toContain('u-1');
		expect(container.textContent).not.toContain('Chiara');

		act(() => {
			runInAction(() => {
				stores.users.set('u-1', {id: 'u-1', displayName: 'Chiara'});
			});
		});
		expect(container.textContent).toContain('Chiara');
	});

	it('useFilteredMemes re-sorts when MemesPicker frecency scores update without input prop changes', () => {
		const memes = [
			{
				id: 'm-1',
				name: 'wave first',
				altText: null,
				filename: 'a.png',
				tags: [],
				contentType: 'image/png',
				isGifv: false,
			},
			{
				id: 'm-2',
				name: 'wave second',
				altText: null,
				filename: 'b.png',
				tags: [],
				contentType: 'image/png',
				isGifv: false,
			},
		] as unknown as ReadonlyArray<FavoriteMeme>;
		runInAction(() => {
			stores.memeScores.set('m-1', 10);
			stores.memeScores.set('m-2', 1);
		});

		let orderedIds: Array<string> = [];
		const Probe = observer(() => {
			orderedIds = useFilteredMemes(memes, 'all', 'wave').map((m) => m.id);
			return null;
		});

		act(() => {
			root.render(<Probe data-flx="platform.hooks.fork-mobx-stale-memo-test.memes-probe" />);
		});
		expect(orderedIds).toEqual(['m-1', 'm-2']);

		act(() => {
			runInAction(() => {
				stores.memeScores.set('m-2', 50);
			});
		});
		expect(orderedIds).toEqual(['m-2', 'm-1']);
	});
});
