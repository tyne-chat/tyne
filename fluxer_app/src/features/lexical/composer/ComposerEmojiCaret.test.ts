// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {$convertEmojiShortcode} from '@app/features/lexical/composer/ComposerEmojiShortcode';
import {registerComposerMarkdownHighlight} from '@app/features/lexical/composer/ComposerMarkdownHighlight';
import {$projectComposer} from '@app/features/lexical/composer/ComposerSerialization';
import {$captureSelectionOffsets, $selectComposerOffset} from '@app/features/lexical/composer/composerOffsets';
import {
	$createComposerBlockquoteLineNode,
	ComposerBlockquoteLineNode,
} from '@app/features/lexical/composer/nodes/ComposerBlockquoteLineNode';
import {
	$createComposerBlockquoteMarkerNode,
	ComposerBlockquoteMarkerNode,
} from '@app/features/lexical/composer/nodes/ComposerBlockquoteMarkerNode';
import {
	$isComposerCaretAnchorNode,
	ComposerCaretAnchorNode,
} from '@app/features/lexical/composer/nodes/ComposerCaretAnchorNode';
import {ComposerCommandNode} from '@app/features/lexical/composer/nodes/ComposerCommandNode';
import {ComposerCustomEmojiNode} from '@app/features/lexical/composer/nodes/ComposerCustomEmojiNode';
import {ComposerMentionNode} from '@app/features/lexical/composer/nodes/ComposerMentionNode';
import {ComposerPlainSegmentNode} from '@app/features/lexical/composer/nodes/ComposerPlainSegmentNode';
import {
	$createComposerStandardEmojiNode,
	ComposerStandardEmojiNode,
} from '@app/features/lexical/composer/nodes/ComposerStandardEmojiNode';
import {SlashOptionalHintNode} from '@app/features/lexical/composer/nodes/SlashOptionalHintNode';
import {SlashSeparatorNode} from '@app/features/lexical/composer/nodes/SlashSeparatorNode';
import {SlashSlotNode} from '@app/features/lexical/composer/nodes/SlashSlotNode';
import {SlashSlotPlaceholderNode} from '@app/features/lexical/composer/nodes/SlashSlotPlaceholderNode';
import {SyntaxMarkerNode} from '@app/features/lexical/composer/nodes/SyntaxMarkerNode';
import {registerComposerCaretAnchors} from '@app/features/lexical/composer/registerComposerCaretAnchors';
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	createEditor,
	type ElementNode,
	type LexicalEditor,
	type LexicalNode,
	TextNode,
} from 'lexical';
import {describe, expect, it, vi} from 'vitest';

vi.hoisted(() => {
	const HARNESS_ENDPOINT = 'https://primary.test/api';
	const host = globalThis as unknown as {window?: Record<string, unknown>};
	if (typeof host.window === 'undefined') {
		host.window = host as unknown as Record<string, unknown>;
	}
	host.window.__FLUXER_BOOTSTRAP__ = {
		config: {
			releaseChannel: 'stable',
			bootstrapApiEndpoint: HARNESS_ENDPOINT,
			bootstrapApiPublicEndpoint: HARNESS_ENDPOINT,
		},
		instance: {
			api_code_version: Number.MAX_SAFE_INTEGER,
			endpoints: {
				api: HARNESS_ENDPOINT,
				api_client: HARNESS_ENDPOINT,
				api_public: HARNESS_ENDPOINT,
				gateway: 'wss://gateway.primary.test',
				media: 'https://media.primary.test',
				static_cdn: 'https://cdn.primary.test',
				marketing: 'https://primary.test',
				admin: 'https://admin.primary.test',
				invite: 'https://primary.test/invite',
				gift: 'https://primary.test/gift',
				webapp: 'https://app.primary.test',
				upload_relay: 'https://upload.primary.test',
			},
			captcha: {provider: 'none', hcaptcha_site_key: null, turnstile_site_key: null},
			features: {
				voice_enabled: false,
				stripe_enabled: false,
				self_hosted: false,
				presigned_attachment_uploads: false,
				emails_enabled: false,
			},
			gif: {provider: 'klipy', display_name: 'Klipy', attribution_required: false},
		},
		geoip: {
			countryCode: null,
			regionCode: null,
			latitude: null,
			longitude: null,
			ageRestrictedGeos: [],
			ageBlockedGeos: [],
		},
	};
});

