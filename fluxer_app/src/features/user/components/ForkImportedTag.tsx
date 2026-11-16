// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the tag after a placeholder account's name (tyne-chat/tyne#682), styled as upstream's Bot tag.

import styles from '@app/features/channel/components/ChannelUserTag.module.css';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';

const IMPORTED_TAG_DESCRIPTOR = msg({
	message: 'Imported',
	comment:
		'Tag after the name of a placeholder account that the Discord history import made for someone who is not on Tyne. Keep it one short word.',
});

const IMPORTED_TOOLTIP_DESCRIPTOR = msg({
	message: 'Placeholder for someone not on Tyne: these messages were imported from Discord.',
	comment: 'Tooltip of the Imported tag after the name of a placeholder account.',
});

export function ImportedTag() {
	const {i18n} = useLingui();
	return (
		<Tooltip text={i18n._(IMPORTED_TOOLTIP_DESCRIPTOR)} data-flx="user.imported-tag.tooltip">
			<span className={clsx(styles.tag, styles.tagSm)} data-flx="user.imported-tag">
				<span className={clsx(styles.text, styles.textSm)} data-flx="user.imported-tag.text">
					{i18n._(IMPORTED_TAG_DESCRIPTOR)}
				</span>
			</span>
		</Tooltip>
	);
}
