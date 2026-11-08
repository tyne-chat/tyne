// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {describe, expect, it} from 'vitest';
import {addPersonaProfileTab} from './PersonaProfileTab';

describe('addPersonaProfileTab', () => {
	const tabs = () => [{key: 'overview'}, {key: 'mutual_friends'}, {key: 'mutual_communities_groups'}];

	it('puts Personas second on someone else’s profile', () => {
		const items = tabs();
		addPersonaProfileTab(items, {key: 'personas'}, false);
		expect(items.map((t) => t.key)).toEqual(['overview', 'personas', 'mutual_friends', 'mutual_communities_groups']);
	});

	it('leaves Overview and Personas only on one’s own profile', () => {
		const items = tabs();
		addPersonaProfileTab(items, {key: 'personas'}, true);
		expect(items.map((t) => t.key)).toEqual(['overview', 'personas']);
	});

	it('changes nothing without a tab', () => {
		const items = tabs();
		addPersonaProfileTab(items, null, true);
		expect(items).toEqual(tabs());
	});
});
