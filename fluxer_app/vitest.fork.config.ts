// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream removed the web app's unit tests and their vitest setup on 2026-10-21. The fork keeps
// running its own (`pnpm --filter fluxer_app test`), with the configuration upstream had.

import {defineConfig} from 'vitest/config';

export default defineConfig({
	resolve: {tsconfigPaths: true},
	oxc: {
		jsx: {runtime: 'automatic', importSource: 'react'},
	},
	test: {
		globals: true,
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 30_000,
		setupFiles: ['./vitest.fork.setup.ts'],
		env: {
			PUBLIC_BUILD_VERSION: process.env.PUBLIC_BUILD_VERSION ?? 'dev',
			PUBLIC_RELEASE_CHANNEL: process.env.PUBLIC_RELEASE_CHANNEL ?? 'development',
		},
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		exclude: ['node_modules', 'dist'],
		server: {
			deps: {
				inline: [/livekit-client/, /@livekit\//],
			},
		},
	},
});
