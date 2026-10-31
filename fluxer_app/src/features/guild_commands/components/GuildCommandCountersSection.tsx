// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import styles from '@app/features/guild_commands/components/GuildCommandCountersSection.module.css';
import {http} from '@app/features/platform/transport/RestTransport';
import {Button} from '@app/features/ui/button/Button';
import {Checkbox} from '@app/features/ui/checkbox/Checkbox';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import * as FormUtils from '@app/lib/forms';
import {
	GUILD_COMMAND_COUNTER_NAME_PATTERN,
	type GuildCommandCounterIdentity,
	type GuildCommandCounterPart,
	MAX_GUILD_COMMAND_COUNTERS,
	RESERVED_GUILD_COMMAND_COUNTER_NAMES,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';

// Fork: a command's counters in its editor (docs/design/server-commands.md, "Counters"). They save
// with the command; only Reset counts acts at once, on counts already stored.

export interface CounterDraft {
	id: string | null;
	name: string;
	per: Array<GuildCommandCounterPart>;
	identity: GuildCommandCounterIdentity;
}

const TITLE = msg({message: 'Counters', comment: 'Section of a community command that counts how often it was used.'});
const ADD = msg({message: 'Add counter', comment: 'Button that adds a counter to a community command.'});
const NAME = msg({message: 'Name', comment: 'Label of the name of a community command counter.'});
const SEPARATELY = msg({
	message: 'Count separately for each:',
	comment: 'Above the choices of what a community command counter keeps its own count for.',
});
const PERSON = msg({
	message: 'Person running it',
	comment: 'A community command counter counts per person who runs it.',
});
const TARGET = msg({
	message: 'Person mentioned',
	comment: 'A community command counter counts per person mentioned. The command then needs a mention to run.',
});
const CHANNEL = msg({message: 'Channel', comment: 'A community command counter counts per channel.'});
const PERSONAS = msg({
	message: 'Count personas separately',
	comment: 'Option of a community command counter: a persona counts as its own person, not as its account.',
});
const REMOVE = msg({message: 'Remove counter', comment: 'Button that removes a counter from a community command.'});
const RESET = msg({
	message: 'Reset counts',
	comment: 'Button that sets all counts of a community command counter to zero.',
});
const RESET_CONFIRM = msg({
	message: "Reset the counts of {name}? This can't be undone.",
	comment: 'Confirmation before resetting a community command counter. Preserve {name}.',
});
const NAME_INVALID = msg({
	message: 'Use lowercase letters, numbers and _, starting with a letter, and not a name scripts already use.',
	comment: 'Error under the name of a community command counter.',
});
const HOW_TO_USE = msg({
	message: 'Use it in a script as {variable}. Each run adds one first, so the first run reads 1.',
	comment: 'Help under a community command counter. {variable} is code such as {{ hugs }}. Preserve {variable}.',
});

export function counterNameError(counters: ReadonlyArray<CounterDraft>, counter: CounterDraft): boolean {
	return (
		!GUILD_COMMAND_COUNTER_NAME_PATTERN.test(counter.name) ||
		RESERVED_GUILD_COMMAND_COUNTER_NAMES.has(counter.name) ||
		counters.filter((other) => other.name === counter.name).length > 1
	);
}

export function GuildCommandCountersSection({
	guildId,
	commandId,
	counters,
	editable,
	takesInput,
	onChange,
	'data-flx': dataFlx,
}: {
	guildId: string;
	commandId: string | null;
	counters: ReadonlyArray<CounterDraft>;
	editable: boolean;
	takesInput: boolean;
	onChange: (counters: Array<CounterDraft>) => void;
	'data-flx'?: string;
}) {
	const {i18n} = useLingui();

	const change = (index: number, patch: Partial<CounterDraft>) =>
		onChange(counters.map((counter, at) => (at === index ? {...counter, ...patch} : counter)));

	const togglePart = (index: number, part: GuildCommandCounterPart, on: boolean) => {
		const per = counters[index]?.per ?? [];
		change(index, {per: on ? [...per, part] : per.filter((other) => other !== part)});
	};

	const confirmReset = (counter: CounterDraft) => {
		ModalCommands.push(
			modal(() => (
				<ConfirmModal
					title={i18n._(RESET)}
					description={i18n._(RESET_CONFIRM, {name: counter.name})}
					primaryText={i18n._(RESET)}
					primaryVariant="danger"
					onPrimary={async () => {
						try {
							const res = await http.delete(
								ForkEndpoints.GUILD_COMMAND_COUNTS(guildId, commandId ?? '', counter.id ?? ''),
							);
							if (!res.ok) throw res;
						} catch (error) {
							ToastCommands.createToast({type: 'error', children: FormUtils.extractErrorMessage(i18n, error)});
						}
					}}
					data-flx="guild-commands.guild-command-counters-section.reset-confirm"
				/>
			)),
		);
	};

	const part = (index: number, value: GuildCommandCounterPart, label: string, disabled: boolean) => (
		<Checkbox
			checked={(counters[index]?.per ?? []).includes(value)}
			disabled={disabled}
			onChange={(on) => togglePart(index, value, on)}
			data-flx={`guild-commands.guild-command-counters-section.per-${value}`}
		>
			{label}
		</Checkbox>
	);

	return (
		<div className={styles.section} data-flx={dataFlx}>
			<div className={styles.title} data-flx="guild-commands.guild-command-counters-section.title">
				{i18n._(TITLE)}
			</div>
			{counters.map((counter, index) => (
				<div
					key={counter.id ?? `new-${index}`}
					className={styles.counter}
					data-flx="guild-commands.guild-command-counters-section.counter"
				>
					<Input
						label={i18n._(NAME)}
						value={counter.name}
						disabled={!editable}
						maxLength={32}
						error={counter.name !== '' && counterNameError(counters, counter) ? i18n._(NAME_INVALID) : null}
						onChange={(event) => change(index, {name: event.target.value})}
						data-flx="guild-commands.guild-command-counters-section.name"
					/>
					<div className={styles.label} data-flx="guild-commands.guild-command-counters-section.separately">
						{i18n._(SEPARATELY)}
					</div>
					{part(index, 'person', i18n._(PERSON), !editable)}
					{part(index, 'target', i18n._(TARGET), !editable || !takesInput)}
					{part(index, 'channel', i18n._(CHANNEL), !editable)}
					<Checkbox
						checked={counter.identity === 'persona'}
						disabled={!editable}
						onChange={(on) => change(index, {identity: on ? 'persona' : 'account'})}
						data-flx="guild-commands.guild-command-counters-section.personas"
					>
						{i18n._(PERSONAS)}
					</Checkbox>
					<p className={styles.help} data-flx="guild-commands.guild-command-counters-section.help">
						{i18n._(HOW_TO_USE, {variable: `{{ ${counter.name || 'name'} }}`})}
					</p>
					{editable && (
						<div className={styles.actions} data-flx="guild-commands.guild-command-counters-section.actions">
							{counter.id !== null && commandId !== null && (
								<Button
									variant="secondary"
									onClick={() => confirmReset(counter)}
									data-flx="guild-commands.guild-command-counters-section.reset"
								>
									{i18n._(RESET)}
								</Button>
							)}
							<Button
								variant="danger"
								onClick={() => onChange(counters.filter((_, at) => at !== index))}
								data-flx="guild-commands.guild-command-counters-section.remove"
							>
								{i18n._(REMOVE)}
							</Button>
						</div>
					)}
				</div>
			))}
			{editable && counters.length < MAX_GUILD_COMMAND_COUNTERS && (
				<Button
					variant="secondary"
					onClick={() => onChange([...counters, {id: null, name: '', per: [], identity: 'persona'}])}
					data-flx="guild-commands.guild-command-counters-section.add"
				>
					{i18n._(ADD)}
				</Button>
			)}
		</div>
	);
}
