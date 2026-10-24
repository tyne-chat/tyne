// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream removed the web app's unit tests and their vitest setup on 2026-10-21. The fork keeps
// running its own (`pnpm --filter fluxer_app test`), with the configuration upstream had.

import {defineConfig} from 'vitest/config';

// The app imports its wasm files as URLs and fetches them (rspack serves them as assets, since
// upstream's #3908 on 2026-11-07). Vitest would instantiate a .wasm import as a module instead, so
// here a .wasm import is a URL too; vitest.fork.setup.ts answers the fetch from the file.
const FORK_WASM_URL_PREFIX = 'http://fork-test-wasm.invalid';

function forkWasmAsUrl() {
	return {
		name: 'fork-wasm-as-url',
		enforce: 'pre' as const,
		load(id: string) {
			const file = id.split('?')[0];
			if (!file.endsWith('.wasm')) {
				return null;
			}
			return `export default ${JSON.stringify(FORK_WASM_URL_PREFIX + file)};`;
		},
	};
}

export default defineConfig({
	plugins: [forkWasmAsUrl()],
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
			BUILD_VERSION: process.env.BUILD_VERSION ?? 'dev',
			BUILD_CHANNEL: process.env.BUILD_CHANNEL ?? 'development',
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
