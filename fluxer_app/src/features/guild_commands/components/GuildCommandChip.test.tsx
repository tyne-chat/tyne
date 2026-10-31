// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {act, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	resolve: vi.fn(),
	ensureLoaded: vi.fn(async () => {}),
	draft: '',
	createDraft: vi.fn(),
	dispatch: vi.fn(),
	openFromEvent: vi.fn(),
	canEdit: vi.fn(() => false),
}));

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));
vi.mock('@lingui/react/macro', () => ({
	useLingui: () => ({i18n: {_: (descriptor: {message: string}) => descriptor.message}}),
}));
vi.mock('@app/features/channel/state/Channels', () => ({default: {getChannel: () => ({id: 'c'})}}));
vi.mock('@app/features/guild/state/Guilds', () => ({default: {getGuild: () => ({name: 'Temple'})}}));
vi.mock('@app/features/guild_commands/state/GuildCommandsStore', () => ({
	default: {resolve: mocks.resolve, ensureLoaded: mocks.ensureLoaded},
}));
vi.mock('@app/features/guild_commands/commands/OpenGuildCommandSettings', () => ({
	canEditGuildCommand: mocks.canEdit,
	openGuildCommandInSettings: vi.fn(),
}));
vi.mock('@app/features/messaging/state/MessagingDrafts', () => ({default: {getDraft: () => mocks.draft}}));
vi.mock('@app/features/messaging/commands/DraftCommands', () => ({createDraft: mocks.createDraft}));
vi.mock('@app/features/platform/state/AuthSession', () => ({default: {currentAccountKey: 'account'}}));
vi.mock('@app/features/platform/utils/ComponentBus', () => ({ComponentBus: {dispatch: mocks.dispatch}}));
vi.mock('@app/features/ui/action_menu/ContextMenuIcons', () => ({EditIcon: () => null}));
vi.mock('@app/features/ui/action_menu/MenuGroup', () => ({MenuGroup: () => null}));
vi.mock('@app/features/ui/action_menu/MenuItem', () => ({MenuItem: () => null}));
vi.mock('@app/features/ui/commands/ContextMenuCommands', () => ({openFromEvent: mocks.openFromEvent}));
vi.mock('@app/features/ui/tooltip/Tooltip', () => ({Tooltip: ({children}: {children: ReactNode}) => children}));

import {GuildCommandChip} from '@app/features/guild_commands/components/GuildCommandChip';

const HUG = {id: '7', name: 'hug', guild_id: 'g'};

let root: Root;
let container: HTMLElement;

async function show() {
	await act(async () => {
		root.render(<GuildCommandChip command={HUG} channelId="c" data-flx="test.chip" />);
	});
	return container.querySelector('button') as HTMLButtonElement;
}

describe('GuildCommandChip', () => {
	beforeEach(() => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		vi.clearAllMocks();
		mocks.draft = '';
		mocks.resolve.mockReturnValue({id: '7'});
		mocks.canEdit.mockReturnValue(false);
		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});

	it('shows the name and asks for nothing until it is used', async () => {
		const chip = await show();

		expect(chip.textContent).toBe('/hug');
		expect(mocks.ensureLoaded).not.toHaveBeenCalled();
	});

	it('puts the command in an empty message box and focuses it', async () => {
		const chip = await show();

		await act(async () => chip.click());

		expect(mocks.createDraft).toHaveBeenCalledWith('account', 'c', '/hug ');
		expect(mocks.dispatch).toHaveBeenCalledWith('FOCUS_TEXTAREA', {channelId: 'c'});
	});

	it('leaves a message box with text in it alone', async () => {
		mocks.draft = 'half a thought';
		const chip = await show();

		await act(async () => chip.click());

		expect(mocks.createDraft).not.toHaveBeenCalled();
	});

	it.each([
		['the name now runs another command', {id: 'other'}],
		['the command cannot be used here', null],
	])('does nothing when %s', async (_case, resolved) => {
		mocks.resolve.mockReturnValue(resolved);
		const chip = await show();

		await act(async () => chip.click());

		expect(mocks.createDraft).not.toHaveBeenCalled();
	});

	it('offers Edit on a right click to those who may edit it', async () => {
		mocks.canEdit.mockReturnValue(true);
		const chip = await show();

		await act(async () => {
			chip.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
		});

		expect(mocks.openFromEvent).toHaveBeenCalledTimes(1);
	});

	it("leaves a right click to the message's own menu for anyone else", async () => {
		const chip = await show();

		await act(async () => {
			chip.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
		});

		expect(mocks.openFromEvent).not.toHaveBeenCalled();
	});
});
