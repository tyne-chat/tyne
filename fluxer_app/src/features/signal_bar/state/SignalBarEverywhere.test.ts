// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import SessionManager from '@app/features/platform/state/AuthSession';
import {http} from '@app/features/platform/transport/RestTransport';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import type {
	ChannelSignalEntry,
	SignalBarSignal,
	UserSignalsResponse,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {runInAction} from 'mobx';

const ME = '1';
const SLEEPING: SignalBarSignal = {
	id: 'sleeping',
	emoji_id: null,
	emoji_name: '💤',
	animated: false,
	label: 'Sleeping',
	everywhere: true,
};

function entry(
	signalId: string,
	userId: string,
	activatedAt: number,
	personaId: string | null = null,
): ChannelSignalEntry {
	return {
		signal_id: signalId,
		user: {id: userId, username: `user-${userId}`, discriminator: '0001'} as ChannelSignalEntry['user'],
		persona_id: personaId,
		subprofile: null,
		activated_at: activatedAt,
	};
}

const summary = (chats: UserSignalsResponse['chats'], restoreAvailable = false): UserSignalsResponse => ({
	chats,
	restore_available: restoreAvailable,
});

// "Network calls" in the root AGENTS.md: each action everywhere is one request, a failure is not
// sent again by itself, and the summary is loaded once and then kept by the channel events.
describe('SignalBarStore signals everywhere', () => {
	const getMock = vi.spyOn(http, 'get');
	const putMock = vi.spyOn(http, 'put');
	const postMock = vi.spyOn(http, 'post');
	const deleteMock = vi.spyOn(http, 'delete');

	beforeEach(() => {
		SessionManager.setUserId(ME);
		getMock.mockReset();
		putMock.mockReset();
		postMock.mockReset();
		deleteMock.mockReset();
		SignalBarStore.forgetMyChats();
		runInAction(() => {
			SignalBarStore.signals = [SLEEPING];
			SignalBarStore.version = 1;
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads the summary once for many bars, and keeps it newest first', async () => {
		getMock.mockResolvedValue({
			ok: true,
			body: summary(
				[
					{channel_id: 'old', signals: [{signal_id: 'sleeping', persona_id: null}], updated_at: 1},
					{channel_id: 'new', signals: [{signal_id: 'sleeping', persona_id: '7'}], updated_at: 5},
				],
				true,
			),
		} as never);

		SignalBarStore.ensureMyChats();
		SignalBarStore.ensureMyChats();
		await SignalBarStore.fetchMyChats();
		SignalBarStore.ensureMyChats();

		expect(getMock).toHaveBeenCalledTimes(1);
		expect(getMock).toHaveBeenCalledWith(ForkEndpoints.USER_SIGNALS);
		expect(SignalBarStore.myChatList.map((chat) => chat.channel_id)).toEqual(['new', 'old']);
		expect(SignalBarStore.restoreAvailable).toBe(true);
	});

	it('does not ask again for a minute after the summary fails to load', async () => {
		vi.useFakeTimers({toFake: ['Date']});
		getMock.mockRejectedValue(new Error('offline'));

		SignalBarStore.ensureMyChats();
		await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		SignalBarStore.ensureMyChats();
		SignalBarStore.ensureMyChats();
		expect(getMock).toHaveBeenCalledTimes(1);

		vi.setSystemTime(Date.now() + 61_000);
		SignalBarStore.ensureMyChats();
		expect(getMock).toHaveBeenCalledTimes(2);
	});

	it('follows channel events that name the account, in channels the bar has not loaded too', async () => {
		getMock.mockResolvedValue({ok: true, body: summary([])} as never);
		await SignalBarStore.fetchMyChats();

		SignalBarStore.handleChannelUpdate({
			channel_id: 'a',
			bar_version: 1,
			added: [entry('sleeping', ME, 10, '7'), entry('sleeping', '2', 11)],
			removed: [],
		});
		SignalBarStore.handleChannelUpdate({
			channel_id: 'b',
			bar_version: 1,
			added: [entry('sleeping', ME, 20)],
			removed: [],
		});
		expect(SignalBarStore.myChatList).toEqual([
			{channel_id: 'b', signals: [{signal_id: 'sleeping', persona_id: null}], updated_at: 20},
			{channel_id: 'a', signals: [{signal_id: 'sleeping', persona_id: '7'}], updated_at: 10},
		]);

		SignalBarStore.handleChannelUpdate({
			channel_id: 'b',
			bar_version: 1,
			added: [],
			removed: [{signal_id: 'sleeping', user_id: ME}],
		});
		SignalBarStore.handleChannelUpdate({
			channel_id: 'a',
			bar_version: 1,
			added: [],
			removed: [{signal_id: 'sleeping', user_id: '2'}],
		});
		expect(SignalBarStore.myChatList.map((chat) => chat.channel_id)).toEqual(['a']);
		expect(getMock).toHaveBeenCalledTimes(1);
	});

	it('sets a signal everywhere in one request with the open chat and its persona, and takes the answer', async () => {
		putMock.mockResolvedValue({
			ok: true,
			body: summary([{channel_id: 'open', signals: [{signal_id: 'sleeping', persona_id: '7'}], updated_at: 3}], true),
		} as never);

		await SignalBarStore.setEverywhere('sleeping', 'open', '7');

		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock).toHaveBeenCalledWith(ForkEndpoints.USER_SIGNALS, {
			body: {signal_id: 'sleeping', channel_id: 'open', persona_id: '7'},
		});
		expect(SignalBarStore.myChatList.map((chat) => chat.channel_id)).toEqual(['open']);
		expect(SignalBarStore.restoreAvailable).toBe(true);
		expect(getMock).not.toHaveBeenCalled();
	});

	it('turns all off with a null signal and no chat', async () => {
		putMock.mockResolvedValue({ok: true, body: summary([], true)} as never);

		await SignalBarStore.setEverywhere(null, 'open', '7');

		expect(putMock).toHaveBeenCalledWith(ForkEndpoints.USER_SIGNALS, {body: {signal_id: null}});
	});

	it('sends nothing while a change everywhere is on its way', async () => {
		let answer: (value: unknown) => void = () => {};
		putMock.mockReturnValue(new Promise((resolve) => (answer = resolve)) as never);

		const first = SignalBarStore.setEverywhere('sleeping', null, null);
		await SignalBarStore.setEverywhere(null, null, null);
		await SignalBarStore.restoreEverywhere();
		expect(SignalBarStore.everywhereBusy).toBe(true);
		answer({ok: true, body: summary([])});
		await first;

		expect(putMock).toHaveBeenCalledTimes(1);
		expect(postMock).not.toHaveBeenCalled();
		expect(SignalBarStore.everywhereBusy).toBe(false);
	});

	it('reloads the summary once after a failed change, and does not send the change again', async () => {
		putMock.mockRejectedValue(new Error('429'));
		getMock.mockResolvedValue({ok: true, body: summary([])} as never);

		await SignalBarStore.setEverywhere('sleeping', null, null);
		await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

		expect(putMock).toHaveBeenCalledTimes(1);
		expect(getMock).toHaveBeenCalledWith(ForkEndpoints.USER_SIGNALS);
	});

	it('restores with one POST', async () => {
		postMock.mockResolvedValue({ok: true, body: summary([], true)} as never);

		await SignalBarStore.restoreEverywhere();

		expect(postMock).toHaveBeenCalledTimes(1);
		expect(postMock).toHaveBeenCalledWith(ForkEndpoints.USER_SIGNALS_RESTORE);
	});

	it('forgets the summary on READY and loads it again with the bar', async () => {
		getMock.mockImplementation(((path: string) =>
			Promise.resolve({
				ok: true,
				body:
					path === ForkEndpoints.USER_SIGNALS
						? summary([], true)
						: {version: 1, signals: [SLEEPING], guild_id: '9', can_manage: false},
			})) as never);
		await SignalBarStore.fetchMyChats();
		expect(SignalBarStore.restoreAvailable).toBe(true);

		SignalBarStore.invalidate();
		expect(SignalBarStore.myChats).toBeNull();
		expect(SignalBarStore.restoreAvailable).toBe(false);
		await vi.waitFor(() => expect(SignalBarStore.myChats).not.toBeNull());

		expect(getMock.mock.calls.map(([path]) => path)).toEqual([
			ForkEndpoints.USER_SIGNALS,
			ForkEndpoints.INSTANCE_SIGNAL_BAR,
			ForkEndpoints.USER_SIGNALS,
		]);
	});

	it('turns off one chat with one DELETE per signal of the account there, dropping it at once', async () => {
		getMock.mockResolvedValue({
			ok: true,
			body: summary([
				{
					channel_id: 'a',
					signals: [
						{signal_id: 'sleeping', persona_id: null},
						{signal_id: 'reading', persona_id: '7'},
					],
					updated_at: 2,
				},
				{channel_id: 'b', signals: [{signal_id: 'sleeping', persona_id: null}], updated_at: 1},
			]),
		} as never);
		await SignalBarStore.fetchMyChats();
		deleteMock.mockResolvedValue({ok: true} as never);

		const done = SignalBarStore.turnOffChat('a');
		expect(SignalBarStore.myChatList.map((chat) => chat.channel_id)).toEqual(['b']);
		await done;

		expect(deleteMock.mock.calls.map(([path]) => path)).toEqual([
			ForkEndpoints.CHANNEL_SIGNAL_ME('a', 'sleeping'),
			ForkEndpoints.CHANNEL_SIGNAL_ME('a', 'reading'),
		]);
		expect(getMock).toHaveBeenCalledTimes(1);
	});

	it('reloads the summary once when turning off a chat fails, however many signals failed', async () => {
		getMock.mockResolvedValue({
			ok: true,
			body: summary([
				{
					channel_id: 'a',
					signals: [
						{signal_id: 'sleeping', persona_id: null},
						{signal_id: 'reading', persona_id: null},
					],
					updated_at: 2,
				},
			]),
		} as never);
		await SignalBarStore.fetchMyChats();
		deleteMock.mockRejectedValue(new Error('offline'));

		await SignalBarStore.turnOffChat('a');

		expect(deleteMock).toHaveBeenCalledTimes(2);
		expect(getMock.mock.calls.map(([path]) => path)).toEqual([ForkEndpoints.USER_SIGNALS, ForkEndpoints.USER_SIGNALS]);
	});

	it('drops a chat whose bar is switched off, which clears its signals without a signal event', async () => {
		getMock.mockResolvedValue({
			ok: true,
			body: summary([{channel_id: 'a', signals: [{signal_id: 'sleeping', persona_id: null}], updated_at: 1}]),
		} as never);
		await SignalBarStore.fetchMyChats();

		SignalBarStore.handleEnabledUpdate({channel_id: 'a', enabled: false});

		expect(SignalBarStore.myChatList).toEqual([]);
		expect(getMock).toHaveBeenCalledTimes(1);
	});
});
