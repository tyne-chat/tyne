// SPDX-License-Identifier: AGPL-3.0-or-later

import {installHarnessBootstrap} from '@app/features/auth/state/__fixtures__/AccountSwitchHarness';

export function installVoiceMenuTestBootstrap(): void {
	const host = globalThis as unknown as {window?: Record<string, unknown>};
	if (typeof host.window === 'undefined') {
		host.window = host as unknown as Record<string, unknown>;
	}
	installHarnessBootstrap();
}
