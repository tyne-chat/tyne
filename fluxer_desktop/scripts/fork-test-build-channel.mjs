// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: preloaded by the fork's desktop tests (`pnpm test`). Since upstream's da7c73d27e (#3989),
// src/common/BuildChannel.ts reads __FLUXER_BUILD_CHANNEL__, which only scripts/build.mjs defines,
// and most modules the tests import read BuildChannel.ts. The tests get the define here, from
// BUILD_CHANNEL as the build takes it. Before that commit `pnpm set-channel` wrote the file instead,
// and this does nothing.
globalThis.__FLUXER_BUILD_CHANNEL__ ??= process.env.BUILD_CHANNEL || 'stable';
