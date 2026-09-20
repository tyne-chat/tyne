// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import {PersonaProfilePopout} from '@app/features/persona/components/PersonaProfilePopout';
import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useMemo} from 'react';

const PERSONA_PROFILE_DESCRIPTOR = msg({
	message: 'Persona profile: {name}',
	comment:
		'Screen reader label for the persona profile modal. Keep it concise. Preserve {name}; it is inserted by code.',
});
const PERSONA_PROFILE_FALLBACK_DESCRIPTOR = msg({
	message: 'Persona profile',
	comment: 'Fallback screen reader label for the persona profile modal. Keep it concise.',
});

interface PersonaProfileModalProps {
	subprofile: MessageSubprofileResponse;
	user: User;
	guildId?: string;
	guildMember?: GuildMember | null;
	onClose: () => void;
}

export const PersonaProfileModal: React.FC<PersonaProfileModalProps> = observer(
	({subprofile, user, guildId, guildMember, onClose}) => {
		const {i18n} = useLingui();
		const screenReaderLabel = useMemo(() => {
			if (subprofile?.name) {
				return i18n._(PERSONA_PROFILE_DESCRIPTOR, {name: subprofile.name});
			}
			return i18n._(PERSONA_PROFILE_FALLBACK_DESCRIPTOR);
		}, [subprofile?.name, i18n.locale]);

		return (
			<Modal.Root size="small" centered onClose={onClose} data-flx="persona.persona-profile-modal.root">
				<Modal.ScreenReaderLabel
					text={screenReaderLabel}
					data-flx="persona.persona-profile-modal.screen-reader-label"
				/>
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
