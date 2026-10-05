// SPDX-License-Identifier: AGPL-3.0-or-later

import upstream from './lingui.config.js';

// Fork-only strings live in their own catalogue so the upstream catalogues under
// src/features/i18n/locales stay byte-identical to upstream and never conflict on rebase.
// Only `lingui compile` uses this config. Do not run `lingui extract` with it: the catalogue is
// maintained by `node scripts/fork-i18n.mjs sync`, which keeps only strings upstream does not have.
export default {
	...upstream,
	catalogs: [
		{
			...upstream.catalogs[0],
			path: 'src/features/i18n/fork_locales/{locale}/messages',
		},
	],
};
