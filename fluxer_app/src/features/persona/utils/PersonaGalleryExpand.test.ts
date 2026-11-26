// SPDX-License-Identifier: AGPL-3.0-or-later

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
	HIDDEN_WHEN_EXPANDED,
	PERSONA_GALLERY_FULL_WINDOW_ATTRIBUTE,
	PROFILE_MODAL_ROOT_SELECTOR,
	STYLED_WHEN_EXPANDED,
} from './PersonaGalleryExpand';

const FEATURES = join(__dirname, '..', '..');
const read = (file: string) => readFileSync(join(FEATURES, file), 'utf8');

// The expanded Personas tab hides upstream's profile header and expands the profile window by
// data-flx, without editing upstream's files; a rename upstream would leave the header showing or
// keep the window cramped, so it fails here instead.
describe('expanding the Personas tab', () => {
	it.each([...HIDDEN_WHEN_EXPANDED, ...STYLED_WHEN_EXPANDED])('finds %s still rendering data-flx="%s"', (file, flx) => {
		expect(read(file)).toContain(`data-flx="${flx}"`);
	});

	it('finds the profile window it marks', () => {
		expect(read('user/components/modals/UserProfileModal.tsx')).toContain(
			PROFILE_MODAL_ROOT_SELECTOR.slice('[data-flx="'.length, -'"]'.length),
		);
	});

	it('styles each of them in the stylesheet and keeps the toolbar sticky', () => {
		const css = read('persona/components/gallery/PersonaGallery.module.css');
		for (const [, flx] of [...HIDDEN_WHEN_EXPANDED, ...STYLED_WHEN_EXPANDED]) {
			expect(css).toContain(`[data-flx='${flx}']`);
		}
		expect(css).toContain(`[${PERSONA_GALLERY_FULL_WINDOW_ATTRIBUTE}='true']`);
		expect(css).toMatch(/\.toolbar\s*\{[^}]*position:\s*sticky;/);
	});
});
