// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import {PersonaProfilePopout} from '@app/features/persona/components/PersonaProfilePopout';
import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {observer} from 'mobx-react-lite';
import type React from 'react';

interface PersonaProfileModalProps {
	subprofile: MessageSubprofileResponse;
	user: User;
	guildId?: string;
	guildMember?: GuildMember | null;
	onClose: () => void;
}

export const PersonaProfileModal: React.FC<PersonaProfileModalProps> = observer(
	({subprofile, user, guildId, guildMember, onClose}) => {
		return (
			<Modal.Root size="small" centered onClose={onClose} data-flx="persona.persona-profile-modal.root">
				<PersonaProfilePopout
					subprofile={subprofile}
					user={user}
					guildId={guildId}
					guildMember={guildMember}
					onClose={onClose}
					data-flx="persona.persona-profile-modal.persona-profile-popout"
				/>
			</Modal.Root>
		);
	},
);
