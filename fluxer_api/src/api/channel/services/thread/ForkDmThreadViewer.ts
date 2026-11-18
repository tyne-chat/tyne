// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: requests from an app that knows DM threads (tyne-chat/tyne#699). Such an app sends the client feature
// DM_THREADS_CLIENT_FEATURE; for it, DM messages keep their thread chips and "thread created" notices and a DM
// thread starts with its starter message, all of which upstream strips from every channel without a guild. Older
// apps keep the stripped responses, so they never show a thread they cannot open.

import type {ThreadViewer} from '@app/api/experiment/ChannelThreadsGate';
import {DM_THREADS_CLIENT_FEATURE} from '@fluxer/constants/src/ForkDmThreadConstants';

// A symbol key: it survives the viewer being spread into a copy and stays out of upstream's type.
const SEES_DM_THREADS = Symbol('forkSeesDmThreads');

type MarkedViewer = ThreadViewer & {[SEES_DM_THREADS]?: true};

export function markDmThreadViewer(clientFeatures: ReadonlySet<string>, viewer: ThreadViewer): ThreadViewer {
	if (viewer.kind === 'user' && viewer.capable && !viewer.bot && clientFeatures.has(DM_THREADS_CLIENT_FEATURE)) {
		(viewer as MarkedViewer)[SEES_DM_THREADS] = true;
	}
	return viewer;
}

// Whether this viewer sees thread chips, notices and starters in a channel without a guild (a DM or DM thread).
export function seesDmThreads(viewer: ThreadViewer, guildId: unknown): boolean {
	return guildId === null && (viewer as MarkedViewer)[SEES_DM_THREADS] === true;
}
