// SPDX-License-Identifier: AGPL-3.0-or-later

import {msg} from '@lingui/core/macro';

// Strings of selecting many personas in settings (tyne-chat/tyne#542). The mobile app's fork
// catalogue has the same English; keep the two aligned.

export const FILTER_BY_VISIBILITY_DESCRIPTOR = msg({
	message: 'Filter by visibility',
	comment: 'Label of the row of chips above the persona list in settings (All, Public, Unlisted, Private).',
});
export const FILTER_ALL_DESCRIPTOR = msg({message: 'All', comment: 'Chip above the persona list: every persona.'});
export const FILTER_PUBLIC_DESCRIPTOR = msg({
	message: 'Public',
	comment: 'Chip above the persona list: public personas.',
});
export const FILTER_UNLISTED_DESCRIPTOR = msg({
	message: 'Unlisted',
	comment: 'Chip above the persona list: unlisted personas.',
});
export const FILTER_PRIVATE_DESCRIPTOR = msg({
	message: 'Private',
	comment: 'Chip above the persona list: private personas.',
});
export const SELECT_DESCRIPTOR = msg({
	message: 'Select',
	comment: 'Button above the persona list in settings that puts a checkbox on every persona.',
});
export const SELECT_ALL_DESCRIPTOR = msg({
	message: 'Select all',
	comment: 'Checkbox that selects every persona the search and chip show.',
});
export const SELECTED_COUNT_DESCRIPTOR = msg({
	message: '{count} selected',
	comment: 'How many personas are selected in settings. Preserve {count}.',
});
export const MAKE_PUBLIC_DESCRIPTOR = msg({
	message: 'Make public',
	comment: 'Button that makes the selected personas public.',
});
export const MAKE_UNLISTED_DESCRIPTOR = msg({
	message: 'Make unlisted',
	comment: 'Button that makes the selected personas unlisted.',
});
export const MAKE_PRIVATE_DESCRIPTOR = msg({
	message: 'Make private',
	comment: 'Button that makes the selected personas private.',
});
export const CONFIRM_PUBLIC_TITLE_DESCRIPTOR = msg({
	message: 'Make {count, plural, one {# persona} other {# personas}} public?',
	comment: 'Title of the confirmation before making the selected personas public.',
});
export const CONFIRM_PRIVATE_TITLE_DESCRIPTOR = msg({
	message: 'Make {count, plural, one {# persona} other {# personas}} private?',
	comment: 'Title of the confirmation before making the selected personas private.',
});
export const CONFIRM_DELETE_TITLE_DESCRIPTOR = msg({
	message: 'Delete {count, plural, one {# persona} other {# personas}}?',
	comment: 'Title of the confirmation before deleting the selected personas.',
});
export const CONFIRM_PUBLIC_BODY_DESCRIPTOR = msg({
	message:
		'Others will see them in your Personas list and can open their profiles. You can change this back at any time.',
	comment: 'Explains what making personas public does, in its confirmation.',
});
export const CONFIRM_PRIVATE_BODY_DESCRIPTOR = msg({
	message:
		'Their profiles will be hidden from others. Their names and avatars still show on their messages and reactions.',
	comment: 'Explains what making personas private does, in its confirmation.',
});
export const CONFIRM_DELETE_BODY_DESCRIPTOR = msg({
	message: 'You can restore deleted personas later in Settings › Personas, under Deleted personas.',
	comment:
		'Body of the confirmation before deleting the selected personas; its title asks the question. Deleted personas are listed under Deleted personas, the last section of Settings › Personas, with a Restore button.',
});
export const NOW_PUBLIC_DESCRIPTOR = msg({
	message: '{count, plural, one {# persona is} other {# personas are}} now public',
	comment: 'Toast after making personas public; it has an Undo button.',
});
export const NOW_UNLISTED_DESCRIPTOR = msg({
	message: '{count, plural, one {# persona is} other {# personas are}} now unlisted',
	comment: 'Toast after making personas unlisted; it has an Undo button.',
});
export const NOW_PRIVATE_DESCRIPTOR = msg({
	message: '{count, plural, one {# persona is} other {# personas are}} now private',
	comment: 'Toast after making personas private; it has an Undo button.',
});
export const DELETED_DESCRIPTOR = msg({
	message: '{count, plural, one {# persona} other {# personas}} deleted',
	comment: 'Toast after deleting personas.',
});
export const UNDO_DESCRIPTOR = msg({message: 'Undo', comment: 'Button in a toast that reverts the change it reports.'});
export const CHANGE_FAILED_DESCRIPTOR = msg({
	message: 'Couldn’t change the personas. Try again.',
	comment: 'Toast when changing or deleting several personas failed.',
});
export const NO_PERSONAS_HERE_DESCRIPTOR = msg({
	message: 'No personas here.',
	comment: 'Shown in the persona list when the chosen chip holds none.',
});
export const CHOOSE_PERSONAS_TO_FEATURE_DESCRIPTOR = msg({
	message: 'Choose personas to feature',
	comment:
		'Button in one’s own Personas list when none is public; opens persona settings to pick which to make public.',
});

