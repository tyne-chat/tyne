// SPDX-License-Identifier: AGPL-3.0-or-later

import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/subprofile/SubprofileSchemas';
import {clsx} from 'clsx';
import type React from 'react';
import styles from './SubprofileTag.module.css';

interface SubprofileTagProps {
	subprofile: MessageSubprofileResponse;
	rootUser: User;
	className?: string;
}

export const SubprofileTag: React.FC<SubprofileTagProps> = ({subprofile, rootUser, className}) => {
	const tagText = subprofile.system_name || 'Persona';
	const tooltipText = `Account: @${rootUser.username}`;

	return (
		<Tooltip text={tooltipText} position="top" data-flx="subprofile.subprofile-tag.tooltip">
			<span className={clsx(styles.tag, className)} data-flx="subprofile.tag">
				<span className={styles.text} data-flx="subprofile.subprofile-tag.text">
					{tagText}
				</span>
			</span>
		</Tooltip>
	);
};
