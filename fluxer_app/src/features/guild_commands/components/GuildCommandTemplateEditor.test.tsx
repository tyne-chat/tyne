// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {act, createRef} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/emoji/state/Emoji', () => ({default: {search: () => []}}));
vi.mock('@app/features/theme_settings/editor/EditorPhrases', () => ({editorPhrases: () => []}));
vi.mock('@lingui/react/macro', () => ({useLingui: () => ({i18n: {}})}));

import GuildCommandTemplateEditor, {
	type GuildCommandTemplateEditorHandle,
} from '@app/features/guild_commands/components/GuildCommandTemplateEditor';
import {MAX_GUILD_COMMAND_TEMPLATE_LENGTH} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';

let root: Root | null = null;
let container: HTMLElement;

async function show(props: {mode: 'basic' | 'script'; value: string; onChange?: (value: string) => void}) {
	const handle = createRef<GuildCommandTemplateEditorHandle>();
	const render = (value: string) =>
		root?.render(
			<GuildCommandTemplateEditor
				mode={props.mode}
				value={value}
				channel={null}
				disabled={false}
				ariaLabel="Message"
				problem={null}
				handleRef={handle}
				onChange={props.onChange ?? (() => {})}
				data-flx="guild-commands.guild-command-template-editor-test.editor"
			/>,
		);
	await act(async () => {
		root ??= createRoot(container);
		render(props.value);
	});
	return {handle, rerender: (value: string) => act(async () => render(value))};
}

describe('GuildCommandTemplateEditor', () => {
	beforeEach(() => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		container = document.createElement('div');
		document.body.append(container);
	});

	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		container.remove();
		vi.unstubAllGlobals();
	});

	it('has line numbers only in the script mode', async () => {
		await show({mode: 'script', value: 'x'});
		expect(container.querySelector('.cm-lineNumbers')).not.toBeNull();
		await act(async () => root?.unmount());
		root = null;
		await show({mode: 'basic', value: 'x'});
		expect(container.querySelector('.cm-lineNumbers')).toBeNull();
	});

	it('inserts at the cursor and reports the change', async () => {
		const onChange = vi.fn();
		const {handle} = await show({mode: 'basic', value: 'hi ', onChange});
		await act(async () => handle.current?.insert('{{ person }}'));
		expect(onChange).toHaveBeenLastCalledWith('{{ person }}hi ');
	});

	it('takes new text from outside without reporting it back as an edit', async () => {
		const onChange = vi.fn();
		const {rerender} = await show({mode: 'basic', value: 'one', onChange});
		await rerender('two');
		expect(container.textContent).toContain('two');
		expect(onChange).not.toHaveBeenCalled();
	});

	it('refuses text past the limit', async () => {
		const onChange = vi.fn();
		const {handle} = await show({mode: 'basic', value: 'x'.repeat(MAX_GUILD_COMMAND_TEMPLATE_LENGTH - 1), onChange});
		await act(async () => handle.current?.insert('toolong'));
		expect(onChange).not.toHaveBeenCalled();
		await act(async () => handle.current?.insert('y'));
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
