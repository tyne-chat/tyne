// SPDX-License-Identifier: AGPL-3.0-or-later

import type {AutocompleteOption} from '@app/features/channel/components/AutocompleteTypes';
import {getComposerAutocompleteReplacementStart} from '@app/features/lexical/composer/ComposerAutocompleteInsertion';
import type {ComposerHandle} from '@app/features/lexical/composer/ComposerHandle';
import {isAutocompleteMediaOption} from '@app/features/messaging/utils/AutocompleteMediaOptions';
import {isDraftUsedUpByExpression} from '@app/features/messaging/utils/ExpressionDraftPersona';
import {detectAutocompleteTrigger} from '@app/features/messaging/utils/SlashCommandUtils';
import type {PersonaStoreClass} from '@app/features/persona/state/PersonaStore';

/**
 * Fork: stickers, saved media and GIFs in the autocomplete only while the composer holds nothing
 * else (tyne-chat/tyne#770).
 *
 * Picking one sends it as a message of its own at once. Upstream then empties the composer, which
 * deletes whatever was typed; sending the text along would surprise as much. So these entries are
 * listed, and can be picked, only when the text outside the query being typed (`:stic`,
 * `/gif cats`) is blank, or is nothing but a persona tag that the send uses up (tyne-chat/tyne#122,
 * `isDraftUsedUpByExpression`). Emoji and every other entry are left alone. Discord, for the same
 * reason, does not list stickers after `:` at all.
 */

type ComposerTextReader = Pick<ComposerHandle, 'getDisplayValue' | 'getWireValue' | 'getTextUpToCursor'>;
type PersonaPreview = Pick<PersonaStoreClass, 'previewOutgoingContent'>;

/**
 * The composer's message text without the autocomplete query at the caret, as it would be sent.
 * Offsets are the display's (`getTextUpToCursor` keeps pills' lengths); the wire is used where the
 * text from the query to the end is plain, so a tag holding an emoji still reads as a tag.
 */
export function composerTextOutsideAutocompleteQuery(reader: ComposerTextReader): string {
	const display = reader.getDisplayValue();
	const textUpToCursor = reader.getTextUpToCursor();
	const trigger = detectAutocompleteTrigger(textUpToCursor);
	if (trigger == null) {
		return reader.getWireValue();
	}
	const caret = textUpToCursor.length;
	const start = Math.min(getComposerAutocompleteReplacementStart(textUpToCursor, trigger.type, trigger.match), caret);
	const tail = display.slice(start);
	const afterCaret = display.slice(caret);
	const wire = reader.getWireValue();
	if (wire.endsWith(tail)) {
		return wire.slice(0, wire.length - tail.length) + afterCaret;
	}
	return display.slice(0, start) + afterCaret;
}

/** Whether a sticker, saved media or GIF may be offered and picked with the composer as it is now. */
export function composerAllowsAutocompleteMedia(
	reader: ComposerTextReader | null,
	channelId: string | null,
	store?: PersonaPreview,
): boolean {
	if (reader == null) {
		return false;
	}
	const otherText = composerTextOutsideAutocompleteQuery(reader);
	if (otherText.trim() === '') {
		return true;
	}
	return isDraftUsedUpByExpression(channelId, otherText, store);
}

/** Drops stickers, saved media and GIFs from `options` unless the composer holds nothing else. */
export function filterAutocompleteMediaForComposer(
	options: Array<AutocompleteOption>,
	reader: ComposerTextReader | null,
	channelId: string | null,
	store?: PersonaPreview,
): Array<AutocompleteOption> {
	if (!options.some(isAutocompleteMediaOption)) {
		return options;
	}
	if (composerAllowsAutocompleteMedia(reader, channelId, store)) {
		return options;
	}
	return options.filter((option) => !isAutocompleteMediaOption(option));
}

/**
 * Whether picking `option` may go ahead. The list is built when the text up to the caret changes,
 * so text added after the caret since then is only seen here: the pick then does nothing.
 */
export function canPickAutocompleteOptionInComposer(
	option: AutocompleteOption,
	reader: ComposerTextReader,
	channelId: string | null,
	store?: PersonaPreview,
): boolean {
	return !isAutocompleteMediaOption(option) || composerAllowsAutocompleteMedia(reader, channelId, store);
}
