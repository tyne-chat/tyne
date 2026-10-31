// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));
vi.mock('@lingui/react/macro', () => ({
	useLingui: () => ({i18n: {_: (descriptor: {message: string}) => descriptor.message}}),
}));

import {GuildCommandScriptReference} from '@app/features/guild_commands/components/GuildCommandScriptReference';

describe('GuildCommandScriptReference', () => {
	let root: Root;
	let container: HTMLElement;

	beforeEach(async () => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		container = document.createElement('div');
		root = createRoot(container);
		await act(async () =>
			root.render(
				<GuildCommandScriptReference data-flx="guild-commands.guild-command-script-reference-test.guild-command-script-reference" />,
			),
		);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		vi.unstubAllGlobals();
	});

	it('lists every variable a script has', () => {
		for (const variable of ['person', 'person.name', 'input', 'target', 'target.name', 'channel', 'community.name']) {
			expect(container.textContent).toContain(`{{ ${variable} }}`);
		}
	});

	it('links to the full guide, in a new tab', () => {
		const link = container.querySelector('a');

		expect(link?.getAttribute('href')).toBe(
			'https://github.com/tyne-chat/tyne/blob/tyne/docs/server-command-scripts.md',
		);
		expect(link?.getAttribute('target')).toBe('_blank');
	});
});
