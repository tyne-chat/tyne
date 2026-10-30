// SPDX-License-Identifier: AGPL-3.0-or-later

import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	can: vi.fn(),
	findById: vi.fn(),
	requestEditing: vi.fn(),
	navigateToTab: vi.fn(),
	push: vi.fn(),
	store: {loaded: true},
}));

vi.mock('@app/features/app/components/dialogs/LoadableSettingsModals', () => ({GuildSettingsModal: () => null}));
vi.mock('@app/features/guild/state/GuildSettingsModal', () => ({default: {navigateToTab: mocks.navigateToTab}}));
vi.mock('@app/features/guild_commands/state/GuildCommandsStore', () => ({
	default: {
		get loaded() {
			return mocks.store.loaded;
		},
		findById: mocks.findById,
		requestEditing: mocks.requestEditing,
	},
}));
vi.mock('@app/features/permissions/state/Permission', () => ({default: {can: mocks.can}}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	modal: (render: unknown) => render,
	pushAfterBottomSheetClose: mocks.push,
}));
vi.mock('@app/features/user/state/Users', () => ({default: {getCurrentUser: () => ({id: 'me'})}}));

import {
	canEditGuildCommand,
	openGuildCommandInSettings,
} from '@app/features/guild_commands/commands/OpenGuildCommandSettings';

const HUG = {id: '7', guild_id: 'g', name: 'hug'};

function allow(...permissions: Array<bigint>) {
	mocks.can.mockImplementation((permission: bigint) => permissions.includes(permission));
}

describe('editing a command from its chip', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.store.loaded = true;
		mocks.findById.mockReturnValue({id: '7', creator_id: 'someone-else'});
		mocks.navigateToTab.mockReturnValue(false);
	});

	it("lets Manage Commands edit anyone's command", () => {
		allow(Permissions.MANAGE_COMMANDS);
		expect(canEditGuildCommand(HUG)).toBe(true);
	});

	it("lets Create Commands edit only one's own", () => {
		allow(Permissions.CREATE_COMMANDS);
		expect(canEditGuildCommand(HUG)).toBe(false);
		mocks.findById.mockReturnValue({id: '7', creator_id: 'me'});
		expect(canEditGuildCommand(HUG)).toBe(true);
	});

	it('refuses without either permission, and for a deleted command', () => {
		allow();
		expect(canEditGuildCommand(HUG)).toBe(false);
		allow(Permissions.MANAGE_COMMANDS);
		mocks.findById.mockReturnValue(null);
		expect(canEditGuildCommand(HUG)).toBe(false);
	});

	it('still offers it before the list has loaded, as the tab then decides', () => {
		mocks.store.loaded = false;
		mocks.findById.mockReturnValue(null);
		allow(Permissions.CREATE_COMMANDS);
		expect(canEditGuildCommand(HUG)).toBe(true);
	});

	it('opens community settings on the Commands tab, asking for that command', () => {
		const onClose = vi.fn();
		openGuildCommandInSettings(HUG, onClose);
		expect(mocks.requestEditing).toHaveBeenCalledWith('g', '7');
		expect(mocks.push).toHaveBeenCalledTimes(1);
		expect(mocks.push.mock.calls[0]![0]).toBe(onClose);
	});

	it('moves settings that are already open instead of opening them twice', () => {
		mocks.navigateToTab.mockReturnValue(true);
		const onClose = vi.fn();
		openGuildCommandInSettings(HUG, onClose);
		expect(mocks.navigateToTab).toHaveBeenCalledWith('g', 'commands');
		expect(mocks.requestEditing).toHaveBeenCalledWith('g', '7');
		expect(mocks.push).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
