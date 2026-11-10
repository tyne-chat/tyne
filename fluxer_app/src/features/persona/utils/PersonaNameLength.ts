// SPDX-License-Identifier: AGPL-3.0-or-later

/** The longest persona name the API takes, in UTF-16 code units (`String.length`), as it counts. */
export const PERSONA_NAME_MAX = 100;

const graphemeSegmenter =
	typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
		? new Intl.Segmenter(undefined, {granularity: 'grapheme'})
		: null;

/**
 * The longest start of `text` that fits in `max` UTF-16 code units, cut only between whole characters
 * (an emoji with a skin tone or a flag stays whole). For names that must leave room for a " (2)".
 */
export function fittingStart(text: string, max: number): string {
	const characters = graphemeSegmenter
		? Array.from(graphemeSegmenter.segment(text), ({segment}) => segment)
		: Array.from(text);
	let start = '';
	for (const character of characters) {
		if (start.length + character.length > max) break;
		start += character;
	}
	return start;
}
