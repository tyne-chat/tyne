// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {useCursorAtEnd} from '@app/features/app/hooks/useCursorAtEnd';
import {CANCEL_DESCRIPTOR, SAVE_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {personaErrorMessage} from '@app/features/persona/commands/PersonaCommands';
import * as PersonaGroupCommands from '@app/features/persona/commands/PersonaGroupCommands';
import * as M from '@app/features/persona/utils/PersonaGroupMessages';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Form} from '@app/features/ui/components/form/Form';
import {Input} from '@app/features/ui/components/form/FormInput';
import {PERSONA_GROUP_NAME_MAX_LENGTH} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';
import type {MessageDescriptor} from '@lingui/core';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useForm} from 'react-hook-form';

// Fork: naming a persona group, new or renamed (tyne-chat/tyne#829), shaped like upstream's
// RenameChannelModal.

interface FormInputs {
	name: string;
}

const PersonaGroupNameModal = observer(
	({
		title,
		submitText,
		initialName,
		save,
	}: {
		title: MessageDescriptor;
		submitText: MessageDescriptor;
		initialName: string;
		save: (name: string) => Promise<void>;
	}) => {
		const {i18n} = useLingui();
		const form = useForm<FormInputs>({defaultValues: {name: initialName}});
		const nameRef = useCursorAtEnd<HTMLInputElement>();
		const onSubmit = async (data: FormInputs) => {
			const name = data.name.trim();
			if (!name) return;
			try {
				await save(name);
			} catch (err) {
				form.setError('name', {
					type: 'server',
					message: personaErrorMessage(err, i18n._(M.GROUPS_CHANGE_FAILED_DESCRIPTOR)) ?? undefined,
				});
				return;
			}
			ModalCommands.pop();
		};
		const name = form.watch('name');
		const registered = form.register('name');
		return (
			<Modal.Root size="small" centered data-flx="persona.group-name-modal.root">
				<Form
					form={form}
					onSubmit={onSubmit}
					aria-label={i18n._(title)}
					data-flx="persona.group-name-modal.form.submit"
				>
					<Modal.Header title={i18n._(title)} data-flx="persona.group-name-modal.header" />
					<Modal.Content data-flx="persona.group-name-modal.content">
						<Modal.ContentLayout data-flx="persona.group-name-modal.content-layout">
							<Input
								{...registered}
								ref={(el) => {
									nameRef(el);
									registered.ref(el);
								}}
								autoFocus={true}
								autoComplete="off"
								error={form.formState.errors.name?.message}
								label={i18n._(M.GROUP_NAME_DESCRIPTOR)}
								maxLength={PERSONA_GROUP_NAME_MAX_LENGTH}
								data-flx="persona.group-name-modal.input"
							/>
						</Modal.ContentLayout>
					</Modal.Content>
					<Modal.Footer data-flx="persona.group-name-modal.footer">
						<Button onClick={ModalCommands.pop} variant="secondary" data-flx="persona.group-name-modal.cancel">
							{i18n._(CANCEL_DESCRIPTOR)}
						</Button>
						<Button
							type="submit"
							disabled={!name?.trim()}
							submitting={form.formState.isSubmitting}
							data-flx="persona.group-name-modal.submit"
						>
							{i18n._(submitText)}
						</Button>
					</Modal.Footer>
				</Form>
			</Modal.Root>
		);
	},
);

/** Asks a name and makes the group, with these personas in it already; `onCreated` gets its id. */
export function openNewPersonaGroupModal(
	personaIds: ReadonlyArray<string> = [],
	onCreated?: (groupId: string) => void,
): void {
	ModalCommands.push(
		modal(() => (
			<PersonaGroupNameModal
				title={M.NEW_GROUP_DESCRIPTOR}
				submitText={M.CREATE_GROUP_DESCRIPTOR}
				initialName=""
				save={async (name) => {
					const group = await PersonaGroupCommands.createPersonaGroup(name, personaIds);
					onCreated?.(group.id);
				}}
				data-flx="persona.group-name-modal.new"
			/>
		)),
	);
}

export function openRenamePersonaGroupModal(groupId: string, currentName: string): void {
	ModalCommands.push(
		modal(() => (
			<PersonaGroupNameModal
				title={M.RENAME_GROUP_DESCRIPTOR}
				submitText={SAVE_DESCRIPTOR}
				initialName={currentName}
				save={async (name) => {
					await PersonaGroupCommands.renamePersonaGroup(groupId, name);
				}}
				data-flx="persona.group-name-modal.rename"
			/>
		)),
	);
}
