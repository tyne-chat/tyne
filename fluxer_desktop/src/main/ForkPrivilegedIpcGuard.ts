// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: central privileged-renderer sender validation guard installed before main-app ipcMain registrations.

import {
	isPrivilegedRendererDocumentSender,
	requirePrivilegedRendererDocumentSender,
} from '@electron/main/PrivilegedRendererDocuments';
import {
	isVoiceDebugEventSinkPopoutContents,
	VOICE_DEBUG_EVENT_SINK_POPOUT_KEY,
} from '@electron/main/VoiceDebugEventSinkPopout';
import {DESKTOP_LAST_ROUTE_CHANNEL} from '@fluxer/desktop_ipc/src/LastRouteContract';
import {VOICE_ENGINE_V2_HARDWARE_ENCODER_IPC_CHANNEL} from '@fluxer/voice_engine_v2/bridge';
import {type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain} from 'electron';

export const FORK_GUARDED_IPC_CHANNELS: ReadonlySet<string> = new Set([
	'autostart-enable',
	'autostart-disable',
	'autostart-is-enabled',
	'autostart-is-initialized',
	'autostart-mark-initialized',
	'get-initial-deep-link',
	'set-display-media-portal-preference',
	'desktop-troubleshooting-set-disable-hardware-acceleration',
	'desktop-troubleshooting-set-disable-module-updates',
	'streaming-priority-acquire',
	'streaming-priority-release',
	'tray-runtime-state-update',
	'native-locale-set',
	'window-flash',
	'window-stop-flash',
	'taskbar-progress-set',
	'desktop-window-behavior-pending-restart',
	'desktop-app-relaunch',
	'desktop-window-behavior-set',
	'popout:set-always-on-top',
	'popout:focus',
	'open-external',
	'clipboard-write-text',
	'clipboard-read-text',
	'check-media-access',
	'request-media-access',
	'open-media-access-settings',
	'open-input-monitoring-settings',
	'virtmic:get-availability',
	'virtmic:list',
	'virtmic:stop',
	'mac-tcc:status',
	'mac-tcc:request',
	'native-audio:get-availability',
	'native-audio:list-applications',
	'native-audio:resolve-root-pid',
	'native-audio:start',
	'native-audio:set-rule',
	'native-audio:set-win-endpoints',
	'native-audio:list-playback-devices',
	'native-audio:stop',
	VOICE_ENGINE_V2_HARDWARE_ENCODER_IPC_CHANNEL,
	'notification-sound-allowed',
	'close-notification',
	'close-notifications',
	'passkey-is-supported',
	'passkey-authenticate',
	'passkey-register',
	'spellcheck:update-autodetect-text',
	'spellcheck:get-bundled-dictionaries',
	'spellcheck:check-words',
	'spellcheck-set-state',
	'spellcheck-get-available-languages',
	'spellcheck-replace-misspelling',
	'spellcheck-add-word-to-dictionary',
	'theme-local-files-pick',
	'theme-local-files-clear',
	'theme-directory-import',
	'updater-check',
	'voice-background-media-cache:write',
	'voice-background-media-cache:read',
	'voice-background-media-cache:delete',
	'voice-debug-event-sink:open',
	'voice-debug-event-sink:append',
	'voice-debug-event-sink:set-stats-html',
	DESKTOP_LAST_ROUTE_CHANNEL,
]);

export type GuardableIpcMain = Pick<IpcMain, 'handle' | 'on'>;

type InvokeListener = Parameters<IpcMain['handle']>[1];
type SendListener = Parameters<IpcMain['on']>[1];

const guardedTargets = new WeakSet<object>();

function isAllowedVoiceDebugSelfPin(event: IpcMainInvokeEvent, key: unknown): boolean {
	const frame = event.senderFrame;
	return (
		key === VOICE_DEBUG_EVENT_SINK_POPOUT_KEY &&
		frame != null &&
		!frame.detached &&
		frame.parent == null &&
		isVoiceDebugEventSinkPopoutContents(event.sender)
	);
}

/**
 * Wraps `ipcMain.handle` and `ipcMain.on` so upstream channels listed in
 * `FORK_GUARDED_IPC_CHANNELS` reject detached, sub-frame, and untrusted-origin callers.
 */
export function installForkPrivilegedIpcGuard(target: GuardableIpcMain = ipcMain): void {
	if (guardedTargets.has(target)) {
		return;
	}
	guardedTargets.add(target);

	const originalHandle = target.handle.bind(target);
	const originalOn = target.on.bind(target);

	target.handle = (channel: string, listener: InvokeListener): void => {
		if (!FORK_GUARDED_IPC_CHANNELS.has(channel)) {
			originalHandle(channel, listener);
			return;
		}
		originalHandle(channel, (event: IpcMainInvokeEvent, ...args: Array<unknown>) => {
			if (channel === 'popout:set-always-on-top' && isAllowedVoiceDebugSelfPin(event, args[0])) {
				return listener(event, ...args);
			}
			requirePrivilegedRendererDocumentSender(event, channel);
			return listener(event, ...args);
		});
	};

	target.on = (channel: string, listener: SendListener) => {
		if (!FORK_GUARDED_IPC_CHANNELS.has(channel)) {
			return originalOn(channel, listener);
		}
		return originalOn(channel, (event: IpcMainEvent, ...args: Array<unknown>) => {
			if (!isPrivilegedRendererDocumentSender(event)) {
				return;
			}
			listener(event, ...args);
		});
	};
}
