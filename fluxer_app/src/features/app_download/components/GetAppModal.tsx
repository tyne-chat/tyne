// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the sidebar's download button opens this instead of upstream's download page link
// (tyne-chat/tyne#242).

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {GET_THE_APP_DESCRIPTOR, GetAppPanel} from '@app/features/app_download/components/GetAppPanel';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {useLingui} from '@lingui/react/macro';
import type React from 'react';
import styles from './GetAppModal.module.css';

export function GetAppModal({onClose}: {onClose: () => void}): React.ReactElement {
	const {i18n} = useLingui();
	return (
		<Modal.Root size="small" centered onClose={onClose} data-flx="app-download.get-app-modal.root">
			<Modal.Header
				title={i18n._(GET_THE_APP_DESCRIPTOR)}
				onClose={onClose}
				data-flx="app-download.get-app-modal.header"
			/>
			<Modal.Content className={styles.content} data-flx="app-download.get-app-modal.content">
				<GetAppPanel showTitle={false} openInNewTab={true} data-flx="app-download.get-app-modal.get-app-panel" />
			</Modal.Content>
		</Modal.Root>
	);
}

export function openGetAppModal(): void {
	ModalCommands.push(
		ModalCommands.modal(() => (
			<GetAppModal
				onClose={() => ModalCommands.pop()}
				data-flx="app-download.get-app-modal.open-get-app-modal.get-app-modal"
			/>
		)),
	);
}
