// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import * as ChannelUtils from '@app/features/channel/utils/ChannelUtils';
import type {Guild} from '@app/features/guild/models/Guild';
import Guilds from '@app/features/guild/state/Guilds';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import Permission from '@app/features/permissions/state/Permission';
import type {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {useLingui} from '@lingui/react/macro';
import {useMemo} from 'react';

interface ForwardedMessageContext {
	readonly sourceChannel: Channel | null;
	readonly sourceGuild: Guild | null;
	readonly sourceUser: User | null;
	readonly hasAccessToSource: boolean;
	readonly displayName: string | null;
}

export function useForwardedMessageContext(message: Message): ForwardedMessageContext {
	const {i18n} = useLingui();
	const reference = message.messageReference;
	const sourceChannel = reference ? (Channels.getChannel(reference.channel_id) ?? null) : null;
	const sourceGuild = sourceChannel && reference?.guild_id ? (Guilds.getGuild(reference.guild_id) ?? null) : null;
	const sourceUser =
		sourceChannel && sourceChannel.type === ChannelTypes.DM && sourceChannel.recipientIds.length > 0
			? (Users.getUser(sourceChannel.recipientIds[0]) ?? null)
			: null;
	const displayName = useMemo(() => {
		if (!sourceChannel) return null;
		if (
			sourceChannel.type === ChannelTypes.DM ||
			sourceChannel.type === ChannelTypes.GROUP_DM ||
			sourceChannel.type === ChannelTypes.DM_PERSONAL_NOTES
		) {
			return ChannelUtils.getDMDisplayName(sourceChannel);
		}
		return sourceChannel.name || null;
	}, [sourceChannel?.id, sourceChannel?.type, sourceChannel?.name, i18n.locale]);
	const hasAccessToSource =
		sourceChannel !== null && (!sourceChannel.guildId || Permission.can(0n, {channelId: sourceChannel.id}));
	return {
		sourceChannel,
		sourceGuild,
		sourceUser,
		hasAccessToSource,
		displayName,
	};
}
