// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, type MockInstance, vi} from 'vitest';

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
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import SessionManager from '@app/features/platform/state/AuthSession';
import {http} from '@app/features/platform/transport/RestTransport';
import SignalBarStore, {FRESH_CHANNEL_ANSWER_MS} from '@app/features/signal_bar/state/SignalBarStore';
import {moveSignal} from '@app/features/signal_bar/utils/SignalUtils';
import type {ChannelSignalEntry, SignalBarSignal} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {observable, runInAction} from 'mobx';

function entry(signalId: string, userId: string, personaId: string | null = null): ChannelSignalEntry {
	return {
		signal_id: signalId,
		user: {id: userId, username: `user-${userId}`, discriminator: '0001'} as ChannelSignalEntry['user'],
		persona_id: personaId,
		subprofile: null,
		activated_at: 0,
	};
}

describe('SignalBarStore', () => {
	const getMock = vi.spyOn(http, 'get');

	beforeEach(() => {
		getMock.mockReset();
		runInAction(() => {
			SignalBarStore.version = 3;
		});
	});

	it('ignores updates for channels that have not been loaded', () => {
		SignalBarStore.handleChannelUpdate({channel_id: 'unloaded', bar_version: 3, added: [entry('a', '1')], removed: []});
		expect(SignalBarStore.getEntries('unloaded', 'a')).toEqual([]);
	});

	it('keeps one entry per account and replaces it in place when its persona changes', async () => {
		getMock.mockResolvedValue({
			ok: true,
			body: {enabled: true, bar_version: 3, entries: [entry('a', '1'), entry('a', '2')]},
		} as never);
		await SignalBarStore.fetchChannel('c');
		expect(SignalBarStore.getEntries('c', 'a')).toHaveLength(2);

		SignalBarStore.handleChannelUpdate({
			channel_id: 'c',
			bar_version: 3,
			added: [entry('a', '1', '9'), entry('a', '3')],
			removed: [{signal_id: 'a', user_id: '2'}],
		});
		expect(SignalBarStore.getEntries('c', 'a').map((item) => [item.user.id, item.persona_id])).toEqual([
			['1', '9'],
			['3', null],
		]);
		expect(SignalBarStore.getEntries('c', 'b')).toEqual([]);
	});

	it('leaves lit signals alone when the active persona changes without anything done in the channel', async () => {
		SessionManager.setUserId('1');
		const active = observable.box<string | null>(null);
		const persona = vi.spyOn(PersonaStore, 'getEffectivePersonaForText').mockImplementation(() => ({
			persona: active.get() ? ({id: active.get()} as never) : null,
			isFromTag: false,
			isTagUnfinished: false,
		}));
		const putMock = vi.spyOn(http, 'put').mockResolvedValue({ok: true} as never);
		getMock.mockResolvedValue({
			ok: true,
			body: {enabled: true, bar_version: 3, entries: [entry('a', '1'), entry('b', '2')]},
		} as never);
		await SignalBarStore.fetchChannel('quiet');

		// A switch made in another channel, another window or on another device.
		runInAction(() => active.set('9'));
		// The composer of this channel then shows the new persona, with nothing typed.
		SignalBarStore.setComposerPersona('quiet', {id: '9', name: 'Nine'});
		SignalBarStore.setComposerPersona(
			'quiet',
			{id: '9', name: 'Nine'},
			{value: '', previousValue: null, typingEnabled: true},
		);
		SignalBarStore.setComposerPersona(
			'quiet',
			{id: '9', name: 'Nine'},
			{value: 'a draft', previousValue: 'a draft', typingEnabled: true},
		);

		expect(putMock).not.toHaveBeenCalled();
		expect(SignalBarStore.getEntries('quiet', 'a')[0]?.persona_id).toBeNull();
		SignalBarStore.clearComposerPersona('quiet');
		persona.mockRestore();
		putMock.mockRestore();
	});

	it('follows the composer of a channel while the person types in it', async () => {
		SessionManager.setUserId('1');
		const putMock = vi.spyOn(http, 'put').mockResolvedValue({ok: true} as never);
		getMock.mockResolvedValue({
			ok: true,
			body: {enabled: true, bar_version: 3, entries: [entry('a', '1'), entry('a', '2')]},
		} as never);
		await SignalBarStore.fetchChannel('live');

		SignalBarStore.setComposerPersona(
			'live',
			{id: '7', name: 'Kitsune', avatar: 'hash'},
			{value: 'k: h', previousValue: 'k: ', typingEnabled: true},
		);
		const [own, other] = SignalBarStore.getEntries('live', 'a');
		expect(own?.persona_id).toBe('7');
		expect(own?.subprofile?.name).toBe('Kitsune');
		expect(other?.persona_id).toBeNull();
		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock).toHaveBeenCalledWith('/channels/live/signals/a/@me', {body: {persona_id: '7'}});

		// Typing on without a tag goes back to the account.
		SignalBarStore.setComposerPersona('live', null, {value: 'hello', previousValue: 'hell', typingEnabled: true});
		expect(SignalBarStore.getEntries('live', 'a')[0]?.persona_id).toBeNull();
		expect(putMock).toHaveBeenLastCalledWith('/channels/live/signals/a/@me', {body: {}});
		SignalBarStore.clearComposerPersona('live');
		putMock.mockRestore();
	});

	it('does not count emptying the composer, a command, or a composer without typing indicators as typing', async () => {
		SessionManager.setUserId('1');
		const putMock = vi.spyOn(http, 'put').mockResolvedValue({ok: true} as never);
		getMock.mockResolvedValue({ok: true, body: {enabled: true, bar_version: 3, entries: [entry('a', '1')]}} as never);
		await SignalBarStore.fetchChannel('idle');
		const seven = {id: '7', name: 'Kitsune'};

		SignalBarStore.setComposerPersona('idle', seven, {value: '', previousValue: 'k: hi', typingEnabled: true});
		SignalBarStore.setComposerPersona('idle', seven, {value: '/nick', previousValue: '/nic', typingEnabled: true});
		SignalBarStore.setComposerPersona('idle', seven, {value: 'k: hi', previousValue: 'k: h', typingEnabled: false});

		expect(putMock).not.toHaveBeenCalled();
		expect(SignalBarStore.getEntries('idle', 'a')[0]?.persona_id).toBeNull();
		SignalBarStore.clearComposerPersona('idle');
		putMock.mockRestore();
	});

	it('changes the signals of the one channel it is told about', async () => {
		SessionManager.setUserId('1');
		const putMock = vi.spyOn(http, 'put').mockResolvedValue({ok: true} as never);
		getMock.mockResolvedValue({
			ok: true,
			body: {enabled: true, bar_version: 3, entries: [entry('a', '1'), entry('b', '1', '7'), entry('a', '2')]},
		} as never);
		await SignalBarStore.fetchChannel('here');
		await SignalBarStore.fetchChannel('elsewhere');

		SignalBarStore.affirmPersona('here', {id: '7', name: 'Kitsune'});

		// Signal b already names that persona, and the other account's signal is not ours to change.
		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock).toHaveBeenCalledWith('/channels/here/signals/a/@me', {body: {persona_id: '7'}});
		expect(SignalBarStore.getEntries('here', 'a').map((item) => item.persona_id)).toEqual(['7', null]);
		expect(SignalBarStore.getEntries('elsewhere', 'a').map((item) => item.persona_id)).toEqual([null, null]);

		SignalBarStore.affirmPersona('never-loaded', {id: '7', name: 'Kitsune'});
		expect(putMock).toHaveBeenCalledTimes(1);
		putMock.mockRestore();
	});

	it('refetches the bar when an event carries a newer version', () => {
		getMock.mockResolvedValue({ok: false} as never);
		SignalBarStore.handleBarUpdate(3);
		expect(getMock).not.toHaveBeenCalled();
		SignalBarStore.handleBarUpdate(4);
		expect(getMock).toHaveBeenCalledTimes(1);
	});
});

