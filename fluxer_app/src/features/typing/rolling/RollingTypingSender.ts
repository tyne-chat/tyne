// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import Authentication from '@app/features/auth/state/Authentication';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {decideComposerTyping} from '@app/features/typing/rolling/RollingComposerTypingGate';
import RollingTypingStore from '@app/features/typing/rolling/RollingTypingStore';
import {
	planTypingSend,
	TYPING_ROLLING_SKIP_ABOVE_TRACKED,
	type TypingSendSlot,
} from '@app/features/typing/rolling/TypingSendThrottle';

// Fork imports.

import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

const logger = new Logger('Typing');

export interface ComposerTypingInput {
	channelId: string;
	value: string;
	previousValue: string | null;
	enabled: boolean;
	typingEnabled: boolean;
	isEditingMessageInComposer: boolean;
	// Fork: the persona the composer is typing as.
	subprofile?: MessageSubprofileResponse | null;
}

class RollingTypingSender {
	handleComposerChange(input: ComposerTypingInput): void {
		const decision = decideComposerTyping({
			previousValue: input.previousValue,
			value: input.value,
			isEditingMessageInComposer: input.isEditingMessageInComposer,
			enabled: input.enabled && input.typingEnabled,
		});
		if (decision === 'start') {
			this.startTyping(input.channelId, input.subprofile);
		} else if (decision === 'stop') {
			this.stopTyping(input.channelId);
		}
	}
	private slot: (TypingSendSlot & {subprofile?: MessageSubprofileResponse | null}) | null = null;

	startTyping(channelId: string, subprofile?: MessageSubprofileResponse | null): void {
		const userId = Authentication.currentUserId;
		if (userId == null) {
			return;
		}
		const now = Date.now();
		const personaId = subprofile?.id ?? null;
		const plan = planTypingSend(this.slot, channelId, userId, now, personaId);
		if (plan.dropSlot) {
			this.dropSlot();
		}
		if (plan.action === 'throttled') {
			return;
		}
		const slot: TypingSendSlot & {subprofile?: MessageSubprofileResponse | null} = {
			channelId,
			userId,
			personaId,
			subprofile,
			timeout: null,
			prevSend: now,
		};
		slot.timeout = setTimeout(() => this.fire(slot), plan.delayMs);
		this.slot = slot;
		RollingTypingStore.start(channelId, userId, 'local', subprofile);
	}

	stopTyping(channelId: string): void {
		const slot = this.slot;
		if (slot === null || slot.channelId !== channelId || slot.timeout === null) {
			return;
		}
		clearTimeout(slot.timeout);
		this.slot = null;
		RollingTypingStore.remove(channelId, slot.userId);
	}

	handleOwnMessageSent(channelId: string): void {
		this.dropSlot();
		const userId = Authentication.currentUserId;
		if (userId != null) {
			RollingTypingStore.remove(channelId, userId);
		}
	}

	private dropSlot(): void {
		const slot = this.slot;
		if (slot === null) {
			return;
		}
		if (slot.timeout !== null) {
			clearTimeout(slot.timeout);
		}
		this.slot = null;
	}

	private fire(captured: TypingSendSlot & {subprofile?: MessageSubprofileResponse | null}): void {
		const slot = this.slot;
		if (slot !== captured || Authentication.currentUserId !== captured.userId || captured.timeout === null) {
			return;
		}
		captured.timeout = null;
		if (RollingTypingStore.countTypists(captured.channelId) > TYPING_ROLLING_SKIP_ABOVE_TRACKED) {
			return;
		}
		void this.postTyping(captured.channelId, captured.subprofile);
	}

	private async postTyping(channelId: string, subprofile?: MessageSubprofileResponse | null): Promise<void> {
		try {
			if (subprofile) {
				await http.post(Endpoints.CHANNEL_TYPING(channelId), {
					body: {persona_id: subprofile.id},
				});
			} else {
				await http.post(Endpoints.CHANNEL_TYPING(channelId));
			}
		} catch (error) {
			logger.error(`Failed to send typing indicator to channel ${channelId}:`, error);
		}
	}
}

export default new RollingTypingSender();
