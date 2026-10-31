// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	usable: [] as Array<{id: string; name: string; description: string; guild_id: string}>,
}));

vi.mock('@app/features/guild/state/Guilds', () => ({
	default: {getGuild: (id: string) => (id === 'g' ? {name: 'Temple'} : undefined)},
}));
vi.mock('@app/features/guild_commands/state/GuildCommandsStore', () => ({
	default: {usableIn: () => mocks.usable, ensureLoaded: vi.fn(async () => {})},
}));

import type {Command} from '@app/features/devtools/hooks/useCommands';
import {useWithGuildCommands} from '@app/features/guild_commands/hooks/useWithGuildCommands';

const SHRUG = {type: 'action', name: '/shrug', description: 'Shrug'} as Command;

describe('useWithGuildCommands', () => {
	let root: Root;
	let seen: Array<Command>;

	function Probe({builtIns}: {builtIns: Array<Command>}) {
		seen = useWithGuildCommands(builtIns, null);
		return null;
	}

	beforeEach(() => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		mocks.usable = [];
		root = createRoot(document.createElement('div'));
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		vi.unstubAllGlobals();
	});

	const show = (builtIns: Array<Command>) =>
		act(async () =>
			root.render(<Probe builtIns={builtIns} data-flx="guild-commands.use-with-guild-commands-test.show.probe" />),
		);

	it('adds commands after the built-ins, naming their community', async () => {
		mocks.usable = [{id: '1', name: 'hug', description: 'Hugs', guild_id: 'g'}];
		await show([SHRUG]);

		expect(seen.map((command) => command.name)).toEqual(['/shrug', '/hug']);
		expect(seen[1]).toMatchObject({type: 'action', description: 'Hugs · Temple'});
	});

	it('leaves out the description when there is none', async () => {
		mocks.usable = [{id: '1', name: 'hug', description: '', guild_id: 'g'}];
		await show([]);

		expect(seen[0]).toMatchObject({description: 'Temple'});
	});

	it('lists the first of two commands with one name, the one that would run', async () => {
		mocks.usable = [
			{id: '1', name: 'hug', description: 'First', guild_id: 'g'},
			{id: '2', name: 'hug', description: 'Second', guild_id: 'g'},
		];
		await show([]);

		expect(seen).toHaveLength(1);
		expect(seen[0]?.description).toContain('First');
	});

	it('never lists a command over a built-in of the same name', async () => {
		mocks.usable = [{id: '1', name: 'shrug', description: '', guild_id: 'g'}];
		await show([SHRUG]);

		expect(seen).toEqual([SHRUG]);
	});

	it('hands back the built-ins untouched when there is nothing to add', async () => {
		const builtIns = [SHRUG];
		await show(builtIns);

		expect(seen).toBe(builtIns);
	});
});
