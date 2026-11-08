// SPDX-License-Identifier: AGPL-3.0-or-later

import {GO_BACK_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {PersonaGallery} from '@app/features/persona/components/gallery/PersonaGallery';
import {PersonaGallerySheetState} from '@app/features/persona/state/PersonaGallerySheetState';
import * as M from '@app/features/persona/utils/PersonaGalleryMessages';
import {usePersonaDirectory} from '@app/features/persona/utils/usePersonaDirectory';
import {BottomSheet} from '@app/features/ui/bottom_sheet/BottomSheet';
import {Scroller} from '@app/features/ui/components/Scroller';
import {ArrowLeftIcon} from '@app/features/ui/icons/DirectionalIcons';
import mutualStyles from '@app/features/user/components/modals/MutualItemsSheet.module.css';
import type {User} from '@app/features/user/models/User';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

/**
 * The Personas sheet on phones (tyne-chat/tyne#189), opened from the Personas pill or button of a
 * profile sheet. It stacks over the profile like the mutual friends sheet, with the same back button.
 */
export const PersonaGallerySheet = observer(() => {
	const user = PersonaGallerySheetState.user;
	if (!user) return null;
	return <PersonaGallerySheetContent key={user.id} user={user} data-flx="persona.gallery-sheet.content" />;
});

const PersonaGallerySheetContent = observer(({user}: {user: User}) => {
	const {i18n} = useLingui();
	const directory = usePersonaDirectory(user.id);
	const close = PersonaGallerySheetState.close;
	return (
		<BottomSheet
			isOpen
			onClose={close}
			snapPoints={[0, 1]}
			initialSnap={1}
			disablePadding={true}
			surface="primary"
			showCloseButton={false}
			leadingAction={
				<button
					type="button"
					onClick={close}
					className={mutualStyles.backButton}
					aria-label={i18n._(GO_BACK_DESCRIPTOR)}
					data-flx="persona.gallery-sheet.back"
				>
					<ArrowLeftIcon className={mutualStyles.backIcon} data-flx="persona.gallery-sheet.back-icon" />
				</button>
			}
			title={i18n._(M.PERSONAS_COUNT_DESCRIPTOR, {count: directory.publicCount})}
			data-flx="persona.gallery-sheet.bottom-sheet"
		>
			<Scroller key="persona-gallery-sheet-scroller" data-flx="persona.gallery-sheet.scroller">
				<PersonaGallery user={user} onClose={close} isMobile data-flx="persona.gallery-sheet.gallery" />
			</Scroller>
		</BottomSheet>
	);
});