vi.mock('@app/features/lexical/composer/nodes/ComposerMentionPill', () => ({ComposerMentionPill: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerCustomEmoji', () => ({ComposerCustomEmoji: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerStandardEmoji', () => ({ComposerStandardEmoji: () => null}));
vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

const NODES = [
	ComposerMentionNode,
	ComposerCustomEmojiNode,
	ComposerStandardEmojiNode,
	ComposerPlainSegmentNode,
	ComposerCommandNode,
	SlashSlotNode,
	SlashSlotPlaceholderNode,
	ComposerCaretAnchorNode,
	SlashSeparatorNode,
	SlashOptionalHintNode,
	SyntaxMarkerNode,
	ComposerBlockquoteLineNode,
	ComposerBlockquoteMarkerNode,
];

function createHarness(): {editor: LexicalEditor; rootElement: HTMLElement} {
	const rootElement = document.createElement('div');
	rootElement.contentEditable = 'true';
	document.body.appendChild(rootElement);

	const editor = createEditor({
		namespace: 'composer-emoji-caret-test',
		nodes: NODES,
		onError: (error) => {
			throw error;
		},
	});
	editor.setRootElement(rootElement);
	registerComposerCaretAnchors(editor);
	registerComposerMarkdownHighlight(editor);
	return {editor, rootElement};
}

describe('Composer caret anchors for line-leading inline decorators', () => {
	it('converts typed :heart: into an emoji and creates anchor', () => {
		const rootElement = document.createElement('div');
		rootElement.contentEditable = 'true';
		document.body.appendChild(rootElement);

		const editor = createEditor({
			namespace: 'composer-emoji-caret-test',
			nodes: NODES,
			onError: (error) => {
				throw error;
			},
		});
		editor.setRootElement(rootElement);
		registerComposerCaretAnchors(editor);
		registerComposerMarkdownHighlight(editor);
		const resolver = (name: string) => {
			if (name === 'heart') {
				return {kind: 'standard' as const, name: 'heart', surrogate: '❤️', url: null, display: ':heart:'};
			}
			return null;
		};
		// register emoji shortcode
		editor.registerNodeTransform(TextNode, (node) => {
			$convertEmojiShortcode(node, resolver);
		});

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createTextNode(':heart:'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			const children = (p as ElementNode).getChildren();
			expect(children.map((c: LexicalNode) => c.getType())).toEqual([
				'text',
				'linebreak',
				'composer-caret-anchor',
				'composer-standard-emoji',
			]);
			const proj = $projectComposer();
			expect(proj.display).toBe('A\n:heart:');
			expect(proj.wire).toBe('A\n❤️');
		});
	});

	it('allows selecting caret position before the emoji at offset 2', () => {
		const {editor} = createHarness();

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createComposerStandardEmojiNode('heart', '❤️', null, ':heart:'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.update(
			() => {
				$selectComposerOffset(2);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const selection = $getSelection();
			expect($isRangeSelection(selection)).toBe(true);
			if ($isRangeSelection(selection)) {
				expect(selection.anchor.type).toBe('text');
				const node = selection.anchor.getNode();
				expect($isComposerCaretAnchorNode(node)).toBe(true);
				expect(selection.anchor.offset).toBe(0);
			}
			const offsets = $captureSelectionOffsets();
			expect(offsets).toEqual({anchor: 2, focus: 2});
		});
	});

	it('inserts typed text before the emoji and cleans up the anchor node', () => {
		const {editor} = createHarness();

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createComposerStandardEmojiNode('heart', '❤️', null, ':heart:'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.update(
			() => {
				$selectComposerOffset(2);
			},
			{discrete: true},
		);

		editor.update(
			() => {
				const selection = $getSelection();
				if ($isRangeSelection(selection)) {
					selection.insertText('B');
				}
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			// Anchor is removed because TextNode('B') now precedes the emoji on line 2
			expect(
				(p as ElementNode).getChildren().map((c: LexicalNode) => ({type: c.getType(), text: c.getTextContent()})),
			).toEqual([
				{type: 'text', text: 'A'},
				{type: 'linebreak', text: '\n'},
				{type: 'text', text: 'B'},
				{type: 'composer-standard-emoji', text: ':heart:'},
			]);

			const projection = $projectComposer();
			expect(projection.display).toBe('A\nB:heart:');
			expect(projection.wire).toBe('A\nB❤️');
			expect(projection.segments[0]).toMatchObject({
				start: 3,
				end: 10,
			});
		});
	});

	it('deletes the line break when backspace is pressed on the anchor, merging with line 1', () => {
		const {editor} = createHarness();

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createComposerStandardEmojiNode('heart', '❤️', null, ':heart:'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.update(
			() => {
				$selectComposerOffset(2);
			},
			{discrete: true},
		);

		editor.update(
			() => {
				const selection = $getSelection();
				if ($isRangeSelection(selection)) {
					selection.deleteCharacter(true);
				}
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			// Merged onto line 1, anchor cleaned up
			expect(
				(p as ElementNode).getChildren().map((c: LexicalNode) => ({type: c.getType(), text: c.getTextContent()})),
			).toEqual([
				{type: 'text', text: 'A'},
				{type: 'composer-standard-emoji', text: ':heart:'},
			]);

			const projection = $projectComposer();
			expect(projection.display).toBe('A:heart:');
			expect(projection.wire).toBe('A❤️');
		});
	});

	it('cleans up anchor if the emoji is removed', () => {
		const {editor} = createHarness();

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createComposerStandardEmojiNode('heart', '❤️', null, ':heart:'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.update(
			() => {
				const root = $getRoot();
				const p = root.getFirstChild();
				if ($isElementNode(p)) {
					const emoji = p.getLastChild();
					if (emoji != null) {
						emoji.remove();
					}
				}
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			// Anchor is removed since no decorator follows
			expect((p as ElementNode).getChildren().map((c: LexicalNode) => c.getType())).toEqual(['text', 'linebreak']);
		});
	});

	it('creates anchor when emoji is at the start of blockquote line', () => {
		const {editor} = createHarness();

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				const bq = $createComposerBlockquoteLineNode();
				bq.append($createComposerBlockquoteMarkerNode('> '));
				bq.append($createComposerStandardEmojiNode('heart', '❤️', null, ':heart:'));
				p.append(bq);
				root.append(p);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			const bq = (p as ElementNode).getFirstChild();
			expect($isElementNode(bq)).toBe(true);
			expect((bq as ElementNode).getChildren().map((c: LexicalNode) => c.getType())).toEqual([
				'composer-blockquote-marker',
				'composer-caret-anchor',
				'composer-standard-emoji',
			]);
		});
	});

	it('converts typed A\\n:heart: aaa into an emoji with trailing text intact and projects correctly', () => {
		const rootElement = document.createElement('div');
		rootElement.contentEditable = 'true';
		document.body.appendChild(rootElement);

		const editor = createEditor({
			namespace: 'composer-emoji-caret-test',
			nodes: NODES,
			onError: (error) => {
				throw error;
			},
		});
		editor.setRootElement(rootElement);
		registerComposerCaretAnchors(editor);
		registerComposerMarkdownHighlight(editor);
		const resolver = (name: string) => {
			if (name === 'heart') {
				return {kind: 'standard' as const, name: 'heart', surrogate: '❤️', url: null, display: ':heart:'};
			}
			return null;
		};
		editor.registerNodeTransform(TextNode, (node) => {
			$convertEmojiShortcode(node, resolver);
		});

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createTextNode(':heart: aaa'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			const children = (p as ElementNode).getChildren();
			expect(children.map((c: LexicalNode) => c.getType())).toEqual([
				'text',
				'linebreak',
				'composer-caret-anchor',
				'composer-standard-emoji',
				'text',
			]);
			expect(children[4]!.getTextContent()).toBe(' aaa');

			const proj = $projectComposer();
			expect(proj.display).toBe('A\n:heart: aaa');
			expect(proj.wire).toBe('A\n❤️ aaa');
		});
	});

	it('handles non-boundary shortcode text A\\n:heart:aaa without truncation', () => {
		const rootElement = document.createElement('div');
		rootElement.contentEditable = 'true';
		document.body.appendChild(rootElement);

		const editor = createEditor({
			namespace: 'composer-emoji-caret-test',
			nodes: NODES,
			onError: (error) => {
				throw error;
			},
		});
		editor.setRootElement(rootElement);
		registerComposerCaretAnchors(editor);
		registerComposerMarkdownHighlight(editor);
		const resolver = (name: string) => {
			if (name === 'heart') {
				return {kind: 'standard' as const, name: 'heart', surrogate: '❤️', url: null, display: ':heart:'};
			}
			return null;
		};
		editor.registerNodeTransform(TextNode, (node) => {
			$convertEmojiShortcode(node, resolver);
		});

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createTextNode(':heart:aaa'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			const children = (p as ElementNode).getChildren();
			expect(children.map((c: LexicalNode) => c.getType())).toEqual(['text', 'linebreak', 'text']);
			expect(children[2]!.getTextContent()).toBe(':heart:aaa');

			const proj = $projectComposer();
			expect(proj.display).toBe('A\n:heart:aaa');
			expect(proj.wire).toBe('A\n:heart:aaa');
		});
	});

	it('handles non-emoji text A\\n:heart without truncation', () => {
		const rootElement = document.createElement('div');
		rootElement.contentEditable = 'true';
		document.body.appendChild(rootElement);

		const editor = createEditor({
			namespace: 'composer-emoji-caret-test',
			nodes: NODES,
			onError: (error) => {
				throw error;
			},
		});
		editor.setRootElement(rootElement);
		registerComposerCaretAnchors(editor);
		registerComposerMarkdownHighlight(editor);
		const resolver = (name: string) => {
			if (name === 'heart') {
				return {kind: 'standard' as const, name: 'heart', surrogate: '❤️', url: null, display: ':heart:'};
			}
			return null;
		};
		editor.registerNodeTransform(TextNode, (node) => {
			$convertEmojiShortcode(node, resolver);
		});

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode('A'));
				p.append($createLineBreakNode());
				p.append($createTextNode(':heart'));
				root.append(p);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			expect($isElementNode(p)).toBe(true);
			const children = (p as ElementNode).getChildren();
			expect(children.map((c: LexicalNode) => c.getType())).toEqual(['text', 'linebreak', 'text']);
			expect(children[2]!.getTextContent()).toBe(':heart');

			const proj = $projectComposer();
			expect(proj.display).toBe('A\n:heart');
			expect(proj.wire).toBe('A\n:heart');
		});
	});
});
