// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import styles from '@app/features/guild_commands/components/GuildCommandTemplateEditor.module.css';
import {
	type GuildCommandEmojiCompletion,
	guildCommandEmojiCompletions,
	renderGuildCommandEmoji,
} from '@app/features/guild_commands/utils/GuildCommandEmojiCompletions';
import {guildCommandLiquidCompletions} from '@app/features/guild_commands/utils/GuildCommandLiquidCompletions';
import {editorPhrases} from '@app/features/theme_settings/editor/EditorPhrases';
import {
	acceptCompletion,
	autocompletion,
	closeBrackets,
	closeBracketsKeymap,
	completionKeymap,
} from '@codemirror/autocomplete';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {closePercentBrace, liquidLanguage} from '@codemirror/lang-liquid';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {setDiagnostics} from '@codemirror/lint';
import {EditorState} from '@codemirror/state';
import {drawSelection, EditorView, keymap, lineNumbers, placeholder} from '@codemirror/view';
import {
	type GuildCommandKind,
	MAX_GUILD_COMMAND_TEMPLATE_LENGTH,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {tags as t} from '@lezer/highlight';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import type React from 'react';
import {useEffect, useImperativeHandle, useRef} from 'react';

// Fork: the field for a command's template (docs/design/server-commands.md, "Script editor"), plain in
// the basic mode and a code editor in the script mode, with emoji suggestions in both. Loaded on
// demand: its grammars are only needed in this settings tab.

const highlightStyle = HighlightStyle.define([
	{tag: t.comment, color: 'var(--text-tertiary)', fontStyle: 'italic'},
	{tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: 'var(--brand-primary-light)'},
	{tag: [t.variableName, t.propertyName], color: 'var(--text-link)'},
	{tag: t.function(t.variableName), color: 'var(--status-warning)'},
	{tag: [t.string, t.number, t.bool], color: 'var(--status-online)'},
	{tag: [t.brace, t.meta], color: 'var(--text-tertiary)'},
]);

const editorTheme = EditorView.theme({
	'&': {color: 'var(--text-primary)', backgroundColor: 'transparent', fontSize: '0.875rem'},
	'&.cm-focused': {outline: 'none'},
	'.cm-scroller': {fontFamily: 'var(--font-mono, ui-monospace, monospace)', lineHeight: '1.6', overflow: 'auto'},
	'.cm-content': {caretColor: 'var(--text-primary)', padding: '0.625rem 0'},
	'.cm-gutters': {backgroundColor: 'transparent', color: 'var(--text-tertiary)', border: 'none'},
	'.cm-cursor': {borderLeftColor: 'var(--text-primary)'},
	'.cm-placeholder': {color: 'var(--text-tertiary)'},
	'.cm-tooltip': {
		backgroundColor: 'var(--background-primary)',
		border: '1px solid var(--background-modifier-accent)',
		borderRadius: '6px',
		color: 'var(--text-primary)',
	},
	'.cm-tooltip-autocomplete > ul': {maxWidth: 'min(22rem, 78vw)'},
	'.cm-tooltip-autocomplete > ul > li': {fontFamily: 'var(--font-mono, ui-monospace, monospace)'},
	'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
		backgroundColor: 'var(--brand-primary)',
		color: 'var(--brand-primary-fill)',
	},
});

/** The basic mode reads as a message box, not as code. */
const basicTheme = EditorView.theme({
	'.cm-scroller': {fontFamily: 'inherit', lineHeight: '1.5'},
	'.cm-content': {padding: '0.625rem 0.75rem'},
});

export interface GuildCommandTemplateEditorHandle {
	/** Puts text at the cursor, in place of any selection. */
	insert: (text: string) => void;
}

export interface GuildCommandTemplateProblem {
	line: number;
	column: number;
	message: string;
}

