// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MentionSegment} from '@app/features/messaging/utils/TextareaSegmentManager';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';

interface ConvertedMarkdown {
	displayText: string;
	segments: Array<{
		start: number;
		displayText: string;
		actualText: string;
		type: MentionSegment['type'];
		id: string;
	}>;
}

// The persona mention's form, as `SLOT_USER_WIRE_RE` in the editor accepts it.
const PERSONA_MENTION_PATTERN = /<@!?(\d+):([a-zA-Z0-9_-]+)>/g;

/**
 * Fork: upstream's `convertMarkdownToSegments` matches `<@userId>` only, so a persona mention
 * (`<@userId:personaId>`) stayed raw text when a message was opened for editing (tyne-chat/tyne#99).
 * Makes each one a user segment that keeps the persona in its wire and shows `@PersonaName`, which
 * the editor turns into a persona pill. A persona this client does not know shows its ID, as a
 * rendered message does, until the pill finds its name.
 */
export function withPersonaMentionSegments(converted: ConvertedMarkdown): ConvertedMarkdown {
	const source = converted.displayText;
	const mentions: ConvertedMarkdown['segments'] = [];
	for (const match of source.matchAll(PERSONA_MENTION_PATTERN)) {
		const start = match.index;
		const end = start + match[0].length;
		if (
			converted.segments.some((segment) => start < segment.start + segment.displayText.length && segment.start < end)
		) {
			continue;
		}
		const personaId = match[2]!;
		const name = PersonaStore.getKnownPersona(personaId)?.name || personaId;
		mentions.push({start, displayText: `@${name}`, actualText: match[0], type: 'user', id: match[1]!});
	}
	if (mentions.length === 0) return converted;

	const ordered = [
		...converted.segments.map((segment) => ({segment, replaces: false})),
		...mentions.map((segment) => ({segment, replaces: true})),
	].sort((a, b) => a.segment.start - b.segment.start);
	let displayText = '';
	let copiedUpTo = 0;
	const segments: ConvertedMarkdown['segments'] = [];
	for (const {segment, replaces} of ordered) {
		displayText += source.slice(copiedUpTo, segment.start);
		segments.push({...segment, start: displayText.length});
		displayText += segment.displayText;
		copiedUpTo = segment.start + (replaces ? segment.actualText.length : segment.displayText.length);
	}
	displayText += source.slice(copiedUpTo);
	return {displayText, segments};
}