function signal(id: string): SignalBarSignal {
	return {id, emoji_id: null, emoji_name: '👍', animated: false, label: null, everywhere: false};
}

describe('SignalBarStore when the server refuses a change', () => {
	let getMock: MockInstance<typeof http.get>;
	let putMock: MockInstance<typeof http.put>;
	let deleteMock: MockInstance<typeof http.delete>;

	async function loadChannel(channelId: string, entries: Array<ChannelSignalEntry>): Promise<void> {
		getMock.mockResolvedValueOnce({ok: true, body: {enabled: true, bar_version: 3, entries}} as never);
		await SignalBarStore.fetchChannel(channelId);
	}

	beforeEach(() => {
		getMock = vi.spyOn(http, 'get').mockResolvedValue({ok: false} as never);
		putMock = vi.spyOn(http, 'put');
		deleteMock = vi.spyOn(http, 'delete');
		putMock.mockResolvedValue({ok: true, status: 204} as never);
		deleteMock.mockResolvedValue({ok: true, status: 204} as never);
		runInAction(() => {
			SignalBarStore.version = 3;
		});
	});

	function failSaving(failure: () => Promise<never>): void {
		putMock.mockImplementation(((path: string) =>
			path === ForkEndpoints.INSTANCE_SIGNAL_BAR ? failure() : Promise.resolve({ok: true, status: 204})) as never);
	}

	it("drops someone's signal at once and reloads the channel when removing it fails", async () => {
		await loadChannel('remove', [entry('a', '1'), entry('a', '2')]);
		deleteMock.mockRejectedValue(new Error('offline'));

		const removing = SignalBarStore.removeUser('remove', 'a', '2');
		expect(SignalBarStore.getEntries('remove', 'a').map((item) => item.user.id)).toEqual(['1']);

		getMock.mockResolvedValueOnce({
			ok: true,
			body: {enabled: true, bar_version: 3, entries: [entry('a', '1'), entry('a', '2')]},
		} as never);
		await removing;
		await vi.waitFor(() => expect(SignalBarStore.getEntries('remove', 'a')).toHaveLength(2));
	});

	it('puts the previous signals back and reloads the bar when saving fails', async () => {
		runInAction(() => {
			SignalBarStore.signals = [signal('kept')];
		});
		failSaving(() => Promise.reject(new Error('offline')));

		const saved = await SignalBarStore.saveSignals([signal('new')]);

		expect(saved).toBe(false);
		expect(putMock).toHaveBeenCalledWith(ForkEndpoints.INSTANCE_SIGNAL_BAR, expect.anything());
		expect(SignalBarStore.signals.map((item) => item.id)).toEqual(['kept']);
		await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
	});

	it('puts the previous signals back when the server answers with an error', async () => {
		runInAction(() => {
			SignalBarStore.signals = [signal('kept')];
		});
		failSaving(() => Promise.resolve({ok: false, status: 400}) as never);

		expect(await SignalBarStore.saveSignals([signal('new')])).toBe(false);
		expect(putMock).toHaveBeenCalledWith(ForkEndpoints.INSTANCE_SIGNAL_BAR, expect.anything());
		expect(SignalBarStore.signals.map((item) => item.id)).toEqual(['kept']);
	});

	it('clears the signals of a channel where the bar is turned off', async () => {
		await loadChannel('switched-off', [entry('a', '1')]);

		SignalBarStore.handleEnabledUpdate({channel_id: 'switched-off', enabled: false});

		expect(SignalBarStore.isEnabled('switched-off')).toBe(false);
		expect(SignalBarStore.getEntries('switched-off', 'a')).toEqual([]);
	});

	it('keeps the signals of a loaded channel when the bar is turned on again', async () => {
		await loadChannel('switched-on', [entry('a', '1')]);

		SignalBarStore.handleEnabledUpdate({channel_id: 'switched-on', enabled: true});

		expect(SignalBarStore.isEnabled('switched-on')).toBe(true);
		expect(SignalBarStore.getEntries('switched-on', 'a')).toHaveLength(1);
	});
});

