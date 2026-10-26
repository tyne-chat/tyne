// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {createEditor} from 'lexical';
import {runInAction} from 'mobx';
import {beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@app/features/lexical/composer/nodes/ComposerMentionPill', () => ({ComposerMentionPill: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerCustomEmoji', () => ({ComposerCustomEmoji: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerStandardEmoji', () => ({ComposerStandardEmoji: () => null}));
vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import Emoji from '@app/features/emoji/state/Emoji';
import {
	$hydrateComposerFromDraft,
	$projectComposer,
	isValidComposerSegment,
} from '@app/features/lexical/composer/ComposerSerialization';
import {ComposerCustomEmojiNode} from '@app/features/lexical/composer/nodes/ComposerCustomEmojiNode';
import {ComposerMentionNode} from '@app/features/lexical/composer/nodes/ComposerMentionNode';
import {convertMarkdownToSegments} from '@app/features/messaging/utils/MarkdownToSegmentUtils';
import {TextareaSegmentManager} from '@app/features/messaging/utils/TextareaSegmentManager';
import {addTestPersona} from '@app/features/persona/state/__fixtures__/PersonaTestFixtures';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';

// tyne-chat/tyne#99: editing a message showed its persona mentions as `<@userId:personaId>`.
describe('persona mentions in a message opened for editing', () => {
	const guildId = '1546374477426720768';
	const userId = '1530000000000000001';
	const emojiId = '1550000000000000001';
	let personaId: string;

	beforeEach(() => {
		Emoji.hydrateFromSnapshot([{guildId, emojis: [{id: emojiId, name: 'blob', animated: false}] as never}]);
		runInAction(() => PersonaStore.setPersonas([]));
		personaId = runInAction(() => addTestPersona(PersonaStore, {name: 'Bob the Fox'})).id;
	});

	const emoji = `<:blob:${emojiId}>`;

	it('shows a persona mention as its name, keeping the mention in the segment', () => {
		const mention = `<@${userId}:${personaId}>`;
		const converted = convertMarkdownToSegments(`${emoji} hi ${mention}, see ${emoji}`, guildId);

		expect(converted.displayText).toBe(':blob: hi @Bob the Fox, see :blob:');
		expect(
			converted.segments.map(({type, displayText, actualText, id}) => ({type, displayText, actualText, id})),
		).toEqual([
			{type: 'emoji', displayText: ':blob:', actualText: emoji, id: emojiId},
			{type: 'user', displayText: '@Bob the Fox', actualText: mention, id: userId},
			{type: 'emoji', displayText: ':blob:', actualText: emoji, id: emojiId},
		]);
		for (const segment of converted.segments) {
			const end = segment.start + segment.displayText.length;
			expect(converted.displayText.slice(segment.start, end)).toBe(segment.displayText);
		}
	});

	it('shows the ID of a persona this client does not know', () => {
		const converted = convertMarkdownToSegments(`<@${userId}:unknown_persona>`, guildId);
		expect(converted.displayText).toBe('@unknown_persona');
		expect(converted.segments).toHaveLength(1);
	});

	it('saves the message unchanged when the edit changes nothing', () => {
		const content = `${emoji} <@${userId}:${personaId}> and <@${userId}:unknown_persona> <@!${userId}:${personaId}>`;
		const manager = new TextareaSegmentManager();
		const converted = convertMarkdownToSegments(content, guildId);
		const display = converted.displayText;
		for (const segment of converted.segments) {
			manager.insertSegment(
				display.slice(0, segment.start + segment.displayText.length),
				segment.start,
				segment.displayText,
				segment.actualText,
				segment.type,
				segment.id,
			);
		}
		const segments = manager.getSegmentsCopy();
		expect(segments.every((segment) => isValidComposerSegment(display, segment))).toBe(true);

		const editor = createEditor({
			namespace: 'persona-mention-edit-test',
			nodes: [ComposerMentionNode, ComposerCustomEmojiNode],
			onError: (error) => {
				throw error;
			},
		});
		editor.update(
			() => {
				$hydrateComposerFromDraft(display, segments);
				const projection = $projectComposer();
				expect(projection.display).toBe(display);
				expect(projection.wire).toBe(content);
			},
			{discrete: true},
		);
	});
});
