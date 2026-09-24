// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	$captureSelectionOffsets,
	$getComposerNodeDisplayStart,
	$selectComposerRange,
} from '@app/features/lexical/composer/composerOffsets';
import {$isComposerCaretAnchorNode} from '@app/features/lexical/composer/nodes/ComposerCaretAnchorNode';
import {$createComposerTimestampNode} from '@app/features/lexical/composer/nodes/ComposerTimestampNode';
import {
	type ComposerTimestampFormat,
	normalizeTimestampFormat,
	TIMESTAMP_COMBO_REGEX,
	TIMESTAMP_SINGLE_REGEX,
} from '@app/features/lexical/composer/nodes/ComposerTimestampUtils';
import {$isSyntaxMarkerNode} from '@app/features/lexical/composer/nodes/SyntaxMarkerNode';
import {type LexicalEditor, TextNode} from 'lexical';

export function registerComposerTimestampTransform(editor: LexicalEditor): () => void {
	return editor.registerNodeTransform(TextNode, (node) => {
		if (!editor.isComposing()) {
			$convertTimestampTokens(node);
		}
	});
}

interface TimestampTokenMatch {
	start: number;
	end: number;
	epoch: number;
	format: ComposerTimestampFormat;
}

function findNextTimestampToken(text: string): TimestampTokenMatch | null {
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '<' || text[i + 1] !== 't' || text[i + 2] !== ':') {
			continue;
		}
		// Skip escaped sequences like \<t:...>
		if (i > 0 && text[i - 1] === '\\') {
			continue;
		}
		const sub = text.slice(i);
		// Check combo first
		const comboMatch = TIMESTAMP_COMBO_REGEX.exec(sub);
		if (comboMatch != null && comboMatch[1] != null) {
			const epoch = Number.parseInt(comboMatch[1], 10);
			if (Number.isFinite(epoch)) {
				return {
					start: i,
					end: i + comboMatch[0].length,
					epoch,
					format: 'combo',
				};
			}
		}
		// Check single tag
		const singleMatch = TIMESTAMP_SINGLE_REGEX.exec(sub);
		if (singleMatch != null && singleMatch[1] != null) {
			const epoch = Number.parseInt(singleMatch[1], 10);
			if (Number.isFinite(epoch)) {
				return {
					start: i,
					end: i + singleMatch[0].length,
					epoch,
					format: normalizeTimestampFormat(singleMatch[2]),
				};
			}
		}
	}
	return null;
}

function $convertTimestampTokens(node: TextNode): void {
	if (!node.isAttached() || $isComposerCaretAnchorNode(node) || $isSyntaxMarkerNode(node) || node.hasFormat('code')) {
		return;
	}
	const text = node.getTextContent();
	const match = findNextTimestampToken(text);
	if (match == null) {
		return;
	}

	const selection = $captureSelectionOffsets();
	const nodeDisplayStart = $getComposerNodeDisplayStart(node);
	const timestampNode = $createComposerTimestampNode(match.epoch, match.format);

	const segments = node.splitText(match.start, match.end);
	const target = segments[match.start > 0 ? 1 : 0];
	if (target == null) {
		return;
	}
	target.replace(timestampNode);

	if (selection != null) {
		const newLen = timestampNode.getTextContent().length;
		const adjusted = $adjustEmbedCaret(selection, nodeDisplayStart, match.start, match.end, newLen);
		$selectComposerRange(adjusted.anchor, adjusted.focus);
	}
}

function $adjustEmbedCaret(
	selection: {anchor: number; focus: number},
	nodeDisplayStart: number | null,
	tokenStart: number,
	tokenEnd: number,
	newLen: number,
): {anchor: number; focus: number} {
	if (nodeDisplayStart == null) {
		return selection;
	}
	const start = nodeDisplayStart + tokenStart;
	const end = nodeDisplayStart + tokenEnd;
	const delta = newLen - (tokenEnd - tokenStart);
	const adjust = (offset: number): number => {
		if (offset <= start) {
			return offset;
		}
		if (offset >= end) {
			return offset + delta;
		}
		return start + newLen;
	};
	return {anchor: adjust(selection.anchor), focus: adjust(selection.focus)};
}