describe('moveSignal', () => {
	it('moves an item without mutating the input', () => {
		const input = ['a', 'b', 'c'];
		expect(moveSignal(input, 0, 2)).toEqual(['b', 'c', 'a']);
		expect(moveSignal(input, 2, 0)).toEqual(['c', 'a', 'b']);
		expect(input).toEqual(['a', 'b', 'c']);
	});
});

// "Network calls" in the root AGENTS.md and the table in signal_bar/AGENTS.md: how many requests
// the store sends, with the data missing and with the request failing. Each request is held until
// the test answers it.
describe('the requests SignalBarStore sends', () => {
	interface HeldRequest {
		method: 'GET' | 'PUT' | 'DELETE';
		path: string;
		answer: (body?: unknown) => Promise<void>;
		refuse: (status: number) => Promise<void>;
		fail: () => Promise<void>;
	}

	let requests: Array<HeldRequest>;
	let getMock: MockInstance<typeof http.get>;
	let putMock: MockInstance<typeof http.put>;
	let deleteMock: MockInstance<typeof http.delete>;

	// Lets every promise chain the answer started run to its end, as the store's `void` calls do.
	const drain = async () => {
		for (let i = 0; i < 10; i += 1) await Promise.resolve();
	};

	function hold(method: HeldRequest['method']) {
		return ((path: string) =>
			new Promise((resolve, reject) => {
				requests.push({
					method,
					path,
					answer: async (body) => {
						resolve({ok: true, status: 200, body});
						await drain();
					},
					refuse: async (status) => {
						resolve({ok: false, status, body: {code: 'ERROR'}});
						await drain();
					},
					fail: async () => {
						reject(new Error('offline'));
						await drain();
					},
				});
			})) as never;
	}

	const sent = (method: HeldRequest['method'], path?: string) =>
		requests.filter((request) => request.method === method && (path === undefined || request.path === path));
	const configGets = () => sent('GET', ForkEndpoints.INSTANCE_SIGNAL_BAR);
	const channelGets = (channelId: string) => sent('GET', ForkEndpoints.CHANNEL_SIGNALS(channelId));
	const config = (version: number) => ({signals: [signal('a')], version, guild_id: 'home', can_manage: false});
	const channelBody = (barVersion: number, entries: Array<ChannelSignalEntry> = []) => ({
		enabled: true,
		bar_version: barVersion,
		entries,
	});

	beforeEach(() => {
		requests = [];
		getMock = vi.spyOn(http, 'get').mockImplementation(hold('GET'));
		putMock = vi.spyOn(http, 'put').mockImplementation(hold('PUT'));
		deleteMock = vi.spyOn(http, 'delete').mockImplementation(hold('DELETE'));
		runInAction(() => {
			SignalBarStore.version = 3;
		});
	});

	afterEach(async () => {
		// Nothing may stay in flight into the next test: a held config request would be shared.
		for (const request of requests) await request.fail();
		getMock.mockRestore();
		putMock.mockRestore();
		deleteMock.mockRestore();
	});

	describe('the bar itself', () => {
		it('shares one request among callers while it is in flight, and asks anew after it settles', async () => {
			void SignalBarStore.fetchConfig();
			void SignalBarStore.fetchConfig();
			SignalBarStore.handleBarUpdate(9);
			expect(configGets()).toHaveLength(1);

			await configGets()[0]?.answer(config(9));
			expect(SignalBarStore.version).toBe(9);
			expect(SignalBarStore.guildId).toBe('home');

			void SignalBarStore.fetchConfig();
			expect(configGets()).toHaveLength(2);
		});

		it('asks only for a version newer than the one it has', async () => {
			SignalBarStore.handleBarUpdate(3);
			SignalBarStore.handleBarUpdate(2);
			expect(configGets()).toHaveLength(0);

			SignalBarStore.handleChannelUpdate({channel_id: 'not-loaded', bar_version: 4, added: [], removed: []});
			SignalBarStore.handleChannelUpdate({channel_id: 'not-loaded', bar_version: 5, added: [], removed: []});
			expect(configGets()).toHaveLength(1);
		});

		it('gives up after a failed request: it keeps what it had and sends nothing more by itself', async () => {
			runInAction(() => {
				SignalBarStore.signals = [signal('kept')];
			});
			void SignalBarStore.fetchConfig();
			await configGets()[0]?.fail();
			void SignalBarStore.fetchConfig();
			await configGets()[1]?.refuse(429);

			expect(configGets()).toHaveLength(2);
			expect(SignalBarStore.version).toBe(3);
			expect(SignalBarStore.signals.map((item) => item.id)).toEqual(['kept']);
		});

		it('keeps every channel shown, unconfirmed, and asks for the bar once when invalidated', async () => {
			SessionManager.setUserId('1');
			void SignalBarStore.fetchChannel('loaded');
			await channelGets('loaded')[0]?.answer(channelBody(3, [entry('a', '1')]));
			expect(SignalBarStore.isConfirmed('loaded')).toBe(true);
			const epoch = SignalBarStore.epoch;

			SignalBarStore.invalidate();
			SignalBarStore.invalidate();

			// READY drops nothing (tyne-chat/tyne#644): the bar keeps what it showed until the answer.
			expect(SignalBarStore.getEntries('loaded', 'a')).toHaveLength(1);
			expect(SignalBarStore.isEnabled('loaded')).toBe(true);
			expect(SignalBarStore.isConfirmed('loaded')).toBe(false);
			expect(SignalBarStore.epoch).toBe(epoch + 2);
			expect(configGets()).toHaveLength(1);
			expect(channelGets('loaded')).toHaveLength(1);
		});
	});

	// READY keeps what is shown, unconfirmed, until each chat answers again (tyne-chat/tyne#644), and
	// a click on such a chat waits for that answer (tyne-chat/tyne#645).
	describe('after READY', () => {
		const loaded = async (channelId: string, entries: Array<ChannelSignalEntry>) => {
			void SignalBarStore.fetchChannel(channelId);
			await channelGets(channelId).at(-1)?.answer(channelBody(3, entries));
			SignalBarStore.invalidate();
			// The mounted bar asks again on the new epoch.
			void SignalBarStore.fetchChannel(channelId);
		};

		beforeEach(() => {
			SessionManager.setUserId('1');
		});

		it('takes an answer to a request sent before READY, but only the newer one confirms the chat', async () => {
			void SignalBarStore.fetchChannel('early');
			SignalBarStore.invalidate();
			void SignalBarStore.fetchChannel('early');

			await channelGets('early')[0]?.answer(channelBody(3, [entry('a', '2')]));
			expect(SignalBarStore.getEntries('early', 'a')).toHaveLength(1);
			expect(SignalBarStore.isConfirmed('early')).toBe(false);

			await channelGets('early')[1]?.answer(channelBody(3, [entry('a', '2'), entry('b', '3')]));
			expect(SignalBarStore.isConfirmed('early')).toBe(true);
			expect(SignalBarStore.getEntries('early', 'b')).toHaveLength(1);
			expect(channelGets('early')).toHaveLength(2);
		});

		it('never lets an answer to a request sent before READY replace a newer one', async () => {
			void SignalBarStore.fetchChannel('late');
			SignalBarStore.invalidate();
			void SignalBarStore.fetchChannel('late');

			await channelGets('late')[1]?.answer(channelBody(3, [entry('b', '3')]));
			await channelGets('late')[0]?.answer(channelBody(3, [entry('a', '2')]));

			expect(SignalBarStore.isConfirmed('late')).toBe(true);
			expect(SignalBarStore.getEntries('late', 'b')).toHaveLength(1);
			expect(SignalBarStore.getEntries('late', 'a')).toEqual([]);
		});

		it('asks once for a chat whose request failed when it is clicked', async () => {
			await loaded('retry', []);
			await channelGets('retry')[1]?.fail();
			expect(channelGets('retry')).toHaveLength(2);

			SignalBarStore.toggle('retry', 'a');
			SignalBarStore.toggle('retry', 'b');
			expect(channelGets('retry')).toHaveLength(3);
			await channelGets('retry')[2]?.answer(channelBody(3, [entry('b', '1')]));

			expect(sent('PUT', ForkEndpoints.CHANNEL_SIGNAL_ME('retry', 'a'))).toHaveLength(1);
			expect(sent('PUT', ForkEndpoints.CHANNEL_SIGNAL_ME('retry', 'b'))).toHaveLength(0);
		});

		it('shows a click turning a signal off at once, and sends it only if the answer still has it on', async () => {
			await loaded('off', [entry('a', '1'), entry('b', '2')]);

			SignalBarStore.toggle('off', 'a');
			expect(SignalBarStore.getEntries('off', 'a')).toEqual([]);
			expect(sent('DELETE')).toHaveLength(0);

			await channelGets('off')[1]?.answer(channelBody(3, [entry('a', '1'), entry('b', '2')]));
			expect(sent('DELETE', ForkEndpoints.CHANNEL_SIGNAL_ME('off', 'a'))).toHaveLength(1);
			expect(SignalBarStore.getEntries('off', 'a')).toEqual([]);
			expect(SignalBarStore.getEntries('off', 'b')).toHaveLength(1);
		});

		it('sends nothing for a click the answer already agrees with', async () => {
			await loaded('on', []);

			SignalBarStore.toggle('on', 'a');
			SignalBarStore.toggle('on', 'b');
			expect(sent('PUT')).toHaveLength(0);
			// Lit on another device meanwhile.
			await channelGets('on')[1]?.answer(channelBody(3, [entry('a', '1')]));

			expect(sent('PUT', ForkEndpoints.CHANNEL_SIGNAL_ME('on', 'a'))).toHaveLength(0);
			expect(sent('PUT', ForkEndpoints.CHANNEL_SIGNAL_ME('on', 'b'))).toHaveLength(1);
		});

		it('keeps only the last click on a signal', async () => {
			await loaded('twice', [entry('a', '1')]);

			SignalBarStore.toggle('twice', 'a');
			SignalBarStore.toggle('twice', 'a');
			await channelGets('twice')[1]?.answer(channelBody(3, [entry('a', '1')]));

			expect(sent('PUT')).toHaveLength(0);
			expect(sent('DELETE')).toHaveLength(0);
			expect(SignalBarStore.getEntries('twice', 'a')).toHaveLength(1);
		});

		it('sends a click as it is when the chat cannot be loaded', async () => {
			await loaded('offline', []);

			SignalBarStore.toggle('offline', 'a');
			await channelGets('offline')[1]?.fail();

			expect(sent('PUT', ForkEndpoints.CHANNEL_SIGNAL_ME('offline', 'a'))).toHaveLength(1);
			expect(channelGets('offline')).toHaveLength(2);
		});

		it('sends a click on a confirmed chat at once, as before', async () => {
			void SignalBarStore.fetchChannel('confirmed');
			await channelGets('confirmed')[0]?.answer(channelBody(3, []));

			SignalBarStore.toggle('confirmed', 'a');

			expect(sent('PUT', ForkEndpoints.CHANNEL_SIGNAL_ME('confirmed', 'a'))).toHaveLength(1);
		});

		it('re-points nothing in a chat that has not answered again', async () => {
			await loaded('point', [entry('a', '1')]);

			SignalBarStore.affirmPersona('point', {id: '7', name: 'Seven'});

			expect(sent('PUT')).toHaveLength(0);
			expect(SignalBarStore.getEntries('point', 'a')[0]?.persona_id).toBeNull();
		});

		it("drops another account's copy", async () => {
			void SignalBarStore.fetchChannel('theirs');
			await channelGets('theirs')[0]?.answer(channelBody(3, [entry('a', '1')]));

			SessionManager.setUserId('2');
			SignalBarStore.invalidate();

			expect(SignalBarStore.isEnabled('theirs')).toBe(false);
			expect(SignalBarStore.getEntries('theirs', 'a')).toEqual([]);
			SessionManager.setUserId('1');
		});
	});

	// Upstream's hover and click preload (`useChannelHoverPreload`) starts the chat's bar too, so a
	// chat not opened before shows its bar with the composer instead of after it (tyne-chat/tyne#645).
	describe('a chat about to open', () => {
		let signalsBefore: ReadonlyArray<SignalBarSignal>;

		beforeEach(() => {
			signalsBefore = SignalBarStore.signals;
			runInAction(() => {
				SignalBarStore.signals = [signal('a')];
			});
		});

		afterEach(() => {
			runInAction(() => {
				SignalBarStore.signals = signalsBefore;
			});
		});

		it('is asked for once, and the bar mounting meanwhile shares that request', async () => {
			SignalBarStore.preloadChannel('hover');
			SignalBarStore.preloadChannel('hover');
			SignalBarStore.loadForBar('hover');
			expect(channelGets('hover')).toHaveLength(1);

			await channelGets('hover')[0]?.answer(channelBody(3, [entry('a', '2')]));
			expect(SignalBarStore.isEnabled('hover')).toBe(true);
			expect(SignalBarStore.isConfirmed('hover')).toBe(true);
		});

		it('spares the bar mounting right after the answer one request, once', async () => {
			SignalBarStore.preloadChannel('soon');
			await channelGets('soon')[0]?.answer(channelBody(3));
			SignalBarStore.preloadChannel('soon');
			SignalBarStore.loadForBar('soon');
			expect(channelGets('soon')).toHaveLength(1);

			// Another mount later asks, as every mount does.
			SignalBarStore.loadForBar('soon');
			expect(channelGets('soon')).toHaveLength(2);
		});

		it('does not spare a bar mounting long after the answer', async () => {
			const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
			try {
				SignalBarStore.preloadChannel('late');
				await channelGets('late')[0]?.answer(channelBody(3));
				now.mockReturnValue(1_000_000 + FRESH_CHANNEL_ANSWER_MS);
				SignalBarStore.loadForBar('late');
				expect(channelGets('late')).toHaveLength(2);
			} finally {
				now.mockRestore();
			}
		});

		it('leaves a bar mounting without a preload asking every time', async () => {
			SignalBarStore.loadForBar('plain');
			await channelGets('plain')[0]?.answer(channelBody(3));
			SignalBarStore.loadForBar('plain');
			expect(channelGets('plain')).toHaveLength(2);
		});

		it('is asked for again after a failed preload, by the bar mounting', async () => {
			SignalBarStore.preloadChannel('flaky');
			await channelGets('flaky')[0]?.fail();
			SignalBarStore.loadForBar('flaky');
			expect(channelGets('flaky')).toHaveLength(2);
		});

		it('asks nothing without a bar', () => {
			runInAction(() => {
				SignalBarStore.signals = [];
			});
			SignalBarStore.preloadChannel('nobar');
			expect(channelGets('nobar')).toHaveLength(0);
		});
	});

	describe('a channel', () => {
		it('sends one request per call, neither shared nor cached', async () => {
			void SignalBarStore.fetchChannel('one');
			void SignalBarStore.fetchChannel('two');
			void SignalBarStore.fetchChannel('one');
			expect(channelGets('one')).toHaveLength(2);
			expect(channelGets('two')).toHaveLength(1);

			for (const request of [...requests]) await request.answer(channelBody(3));
			expect(requests).toHaveLength(3);
		});

		it('asks for the bar once when channels report a newer bar, and not for the same one', async () => {
			void SignalBarStore.fetchChannel('one');
			void SignalBarStore.fetchChannel('two');
			void SignalBarStore.fetchChannel('three');
			await channelGets('one')[0]?.answer(channelBody(3));
			expect(configGets()).toHaveLength(0);

			await channelGets('two')[0]?.answer(channelBody(4));
			await channelGets('three')[0]?.answer(channelBody(4));
			expect(configGets()).toHaveLength(1);
		});

		it('keeps what it showed and sends nothing more after a failed or refused request', async () => {
			void SignalBarStore.fetchChannel('flaky');
			await channelGets('flaky')[0]?.answer(channelBody(3, [entry('a', '1')]));

			void SignalBarStore.fetchChannel('flaky');
			await channelGets('flaky')[1]?.fail();
			void SignalBarStore.fetchChannel('flaky');
			await channelGets('flaky')[2]?.refuse(400);

			expect(requests).toHaveLength(3);
			expect(SignalBarStore.getEntries('flaky', 'a')).toHaveLength(1);
			expect(SignalBarStore.isEnabled('flaky')).toBe(true);
		});

		it('remembers the accounts and personas of the signals it loads', async () => {
			const lit = {
				...entry('a', '1000000000000000077'),
				persona_id: '1000000000000000078',
				subprofile: {id: '1000000000000000078', name: 'Kit'} as ChannelSignalEntry['subprofile'],
			};
			void SignalBarStore.fetchChannel('remembered');
			await channelGets('remembered')[0]?.answer(channelBody(3, [lit]));

			expect(PersonaStore.getKnownPersona('1000000000000000078')?.name).toBe('Kit');
			expect(requests).toHaveLength(1);
		});

		it('counts a channel it could not load as off', async () => {
			void SignalBarStore.fetchChannel('thread');
			await channelGets('thread')[0]?.refuse(400);

			expect(SignalBarStore.isEnabled('thread')).toBe(false);
			expect(SignalBarStore.getEntries('thread', 'a')).toEqual([]);
		});
	});

	describe('a write the server refuses', () => {
		const writes: Array<[string, () => Promise<void>, HeldRequest['method']]> = [
			['switching the bar in a DM', () => SignalBarStore.setDmEnabled('chan', false), 'PUT'],
			['giving a signal', () => SignalBarStore.activate('chan', 'a', null), 'PUT'],
			['withdrawing a signal', () => SignalBarStore.deactivate('chan', 'a'), 'DELETE'],
			['resetting a signal', () => SignalBarStore.reset('chan', 'a'), 'DELETE'],
		];

		for (const [action, write, method] of writes) {
			it(`reloads the channel once after ${action} fails, and not again when that fails too`, async () => {
				const done = write();
				expect(sent(method)).toHaveLength(1);
				expect(channelGets('chan')).toHaveLength(0);

				await sent(method)[0]?.fail();
				await done;
				expect(channelGets('chan')).toHaveLength(1);

				await channelGets('chan')[0]?.fail();
				expect(requests).toHaveLength(2);
			});
		}

		it('sends nothing more after switching the bar in a DM succeeds', async () => {
			const done = SignalBarStore.setDmEnabled('chan', true);
			await sent('PUT')[0]?.answer();
			await done;
			expect(requests).toHaveLength(1);
		});

		it("answers null for a community's settings it could not load or save", async () => {
			const loading = SignalBarStore.fetchGuildSettings('guild');
			await sent('GET')[0]?.fail();
			expect(await loading).toBeNull();

			const saving = SignalBarStore.saveGuildSettings('guild', {} as never);
			await sent('PUT')[0]?.refuse(403);
			expect(await saving).toBeNull();
			expect(requests).toHaveLength(2);
		});
	});
});
