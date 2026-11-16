// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: in a DM with a placeholder the Discord import made (tyne-chat/tyne#685), a notice takes the composer's
// place, as the read-only system DM's does: nobody is behind the placeholder, and the server refuses messages
// to it (tyne-chat/tyne#682).

import {BarrierBase} from '@app/features/channel/components/barriers/BarrierComponents';
import {remFromPx} from '@app/features/theme/layout/RemFromPx';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {ClockCounterClockwiseIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

const IMPORTED_DM_DESCRIPTOR = msg({
	message: "{name} isn't on Tyne: this conversation was imported from Discord, and new messages can't reach them.",
	comment:
		'Shown instead of the message composer in a direct message with a placeholder account that the Discord history import made for someone who is not on Tyne. name is their display name.',
});

export const ImportedDmBarrier = observer(({name}: {name: string}) => {
	const {i18n} = useLingui();
	return (
		<BarrierBase
			message={i18n._(IMPORTED_DM_DESCRIPTOR, {name})}
			icon={
				<ClockCounterClockwiseIcon
					size={remFromPx(18)}
					weight="fill"
					data-flx="channel.barriers.fork-imported-dm-barrier.clock-icon"
				/>
			}
			action={null}
			data-flx="channel.barriers.fork-imported-dm-barrier.barrier-base"
		/>
	);
});
