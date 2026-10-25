// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: ForkLinkColors.css uses the same selectors as the generated color-system.css, so it wins
// only by coming after it (tyne-chat/tyne#230). If a rebase moves its import above, links and
// mentions take the instance's brand colour again with nothing else failing.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

const INDEX = readFileSync(join(__dirname, '..', '..', '..', 'index.tsx'), 'utf8');

describe('ForkLinkColors.css', () => {
	it('is imported after the generated colour system', () => {
		const colorSystem = INDEX.indexOf("import '@app/features/theme/styles/generated/color-system.css';");
		const forkLinkColors = INDEX.indexOf("import '@app/features/theme/styles/ForkLinkColors.css';");
		expect(colorSystem).toBeGreaterThan(-1);
		expect(forkLinkColors).toBeGreaterThan(colorSystem);
	});
});
