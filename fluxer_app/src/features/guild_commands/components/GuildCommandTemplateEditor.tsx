// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/guild_commands/components/GuildCommandScriptEditor.module.css';
import {guildCommandLiquidCompletions} from '@app/features/guild_commands/utils/GuildCommandLiquidCompletions';
import {editorPhrases} from '@app/features/theme_settings/editor/EditorPhrases';
import {autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap} from '@codemirror/autocomplete';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {closePercentBrace, liquidLanguage} from '@codemirror/lang-liquid';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {setDiagnostics} from '@codemirror/lint';
import {EditorState} from '@codemirror/state';
import {drawSelection, EditorView, keymap, lineNumbers, placeholder} from '@codemirror/view';
import {tags as t} from '@lezer/highlight';
import {useLingui} from '@lingui/react/macro';
import {useEffect, useRef} from 'react';

// Fork: the code editor for command scripts (docs/design/server-commands.md, "Script editor"). Loaded
// on demand: its grammars are only needed by people editing a script.

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
	'.cm-tooltip-autocomplete > ul > li': {fontFamily: 'var(--font-mono, ui-monospace, monospace)'},
	'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
		backgroundColor: 'var(--brand-primary)',
		color: 'var(--brand-primary-fill)',
	},
});

export interface GuildCommandScriptProblem {
	line: number;
	column: number;
	message: string;
}

export default function GuildCommandScriptEditor({
	value,
	disabled,
	ariaLabel,
	placeholderText,
	problem,
	onChange,
}: {
	value: string;
	disabled: boolean;
	ariaLabel: string;
	placeholderText: string;
	problem: GuildCommandScriptProblem | null;
	onChange: (value: string) => void;
}) {
	const {i18n} = useLingui();
	const parent = useRef<HTMLDivElement | null>(null);
	const view = useRef<EditorView | null>(null);
	const latestChange = useRef(onChange);
	latestChange.current = onChange;
	const latestValue = useRef(value);
	latestValue.current = value;

	// Built once: the parent remounts it for another command.
	useEffect(() => {
		if (!parent.current) return;
		const created = new EditorView({
			parent: parent.current,
			state: EditorState.create({
				doc: value,
				extensions: [
					liquidLanguage,
					liquidLanguage.data.of({closeBrackets: {brackets: ['{']}}),
					closePercentBrace,
					closeBrackets(),
					autocompletion({override: [guildCommandLiquidCompletions]}),
					history(),
					lineNumbers(),
					drawSelection(),
					EditorView.lineWrapping,
					syntaxHighlighting(highlightStyle),
					editorTheme,
					editorPhrases(i18n),
					placeholder(placeholderText),
					EditorState.readOnly.of(disabled),
					EditorView.editable.of(!disabled),
					EditorView.contentAttributes.of({'aria-label': ariaLabel}),
					keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
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

	return <div ref={parent} className={styles.editor} data-flx="guild-commands.guild-command-script-editor.editor" />;
}
