// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	$applyNodeReplacement,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedTextNode,
	TextNode,
} from 'lexical';

export const CARET_ANCHOR_CHAR = '\uFEFF';

export class ComposerCaretAnchorNode extends TextNode {
	static override getType(): string {
		return 'composer-caret-anchor';
	}

	static override clone(node: ComposerCaretAnchorNode): ComposerCaretAnchorNode {
		const cloned = new ComposerCaretAnchorNode(node.__key);
		cloned.__mode = node.__mode;
		return cloned;
	}

	static override importJSON(): ComposerCaretAnchorNode {
		return $createComposerCaretAnchorNode();
	}

	constructor(key?: NodeKey) {
		super(CARET_ANCHOR_CHAR, key);
	}

	override exportJSON(): SerializedTextNode {
		return {
			...super.exportJSON(),
			type: ComposerCaretAnchorNode.getType(),
			text: CARET_ANCHOR_CHAR,
		};
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const dom = super.createDOM(config);
		dom.setAttribute('data-lexical-caret-anchor', 'true');
		return dom;
	}

	override getTextContent(): string {
		return '';
	}

	override getTextContentSize(): number {
		return 0;
	}

	override canInsertTextBefore(): false {
		return false;
	}

	override canInsertTextAfter(): false {
		return false;
	}
}

export function $createComposerCaretAnchorNode(): ComposerCaretAnchorNode {
	return $applyNodeReplacement(new ComposerCaretAnchorNode()).setMode('token');
}

export function $isComposerCaretAnchorNode(node: LexicalNode | null | undefined): node is ComposerCaretAnchorNode {
	return node instanceof ComposerCaretAnchorNode;
}
