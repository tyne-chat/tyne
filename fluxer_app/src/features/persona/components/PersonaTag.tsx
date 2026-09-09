// SPDX-License-Identifier: AGPL-3.0-or-later

import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {clsx} from 'clsx';
import type React from 'react';
import styles from './PersonaTag.module.css';

interface PersonaTagProps {
	subprofile: MessageSubprofileResponse;
	rootUser: User;
	className?: string;
}

export const PersonaTag: React.FC<PersonaTagProps> = ({subprofile, rootUser, className}) => {
	const tagText = subprofile.system_name || 'Persona';
	const tooltipText = `Account: @${rootUser.username}`;

	return (
		<Tooltip text={tooltipText} position="top" data-flx="persona.persona-tag.tooltip">
			<span className={clsx(styles.tag, className)} data-flx="persona.tag">
				<span className={styles.text} data-flx="persona.persona-tag.text">
					{tagText}
				</span>
			</span>
		</Tooltip>
	);
};

export const SubprofileTag = PersonaTag;
