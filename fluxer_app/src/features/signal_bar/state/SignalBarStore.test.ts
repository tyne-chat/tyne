// @vitest-environment happy-dom

import {beforeEach, describe, expect, it, vi} from 'vitest';

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

import Authentication from '@app/features/auth/state/Authentication';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {http} from '@app/features/platform/transport/RestTransport';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {moveSignal} from '@app/features/signal_bar/utils/SignalUtils';
import type {ChannelSignalEntry} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
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

	it('re-sends own signals as the new persona when the active persona changes', async () => {
		Authentication.setUserId('1');
		const active = observable.box<string | null>(null);
		const persona = vi
			.spyOn(PersonaStore, 'getEffectivePersonaForText')
			.mockImplementation(() => ({persona: active.get() ? ({id: active.get()} as never) : null, isFromTag: false}));
		const putMock = vi.spyOn(http, 'put').mockResolvedValue({ok: true} as never);
		getMock.mockResolvedValue({
			ok: true,
			body: {enabled: true, bar_version: 3, entries: [entry('a', '1'), entry('b', '2')]},
		} as never);
		await SignalBarStore.fetchChannel('sync');
		expect(putMock).not.toHaveBeenCalled();

		runInAction(() => active.set('9'));
		expect(putMock).toHaveBeenCalledWith('/channels/sync/signals/a/@me', {body: {persona_id: '9'}});
		expect(putMock).not.toHaveBeenCalledWith('/channels/sync/signals/b/@me', expect.anything());
		persona.mockRestore();
		putMock.mockRestore();
	});

	it('updates the own badge locally as soon as the composer reports a new persona', async () => {
		Authentication.setUserId('1');
		const putMock = vi.spyOn(http, 'put').mockResolvedValue({ok: true} as never);
		getMock.mockResolvedValue({ok: true, body: {enabled: true, bar_version: 3, entries: [entry('a', '1')]}} as never);
		SignalBarStore.setComposerPersona('live', null);
		await SignalBarStore.fetchChannel('live');

		SignalBarStore.setComposerPersona('live', {id: '7', name: 'Kitsune', avatar: 'hash'});
		const [own] = SignalBarStore.getEntries('live', 'a');
		expect(own?.persona_id).toBe('7');
		expect(own?.subprofile?.name).toBe('Kitsune');
		expect(putMock).toHaveBeenCalledWith('/channels/live/signals/a/@me', {body: {persona_id: '7'}});

		SignalBarStore.setComposerPersona('live', null);
		expect(SignalBarStore.getEntries('live', 'a')[0]?.persona_id).toBeNull();
		expect(putMock).toHaveBeenLastCalledWith('/channels/live/signals/a/@me', {body: {}});
		SignalBarStore.clearComposerPersona('live');
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

describe('moveSignal', () => {
	it('moves an item without mutating the input', () => {
		const input = ['a', 'b', 'c'];
		expect(moveSignal(input, 0, 2)).toEqual(['b', 'c', 'a']);
		expect(moveSignal(input, 2, 0)).toEqual(['c', 'a', 'b']);
		expect(input).toEqual(['a', 'b', 'c']);
	});
});
