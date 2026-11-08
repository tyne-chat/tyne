// SPDX-License-Identifier: AGPL-3.0-or-later

import {msg} from '@lingui/core/macro';

// Strings of the Personas tab, sheet and pill (tyne-chat/tyne#189). The mobile app's fork catalogue
// has the same English; keep the two aligned.

export const PERSONAS_COUNT_DESCRIPTOR = msg({
	message: 'Personas ({count})',
	comment:
		'Label of the tab, pill, button and sheet title that list an account’s personas, like "Mutual friends ({count})". Preserve {count}.',
});
export const PERSONA_COUNT_LINE_DESCRIPTOR = msg({
	message: '{count, plural, one {# persona} other {# personas}}',
	comment: 'How many personas the Personas list shows.',
});
export const PERSONA_COUNT_FILTERED_DESCRIPTOR = msg({
	message: '{shown} of {total} personas',
	comment: 'How many personas match the search, out of all shown. Preserve {shown} and {total}.',
});
export const SEARCH_PERSONAS_OF_DESCRIPTOR = msg({
	message: 'Search {name}’s personas',
	comment: 'Placeholder of the search field in another account’s Personas list. {name} is the account’s name.',
});
export const SEARCH_OWN_PERSONAS_DESCRIPTOR = msg({
	message: 'Search your personas',
	comment: 'Placeholder of the search field in one’s own Personas list.',
});
export const SORT_PERSONAS_DESCRIPTOR = msg({message: 'Sort by', comment: 'Label of the Personas list’s sort menu.'});
export const SORT_PERSONAS_NAME_DESCRIPTOR = msg({
	message: 'Name (A–Z)',
	comment: 'Sort order of the Personas list: alphabetical by name.',
});
export const SORT_PERSONAS_USED_DESCRIPTOR = msg({
	message: 'Most used',
	comment: 'Sort order of the Personas list: the personas used most often first.',
});
export const SORT_PERSONAS_RECENT_DESCRIPTOR = msg({
	message: 'Recently used',
	comment: 'Sort order of one’s own Personas list: the personas used most recently first.',
});
export const VIEW_PERSONAS_AS_DESCRIPTOR = msg({
	message: 'View as',
	comment: 'Label of the switch between the Personas list’s layouts (Gallery, List, Avatars).',
});
export const PERSONA_VIEW_GALLERY_DESCRIPTOR = msg({
	message: 'Gallery',
	comment: 'Layout of the Personas list: cards with banner, avatar and bio.',
});
export const PERSONA_VIEW_LIST_DESCRIPTOR = msg({
	message: 'List',
	comment: 'Layout of the Personas list: one row per persona.',
});
export const PERSONA_VIEW_AVATARS_DESCRIPTOR = msg({
	message: 'Avatars',
	comment: 'Layout of the Personas list: large avatars with names only.',
});
export const NO_PERSONAS_MATCH_DESCRIPTOR = msg({
	message: 'No personas match your search.',
	comment: 'Shown in the Personas list when the search matches nothing.',
});
export const PERSONAS_LOAD_FAILED_DESCRIPTOR = msg({
	message: 'Couldn’t load personas.',
	comment: 'Shown in the Personas list when the request for them failed.',
});
export const OTHERS_SEE_PUBLIC_PERSONAS_DESCRIPTOR = msg({
	message: 'Others see {count, plural, one {# public persona} other {# public personas}}.',
	comment: 'Shown above one’s own Personas list: how many of one’s personas others can see there.',
});
export const SHOW_HIDDEN_PERSONAS_DESCRIPTOR = msg({
	message: 'Show unlisted and private',
	comment: 'Switch in one’s own Personas list that adds the personas others do not see there.',
});
export const MANAGE_PERSONAS_DESCRIPTOR = msg({
	message: 'Manage personas',
	comment: 'Button in one’s own Personas list that opens the persona settings.',
});
export const NO_PUBLIC_PERSONAS_DESCRIPTOR = msg({
	message: 'None of your personas are public yet. Others see a persona here once you set its visibility to Public.',
	comment: 'Shown in one’s own Personas list when none of them is public.',
});
export const PERSONA_NO_BIO_DESCRIPTOR = msg({
	message: 'No bio yet.',
	comment: 'Shown on a persona’s card in the Personas list when it has no bio.',
});
export const PERSONA_CREATED_DESCRIPTOR = msg({
	message: 'Created {date}',
	comment: 'When a persona was made, on its card in the Personas list. {date} is a date.',
});
export const PERSONA_SINCE_DESCRIPTOR = msg({
	message: 'Persona since',
	comment: 'Heading on a persona’s full profile, above the date it was made.',
});
export const PERSONA_VISIBILITY_UNLISTED_DESCRIPTOR = msg({
	message: 'Unlisted',
	comment: 'Badge on one’s own persona in the Personas list: others do not see it in the list.',
});
export const PERSONA_VISIBILITY_PRIVATE_DESCRIPTOR = msg({
	message: 'Private',
	comment: 'Badge on one’s own persona in the Personas list: its profile is hidden from others.',
});
export const ALL_PERSONAS_DESCRIPTOR = msg({
	message: 'All personas',
	comment: 'Back button on a persona’s full profile, back to the Personas list.',
});
export const PREVIOUS_PERSONA_DESCRIPTOR = msg({
	message: 'Previous persona',
	comment: 'Button on a persona’s full profile that shows the previous persona of the list.',
});
export const NEXT_PERSONA_DESCRIPTOR = msg({
	message: 'Next persona',
	comment: 'Button on a persona’s full profile that shows the next persona of the list.',
});
export const PERSONA_POSITION_DESCRIPTOR = msg({
	message: '{position} of {total}',
	comment: 'Which persona of the list is shown, as in "3 of 12". Preserve {position} and {total}.',
});
export const TAG_EXAMPLE_TEXT_DESCRIPTOR = msg({
	message: 'text',
	comment: 'Stands for the message text between a tag pair\'s prefix and suffix, as in "a:text"',
});
export const NO_PUBLIC_PERSONAS_OTHERS_DESCRIPTOR = msg({
	message: 'No public personas.',
	comment: 'Shown in another account’s Personas list when it lists none.',
});
