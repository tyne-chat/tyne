// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the DM-thread gateway envelope and READY's DM threads (tyne-chat/tyne#699).

import type {GatewayHandlerContext, GatewayHandlerRegistry} from '@app/features/gateway/events/EventRouter';
import {registerDmThreadEnvelope} from '@app/features/threads/fork/ForkDmThreadEvents';
import {dmThreadReadyChannels, includeDmThreadReadStates} from '@app/features/threads/fork/ForkDmThreadReady';
import {DM_THREAD_GATEWAY_EVENT} from '@fluxer/constants/src/ForkDmThreadConstants';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/threads/state/ChannelThreads', () => ({default: {upsert: vi.fn()}}));
vi.mock('@app/features/threads/fork/ForkDmThreads', () => ({DmThreads: {setCanStart: vi.fn()}}));

const context = {} as GatewayHandlerContext;

describe('the DM-thread envelope', () => {
	it("hands the inner event to upstream's handler for it", () => {
		const registry: GatewayHandlerRegistry = new Map();
		const messageCreate = vi.fn();
		registry.set('MESSAGE_CREATE', messageCreate);
		registerDmThreadEnvelope(registry);
		const inner = {id: '3', channel_id: '2', content: 'cake?'};
		registry.get(DM_THREAD_GATEWAY_EVENT)?.({t: 'MESSAGE_CREATE', d: inner, push: {message: {}}}, context);
		expect(messageCreate).toHaveBeenCalledWith(inner, context);
	});

	it('ignores what it cannot read, an unknown inner event, and an envelope inside an envelope', () => {
		const registry: GatewayHandlerRegistry = new Map();
		const handler = vi.fn();
		registry.set('THREAD_CREATE', handler);
		registerDmThreadEnvelope(registry);
		const envelope = registry.get(DM_THREAD_GATEWAY_EVENT)!;
		envelope(null, context);
		envelope({d: {}}, context);
		envelope({t: 'SOMETHING_NEW', d: {}}, context);
		envelope({t: DM_THREAD_GATEWAY_EVENT, d: {t: 'THREAD_CREATE', d: {}}}, context);
		expect(handler).not.toHaveBeenCalled();
	});
});

describe("READY's DM threads", () => {
	it("adds their read states to upstream's, and gives their channels", () => {
		const thread = {id: '3', type: 11, parent_id: '2', member: {id: '3', user_id: '1', join_timestamp: '', flags: 0}};
		const data = {
			read_states: [{id: '2', mention_count: 0}],
			fork_dm_threads: {enabled: true, threads: [thread], read_states: [{id: '3', mention_count: 1}]},
		};
		includeDmThreadReadStates(data);
		expect(data.read_states.map((state) => state.id)).toEqual(['2', '3']);
		expect(dmThreadReadyChannels(data).map((channel) => channel.id)).toEqual(['3']);
	});

	it('changes nothing for a READY without them', () => {
		const data = {read_states: [{id: '2'}]};
		includeDmThreadReadStates(data);
		expect(data.read_states).toEqual([{id: '2'}]);
		expect(dmThreadReadyChannels(data)).toEqual([]);
	});
});
