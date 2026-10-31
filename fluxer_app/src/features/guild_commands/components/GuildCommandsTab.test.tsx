// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {GuildCommandResponse} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {act, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	can: vi.fn((_permission: unknown, _context: unknown) => true),
	get: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
	delete: vi.fn(),
	tabData: null as {onReset: () => void; onSave: () => void} | null,
	push: vi.fn(),
	toast: vi.fn(),
	store: {editingRequest: null as {guildId: string; commandId: string} | null, clearEditingRequest: vi.fn()},
	preview: {result: {content: null as string | null, issue: null as unknown}, runAgain: vi.fn()},
}));

function say(descriptor: {message?: string} | string, values: Record<string, unknown> = {}): string {
	const text = typeof descriptor === 'string' ? descriptor : (descriptor.message ?? '');
	return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));
vi.mock('@lingui/react/macro', () => ({useLingui: () => ({i18n: {_: say, number: String}})}));
vi.mock('@app/features/permissions/state/Permission', () => ({default: {can: mocks.can}}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete},
}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		warn() {}
		error() {}
	},
}));
vi.mock('@app/features/ui/commands/UnsavedChangesCommands', () => ({
	setUnsavedChanges: vi.fn(),
	clearUnsavedChanges: vi.fn(),
	setTabData: (_tab: string, data: {onReset: () => void; onSave: () => void}) => {
		mocks.tabData = data;
	},
}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({push: mocks.push, modal: (build: () => unknown) => build}));
vi.mock('@app/features/ui/commands/ToastCommands', () => ({createToast: mocks.toast}));
vi.mock('@app/features/guild_commands/state/GuildCommandsStore', () => ({default: mocks.store}));
vi.mock('@app/features/guild_commands/hooks/useGuildCommandScriptPreview', () => ({
	useGuildCommandScriptPreview: () => mocks.preview,
}));
vi.mock('@app/features/guild_commands/components/GuildCommandScriptReference', () => ({
	GuildCommandScriptReference: () => <div data-flx="reference" />,
}));
vi.mock('@app/features/guild_commands/components/GuildCommandTemplateEditor', () => ({
	default: (props: {value: string; onChange: (value: string) => void; 'data-flx'?: string; mode: string}) => (
		<textarea
			value={props.value}
			data-mode={props.mode}
			data-flx={props['data-flx']}
			onChange={(event) => props.onChange(event.target.value)}
		/>
	),
}));
vi.mock('@app/features/channel/components/ChannelMessage', () => ({Message: () => <div data-flx="message" />}));
vi.mock('@app/features/channel/state/Channels', () => ({default: {getGuildChannels: () => []}}));
vi.mock('@app/features/lexical/composer/LexicalRichInput', () => ({
	LexicalRichInput: () => <div data-flx="guild-commands.guild-commands-tab-test.lexical-rich-input.div" />,
}));
vi.mock('@app/features/messaging/models/MessagingMessage', () => ({Message: class {}}));
vi.mock('@app/features/messaging/utils/TypedEmojiShortcodeUtils', () => ({
	resolveTypedEmojiShortcodes: ({content}: {content: string}) => content,
}));
vi.mock('@app/features/messaging/utils/markdown/TypedEmojiMatch', () => ({isExistingCustomEmojiMarkdown: () => false}));
vi.mock('@app/features/messaging/utils/markdown/UrlSpanUtils', () => ({
	findUrlSpans: () => [],
	isInsideSpan: () => false,
}));
vi.mock('@app/features/app/components/dialogs/ConfirmModal', () => ({ConfirmModal: () => null}));
vi.mock('@app/features/ui/button/Button', () => ({
	Button: (props: {children: ReactNode; onClick?: () => void; disabled?: boolean; 'data-flx'?: string}) => (
		<button type="button" onClick={props.onClick} disabled={props.disabled} data-flx={props['data-flx']}>
			{props.children}
		</button>
	),
}));
vi.mock('@app/features/ui/components/form/FormInput', () => ({
	Input: (props: {
		value: string;
		disabled?: boolean;
		error?: string | null;
		onChange: (event: {target: {value: string}}) => void;
		'data-flx'?: string;
	}) => (
		<div data-flx="guild-commands.guild-commands-tab-test.input.div">
			<input value={props.value} disabled={props.disabled} onChange={props.onChange} data-flx={props['data-flx']} />
			{props.error && <span data-flx={`${props['data-flx']}-error`}>{props.error}</span>}
		</div>
	),
}));
vi.mock('@app/features/ui/components/Spinner', () => ({Spinner: () => <div data-flx="spinner" />}));
vi.mock('@app/features/ui/radio_group/RadioGroup', () => ({
	RadioGroup: () => <div data-flx="guild-commands.guild-commands-tab-test.radio-group.div" />,
}));
vi.mock('@app/features/ui/state/MobileLayout', () => ({default: {enabled: false}}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {getCurrentUser: () => ({id: 'me'}), getUser: () => ({displayName: 'Someone'})},
}));
vi.mock('@app/lib/forms', () => ({extractErrorMessage: () => 'the server said no'}));

