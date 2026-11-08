// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: "Get the Tyne app" under the instance's logo on the login, register and invite pages
// (tyne-chat/tyne#242), placed by one line in upstream's AuthBrandPanel. Only in the wide two-column
// card: the narrow layouts have no room beside the form. Not shown inside the desktop app or the
// installed web app, which are the app already.

import {GetAppPanel} from '@app/features/app_download/components/GetAppPanel';
import {useLocation} from '@app/features/platform/components/router/RouterReact';
import {Platform} from '@app/features/platform/types/Platform';
import type React from 'react';
import styles from './AuthGetAppPanel.module.css';

const PAGES_WITH_THE_PANEL = [/^\/login\/?$/, /^\/register\/?$/, /^\/invite\/[^/]+(\/login)?\/?$/];

export function shouldShowAuthGetAppPanel(pathname: string): boolean {
	if (Platform.isElectron || Platform.isPWA) {
		return false;
	}
	return PAGES_WITH_THE_PANEL.some((page) => page.test(pathname));
}

export function AuthGetAppPanel({inSplitCard}: {inSplitCard: boolean}): React.ReactElement | null {
	const location = useLocation();
	if (!inSplitCard || !shouldShowAuthGetAppPanel(location.pathname)) {
		return null;
	}
	return (
		<GetAppPanel
			showTitle={true}
			openInNewTab={false}
			className={styles.panel}
			data-flx="app-download.auth-get-app-panel.panel"
		/>
	);
}
