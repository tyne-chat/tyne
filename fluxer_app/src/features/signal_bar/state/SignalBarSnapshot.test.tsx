// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the device keeps the bar's last copy for each account in app storage, so that the next start
// shows the bar before any request answers, as it was (tyne-chat/tyne#645).

import {beforeAll, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, string>) =>
				(descriptor.message ?? '').replace(/\{(\w+)\}/g, (_match, key: string) => values?.[key] ?? ''),
			locale: 'en',
		},
	}),
}));
vi.mock('react-dnd', () => ({
	useDrag: () => [{isDragging: false}, (node: unknown) => node, (node: unknown) => node],
	useDrop: () => [{}, (node: unknown) => node],
}));
vi.mock('@app/features/ui/tooltip/Tooltip', () => ({
	Tooltip: ({children}: {children?: React.ReactNode}) => <>{children}</>,
}));
vi.mock('@app/features/ui/components/Avatar', () => ({
	Avatar: () => <span data-flx="signal-bar.signal-bar-snapshot-test.avatar" />,
}));

import type {Channel} from '@app/features/channel/models/Channel';
import type {
	ChannelSignalEntry,
	SignalBarSignal,
	UserSignalsResponse,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {act} from 'react';
import {createRoot} from 'react-dom/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

type StorageModule = typeof import('@app/features/platform/state/PersistentStorage');
type StoreModule = typeof import('@app/features/signal_bar/state/SignalBarStore');
type SessionModule = typeof import('@app/features/platform/state/AuthSession');
type TransportModule = typeof import('@app/features/platform/transport/RestTransport');

const ACCOUNT_A = 'https://one.example/api::1';
const ACCOUNT_B = 'https://one.example/api::2';
const ME = '1';
const THEM = '2';

const READING: SignalBarSignal = {
	id: 'reading',
	emoji_id: null,
	emoji_name: '📖',
	animated: false,
	label: 'Reading',
	everywhere: false,
};

function entry(userId: string, username: string): ChannelSignalEntry {
	return {
		signal_id: 'reading',
		user: {
			id: userId,
			username,
			discriminator: '0001',
			avatar: null,
			flags: 0,
		} as unknown as ChannelSignalEntry['user'],
		persona_id: null,
		subprofile: null,
		activated_at: 0,
	};
}

const SUMMARY: UserSignalsResponse = {
	chats: [{channel_id: 'chat-50', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 5}],
	restore_available: true,
};

let storage: StorageModule;
let store: StoreModule;
let session: SessionModule;
let transport: TransportModule;
let flushPendingPersistWrites: () => void;

beforeAll(async () => {
	vi.resetModules();
	// The fresh modules need the test instance again.
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
	storage = await import('@app/features/platform/state/PersistentStorage');
	await storage.initializeAppStorage();
	await storage.activateAppStorageScope(ACCOUNT_A);
	session = await import('@app/features/platform/state/AuthSession');
	session.default.setUserId(ME);
	transport = await import('@app/features/platform/transport/RestTransport');
	store = await import('@app/features/signal_bar/state/SignalBarStore');
	const persistence = await import('@app/features/platform/utils/MobXPersistence');
	flushPendingPersistWrites = persistence.flushPendingPersistWrites;
	await persistence.awaitHydration('SignalBar');
});

describe("the signal bar's copy on the device", () => {
	it('keeps the bar, the 50 most recently loaded chats and the summary, for the account', async () => {
		const SignalBarStore = store.default;
		const get = vi.spyOn(transport.http, 'get').mockImplementation(((path: string) => {
			if (path.endsWith('/signal-bar')) {
				return Promise.resolve({ok: true, body: {signals: [READING], version: 4, guild_id: 'home', can_manage: false}});
			}
			if (path.endsWith('/users/@me/signals')) return Promise.resolve({ok: true, body: SUMMARY});
			return Promise.resolve({ok: true, body: {enabled: true, bar_version: 4, entries: [entry(THEM, 'them')]}});
		}) as never);

		await SignalBarStore.fetchConfig();
		for (let i = 0; i <= 50; i += 1) await SignalBarStore.fetchChannel(`chat-${i}`);
		await SignalBarStore.fetchMyChats();
		get.mockRestore();

		const snapshot = SignalBarStore.snapshot;
		expect(snapshot?.userId).toBe(ME);
		expect(snapshot?.signals.map((signal) => signal.id)).toEqual(['reading']);
		expect(snapshot?.version).toBe(4);
		expect(snapshot?.channels).toHaveLength(store.SNAPSHOT_CHANNELS);
		expect(snapshot?.channels[0]?.channel_id).toBe('chat-50');
		expect(snapshot?.channels.at(-1)?.channel_id).toBe('chat-1');
		expect(snapshot?.channels[0]?.entries.map((item) => item.user.id)).toEqual([THEM]);
		expect(snapshot?.myChats?.map((chat) => chat.channel_id)).toEqual(['chat-50']);
		expect(snapshot?.restoreAvailable).toBe(true);
		// Plain JSON, as app storage keeps it.
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
	});

	it("starts another account empty, and shows each account's own copy, unconfirmed, before anything answers", async () => {
		const SignalBarStore = store.default;
		flushPendingPersistWrites();

		session.default.setUserId(THEM);
		await storage.activateAppStorageScope(ACCOUNT_B);
		expect(SignalBarStore.isEnabled('chat-50')).toBe(false);
		expect(SignalBarStore.getEntries('chat-50', 'reading')).toEqual([]);
		expect(SignalBarStore.myChats).toBeNull();

		session.default.setUserId(ME);
		await storage.activateAppStorageScope(ACCOUNT_A);
		expect(SignalBarStore.isEnabled('chat-50')).toBe(true);
		expect(SignalBarStore.getEntries('chat-50', 'reading').map((item) => item.user.id)).toEqual([THEM]);
		expect(SignalBarStore.isConfirmed('chat-50')).toBe(false);
		expect(SignalBarStore.myChats?.size).toBe(1);
		expect(SignalBarStore.restoreAvailable).toBe(true);

		// Nothing answers: the bar draws from the copy.
		const held: Array<(value: unknown) => void> = [];
		const get = vi.spyOn(transport.http, 'get').mockImplementation(
			(() =>
				new Promise((resolve) => {
					held.push(resolve);
				})) as never,
		);
		const put = vi.spyOn(transport.http, 'put').mockResolvedValue({ok: true} as never);
		const {SignalBar} = await import('@app/features/signal_bar/components/SignalBar');
		const container = document.createElement('div');
		document.body.appendChild(container);
		const root = createRoot(container);
		const chat = {id: 'chat-50', guildId: null, ownerId: null, isGroupDM: () => false} as unknown as Channel;
		await act(async () => {
			root.render(
				<SignalBar channel={chat} attached={true} data-flx="signal-bar.signal-bar-snapshot-test.signal-bar" />,
			);
		});

		const reading = Array.from(container.querySelectorAll('button')).find((node) =>
			node.getAttribute('aria-label')?.startsWith('Reading'),
		);
		expect(reading?.getAttribute('aria-label')).toBe('Reading: them');
		// A click waits for the chat's answer instead of going out against the copy.
		await act(async () => reading?.click());
		expect(put).not.toHaveBeenCalled();

		await act(async () => {
			for (const resolve of held) resolve({ok: false, body: null});
		});
		act(() => root.unmount());
		container.remove();
		get.mockRestore();
		put.mockRestore();
	});
});