import {GuildCommandsTab} from '@app/features/guild_commands/components/GuildCommandsTab';

const GUILD = 'g';

function command(id: string, name: string, overrides: Partial<GuildCommandResponse> = {}): GuildCommandResponse {
	return {
		id,
		guild_id: GUILD,
		name,
		description: '',
		kind: 'basic',
		input_mode: 'required',
		input_type: 'text',
		input_hint: null,
		creator_id: 'me',
		created_at: '2026-10-30T00:00:00.000Z',
		updated_at: '2026-10-30T00:00:00.000Z',
		template: '{{ person }} hugs {{ input }}',
		...overrides,
	};
}

let root: Root;
let container: HTMLElement;

const part = (name: string) =>
	container.querySelector<HTMLElement>(`[data-flx="guild-commands.guild-commands-tab.${name}"]`);
const parts = (name: string) => [
	...container.querySelectorAll<HTMLElement>(`[data-flx="guild-commands.guild-commands-tab.${name}"]`),
];
const heading = () => part('editor-title')?.textContent;
const nameField = () => part('name') as HTMLInputElement;

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function show(commands: Array<GuildCommandResponse>) {
	mocks.get.mockResolvedValue({ok: true, body: commands});
	await act(async () => {
		root.render(
			<GuildCommandsTab guildId={GUILD} data-flx="guild-commands.guild-commands-tab-test.show.guild-commands-tab" />,
		);
	});
	await settle();
	await settle();
}

async function click(element: HTMLElement | null) {
	await act(async () => {
		element?.click();
	});
	await settle();
}

async function type(element: HTMLElement | null, value: string) {
	const input = element as HTMLInputElement | HTMLTextAreaElement;
	const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
		input.dispatchEvent(new Event('input', {bubbles: true}));
	});
	await settle();
}

async function press(action: 'onReset' | 'onSave') {
	await act(async () => {
		mocks.tabData?.[action]();
	});
	await settle();
}