// Who gets the selected personas in mention suggestions (tyne-chat/tyne#652).
export const MENTIONS_BUTTON_DESCRIPTOR = msg({
	message: 'Mentions',
	comment:
		'Button in the persona selection bar; opens a menu to choose who gets the selected personas in @ mention and search suggestions.',
});
export const MENTIONABLE_BY_EVERYONE_ITEM_DESCRIPTOR = msg({
	message: 'Allow mentions by everyone',
	comment: 'Menu item under the persona selection bar’s Mentions button.',
});
export const MENTIONABLE_BY_SELF_ITEM_DESCRIPTOR = msg({
	message: 'Allow mentions only by you',
	comment:
		'Menu item under the persona selection bar’s Mentions button: only your own account gets them in suggestions.',
});
export const MENTIONABLE_BY_NOBODY_ITEM_DESCRIPTOR = msg({
	message: 'Allow mentions by nobody',
	comment:
		'Menu item under the persona selection bar’s Mentions button: nobody gets them in suggestions, you included (for copies of other people’s personas).',
});
export const MENTIONABLE_BY_FOLLOW_ITEM_DESCRIPTOR = msg({
	message: 'Follow Visibility',
	comment:
		'Menu item under the persona selection bar’s Mentions button: drop the choice, so a private persona is only for you and any other for everyone.',
});
export const NOW_MENTIONABLE_BY_EVERYONE_DESCRIPTOR = msg({
	message: 'Mentions of {count, plural, one {# persona} other {# personas}} now allowed by everyone',
	comment: 'Toast after changing who gets the selected personas in mention suggestions; it has an Undo button.',
});
export const NOW_MENTIONABLE_BY_SELF_DESCRIPTOR = msg({
	message: 'Mentions of {count, plural, one {# persona} other {# personas}} now allowed only by you',
	comment: 'Toast after changing who gets the selected personas in mention suggestions; it has an Undo button.',
});
export const NOW_MENTIONABLE_BY_NOBODY_DESCRIPTOR = msg({
	message: 'Mentions of {count, plural, one {# persona} other {# personas}} now allowed by nobody',
	comment: 'Toast after changing who gets the selected personas in mention suggestions; it has an Undo button.',
});
export const NOW_MENTIONABLE_BY_FOLLOWING_DESCRIPTOR = msg({
	message: 'Mentions of {count, plural, one {# persona} other {# personas}} now follow Visibility',
	comment:
		'Toast after making the selected personas’ mention setting follow their visibility again; it has an Undo button.',
});
export const NOT_MENTIONABLE_ICON_DESCRIPTOR = msg({
	message: 'Nobody gets this persona in mention suggestions',
	comment: 'Tooltip and label of the small icon on a persona row in settings whose “Allow mentions by” is Nobody.',
});
