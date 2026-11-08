// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the public `/download` page (tyne-chat/tyne#242), added to upstream's two root route trees
// (RouterRoutes.ts for the full app, AuthRootRoutes.tsx for the sign-in shell). No sign-in needed.

import {AppDownloadPage} from '@app/features/app_download/components/AppDownloadPage';
import {APP_DOWNLOAD_PAGE_PATH} from '@app/features/app_download/utils/AppDownloadPlatform';
import {createRoute} from '@app/features/platform/components/router/RouterBuilder';

export const appDownloadRoute = createRoute({
	id: 'forkAppDownload',
	path: APP_DOWNLOAD_PAGE_PATH,
	component: () => <AppDownloadPage data-flx="app-download.app-download-route.app-download-page" />,
});
