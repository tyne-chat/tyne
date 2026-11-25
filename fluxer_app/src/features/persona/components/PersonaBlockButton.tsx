// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaBlocks} from '@app/features/persona/state/PersonaBlocks';
import {
	BLOCK_PERSONA_ACTION_DESCRIPTOR,
	type PersonaBlockTarget,
	togglePersonaBlock,
	UNBLOCK_PERSONA_ACTION_DESCRIPTOR,
} from '@app/features/persona/utils/PersonaBlockActions';
import {Button} from '@app/features/ui/button/Button';
import {useLingui} from '@lingui/react/macro';
import {ProhibitIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';

interface PersonaBlockButtonProps extends PersonaBlockTarget {
	/** Called before the confirmation opens, to close a popout first. */
	onBeforeConfirm?: () => void;
	fitContainer?: boolean;
	fitContent?: boolean;
	iconClassName?: string;
	'data-flx'?: string;
}

/** Block or Unblock beside a persona's Message button (tyne-chat/tyne#921). */
export const PersonaBlockButton: React.FC<PersonaBlockButtonProps> = observer(
	({userId, personaId, personaName, ownerName, onBeforeConfirm, fitContainer, fitContent, iconClassName, ...rest}) => {
		const {i18n} = useLingui();
		const isBlocked = PersonaBlocks.isBlocked(userId, personaId);
		const handleClick = (event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
			const bypassConfirm = Boolean(event.shiftKey);
			onBeforeConfirm?.();
			togglePersonaBlock(i18n, {userId, personaId, personaName, ownerName}, isBlocked, {bypassConfirm});
		};
		return (
			<Button
				small={true}
				variant="secondary"
				fitContainer={fitContainer}
				fitContent={fitContent}
				leftIcon={<ProhibitIcon size={16} className={iconClassName} data-flx="persona.persona-block-button.icon" />}
				onClick={handleClick}
				aria-pressed={isBlocked}
				data-flx={rest['data-flx'] ?? 'persona.persona-block-button'}
			>
				{i18n._(isBlocked ? UNBLOCK_PERSONA_ACTION_DESCRIPTOR : BLOCK_PERSONA_ACTION_DESCRIPTOR)}
			</Button>
		);
	},
);
