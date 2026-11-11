// SPDX-License-Identifier: AGPL-3.0-or-later

import {useShouldAnimate} from '@app/features/app/hooks/useShouldAnimate';
import {ChannelOriginIcon} from '@app/features/channel/components/ChannelOriginIcon';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import Guilds from '@app/features/guild/state/Guilds';
import {DIRECT_MESSAGE_DESCRIPTOR, GROUP_DM_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import Permission from '@app/features/permissions/state/Permission';
import styles from '@app/features/signal_bar/components/SignalChatParts.module.css';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {getSignalImageUrl} from '@app/features/signal_bar/utils/SignalUtils';
import {StatusAwareAvatar} from '@app/features/ui/components/StatusAwareAvatar';
import Users from '@app/features/user/state/Users';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {SignalBarSignal, UserSignalChat} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import type {I18n} from '@lingui/core';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';

/** A signal's emoji, as on the bar: its image, or the Unicode text. Still unless `animated`. */
export const SignalEmoji = ({
	signal,
	className,
	animated = false,
}: {
	signal: SignalBarSignal;
	className: string;
	animated?: boolean;
}) => {
	const imageUrl = getSignalImageUrl(signal, animated);
	return imageUrl ? (
		<img className={className} src={imageUrl} alt="" draggable={false} data-flx="signal-bar.signal-emoji.image" />
	) : (
		<span className={clsx(className, styles.emojiText)} data-flx="signal-bar.signal-emoji.text">
			{signal.emoji_name}
		</span>
	);
};

/** The community icon with the channel's type in the corner, or the person in a DM, as in the Quick Switcher. */
export const SignalChatIcon = observer(({channel, size}: {channel: Channel; size: number}) => {
	if (channel.type === ChannelTypes.DM) {
		const user = Users.getUser(channel.recipientIds[0] ?? '');
		if (user) return <StatusAwareAvatar user={user} size={size} data-flx="signal-bar.signal-chat-icon.avatar" />;
	}
	return <ChannelOriginIcon channel={channel} size={size} data-flx="signal-bar.signal-chat-icon.origin-icon" />;
});

export function getSignalChatPlace(channel: Channel, i18n: I18n): string {
	if (channel.guildId) return Guilds.getGuild(channel.guildId)?.name ?? '';
	return i18n._(channel.type === ChannelTypes.GROUP_DM ? GROUP_DM_DESCRIPTOR : DIRECT_MESSAGE_DESCRIPTOR);
}

/** Whether a click on the bar's globe may set a signal in this chat now. */
export function canSetSignalIn(channel: Channel): boolean {
	if (!SignalBarStore.isEnabled(channel.id)) return false;
	return channel.guildId == null || Permission.can(Permissions.SEND_MESSAGES, channel);
}

export interface KnownSignalChat {
	chat: UserSignalChat;
	channel: Channel;
}

/** The account's chats with a signal on, newest first, leaving out chats this client does not know. */
export function getKnownSignalChats(): Array<KnownSignalChat> {
	const known: Array<KnownSignalChat> = [];
	for (const chat of SignalBarStore.myChatList) {
		const channel = Channels.getChannel(chat.channel_id);
		if (channel) known.push({chat, channel});
	}
	return known;
}

/** A lit signal's emoji: animated as lit signals on the bar are, following the account's settings. */
export const LitSignalEmoji = ({
	signal,
	className,
	isHovering,
}: {
	signal: SignalBarSignal;
	className: string;
	isHovering: boolean;
}) => {
	const animated = useShouldAnimate({kind: 'emoji', isAnimated: signal.animated, isHovering});
	return (
		<SignalEmoji
			signal={signal}
			className={className}
			animated={animated}
			data-flx="signal-bar.lit-signal-emoji.emoji"
		/>
	);
};
