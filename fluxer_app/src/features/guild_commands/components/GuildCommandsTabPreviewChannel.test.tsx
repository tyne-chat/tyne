// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: regression guard ensuring GuildCommandsTab updates previewChannel when guild channels
// hydrate after initial render instead of freezing inside useMemo (tyne-chat/tyne#937, tyne-chat/tyne#947).

import {observable, runInAction} from 'mobx';
import {act, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	capturedChannels: [] as Array<unknown>,
	get: vi.fn(),
}));

const reactiveChannels = observable.box<Array<{id: string; type: number; name: string}>>([]);

function say(descriptor: {message?: string} | string): string {
	return typeof descriptor === 'string' ? descriptor : (descriptor.message ?? '');
}

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));
vi.mock('@lingui/react/macro', () => ({useLingui: () => ({i18n: {_: say, number: String}})}));
vi.mock('@app/features/permissions/state/Permission', () => ({default: {can: () => true}}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {get: mocks.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn()},
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
	setTabData: vi.fn(),
}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({push: vi.fn(), modal: (build: () => unknown) => build}));
vi.mock('@app/features/ui/commands/ToastCommands', () => ({createToast: vi.fn()}));
vi.mock('@app/features/guild_commands/state/GuildCommandsStore', () => ({
	default: {editingRequest: null, clearEditingRequest: vi.fn()},
}));
vi.mock('@app/features/guild_commands/hooks/useGuildCommandScriptPreview', () => ({
	useGuildCommandScriptPreview: () => ({result: {content: null, issue: null}, runAgain: vi.fn()}),
}));
vi.mock('@app/features/guild_commands/components/GuildCommandScriptReference', () => ({
	GuildCommandScriptReference: () => null,
}));
vi.mock('@app/features/guild_commands/components/GuildCommandTemplateEditor', () => ({
	default: () => null,
}));
vi.mock('@app/features/channel/components/ChannelMessage', () => ({Message: () => null}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {
		getGuildChannels: () => reactiveChannels.get(),
	},
}));
vi.mock('@app/features/lexical/composer/LexicalRichInput', () => ({LexicalRichInput: () => null}));
vi.mock('@app/features/messaging/models/MessagingMessage', () => ({Message: class {}}));
vi.mock('@app/features/messaging/utils/TypedEmojiShortcodeUtils', () => ({
	resolveTypedEmojiShortcodes: ({content, channel}: {content: string; channel: unknown}) => {
		mocks.capturedChannels.push(channel);
		return content;
	},
}));
vi.mock('@app/features/messaging/utils/markdown/TypedEmojiMatch', () => ({isExistingCustomEmojiMarkdown: () => false}));
vi.mock('@app/features/messaging/utils/markdown/UrlSpanUtils', () => ({
	findUrlSpans: () => [],
	isInsideSpan: () => false,
}));
vi.mock('@app/features/app/components/dialogs/ConfirmModal', () => ({ConfirmModal: () => null}));
vi.mock('@app/features/ui/button/Button', () => ({
	Button: (props: {children: ReactNode}) => (
		<button type="button" data-flx="guild-commands.guild-commands-tab-preview-channel-test.button.button">
			{props.children}
		</button>
	),
}));
vi.mock('@app/features/ui/components/form/FormInput', () => ({Input: () => null}));
vi.mock('@app/features/ui/checkbox/Checkbox', () => ({Checkbox: () => null}));
vi.mock('@app/features/ui/components/Spinner', () => ({Spinner: () => null}));
vi.mock('@app/features/ui/radio_group/RadioGroup', () => ({RadioGroup: () => null}));
vi.mock('@app/features/ui/state/MobileLayout', () => ({default: {enabled: false}}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {getCurrentUser: () => ({id: 'me'}), getUser: () => ({displayName: 'Someone'})},
}));
vi.mock('@app/lib/forms', () => ({extractErrorMessage: () => 'error'}));

import {GuildCommandsTab} from '@app/features/guild_commands/components/GuildCommandsTab';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('GuildCommandsTab previewChannel reactivity', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		mocks.capturedChannels = [];
		mocks.get.mockResolvedValue({ok: true, body: []});
		runInAction(() => {
			reactiveChannels.set([]);
		});
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it('updates previewChannel when guild channels arrive after initial render', async () => {
		await act(async () => {
			root.render(
				<GuildCommandsTab
					guildId="guild_1"
					data-flx="guild-commands.guild-commands-tab-preview-channel-test.guild-commands-tab"
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(mocks.capturedChannels.at(-1)).toBeNull();

		const textChannel = {id: 'ch_text', type: 0, name: 'general'};
		await act(async () => {
			runInAction(() => {
				reactiveChannels.set([textChannel]);
			});
		});

		expect(mocks.capturedChannels.at(-1)).toMatchObject(textChannel);
	});
});
