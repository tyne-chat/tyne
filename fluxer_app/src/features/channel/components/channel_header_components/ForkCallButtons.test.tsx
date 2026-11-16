// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const users = vi.hoisted(() => new Map<string, {flags: number}>());
vi.mock('@app/features/user/state/Users', () => ({default: {getUser: (id: string) => users.get(id) ?? null}}));

import {withoutImportedDmCalls} from '@app/features/channel/components/channel_header_components/ForkCallButtons';
import type {Channel} from '@app/features/channel/models/Channel';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {PublicUserFlags} from '@fluxer/constants/src/UserConstants';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const Call = ({channel}: {channel: Channel}) => (
	<button type="button" data-flx="test.call">{`call ${channel.id}`}</button>
);
const {VoiceCallButton, VideoCallButton} = withoutImportedDmCalls({VoiceCallButton: Call, VideoCallButton: Call});
const dm = (id: string, recipient: string) =>
	({id, type: ChannelTypes.DM, recipientIds: [recipient]}) as unknown as Channel;
const group = {id: '30', type: ChannelTypes.GROUP_DM, recipientIds: ['2', '3']} as unknown as Channel;

// tyne-chat/tyne#685: no calls with a placeholder the Discord import made.
describe('withoutImportedDmCalls', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		users.clear();
		users.set('2', {flags: PublicUserFlags.IMPORTED});
		users.set('3', {flags: 0});
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	const render = async (channel: Channel) => {
		await act(async () => {
			root.render(
				<>
					<VoiceCallButton
						channel={channel}
						data-flx="channel.channel-header-components.fork-call-buttons-test.voice-call-button"
					/>
					<VideoCallButton
						channel={channel}
						data-flx="channel.channel-header-components.fork-call-buttons-test.video-call-button"
					/>
				</>,
			);
		});
		return container.querySelectorAll('button').length;
	};

	it('shows no call buttons in a DM with a placeholder', async () => {
		expect(await render(dm('10', '2'))).toBe(0);
	});

	it('keeps them in a DM with anyone else and in a group DM', async () => {
		expect(await render(dm('20', '3'))).toBe(2);
		expect(await render(group)).toBe(2);
	});
});
