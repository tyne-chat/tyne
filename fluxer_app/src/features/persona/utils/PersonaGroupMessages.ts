// SPDX-License-Identifier: AGPL-3.0-or-later

import {msg} from '@lingui/core/macro';

// The words of persona groups (tyne-chat/tyne#829). The mobile app has the same English strings in
// its fork catalogue; keep the two in step. The ones upstream also has (for group DMs) take the
// context 'persona-group': upstream's translations say "group chat" in some languages and are
// missing in others.

export const NEW_GROUP_DESCRIPTOR = msg({
	message: 'New group',
	context: 'persona-group',
	comment: 'Button in persona settings that makes a group of personas, and the title of its dialog',
});
export const NEW_GROUP_MENU_DESCRIPTOR = msg({
	message: 'New group…',
	comment: 'Menu item that makes a new group of personas, asking its name first',
});
export const GROUP_NAME_DESCRIPTOR = msg({
	message: 'Group name',
	context: 'persona-group',
	comment: 'Label of the name field when making or renaming a group of personas',
});
export const CREATE_GROUP_DESCRIPTOR = msg({
	message: 'Create group',
	comment: 'Button that makes the group of personas named in the dialog',
});
export const RENAME_GROUP_DESCRIPTOR = msg({
	message: 'Rename group',
	comment: 'Menu item and dialog title for giving a group of personas a new name',
});
export const DELETE_GROUP_DESCRIPTOR = msg({
	message: 'Delete group',
	comment: 'Menu item, dialog title and button for deleting a group of personas; the personas stay',
});
export const DELETE_GROUP_BODY_DESCRIPTOR = msg({
	message: 'Delete the group “{name}”? The personas in it are kept.',
	comment: 'Asks before deleting a group of personas. Preserve {name}, the group’s name.',
});
export const NOT_IN_A_GROUP_DESCRIPTOR = msg({
	message: 'Not in a group',
	comment: 'Heading of the section of the persona list holding the personas that are in no group',
});
export const GROUPS_DESCRIPTOR = msg({
	message: 'Groups',
	comment: 'Heading of the persona editor’s list of the groups the persona is in',
});
export const ADD_TO_GROUP_DESCRIPTOR = msg({
	message: 'Add to group',
	context: 'persona-group',
	comment: 'Button that puts the selected personas in a group chosen from a menu',
});
export const REMOVE_FROM_GROUP_DESCRIPTOR = msg({
	message: 'Remove from group',
	context: 'persona-group',
	comment: 'Button that takes the selected personas out of a group chosen from a menu',
});
export const SELECT_GROUP_MEMBERS_DESCRIPTOR = msg({
	message: 'Select the personas in it',
	comment: 'Menu item of a group of personas that selects every persona in the group',
});
export const GROUP_OPTIONS_DESCRIPTOR = msg({
	message: 'Options for {name}',
	comment: 'Accessible name of the button that opens the menu of a group of personas. Preserve {name}.',
});
export const SELECT_GROUP_DESCRIPTOR = msg({
	message: 'Select everyone in {name}',
	comment: 'Accessible name of the checkbox that selects every persona in a group. Preserve {name}.',
});
export const GROUPS_CHANGE_FAILED_DESCRIPTOR = msg({
	message: 'Couldn’t change the groups. Try again.',
	comment: 'Toast when making, renaming or deleting a group of personas, or changing who is in it, failed',
});
