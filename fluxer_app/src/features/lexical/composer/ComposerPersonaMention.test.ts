// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	$hydrateComposerFromDraft,
	$projectComposer,
	isValidComposerSegment,
} from '@app/features/lexical/composer/ComposerSerialization';
import {$replaceComposerRange} from '@app/features/lexical/composer/composerOffsets';
import {
	$createComposerMentionNode,
	ComposerMentionNode,
} from '@app/features/lexical/composer/nodes/ComposerMentionNode';
import type {MentionSegment} from '@app/features/messaging/utils/TextareaSegmentManager';
import {createEditor} from 'lexical';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/lexical/composer/nodes/ComposerMentionPill', () => ({ComposerMentionPill: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerCustomEmoji', () => ({ComposerCustomEmoji: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerStandardEmoji', () => ({ComposerStandardEmoji: () => null}));
vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));

describe('ComposerPersonaMention', () => {
	it('extracts personaId from wire and formats wire and display correctly', () => {
		const editor = createEditor({
			namespace: 'test',
			nodes: [ComposerMentionNode],
		});
		editor.update(() => {
			const node = $createComposerMentionNode(
				'user',
				'123456789012345678',
				'@Bob the Fox',
				'<@123456789012345678:bob_the_fox_id>',
			);
			expect(node.getPersonaId()).toBe('bob_the_fox_id');
			expect(node.getTextContent()).toBe('@Bob the Fox');
			expect(node.getWireText()).toBe('<@123456789012345678:bob_the_fox_id>');
			expect(node.getMentionId()).toBe('123456789012345678');
		});
	});

	it('returns null for personaId on standard user mention wire', () => {
		const editor = createEditor({
			namespace: 'test',
			nodes: [ComposerMentionNode],
		});
		editor.update(() => {
			const node = $createComposerMentionNode('user', '123456789012345678', '@Alice', '<@123456789012345678>');
			expect(node.getPersonaId()).toBeNull();
			expect(node.getTextContent()).toBe('@Alice');
			expect(node.getWireText()).toBe('<@123456789012345678>');
		});
	});

	it('projects persona mention to correct wire format and valid segment', () => {
		const editor = createEditor({
			namespace: 'persona-mention-test',
			nodes: [ComposerMentionNode],
			onError: (err) => {
				throw err;
			},
		});

		editor.update(() => {
			$replaceComposerRange(
				0,
				0,
				{
					kind: 'mention',
					mentionType: 'user',
					id: '123456789012345678',
					display: '@Bob the Fox',
					wire: '<@123456789012345678:bob_the_fox_id>',
				},
				{leading: false, trailing: true},
			);

			const projection = $projectComposer();
			expect(projection.display).toBe('@Bob the Fox ');
			expect(projection.wire).toBe('<@123456789012345678:bob_the_fox_id> ');
			expect(projection.segments).toHaveLength(1);

			const seg = projection.segments[0]!;
			expect(seg.type).toBe('user');
			expect(seg.id).toBe('123456789012345678');
			expect(seg.displayText).toBe('@Bob the Fox');
			expect(seg.actualText).toBe('<@123456789012345678:bob_the_fox_id>');
			expect(isValidComposerSegment(projection.display, seg)).toBe(true);
		});
	});

	it('hydrates persona mention from draft correctly', () => {
		const editor = createEditor({
			namespace: 'persona-mention-draft-test',
			nodes: [ComposerMentionNode],
			onError: (err) => {
				throw err;
			},
		});

		const segment: MentionSegment = {
			type: 'user',
			id: '123456789012345678',
			displayText: '@Bob the Fox',
			actualText: '<@123456789012345678:bob_the_fox_id>',
			start: 0,
			end: 12,
		};

		editor.update(() => {
			$hydrateComposerFromDraft('@Bob the Fox', [segment]);
			const projection = $projectComposer();
			expect(projection.display).toBe('@Bob the Fox');
			expect(projection.wire).toBe('<@123456789012345678:bob_the_fox_id>');
		});
	});
});
