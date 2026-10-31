// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import {Message} from '@app/features/channel/components/ChannelMessage';
import Channels from '@app/features/channel/state/Channels';
import {
	type CounterDraft,
	counterNameError,
	GuildCommandCountersSection,
} from '@app/features/guild_commands/components/GuildCommandCountersSection';
import {GuildCommandScriptReference} from '@app/features/guild_commands/components/GuildCommandScriptReference';
import styles from '@app/features/guild_commands/components/GuildCommandsTab.module.css';
import type {
	GuildCommandTemplateEditorHandle,
	GuildCommandTemplateProblem,
} from '@app/features/guild_commands/components/GuildCommandTemplateEditor';
import {useGuildCommandScriptPreview} from '@app/features/guild_commands/hooks/useGuildCommandScriptPreview';
import GuildCommandsStore from '@app/features/guild_commands/state/GuildCommandsStore';
import {
	templateEmojiByName,
	templateForEditing,
	templateForSaving,
} from '@app/features/guild_commands/utils/GuildCommandTemplateEmoji';
import {
	describeTemplateIssue,
	templateIssueOfError,
} from '@app/features/guild_commands/utils/GuildCommandTemplateIssues';
import {LexicalRichInput} from '@app/features/lexical/composer/LexicalRichInput';
import {Message as MessageModel} from '@app/features/messaging/models/MessagingMessage';
import {resolveTypedEmojiShortcodes} from '@app/features/messaging/utils/TypedEmojiShortcodeUtils';
import Permission from '@app/features/permissions/state/Permission';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import * as UnsavedChangesCommands from '@app/features/ui/commands/UnsavedChangesCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import formStyles from '@app/features/ui/components/form/FormInput.module.css';
import surfaceStyles from '@app/features/ui/components/form/FormSurface.module.css';
import {Spinner} from '@app/features/ui/components/Spinner';
import {RadioGroup} from '@app/features/ui/radio_group/RadioGroup';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import Users from '@app/features/user/state/Users';
import * as FormUtils from '@app/lib/forms';
import {MessagePreviewContext, MessageStates, MessageTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {
	classifyGuildCommandTemplate,
	GUILD_COMMAND_NAME_PATTERN,
	type GuildCommandInputMode,
	type GuildCommandKind,
	type GuildCommandResponse,
	MAX_GUILD_COMMAND_DESCRIPTION_LENGTH,
	MAX_GUILD_COMMAND_HINT_LENGTH,
	MAX_GUILD_COMMAND_INPUT_LENGTH,
	MAX_GUILD_COMMAND_TEMPLATE_LENGTH,
	MAX_GUILD_COMMANDS,
	RESERVED_GUILD_COMMAND_NAMES,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import {lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';

// Fork: the Commands tab in community settings (docs/design/server-commands.md, "Managing
// commands"). A list beside an editor, like the Roles tab; edits wait for upstream's Save bar.

const TAB_ID = 'commands';
const NEW_ID = 'new';
const logger = new Logger('GuildCommandsTab');

const TITLE = msg({message: 'Commands', comment: 'Title of the community settings tab for community slash commands.'});
const SUBTITLE = msg({
	message: 'Messages members can post by typing /name.',
	comment: 'Subtitle of the Commands tab in community settings. Keep "/name" as it is.',
});
const SLOTS = msg({message: 'Command slots', comment: 'Heading above the count of commands, like "Emoji slots".'});
const NEW_COMMAND = msg({message: 'New command', comment: 'Button that starts a new community command.'});
const SEARCH = msg({message: 'Search commands', comment: 'Placeholder of the search box in the Commands tab.'});
const EMPTY_TITLE = msg({message: 'No commands', comment: 'Empty state title in the Commands tab.'});
const EMPTY_BODY = msg({
	message: "This community doesn't have any commands yet.",
	comment: 'Empty state text in the Commands tab.',
});
const EDIT_TITLE = msg({
	message: 'Edit /{name}',
	comment: 'Heading of the command editor. Preserve {name}, the command name.',
});
const CREATED_BY = msg({
	message: 'Created by {name}',
	comment: 'Under the command editor heading: who made the command. Preserve {name}.',
});
const DELETE_COMMAND = msg({message: 'Delete command', comment: 'Button that deletes a community command.'});
const DELETE_CONFIRM_TITLE = msg({
	message: 'Delete /{name}?',
	comment: 'Title of the dialog confirming that a command is deleted. Preserve {name}.',
});
const DELETE_CONFIRM_BODY = msg({
	message: "This can't be undone. Messages made with it still show which command made them.",
	comment: 'Body of the dialog confirming that a command is deleted.',
});
const DELETE = msg({message: 'Delete', comment: 'Confirm button of the delete-command dialog.'});
const SECTION_COMMAND = msg({
	message: 'Command',
	comment: 'Section label in the command editor: name and description.',
});
const NAME = msg({message: 'Name', comment: 'Label of the command name field.'});
const NAME_INVALID = msg({
	message: 'Use lowercase letters, numbers, - and _, up to 32 characters.',
	comment: 'Error under the command name field when the name is not allowed.',
});
const NAME_TAKEN = msg({
	message: 'Another command or a built-in command already has this name.',
	comment: 'Error under the command name field.',
});
const DESCRIPTION = msg({message: 'Description', comment: 'Label of the command description field.'});
const SECTION_INPUT = msg({
	message: 'Input',
	comment: 'Section label in the command editor: whether members type something after the command.',
});
const INPUT_NONE = msg({message: 'None', comment: 'Choice: the command takes no input.'});
const INPUT_OPTIONAL = msg({message: 'Optional', comment: 'Choice: the command may take input.'});
const INPUT_REQUIRED = msg({message: 'Required', comment: 'Choice: the command needs input.'});
const HINT = msg({
	message: 'Hint',
	comment: 'Label of the field holding the placeholder shown while a member fills the command in.',
});
const USE_SCRIPT_EDITOR = msg({
	message: 'Use the script editor',
	comment: 'Button in the command editor that switches the message field to the code editor for scripts.',
});
const USE_BASIC_EDITOR = msg({
	message: 'Use the basic editor',
	comment: 'Button in the command editor that switches back from the code editor to the plain message field.',
});
const SCRIPT = msg({message: 'Script', comment: 'Label of the code editor for a community command.'});
const SCRIPT_PLACEHOLDER = msg({
	message: 'Type {output} or {tag} for suggestions.',
	comment:
		'Placeholder in the empty command script editor. {output} and {tag} are the characters to type; preserve them.',
});
const RUN_AGAIN = msg({
	message: 'Run again',
	comment: 'Button under the preview of a command script that picks at random: fills the preview in again.',
});
const EMPTY_PREVIEW = msg({
	message: 'This would post nothing, so the command would fail.',
	comment: 'Shown instead of the preview when a command script produces no text.',
});
const SECTION_MESSAGE = msg({message: 'Message', comment: 'Section label in the command editor: the template.'});
const INSERT = msg({message: 'Insert:', comment: 'Label before the buttons that insert placeholders into a command.'});
const PERSON = msg({
	message: 'Person running it',
	comment: 'Button inserting the placeholder for the member who runs the command.',
});
const WHAT_THEY_TYPE = msg({
	message: 'What they type',
	comment: 'Button inserting the placeholder for what the member types after the command.',
});
const SECTION_PREVIEW = msg({message: 'Preview', comment: 'Section label in the command editor.'});
const SAMPLE_INPUT = msg({
	message: 'Sample input',
	comment: 'Label of the field whose text stands in for what a member types, in the preview.',
});
const SAVED = msg({message: 'Commands saved', comment: 'Toast after saving the Commands tab.'});
const SAVE_FAILED = msg({
	message: "Couldn't save /{name}: {detail}",
	comment: 'Toast when saving a command fails. Preserve {name} and {detail}.',
});
const LOAD_FAILED = msg({
	message: "Couldn't load the commands.",
	comment: 'Shown when the Commands tab fails to load.',
});
const BACK = msg({message: 'Back to commands', comment: 'Button on narrow screens that returns to the command list.'});

interface Draft {
	id: string;
	name: string;
	description: string;
	template: string;
	input_mode: GuildCommandInputMode;
	input_hint: string;
	counters: Array<CounterDraft>;
}

function toDraft(command: GuildCommandResponse): Draft {
	return {
		id: command.id,
		name: command.name,
		description: command.description,
		template: templateForEditing(command.template ?? ''),
		input_mode: command.input_mode,
		input_hint: command.input_hint ?? '',
		counters: (command.counters ?? []).map((counter) => ({...counter})),
	};
}

const EMPTY_DRAFT: Draft = {
	id: NEW_ID,
	name: '',
	description: '',
	template: '# **{{ person }} {{ input }}**',
	input_mode: 'required',
	input_hint: '',
	counters: [],
};

function sameDraft(a: Draft, b: Draft): boolean {
	return (
		a.name === b.name &&
		a.description === b.description &&
		a.template === b.template &&
		a.input_mode === b.input_mode &&
		a.input_hint === b.input_hint &&
		JSON.stringify(a.counters) === JSON.stringify(b.counters)
	);
}

/** The template with `{{ person }}` and `{{ input }}` filled in, as a basic template is. */
function fillBasicTemplate(template: string, person: string, input: string): string {
	return template.replace(/\{\{\s*(person|input)\s*\}\}/g, (_match, name: string) =>
		name === 'person' ? person : input,
	);
}

const GuildCommandTemplateEditor = lazy(
	() => import('@app/features/guild_commands/components/GuildCommandTemplateEditor'),
);

const PICKS_AT_RANDOM = /\{%-?\s*random\b|\|\s*one_of\b/;

export const GuildCommandsTab = observer(function GuildCommandsTab({guildId}: {guildId: string}) {
	const {i18n} = useLingui();
	const [commands, setCommands] = useState<Array<GuildCommandResponse> | null>(null);
	const [failed, setFailed] = useState(false);
	const [edits, setEdits] = useState<Map<string, Draft>>(new Map());
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [showEditorOnMobile, setShowEditorOnMobile] = useState(false);
	const [query, setQuery] = useState('');
	const [sampleInput, setSampleInput] = useState('');
	const [saving, setSaving] = useState(false);
	const [editors, setEditors] = useState<Map<string, GuildCommandKind>>(new Map());
	const templateEditor = useRef<GuildCommandTemplateEditorHandle | null>(null);
	const sampleFieldRef = useRef<HTMLDivElement | null>(null);
	const sampleLabelId = useId();
	const currentUserId = Users.getCurrentUser()?.id ?? null;
	const canCreate = Permission.can(Permissions.CREATE_COMMANDS, {guildId});
	const canManage = Permission.can(Permissions.MANAGE_COMMANDS, {guildId});

	// A text channel of the community: the preview renders in it, and emoji resolve as in a message there.
	const previewChannel = useMemo(
		() => Channels.getGuildChannels(guildId).find((channel) => channel.type === 0) ?? null,
		[guildId],
	);

	const load = useCallback(async () => {
		try {
			const res = await http.get<Array<GuildCommandResponse>>(ForkEndpoints.GUILD_COMMANDS(guildId));
			if (!res.ok || !res.body) throw res;
			setCommands([...res.body].sort((a, b) => a.name.localeCompare(b.name)));
			setFailed(false);
		} catch (error) {
			logger.warn('Failed to load commands', error);
			setFailed(true);
		}
	}, [guildId]);

	useEffect(() => {
		void load();
	}, [load]);

	// A command's chip asked to open that command here.
	const editingRequest = GuildCommandsStore.editingRequest;
	useEffect(() => {
		if (editingRequest?.guildId !== guildId) return;
		setSelectedId(editingRequest.commandId);
		setShowEditorOnMobile(true);
		GuildCommandsStore.clearEditingRequest();
	}, [editingRequest, guildId]);

	const canModify = useCallback(
		(draft: Draft) => {
			if (draft.id === NEW_ID) return canCreate;
			const command = commands?.find((c) => c.id === draft.id);
			return canManage || (canCreate && command?.creator_id === currentUserId);
		},
		[canCreate, canManage, commands, currentUserId],
	);

	const draftFor = useCallback(
		(id: string): Draft | null => {
			const edited = edits.get(id);
			if (edited) return edited;
			if (id === NEW_ID) return EMPTY_DRAFT;
			const command = commands?.find((c) => c.id === id);
			return command ? toDraft(command) : null;
		},
		[commands, edits],
	);

	const effectiveSelected = selectedId ?? commands?.[0]?.id ?? null;
	const draft = effectiveSelected ? draftFor(effectiveSelected) : null;

	const update = (patch: Partial<Draft>) => {
		if (!draft) return;
		const next = {...draft, ...patch};
		const original = draft.id === NEW_ID ? null : commands?.find((c) => c.id === draft.id);
		setEdits((previous) => {
			const map = new Map(previous);
			if (original && sameDraft(next, toDraft(original))) map.delete(draft.id);
			else map.set(draft.id, next);
			return map;
		});
	};

	const nameError = (d: Draft): string | null => {
		if (!GUILD_COMMAND_NAME_PATTERN.test(d.name)) return i18n._(NAME_INVALID);
		if (RESERVED_GUILD_COMMAND_NAMES.has(d.name)) return i18n._(NAME_TAKEN);
		if (commands?.some((c) => c.name === d.name && c.id !== d.id)) return i18n._(NAME_TAKEN);
		return null;
	};

	/** The next new command starts in the basic editor, whichever this one used. */
	const forgetNewCommandEditor = useCallback(() => {
		setEditors((previous) => {
			const next = new Map(previous);
			next.delete(NEW_ID);
			return next;
		});
	}, []);

	// A new command stays selected, as a blank one: its draft is only what `edits` holds.
	const reset = useCallback(() => {
		setEdits(new Map());
		forgetNewCommandEditor();
	}, [forgetNewCommandEditor]);

	const saveProblem = useCallback(
		(error: unknown) => {
			const issue = templateIssueOfError(error);
			return issue ? describeTemplateIssue(i18n, issue) : FormUtils.extractErrorMessage(i18n, error);
		},
		[i18n],
	);

	const save = useCallback(async () => {
		setSaving(true);
		try {
			for (const pending of edits.values()) {
				const body = {
					name: pending.name,
					description: pending.description,
					template: templateForSaving({
						text: pending.template,
						stored: templateEmojiByName(commands?.find((c) => c.id === pending.id)?.template ?? ''),
						channel: previewChannel,
						guildId,
						i18n,
					}),
					input_mode: pending.input_mode,
					input_hint: pending.input_hint === '' ? null : pending.input_hint,
					counters: pending.counters,
				};
				try {
					const res =
						pending.id === NEW_ID
							? await http.post<GuildCommandResponse>(ForkEndpoints.GUILD_COMMANDS(guildId), {body})
							: await http.patch<GuildCommandResponse>(ForkEndpoints.GUILD_COMMAND(guildId, pending.id), {body});
					if (!res.ok) throw res;
					if (pending.id === NEW_ID && res.body) {
						setSelectedId(res.body.id);
						forgetNewCommandEditor();
					}
				} catch (error) {
					ToastCommands.createToast({
						type: 'error',
						children: i18n._(SAVE_FAILED, {name: pending.name, detail: saveProblem(error)}),
					});
					return;
				}
			}
			setEdits(new Map());
			ToastCommands.createToast({type: 'success', children: i18n._(SAVED)});
			await load();
		} finally {
			setSaving(false);
		}
	}, [commands, edits, forgetNewCommandEditor, guildId, i18n, load, previewChannel, saveProblem]);

	const hasInvalid = Array.from(edits.values()).some(
		(d) =>
			nameError(d) !== null ||
			d.template.trim() === '' ||
			d.counters.some((counter) => counterNameError(d.counters, counter)),
	);
	useEffect(() => {
		UnsavedChangesCommands.setUnsavedChanges(TAB_ID, edits.size > 0);
	}, [edits.size]);
	useEffect(() => {
		UnsavedChangesCommands.setTabData(TAB_ID, {
			onReset: reset,
			onSave: () => {
				if (!hasInvalid) void save();
			},
			isSubmitting: saving,
		});
	}, [reset, save, saving, hasInvalid]);
	useEffect(() => () => UnsavedChangesCommands.clearUnsavedChanges(TAB_ID), []);

	const confirmDelete = (target: Draft) => {
		ModalCommands.push(
			modal(() => (
				<ConfirmModal
					title={i18n._(DELETE_CONFIRM_TITLE, {name: target.name})}
					description={i18n._(DELETE_CONFIRM_BODY)}
					primaryText={i18n._(DELETE)}
					primaryVariant="danger"
					onPrimary={async () => {
						try {
							const res = await http.delete(ForkEndpoints.GUILD_COMMAND(guildId, target.id));
							if (!res.ok) throw res;
							setEdits((previous) => {
								const map = new Map(previous);
								map.delete(target.id);
								return map;
							});
							setSelectedId(null);
							setShowEditorOnMobile(false);
							await load();
						} catch (error) {
							ToastCommands.createToast({
								type: 'error',
								children: i18n._(SAVE_FAILED, {name: target.name, detail: FormUtils.extractErrorMessage(i18n, error)}),
							});
						}
					}}
					data-flx="guild-commands.guild-commands-tab.delete-confirm"
				/>
			)),
		);
	};

	const currentUser = Users.getCurrentUser();
	const draftText = draft?.template ?? '';
	const draftId = draft?.id;
	const draftInputMode = draft?.input_mode;
	const previewTemplate = useMemo(
		() =>
			templateForSaving({
				text: draftText,
				stored: templateEmojiByName(commands?.find((c) => c.id === draftId)?.template ?? ''),
				channel: previewChannel,
				guildId,
				i18n,
			}),
		[commands, draftId, draftText, previewChannel, guildId, i18n],
	);
	const previewInput = useMemo(
		() =>
			draftInputMode === 'none'
				? ''
				: resolveTypedEmojiShortcodes({content: sampleInput, channel: previewChannel, guildIdFallback: guildId, i18n}),
		[draftInputMode, sampleInput, previewChannel, guildId, i18n],
	);
	const isScript = classifyGuildCommandTemplate(previewTemplate) === 'script';
	const {result: scriptPreview, runAgain} = useGuildCommandScriptPreview({
		guildId,
		channelId: previewChannel?.id ?? null,
		template: previewTemplate,
		input: previewInput,
		counterNames: draft?.counters.map((counter) => counter.name),
		enabled: isScript,
	});
	const previewIssue = isScript ? scriptPreview.issue : null;
	const previewContent = isScript
		? scriptPreview.content
		: fillBasicTemplate(previewTemplate, `<@${currentUser?.id ?? ''}>`, previewInput);
	const scriptProblem = useMemo<GuildCommandTemplateProblem | null>(
		() =>
			previewIssue?.line
				? {
						line: previewIssue.line,
						column: previewIssue.column ?? 1,
						message: describeTemplateIssue(i18n, previewIssue),
					}
				: null,
		[previewIssue, i18n],
	);
	const previewMessage = useMemo(() => {
		if (!previewChannel || !currentUser || !previewContent) return null;
		return new MessageModel(
			{
				id: '1000000000000000051',
				channel_id: previewChannel.id,
				author: currentUser.toJSON(),
				type: MessageTypes.DEFAULT,
				flags: 0,
				pinned: false,
				mention_everyone: false,
				content: previewContent,
				timestamp: new Date().toISOString(),
				state: MessageStates.SENT,
			},
			{skipUserCache: true, skipReactionHydration: true},
		);
	}, [previewChannel, currentUser, previewContent]);

	if (failed) {
		return (
			<p className={styles.notice} data-flx="guild-commands.guild-commands-tab.load-failed">
				{i18n._(LOAD_FAILED)}
			</p>
		);
	}
	if (commands === null) {
		return <Spinner data-flx="guild-commands.guild-commands-tab.spinner" />;
	}

	const listed = commands.filter((c) => c.name.includes(query.trim().toLowerCase()));
	const isMobile = MobileLayout.enabled;
	const showList = !isMobile || !showEditorOnMobile;
	const showEditor = draft !== null && (!isMobile || showEditorOnMobile);
	const editable = draft !== null && canModify(draft);
	const editor: GuildCommandKind =
		(draft && (editors.get(draft.id) ?? commands?.find((c) => c.id === draft.id)?.kind)) ?? 'basic';
	const creator = draft && draft.id !== NEW_ID ? commands.find((c) => c.id === draft.id)?.creator_id : null;
	const creatorName = creator ? Users.getUser(creator)?.displayName : null;

	return (
		<div className={styles.container} data-flx="guild-commands.guild-commands-tab.container">
			<header className={styles.header} data-flx="guild-commands.guild-commands-tab.header">
				<h2 className={styles.title} data-flx="guild-commands.guild-commands-tab.title">
					{i18n._(TITLE)}
				</h2>
				<p className={styles.subtitle} data-flx="guild-commands.guild-commands-tab.subtitle">
					{i18n._(SUBTITLE)}
				</p>
			</header>
			<div className={styles.layout} data-flx="guild-commands.guild-commands-tab.layout">
				{showList && (
					<section className={styles.list} data-flx="guild-commands.guild-commands-tab.list">
						<div className={styles.slots} data-flx="guild-commands.guild-commands-tab.slots">
							<span data-flx="guild-commands.guild-commands-tab.slots-title">{i18n._(SLOTS)}</span>
							<span className={styles.count} data-flx="guild-commands.guild-commands-tab.slots-count">
								{`${commands.length} / ${MAX_GUILD_COMMANDS}`}
							</span>
						</div>
						{canCreate && (
							<Button
								onClick={() => {
									setSelectedId(NEW_ID);
									setShowEditorOnMobile(true);
								}}
								disabled={commands.length >= MAX_GUILD_COMMANDS || edits.has(NEW_ID)}
								data-flx="guild-commands.guild-commands-tab.new-command"
							>
								{i18n._(NEW_COMMAND)}
							</Button>
						)}
						<Input
							type="text"
							placeholder={i18n._(SEARCH)}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							data-flx="guild-commands.guild-commands-tab.search"
						/>
						{commands.length === 0 && !edits.has(NEW_ID) ? (
							<div className={styles.empty} data-flx="guild-commands.guild-commands-tab.empty">
								<strong data-flx="guild-commands.guild-commands-tab.empty-title">{i18n._(EMPTY_TITLE)}</strong>
								<span data-flx="guild-commands.guild-commands-tab.empty-body">{i18n._(EMPTY_BODY)}</span>
							</div>
						) : (
							<ul className={styles.rows} data-flx="guild-commands.guild-commands-tab.rows">
								{[...(edits.has(NEW_ID) ? [draftFor(NEW_ID)!] : []), ...listed.map((c) => draftFor(c.id)!)].map(
									(row) => (
										<li key={row.id} data-flx="guild-commands.guild-commands-tab.row-item">
											<button
												type="button"
												className={clsx(styles.row, row.id === effectiveSelected && styles.rowSelected)}
												onClick={() => {
													setSelectedId(row.id);
													setShowEditorOnMobile(true);
												}}
												data-flx="guild-commands.guild-commands-tab.row"
											>
												<span className={styles.rowName} data-flx="guild-commands.guild-commands-tab.row-name">
													{`/${row.name}`}
												</span>
												<span
													className={styles.rowDescription}
													data-flx="guild-commands.guild-commands-tab.row-description"
												>
													{row.description}
												</span>
											</button>
										</li>
									),
								)}
							</ul>
						)}
					</section>
				)}
				{showEditor && draft && (
					<section className={styles.editor} data-flx="guild-commands.guild-commands-tab.editor">
						{isMobile && (
							<Button
								variant="secondary"
								onClick={() => setShowEditorOnMobile(false)}
								data-flx="guild-commands.guild-commands-tab.back"
							>
								{i18n._(BACK)}
							</Button>
						)}
						<div className={styles.editorHeader} data-flx="guild-commands.guild-commands-tab.editor-header">
							<div data-flx="guild-commands.guild-commands-tab.editor-heading">
								<h3 className={styles.editorTitle} data-flx="guild-commands.guild-commands-tab.editor-title">
									{draft.id === NEW_ID ? i18n._(NEW_COMMAND) : i18n._(EDIT_TITLE, {name: draft.name})}
								</h3>
								{creatorName && (
									<span className={styles.muted} data-flx="guild-commands.guild-commands-tab.created-by">
										{i18n._(CREATED_BY, {name: creatorName})}
									</span>
								)}
							</div>
							{editable && draft.id !== NEW_ID && (
								<Button
									variant="danger"
									onClick={() => confirmDelete(draft)}
									data-flx="guild-commands.guild-commands-tab.delete"
								>
									{i18n._(DELETE_COMMAND)}
								</Button>
							)}
						</div>

						<div className={styles.sectionLabel} data-flx="guild-commands.guild-commands-tab.section-command">
							{i18n._(SECTION_COMMAND)}
						</div>
						<div className={styles.fieldRow} data-flx="guild-commands.guild-commands-tab.field-row">
							<Input
								label={i18n._(NAME)}
								value={draft.name}
								disabled={!editable}
								maxLength={32}
								leftElement={
									<span className={styles.slash} data-flx="guild-commands.guild-commands-tab.slash">
										/
									</span>
								}
								error={draft.name === '' ? null : nameError(draft)}
								onChange={(event) => update({name: event.target.value.toLowerCase()})}
								data-flx="guild-commands.guild-commands-tab.name"
							/>
							<Input
								label={i18n._(DESCRIPTION)}
								value={draft.description}
								disabled={!editable}
								maxLength={MAX_GUILD_COMMAND_DESCRIPTION_LENGTH}
								onChange={(event) => update({description: event.target.value})}
								data-flx="guild-commands.guild-commands-tab.description"
							/>
						</div>

						<div className={styles.sectionLabel} data-flx="guild-commands.guild-commands-tab.section-input">
							{i18n._(SECTION_INPUT)}
						</div>
						<RadioGroup<GuildCommandInputMode>
							aria-label={i18n._(SECTION_INPUT)}
							options={[
								{value: 'none', name: i18n._(INPUT_NONE)},
								{value: 'optional', name: i18n._(INPUT_OPTIONAL)},
								{value: 'required', name: i18n._(INPUT_REQUIRED)},
							]}
							value={draft.input_mode}
							disabled={!editable}
							onChange={(mode) => {
								update({input_mode: mode});
								if (mode === 'none') setSampleInput('');
							}}
							data-flx="guild-commands.guild-commands-tab.input-mode"
						/>
						{draft.input_mode !== 'none' && (
							<Input
								label={i18n._(HINT)}
								value={draft.input_hint}
								disabled={!editable}
								maxLength={MAX_GUILD_COMMAND_HINT_LENGTH}
								onChange={(event) => update({input_hint: event.target.value})}
								data-flx="guild-commands.guild-commands-tab.hint"
							/>
						)}

						<div className={styles.sectionRow} data-flx="guild-commands.guild-commands-tab.section-row">
							<div className={styles.sectionLabel} data-flx="guild-commands.guild-commands-tab.section-message">
								{i18n._(SECTION_MESSAGE)}
							</div>
							{editable && (editor === 'basic' || !isScript) && (
								<button
									type="button"
									className={styles.switchEditor}
									onClick={() =>
										setEditors((previous) => new Map(previous).set(draft.id, editor === 'basic' ? 'script' : 'basic'))
									}
									data-flx="guild-commands.guild-commands-tab.switch-editor"
								>
									{i18n._(editor === 'basic' ? USE_SCRIPT_EDITOR : USE_BASIC_EDITOR)}
								</button>
							)}
						</div>
						{editable && editor === 'basic' && (
							<div className={styles.insertRow} data-flx="guild-commands.guild-commands-tab.insert-row">
								<span className={styles.muted} data-flx="guild-commands.guild-commands-tab.insert-label">
									{i18n._(INSERT)}
								</span>
								<button
									type="button"
									className={styles.insertButton}
									onClick={() => templateEditor.current?.insert('{{ person }}')}
									data-flx="guild-commands.guild-commands-tab.insert-person"
								>
									{i18n._(PERSON)}
								</button>
								<button
									type="button"
									className={styles.insertButton}
									onClick={() => templateEditor.current?.insert('{{ input }}')}
									data-flx="guild-commands.guild-commands-tab.insert-input"
								>
									{i18n._(WHAT_THEY_TYPE)}
								</button>
							</div>
						)}
						<div className={styles.scriptField} data-flx="guild-commands.guild-commands-tab.script-field">
							<div className={styles.scriptHeader} data-flx="guild-commands.guild-commands-tab.script-header">
								<span className={formStyles.label} data-flx="guild-commands.guild-commands-tab.script-label">
									{i18n._(editor === 'script' ? SCRIPT : SECTION_MESSAGE)}
								</span>
								<span className={styles.scriptCount} data-flx="guild-commands.guild-commands-tab.script-count">
									{i18n.number(draft.template.length)}/{i18n.number(MAX_GUILD_COMMAND_TEMPLATE_LENGTH)}
								</span>
							</div>
							<Suspense
								fallback={
									<div className={styles.editorLoading} data-flx="guild-commands.guild-commands-tab.editor-loading" />
								}
								data-flx="guild-commands.guild-commands-tab.script-suspense"
							>
								<GuildCommandTemplateEditor
									key={`${draft.id}:${editor}`}
									mode={editor}
									value={draft.template}
									channel={previewChannel}
									disabled={!editable}
									ariaLabel={i18n._(editor === 'script' ? SCRIPT : SECTION_MESSAGE)}
									placeholderText={
										editor === 'script' ? i18n._(SCRIPT_PLACEHOLDER, {output: '{{', tag: '{%'}) : undefined
									}
									problem={scriptProblem}
									handleRef={templateEditor}
									onChange={(template) => update({template})}
									data-flx="guild-commands.guild-commands-tab.template"
								/>
							</Suspense>
							{editor === 'script' && (
								<GuildCommandScriptReference data-flx="guild-commands.guild-commands-tab.script-reference" />
							)}
						</div>

						<GuildCommandCountersSection
							guildId={guildId}
							commandId={draft.id === NEW_ID ? null : draft.id}
							counters={draft.counters}
							editable={editable}
							takesInput={draft.input_mode !== 'none'}
							onChange={(counters) => update({counters})}
							data-flx="guild-commands.guild-commands-tab.guild-command-counters-section.update"
						/>

						<div className={styles.sectionLabel} data-flx="guild-commands.guild-commands-tab.section-preview">
							{i18n._(SECTION_PREVIEW)}
						</div>
						{draft.input_mode !== 'none' && (
							<div className={styles.scriptField} data-flx="guild-commands.guild-commands-tab.sample-field">
								<span
									id={sampleLabelId}
									className={formStyles.label}
									data-flx="guild-commands.guild-commands-tab.sample-label"
								>
									{i18n._(SAMPLE_INPUT)}
								</span>
								<div
									ref={sampleFieldRef}
									className={clsx(formStyles.textareaWrapper, surfaceStyles.surface, formStyles.focusable)}
									data-flx="guild-commands.guild-commands-tab.sample-wrapper"
								>
									<LexicalRichInput
										placeholder=""
										channel={previewChannel}
										allowSpecialMentions={false}
										markdown={false}
										singleLine
										size="form"
										maxLength={MAX_GUILD_COMMAND_INPUT_LENGTH}
										className={styles.sampleInput}
										autocompleteAnchor={sampleFieldRef.current}
										ariaLabelledBy={sampleLabelId}
										onChange={(_display, _segments, wire) => setSampleInput(wire)}
										i18n={i18n}
										data-flx="guild-commands.guild-commands-tab.sample-input"
									/>
								</div>
							</div>
						)}
						{previewIssue && (
							<p className={styles.problem} data-flx="guild-commands.guild-commands-tab.problem">
								{describeTemplateIssue(i18n, previewIssue)}
							</p>
						)}
						{isScript && previewContent === '' && (
							<p className={styles.notice} data-flx="guild-commands.guild-commands-tab.empty-preview">
								{i18n._(EMPTY_PREVIEW)}
							</p>
						)}
						{previewChannel && previewMessage && (
							<div className={styles.preview} data-flx="guild-commands.guild-commands-tab.preview">
								<Message
									channel={previewChannel}
									message={previewMessage}
									previewContext={MessagePreviewContext.SETTINGS}
									shouldGroup={false}
									data-flx="guild-commands.guild-commands-tab.preview-message"
								/>
							</div>
						)}
						{isScript && (PICKS_AT_RANDOM.test(draft.template) || draft.counters.length > 0) && (
							<div data-flx="guild-commands.guild-commands-tab.run-again-row">
								<Button
									variant="secondary"
									compact
									fitContent
									onClick={runAgain}
									data-flx="guild-commands.guild-commands-tab.run-again"
								>
									{i18n._(RUN_AGAIN)}
								</Button>
							</div>
						)}
					</section>
				)}
			</div>
		</div>
	);
});
