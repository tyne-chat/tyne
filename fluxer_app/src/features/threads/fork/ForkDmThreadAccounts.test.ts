// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelWire} from '@app/features/channel/models/Channel';
import {
	clearDmThreadAccountsForTesting,
	dmThreadsToRestore,
	forgetDmThread,
	rememberDmThread,
	rememberDmThreadAccount,
} from '@app/features/threads/fork/ForkDmThreadAccounts';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {afterEach, describe, expect, it} from 'vitest';

const thread = (id: string, extra: Partial<ChannelWire> = {}): ChannelWire =>
	({id, type: ChannelTypes.PUBLIC_THREAD, parent_id: '10', name: `t${id}`, ...extra}) as ChannelWire;
const member = {join_timestamp: '2026-11-18T00:00:00.000Z', flags: 1};

describe('ForkDmThreadAccounts', () => {
	afterEach(clearDmThreadAccountsForTesting);

	it('gives back each account its own DM threads and whether it may start one', () => {
		rememberDmThreadAccount('a', true);
		rememberDmThread(thread('1'));
		rememberDmThreadAccount('b', false);
		rememberDmThread(thread('2'));
		expect(dmThreadsToRestore('a')).toEqual({canStart: true, threads: [thread('1')]});
		expect(dmThreadsToRestore('b')).toEqual({canStart: false, threads: [thread('2')]});
		expect(dmThreadsToRestore('c')).toBeNull();
	});

	it('follows updates and deletes for the account in front, keeping a known member', () => {
		rememberDmThreadAccount('a', true);
		rememberDmThread(thread('1', {member}));
		rememberDmThread(thread('1', {name: 'renamed'}));
		rememberDmThread(thread('2'));
		forgetDmThread('2');
		expect(dmThreadsToRestore('a')?.threads).toEqual([thread('1', {name: 'renamed', member})]);
	});

	it('starts again from READY, and after a warm switch records for the account switched to', () => {
		rememberDmThreadAccount('a', true);
		rememberDmThread(thread('1'));
		rememberDmThreadAccount('a', true);
		expect(dmThreadsToRestore('a')?.threads).toEqual([]);
		rememberDmThreadAccount('b', true);
		dmThreadsToRestore('a');
		rememberDmThread(thread('3'));
		expect(dmThreadsToRestore('a')?.threads).toEqual([thread('3')]);
		expect(dmThreadsToRestore('b')?.threads).toEqual([]);
	});
});