export default function GuildCommandTemplateEditor({
	mode,
	value,
	channel,
	disabled,
	ariaLabel,
	placeholderText,
	problem,
	handleRef,
	onChange,
}: {
	mode: GuildCommandKind;
	value: string;
	/** Where emoji suggestions are judged usable: a channel of the command's community. */
	channel: Channel | null;
	disabled: boolean;
	ariaLabel: string;
	placeholderText?: string;
	problem: GuildCommandTemplateProblem | null;
	handleRef?: React.Ref<GuildCommandTemplateEditorHandle>;
	onChange: (value: string) => void;
}) {
	const {i18n} = useLingui();
	const parent = useRef<HTMLDivElement | null>(null);
	const view = useRef<EditorView | null>(null);
	const latestChange = useRef(onChange);
	latestChange.current = onChange;
	const latestValue = useRef(value);
	latestValue.current = value;

	useImperativeHandle(
		handleRef,
		() => ({
			insert: (text) => {
				const current = view.current;
				if (!current) return;
				current.dispatch(current.state.replaceSelection(text));
				current.focus();
			},
		}),
		[],
	);

	// Built once: the parent remounts it for another command or mode.
	useEffect(() => {
		if (!parent.current) return;
		const emoji = guildCommandEmojiCompletions(channel);
		const created = new EditorView({
			parent: parent.current,
			state: EditorState.create({
				doc: value,
				extensions: [
					mode === 'script'
						? [
								liquidLanguage,
								liquidLanguage.data.of({closeBrackets: {brackets: ['{']}}),
								closePercentBrace,
								closeBrackets(),
								lineNumbers(),
								syntaxHighlighting(highlightStyle),
							]
						: [],
					autocompletion({
						override: mode === 'script' ? [guildCommandLiquidCompletions, emoji] : [emoji],
						addToOptions: [
							{
								render: (completion) => renderGuildCommandEmoji(completion as GuildCommandEmojiCompletion),
								position: 20,
							},
						],
					}),
					history(),
					drawSelection(),
					EditorView.lineWrapping,
					// Earlier themes win.
					mode === 'basic' ? basicTheme : [],
					editorTheme,
					editorPhrases(i18n),
					placeholderText ? placeholder(placeholderText) : [],
					EditorState.changeFilter.of((transaction) => transaction.newDoc.length <= MAX_GUILD_COMMAND_TEMPLATE_LENGTH),
					EditorState.readOnly.of(disabled),
					EditorView.editable.of(!disabled),
					EditorView.contentAttributes.of({'aria-label': ariaLabel}),
					keymap.of([
						{key: 'Tab', run: acceptCompletion},
						...closeBracketsKeymap,
						...completionKeymap,
						...historyKeymap,
						...defaultKeymap,
					]),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged) return;
						const text = update.state.doc.toString();
						if (text !== latestValue.current) latestChange.current(text);
					}),
				],
			}),
		});
		view.current = created;
		return () => {
			created.destroy();
			view.current = null;
		};
	}, []);

	// Reset and undoing in the settings tab change the text from outside the editor.
	useEffect(() => {
		const current = view.current;
		if (!current || current.state.doc.toString() === value) return;
		current.dispatch({changes: {from: 0, to: current.state.doc.length, insert: value}});
	}, [value]);

	useEffect(() => {
		const current = view.current;
		if (!current) return;
		const {doc} = current.state;
		if (!problem || problem.line > doc.lines) {
			current.dispatch(setDiagnostics(current.state, []));
			return;
		}
		const line = doc.line(problem.line);
		const from = Math.min(line.from + problem.column - 1, line.to);
		current.dispatch(
			setDiagnostics(current.state, [
				{from, to: Math.max(from, Math.min(from + 1, doc.length)), severity: 'error', message: problem.message},
			]),
		);
	}, [problem]);

	return (
		<div
			ref={parent}
			className={clsx(styles.editor, mode === 'script' && styles.script)}
			data-flx="guild-commands.guild-command-template-editor.editor"
		/>
	);
}
