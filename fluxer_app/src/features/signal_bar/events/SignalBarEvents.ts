// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import type {
	ChannelSignalBarUpdateEvent,
	ChannelSignalUpdateEvent,
	SignalBarUpdateEvent,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';

export function handleChannelSignalUpdate(data: ChannelSignalUpdateEvent, _context: GatewayHandlerContext): void {
	SignalBarStore.handleChannelUpdate(data);
}

export function handleSignalBarUpdate(data: SignalBarUpdateEvent, _context: GatewayHandlerContext): void {
	SignalBarStore.handleBarUpdate(data.version);
}

export function handleChannelSignalBarUpdate(data: ChannelSignalBarUpdateEvent, _context: GatewayHandlerContext): void {
	SignalBarStore.handleEnabledUpdate(data);
}
