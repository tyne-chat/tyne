// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: no call buttons in a DM with a placeholder the Discord import made (tyne-chat/tyne#685): nobody is
// behind it, and the server refuses the call (tyne-chat/tyne#682). The header takes its buttons through
// this, so upstream's buttons and the header's conditions stay as upstream wrote them.

import type {Channel} from '@app/features/channel/models/Channel';
import Users from '@app/features/user/state/Users';
import {isImportedPlaceholder} from '@app/features/user/utils/ForkImportedUser';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {observer} from 'mobx-react-lite';
import type React from 'react';

type CallButton = React.ComponentType<{channel: Channel}>;

function isImportedPlaceholderDm(channel: Channel): boolean {
	const recipientId = channel.type === ChannelTypes.DM ? channel.recipientIds?.[0] : undefined;
	return recipientId != null && isImportedPlaceholder(Users.getUser(recipientId));
}

function hiddenInImportedDms(Button: CallButton): CallButton {
	return observer((props: {channel: Channel}) =>
		isImportedPlaceholderDm(props.channel) ? null : <Button data-flx="channel.fork-call-buttons.button" {...props} />,
	);
}

/** Upstream's call buttons, showing nothing in a DM with an import placeholder. */
export function withoutImportedDmCalls<T extends {VoiceCallButton: CallButton; VideoCallButton: CallButton}>(
	buttons: T,
): T {
	return {
		...buttons,
		VoiceCallButton: hiddenInImportedDms(buttons.VoiceCallButton),
		VideoCallButton: hiddenInImportedDms(buttons.VideoCallButton),
	};
}
