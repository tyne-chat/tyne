// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the persona a thread was started as arrives as owner_persona_id and is sent once, when the
// thread is created or loaded. Later updates to the thread do not repeat it and must not drop it.

import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/app/state/RuntimeConfig', () => ({default: {localInstanceDomain: 'fluxer.test'}}));
vi.mock('@app/features/user/state/Users', () => ({default: {getUser: () => undefined, cacheUsers: () => {}}}));

const {Channel} = await import('@app/features/channel/models/Channel');

const THREAD = {id: '1500000000000000003', type: ChannelTypes.PUBLIC_THREAD, guild_id: '1', parent_id: '2'};

describe('Channel.ownerPersonaId', () => {
	it('is null for a thread started as the account', () => {
		expect(new Channel(THREAD).ownerPersonaId).toBeNull();
	});

	it('reads the persona and keeps it across updates and serialisation', () => {
		const thread = new Channel({...THREAD, owner_persona_id: '1500000000000000009'});
		expect(thread.ownerPersonaId).toBe('1500000000000000009');
		expect(thread.withUpdates({name: 'renamed'}).ownerPersonaId).toBe('1500000000000000009');
		expect(thread.toJSON().owner_persona_id).toBe('1500000000000000009');
		expect(new Channel(thread.toJSON()).equals(thread)).toBe(true);
	});

	it('tells a thread started as a persona from one started as the account', () => {
		const persona = new Channel({...THREAD, owner_persona_id: '1500000000000000009'});
		expect(persona.equals(new Channel(THREAD))).toBe(false);
	});
});
