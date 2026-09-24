// SPDX-License-Identifier: AGPL-3.0-or-later

import {$selectComposerNodeBoundary} from '@app/features/lexical/composer/composerOffsets';
import {ComposerBlockquoteLineNode} from '@app/features/lexical/composer/nodes/ComposerBlockquoteLineNode';
import {$isComposerBlockquoteMarkerNode} from '@app/features/lexical/composer/nodes/ComposerBlockquoteMarkerNode';
import {
	$createComposerCaretAnchorNode,
	$isComposerCaretAnchorNode,
} from '@app/features/lexical/composer/nodes/ComposerCaretAnchorNode';
import {$isComposerCustomEmojiNode} from '@app/features/lexical/composer/nodes/ComposerCustomEmojiNode';
import {$isComposerMentionNode} from '@app/features/lexical/composer/nodes/ComposerMentionNode';
import {$isComposerStandardEmojiNode} from '@app/features/lexical/composer/nodes/ComposerStandardEmojiNode';
import {$isComposerTimestampNode} from '@app/features/lexical/composer/nodes/ComposerTimestampNode';
import {mergeRegister} from '@lexical/utils';
import {
	$getNearestNodeFromDOMNode,
	$isDecoratorNode,
	$isLineBreakNode,
	CLICK_COMMAND,
	COMMAND_PRIORITY_LOW,
	type ElementNode,
	type LexicalEditor,
	type LexicalNode,
	ParagraphNode,
} from 'lexical';

export function $isLineLeadingDecorator(node: LexicalNode | null | undefined): boolean {
	if (node == null) {
		return false;
	}
	if (
		$isComposerStandardEmojiNode(node) ||
		$isComposerCustomEmojiNode(node) ||
		$isComposerMentionNode(node) ||
		$isComposerTimestampNode(node)
	) {
		return true;
	}
	return $isDecoratorNode(node) && node.isInline();
}

/**
 * Synchronizes ephemeral zero-width caret anchors for inline decorators at the start of a line.
 *
 * In Blink/WebKit layout engines, an atomic inline `contenteditable="false"` element following a
 * `<br>` has upstream line affinity toward the line break, causing the browser to drop the caret
 * rect (0,0,0,0) and skip the position immediately preceding the decorator during arrow-key
 * navigation and pointer clicks.
 *
 * Placing a zero-width `ComposerCaretAnchorNode` ('\uFEFF') immediately before the decorator
 * establishes an in-flow editable text run on that line, allowing native caret painting,
 * arrow-key stepping, click targeting, and typing before the decorator.
 */
export function $syncCaretAnchorsForBlock(block: ElementNode): void {
	const children = block.getChildren();
	for (let index = 0; index < children.length; index += 1) {
		const child = children[index]!;
		if ($isComposerCaretAnchorNode(child)) {
			const prev = child.getPreviousSibling();
			const next = child.getNextSibling();
			const isStartOfLine = prev == null || $isLineBreakNode(prev) || $isComposerBlockquoteMarkerNode(prev);
			const hasFollowingDecorator = $isLineLeadingDecorator(next);
			if (!isStartOfLine || !hasFollowingDecorator) {
				child.remove();
			}
		} else if ($isLineLeadingDecorator(child)) {
			const prev = child.getPreviousSibling();
			const isStartOfLine = prev == null || $isLineBreakNode(prev) || $isComposerBlockquoteMarkerNode(prev);
			if (isStartOfLine) {
				child.insertBefore($createComposerCaretAnchorNode());
			}
		}
	}
}

export function registerComposerCaretAnchors(editor: LexicalEditor): () => void {
	return mergeRegister(
		editor.registerNodeTransform(ParagraphNode, (node) => {
			$syncCaretAnchorsForBlock(node);
		}),
		editor.registerNodeTransform(ComposerBlockquoteLineNode, (node) => {
			$syncCaretAnchorsForBlock(node);
		}),
		editor.registerCommand(
			CLICK_COMMAND,
			(event: MouseEvent) => {
				const target = event.target instanceof Element ? event.target : null;
				const root = editor.getRootElement();
				if (target == null || root == null || !root.contains(target)) {
					return false;
				}
				const host = target.closest<HTMLElement>(
					'[data-lexical-composer-mention], [data-lexical-composer-emoji], [data-lexical-composer-standard-emoji], [data-lexical-composer-timestamp], [data-lexical-caret-anchor]',
				);
				if (host?.matches('[data-lexical-caret-anchor]')) {
					const next = host.nextElementSibling;
					const node = next != null ? $getNearestNodeFromDOMNode(next) : $getNearestNodeFromDOMNode(host);
					if (node != null) {
						$selectComposerNodeBoundary(node, 'before');
						return true;
					}
				}
				if (host?.previousElementSibling?.hasAttribute('data-lexical-caret-anchor')) {
					const rect = host.getBoundingClientRect();
					const threshold = Math.min(10, rect.width * 0.45);
					if (event.clientX <= rect.left + threshold) {
						const node = $getNearestNodeFromDOMNode(host);
						if (node != null) {
							$selectComposerNodeBoundary(node, 'before');
							return true;
						}
					}
				}
				if (host == null && (target === root || target.tagName === 'P' || target.tagName === 'DIV')) {
					const anchors = root.querySelectorAll<HTMLElement>('[data-lexical-caret-anchor]');
					for (let i = 0; i < anchors.length; i += 1) {
						const anchor = anchors[i]!;
						const dec = anchor.nextElementSibling as HTMLElement | null;
						if (dec == null) {
							continue;
						}
						const rect = dec.getBoundingClientRect();
						if (event.clientY >= rect.top - 6 && event.clientY <= rect.bottom + 6 && event.clientX < rect.left) {
							const node = $getNearestNodeFromDOMNode(dec);
							if (node != null) {
								$selectComposerNodeBoundary(node, 'before');
								return true;
							}
						}
					}
				}
				return false;
			},
			COMMAND_PRIORITY_LOW,
		),
	);
}
