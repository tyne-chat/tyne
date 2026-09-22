// SPDX-License-Identifier: AGPL-3.0-or-later

import {ComposerAtomicPresentation} from '@app/features/lexical/composer/nodes/ComposerAtomicPresentation';
import {ComposerTimestampPill} from '@app/features/lexical/composer/nodes/ComposerTimestampPill';
import {
	type ComposerTimestampFormat,
	getTimestampDisplay,
	getTimestampWire,
	normalizeTimestampFormat,
} from '@app/features/lexical/composer/nodes/ComposerTimestampUtils';
import {
	DecoratorNode,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from 'lexical';
import type {JSX} from 'react';

export type SerializedComposerTimestampNode = Spread<
	{
		epoch: number;
		format: ComposerTimestampFormat;
		wire?: string;
		spoiler: boolean;
	},
	SerializedLexicalNode
>;

export class ComposerTimestampNode extends DecoratorNode<JSX.Element> {
	__epoch: number;
	__format: ComposerTimestampFormat;
	__spoiler: boolean;

	static override getType(): string {
		return 'composer-timestamp';
	}

	static override clone(node: ComposerTimestampNode): ComposerTimestampNode {
		return new ComposerTimestampNode(node.__epoch, node.__format, node.__spoiler, node.__key);
	}

	static override importJSON(serializedNode: SerializedComposerTimestampNode): ComposerTimestampNode {
		return $createComposerTimestampNode(
			serializedNode.epoch,
			serializedNode.format,
			serializedNode.spoiler == null ? false : serializedNode.spoiler,
		);
	}

	constructor(epoch: number, format: ComposerTimestampFormat = 'combo', spoiler = false, key?: NodeKey) {
		super(key);
		this.__epoch = epoch;
		this.__format = format;
		this.__spoiler = spoiler;
	}

	override exportJSON(): SerializedComposerTimestampNode {
		return {
			...super.exportJSON(),
			epoch: this.__epoch,
			format: this.__format,
			wire: this.getWireText(),
			spoiler: this.__spoiler,
		};
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const span = document.createElement('span');
		const className = (config.theme as Record<string, string | undefined>).composerTimestamp;
		if (typeof className === 'string') {
			span.className = className;
		}
		span.setAttribute('data-lexical-composer-timestamp', 'true');
		span.setAttribute('data-epoch', String(this.__epoch));
		span.setAttribute('data-format', this.__format);
		span.spellcheck = false;
		return span;
	}

	override updateDOM(prevNode: ComposerTimestampNode, dom: HTMLElement): boolean {
		if (prevNode.__epoch !== this.__epoch) {
			dom.setAttribute('data-epoch', String(this.__epoch));
		}
		if (prevNode.__format !== this.__format) {
			dom.setAttribute('data-format', this.__format);
		}
		return false;
	}

	override exportDOM(): DOMExportOutput {
		const element = document.createElement('span');
		element.setAttribute('data-lexical-composer-timestamp', 'true');
		element.textContent = this.getWireText();
		return {element};
	}

	override isInline(): true {
		return true;
	}

	override isKeyboardSelectable(): false {
		return false;
	}

	override getTextContent(): string {
		return getTimestampDisplay(this.__epoch, this.__format);
	}

	getWireText(): string {
		return getTimestampWire(this.__epoch, this.__format);
	}

	getSegmentId(): string {
		return `timestamp:${this.__epoch}:${this.__format}`;
	}

	getEpoch(): number {
		return this.getLatest().__epoch;
	}

	setEpoch(epoch: number): this {
		this.getWritable().__epoch = epoch;
		return this;
	}

	getFormat(): ComposerTimestampFormat {
		return this.getLatest().__format;
	}

	setFormat(format: ComposerTimestampFormat): this {
		this.getWritable().__format = format;
		return this;
	}

	isSpoiler(): boolean {
		return this.getLatest().__spoiler;
	}

	setSpoiler(spoiler: boolean): this {
		this.getWritable().__spoiler = spoiler;
		return this;
	}

	override decorate(): JSX.Element {
		return (
			<ComposerAtomicPresentation
				spoiler={this.__spoiler}
				data-flx="lexical.composer.nodes.composer-timestamp-node.composer-atomic-presentation"
			>
				<ComposerTimestampPill
					nodeKey={this.getKey()}
					epoch={this.__epoch}
					format={this.__format}
					wire={this.getWireText()}
					data-flx="lexical.composer.nodes.composer-timestamp-node.composer-timestamp-pill"
				/>
			</ComposerAtomicPresentation>
		);
	}
}

export function $createComposerTimestampNode(
	epoch: number,
	format: string = 'combo',
	spoiler = false,
): ComposerTimestampNode {
	return new ComposerTimestampNode(epoch, normalizeTimestampFormat(format), spoiler);
}

export function $isComposerTimestampNode(node: LexicalNode | null | undefined): node is ComposerTimestampNode {
	return node instanceof ComposerTimestampNode;
}
