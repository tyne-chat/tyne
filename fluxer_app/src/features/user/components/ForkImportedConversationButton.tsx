// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Open DM on a Discord import placeholder's profile, in the place of Message, when you have an imported
// conversation with it (tyne-chat/tyne#696). Nobody is behind a placeholder, so it opens the history only:
// the server reopens that DM and refuses any other. Each renders nothing for anyone else.

import {OPEN_DM_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {Button} from '@app/features/ui/button/Button';
import sheetStyles from '@app/features/user/components/modals/UserProfileMobileSheet.module.css';
import modalStyles from '@app/features/user/components/modals/UserProfileModal.module.css';
import popoutStyles from '@app/features/user/components/popouts/UserProfilePopout.module.css';
import {ProfileCardFooter} from '@app/features/user/components/profile/profile_card/ProfileCardFooter';
import {useImportedConversation} from '@app/features/user/state/ForkImportedConversations';
import {useLingui} from '@lingui/react/macro';
import {ChatTeardropIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

interface ImportedConversationProps {
	user: {id: string; flags: number} | null | undefined;
	/** Opens the DM (the profile's own Message handler), closing the profile where it does. */
	onOpen: () => void;
}

/** The profile popout's footer, which a placeholder otherwise has none of. */
export const ImportedConversationFooter = observer(({user, onOpen}: ImportedConversationProps) => {
	const {i18n} = useLingui();
	if (!useImportedConversation(user)) return null;
	return (
		<ProfileCardFooter data-flx="user.imported-conversation-footer">
			<Button
				small={true}
				fitContainer={true}
				leftIcon={
					<ChatTeardropIcon className={popoutStyles.iconSmall} data-flx="user.imported-conversation-footer.icon" />
				}
				onClick={onOpen}
				data-flx="user.imported-conversation-footer.button"
			>
				{i18n._(OPEN_DM_DESCRIPTOR)}
			</Button>
		</ProfileCardFooter>
	);
});

/** The full profile's action button. */
export const ImportedConversationButton = observer(({user, onOpen}: ImportedConversationProps) => {
	const {i18n} = useLingui();
	if (!useImportedConversation(user)) return null;
	return (
		<Button
			small={true}
			leftIcon={
				<ChatTeardropIcon className={modalStyles.buttonIcon} data-flx="user.imported-conversation-button.icon" />
			}
			onClick={onOpen}
			data-flx="user.imported-conversation-button"
		>
			{i18n._(OPEN_DM_DESCRIPTOR)}
		</Button>
	);
});

/** The mobile profile sheet's action card. */
export const ImportedConversationActionCard = observer(({user, onOpen}: ImportedConversationProps) => {
	const {i18n} = useLingui();
	if (!useImportedConversation(user)) return null;
	return (
		<button
			type="button"
			onClick={onOpen}
			className={sheetStyles.actionCard}
			data-flx="user.imported-conversation-action-card"
		>
			<div className={sheetStyles.actionIconContainer} data-flx="user.imported-conversation-action-card.icon-container">
				<ChatTeardropIcon className={sheetStyles.actionIcon} data-flx="user.imported-conversation-action-card.icon" />
			</div>
			<span className={sheetStyles.actionLabel} data-flx="user.imported-conversation-action-card.label">
				{i18n._(OPEN_DM_DESCRIPTOR)}
			</span>
		</button>
	);
});
