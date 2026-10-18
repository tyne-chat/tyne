// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the strings of the /persona slash command, kept here so that upstream's command files
// (devtools/hooks/useCommands.ts, devtools/utils/CommandUtils.ts) only gain the lines that use them.

import {msg} from '@lingui/core/macro';

export const PERSONA_COMMAND_DESCRIPTOR = msg({
	message: 'Switch the active persona',
	comment: 'Slash-command description for /persona',
});

export const PERSONA_COMMAND_OPTION_DESCRIPTOR = msg({
	message: 'The persona to select.',
	comment: 'Description of the persona option of the /persona slash command',
});

export const PERSONA_DESELECTED_DESCRIPTOR = msg({
	message: 'Persona deselected.',
	comment: 'System message after /persona without a name: messages are sent as the account again',
});

export const PERSONA_SELECTED_DESCRIPTOR = msg({
	message: 'Persona "{name}" selected.',
	comment: 'System message after /persona selects the persona {name}',
});
