// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {BLOCK_DESCRIPTOR} from '@app/features/moderation/utils/ModerationMessageDescriptors';
import * as PersonaBlockCommands from '@app/features/persona/commands/PersonaBlockCommands';
import {UNBLOCK_USER_ACTION_DESCRIPTOR} from '@app/features/relationship/utils/RelationshipMessageDescriptors';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';

// Blocking one persona (tyne-chat/tyne#921), with the same confirmations as blocking an account
// (RelationshipActionUtils.showBlockUserConfirmation and showUnblockUserConfirmation): a danger
// confirmation to block, a plain one to unblock, and Shift skips either, as it does there.

const BLOCK_PERSONA_TITLE_DESCRIPTOR = msg({
	message: 'Block persona',
	comment:
		'Title of the destructive confirmation modal for blocking one persona (one identity of another account) without blocking the account. Short command title.',
});
const BLOCK_PERSONA_BODY_DESCRIPTOR = msg({
	message:
		"Block {personaName}? Their messages will be collapsed, like a blocked user's. {ownerName}'s other personas won't be affected.",
	comment:
		'Body of the confirmation modal for blocking one persona. {personaName} is the persona, {ownerName} the account it belongs to. Messages from a blocked persona are folded into a "N blocked messages" row.',
});
const UNBLOCK_PERSONA_TITLE_DESCRIPTOR = msg({
	message: 'Unblock persona',
	comment: 'Title of the confirmation modal for unblocking a persona that was blocked. Short command title.',
});
const UNBLOCK_PERSONA_BODY_DESCRIPTOR = msg({
	message: 'Unblock {personaName}?',
	comment: 'Body of the confirmation modal for unblocking a persona. {personaName} is the persona.',
});
const BLOCK_PERSONA_FAILED_DESCRIPTOR = msg({
	message: "Couldn't block the persona. Try again.",
	comment: 'Error toast when blocking a persona fails.',
});
const UNBLOCK_PERSONA_FAILED_DESCRIPTOR = msg({
	message: "Couldn't unblock the persona. Try again.",
	comment: 'Error toast when unblocking a persona fails.',
});

export interface PersonaBlockTarget {
	userId: string;
	personaId: string;
	personaName: string;
	ownerName: string;
}

export interface PersonaBlockConfirmationOptions {
	/** Skip the confirmation, as Shift-click does for an account. */
	bypassConfirm?: boolean;
}

async function block(i18n: I18n, target: PersonaBlockTarget): Promise<void> {
	try {
		await PersonaBlockCommands.blockPersona(target.userId, target.personaId);
	} catch {
		ToastCommands.createToast({type: 'error', children: i18n._(BLOCK_PERSONA_FAILED_DESCRIPTOR)});
	}
}

async function unblock(i18n: I18n, target: PersonaBlockTarget): Promise<void> {
	try {
		await PersonaBlockCommands.unblockPersona(target.userId, target.personaId);
	} catch {
		ToastCommands.createToast({type: 'error', children: i18n._(UNBLOCK_PERSONA_FAILED_DESCRIPTOR)});
	}
}

export function showBlockPersonaConfirmation(
	i18n: I18n,
	target: PersonaBlockTarget,
	options: PersonaBlockConfirmationOptions = {},
): void {
	if (options.bypassConfirm) {
		void block(i18n, target);
		return;
	}
	ModalCommands.push(
		modal(() => (
			<ConfirmModal
				title={i18n._(BLOCK_PERSONA_TITLE_DESCRIPTOR)}
				description={i18n._(BLOCK_PERSONA_BODY_DESCRIPTOR, {
					personaName: target.personaName,
					ownerName: target.ownerName,
				})}
				primaryText={i18n._(BLOCK_DESCRIPTOR)}
				primaryVariant="danger"
				onPrimary={async () => {
					await block(i18n, target);
				}}
				showShiftBypassConfirmationTip={true}
				data-flx="persona.persona-block-actions.block-confirm-modal"
			/>
		)),
	);
}

export function showUnblockPersonaConfirmation(
	i18n: I18n,
	target: PersonaBlockTarget,
	options: PersonaBlockConfirmationOptions = {},
): void {
	if (options.bypassConfirm) {
		void unblock(i18n, target);
		return;
	}
	ModalCommands.push(
		modal(() => (
			<ConfirmModal
				title={i18n._(UNBLOCK_PERSONA_TITLE_DESCRIPTOR)}
				description={i18n._(UNBLOCK_PERSONA_BODY_DESCRIPTOR, {personaName: target.personaName})}
				primaryText={i18n._(UNBLOCK_USER_ACTION_DESCRIPTOR)}
				primaryVariant="primary"
				onPrimary={async () => {
					await unblock(i18n, target);
				}}
				showShiftBypassConfirmationTip={true}
				data-flx="persona.persona-block-actions.unblock-confirm-modal"
			/>
		)),
	);
}

/** Block or unblock, whichever applies now, after the matching confirmation. */
export function togglePersonaBlock(
	i18n: I18n,
	target: PersonaBlockTarget,
	isBlocked: boolean,
	options: PersonaBlockConfirmationOptions = {},
): void {
	if (isBlocked) showUnblockPersonaConfirmation(i18n, target, options);
	else showBlockPersonaConfirmation(i18n, target, options);
}

export {
	BLOCK_DESCRIPTOR as BLOCK_PERSONA_ACTION_DESCRIPTOR,
	UNBLOCK_USER_ACTION_DESCRIPTOR as UNBLOCK_PERSONA_ACTION_DESCRIPTOR,
};
