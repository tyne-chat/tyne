// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the desktop app starts its sign-in flow on a default homeserver, so the first screen has
// already picked an instance without ever naming it. Show which one.

import styles from '@app/features/auth/flow/AuthInstanceHint.module.css';
import {useOptionalAuthRuntimeTarget} from '@app/features/auth/state/AuthRuntimeTarget';
import {isDesktop} from '@app/features/ui/utils/NativeUtils';
import {observer} from 'mobx-react-lite';

function instanceHost(apiEndpoint: string): string | null {
	try {
		return new URL(apiEndpoint).host;
	} catch {
		return null;
	}
}

export const AuthInstanceHint = observer(function AuthInstanceHint() {
	const snapshot = useOptionalAuthRuntimeTarget()?.snapshot ?? null;
	if (snapshot === null || !isDesktop()) {
		return null;
	}
	const host = instanceHost(snapshot.apiEndpoint);
	if (host === null) {
		return null;
	}
	return (
		<p className={styles.hint} data-flx="auth.flow.auth-instance-hint.hint">
			{host}
		</p>
	);
});
