// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the REST requests this fork makes when the gateway reports READY. A READY that arrives
// while the app is still signing in or switching account cannot make them yet: requests started
// during the switch are cancelled when it completes. Like upstream's AccountReadyWork, wait for
// the switch to be released and run them then.

import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {AccountScopedWork} from '@app/features/platform/state/AccountScopedWork';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';

let pending = false;

function runForkAccountReadyWork(): void {
	void PersonaCommands.fetchPersonas(true);
	void PersonaCommands.fetchPersonaSettings();
}

export function scheduleForkAccountReadyWork(): void {
	if (AccountScopedWork.isSuspended) {
		pending = true;
		return;
	}
	pending = false;
	runForkAccountReadyWork();
}

AccountScopedWork.registerTransition({
	suspend: () => {
		pending = false;
	},
	resume: () => {},
	released: () => {
		if (!pending) {
			return;
		}
		pending = false;
		SignalBarStore.invalidate();
		runForkAccountReadyWork();
	},
});
