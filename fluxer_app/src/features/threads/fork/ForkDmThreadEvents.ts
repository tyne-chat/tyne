// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the server sends every gateway event about a DM thread wrapped as FORK_DM_THREAD_EVENT {t, d}, so apps that
// predate DM threads drop it (tyne-chat/tyne#699). Here it is unwrapped into upstream's handler for `t`, whose
// thread code reads a missing guild as a DM (ForkDmThreads.ts).

import type {GatewayHandlerRegistry} from '@app/features/gateway/events/EventRouter';
import {DM_THREAD_GATEWAY_EVENT} from '@fluxer/constants/src/ForkDmThreadConstants';

interface DmThreadEnvelope {
	t: string;
	d: unknown;
}

function isEnvelope(data: unknown): data is DmThreadEnvelope {
	return typeof data === 'object' && data !== null && typeof (data as {t?: unknown}).t === 'string';
}

export function registerDmThreadEnvelope(registry: GatewayHandlerRegistry): void {
	registry.set(DM_THREAD_GATEWAY_EVENT, (data, context) => {
		if (!isEnvelope(data) || data.t === DM_THREAD_GATEWAY_EVENT) return;
		registry.get(data.t)?.(data.d, context);
	});
}