describe('GuildCommandsTab', () => {
	beforeEach(() => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		vi.clearAllMocks();
		mocks.can.mockImplementation(() => true);
		mocks.store.editingRequest = null;
		mocks.preview.result = {content: null, issue: null};
		mocks.post.mockResolvedValue({ok: true, body: command('new-id', 'wave')});
		mocks.patch.mockResolvedValue({ok: true, body: command('1', 'hug')});
		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});

	it('lists the commands, with the slots, and opens the first', async () => {
		await show([command('1', 'hug'), command('2', 'tuck')]);

		expect(part('slots-count')?.textContent).toBe('2 / 500');
		expect(parts('row-name').map((row) => row.textContent)).toEqual(
			expect.arrayContaining([expect.stringContaining('hug')]),
		);
		expect(nameField().value).toBe('hug');
	});

	it('says so when the list cannot be loaded', async () => {
		mocks.get.mockRejectedValue(new Error('offline'));
		await act(async () => {
			root.render(
				<GuildCommandsTab guildId={GUILD} data-flx="guild-commands.guild-commands-tab-test.guild-commands-tab" />,
			);
		});
		await settle();

		expect(part('load-failed')).not.toBeNull();
	});

	it('hides New command from those who may not create', async () => {
		mocks.can.mockImplementation(() => false);
		await show([command('1', 'hug', {creator_id: 'someone'})]);

		expect(part('new-command')).toBeNull();
		expect(nameField().disabled).toBe(true);
		expect(part('delete')).toBeNull();
	});

	it("lets Create Commands edit only one's own", async () => {
		mocks.can.mockImplementation((permission: unknown) => permission !== Permissions.MANAGE_COMMANDS);
		await show([command('1', 'mine'), command('2', 'theirs', {creator_id: 'someone'})]);
		expect(nameField().disabled).toBe(false);

		await click(parts('row')[1]!.querySelector('button') ?? parts('row')[1]!);
		expect(nameField().disabled).toBe(true);
	});

	it('stays on a new command when it is reset', async () => {
		await show([command('1', 'hug')]);
		await click(part('new-command'));
		await type(part('description'), 'Waves');
		expect(heading()).toBe('New command');

		await press('onReset');

		expect(heading()).toBe('New command');
		expect((part('description') as HTMLInputElement).value).toBe('');
	});

	it('saves a command with no description', async () => {
		await show([command('1', 'hug')]);
		await click(part('new-command'));
		await type(part('name'), 'wave');
		await type(part('template'), 'Hello');

		await press('onSave');

		expect(mocks.post).toHaveBeenCalledTimes(1);
		expect(mocks.post.mock.calls[0]![1].body).toMatchObject({name: 'wave', description: '', template: 'Hello'});
		expect(mocks.get).toHaveBeenCalledTimes(2);
	});

	it('does not save a name that is taken, or a built-in one', async () => {
		await show([command('1', 'hug')]);
		await click(part('new-command'));
		await type(part('template'), 'Hello');

		await type(part('name'), 'hug');
		expect(part('name-error')).not.toBeNull();
		await press('onSave');

		await type(part('name'), 'shrug');
		expect(part('name-error')).not.toBeNull();
		await press('onSave');

		expect(mocks.post).not.toHaveBeenCalled();
	});

	it('allows pagebreak, which no built-in uses yet', async () => {
		await show([command('1', 'hug')]);
		await click(part('new-command'));
		await type(part('name'), 'pagebreak');

		expect(part('name-error')).toBeNull();
	});

	it('explains a failed save and keeps the changes', async () => {
		mocks.patch.mockRejectedValue({body: {template_issue: {code: 'too_long', line: null, column: null, name: null}}});
		await show([command('1', 'hug')]);
		await type(part('description'), 'Longer');

		await press('onSave');

		expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({type: 'error'}));
		expect(String(mocks.toast.mock.calls[0]![0].children)).toContain('The script is too long.');
		expect((part('description') as HTMLInputElement).value).toBe('Longer');
	});

	it('opens a script in the script editor, with no way back while it is a script', async () => {
		await show([command('1', 'hug', {kind: 'script', template: '{% if target %}x{% endif %}'})]);
		await settle();

		expect(part('template')?.getAttribute('data-mode')).toBe('script');
		expect(part('switch-editor')).toBeNull();
		expect(part('insert-person')).toBeNull();
	});

	it('moves between the editors while the text is plain', async () => {
		await show([command('1', 'hug')]);
		expect(part('insert-person')).not.toBeNull();

		await click(part('switch-editor'));
		expect(part('template')?.getAttribute('data-mode')).toBe('script');
		expect(part('insert-person')).toBeNull();

		await click(part('switch-editor'));
		expect(part('template')?.getAttribute('data-mode')).toBe('basic');
	});

	it('shows a script problem and offers Run again only for random scripts', async () => {
		mocks.preview.result = {content: null, issue: {code: 'unknown_tag', name: 'for', line: 1, column: 1}};
		await show([command('1', 'hug', {kind: 'script', template: '{% for x in y %}'})]);
		expect(part('run-again')).toBeNull();

		mocks.preview.result = {content: 'a', issue: null};
		await type(part('template'), '{% random %}a{% or %}b{% endrandom %}');
		await click(part('run-again'));

		expect(mocks.preview.runAgain).toHaveBeenCalledTimes(1);
	});

	it('warns when a script would post nothing', async () => {
		mocks.preview.result = {content: '', issue: null};
		await show([command('1', 'hug', {kind: 'script', template: '{% if target %}x{% endif %}'})]);

		expect(part('empty-preview')).not.toBeNull();
	});

	it('opens the command a chip asked for, once', async () => {
		mocks.store.editingRequest = {guildId: GUILD, commandId: '2'};
		await show([command('1', 'hug'), command('2', 'tuck')]);

		expect(nameField().value).toBe('tuck');
		expect(mocks.store.clearEditingRequest).toHaveBeenCalledTimes(1);
	});

	it('leaves alone a request for another community', async () => {
		mocks.store.editingRequest = {guildId: 'other', commandId: '2'};
		await show([command('1', 'hug'), command('2', 'tuck')]);

		expect(nameField().value).toBe('hug');
		expect(mocks.store.clearEditingRequest).not.toHaveBeenCalled();
	});

	it('asks before deleting', async () => {
		await show([command('1', 'hug')]);

		await click(part('delete'));

		expect(mocks.push).toHaveBeenCalledTimes(1);
		expect(mocks.delete).not.toHaveBeenCalled();
	});
});
