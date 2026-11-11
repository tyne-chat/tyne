// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import Authentication from '@app/features/auth/state/Authentication';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import {getDMDisplayName} from '@app/features/channel/utils/ChannelUtils';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {SignalChatIcon, SignalEmoji} from '@app/features/signal_bar/components/SignalChatParts';
import styles from '@app/features/signal_bar/components/SignalsRestoreModal.module.css';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {getSignalLabel} from '@app/features/signal_bar/utils/SignalUtils';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import Users from '@app/features/user/state/Users';
import type {UserSignalRef, UserSignalsRestoreResponse} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {ArrowRightIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

const RESTORE_TITLE_DESCRIPTOR = msg({
	message: 'Restore your signals?',
	comment: 'Title of the confirmation that undoes your last change to your signals in every chat at once.',
});
const RESTORE_BEFORE_SET_DESCRIPTOR = msg({
	message: 'Puts back what you had on before {label} everywhere at {time}. What you have on there now goes off.',
	comment:
		'Body of the restore confirmation, when the last change set one signal in every chat. {label} is the signal name, such as Sleeping; {time} is when, such as 11:58 PM or 9 Nov, 11:58 PM.',
});
const RESTORE_BEFORE_OFF_DESCRIPTOR = msg({
	message: 'Puts back what you had on before you turned all off at {time}. What you have on there now goes off.',
	comment:
		'Body of the restore confirmation, when the last change turned off all your signals in every chat. {time} is when, such as 11:58 PM or 9 Nov, 11:58 PM.',
});
const RESTORE_BEFORE_RESTORE_DESCRIPTOR = msg({
	message: 'Puts back what you had on before your last restore at {time}. What you have on there now goes off.',
	comment:
		'Body of the restore confirmation, when the last change was itself a restore, so this one swaps back. {time} is when, such as 11:58 PM or 9 Nov, 11:58 PM.',
});
const RESTORE_NOW_DESCRIPTOR = msg({
	message: 'Now',
	comment: 'Column heading in the restore confirmation over the signals you have on in each chat now. Keep it short.',
});
const RESTORE_AFTER_DESCRIPTOR = msg({
	message: 'After',
	comment:
		'Column heading in the restore confirmation over the signals each chat will have after restoring. Keep it short.',
});
const RESTORE_MORE_CHATS_DESCRIPTOR = msg({
	message: '{count, plural, one {+ # more chat} other {+ # more chats}}',
	comment: 'Last line of the list in the restore confirmation when more chats change than are listed.',
});
const RESTORE_LEFT_OUT_DESCRIPTOR = msg({
	message: 'Left out, since you can no longer post there: {chats}',
	comment:
		'Line in the restore confirmation naming chats the restore will skip. {chats} is a comma-separated list of chat names.',
});
const RESTORE_CONFIRM_DESCRIPTOR = msg({
	message: 'Restore',
	comment: 'Confirm button of the restore confirmation for signals everywhere. Keep it short.',
});
const RESTORE_NOTHING_DESCRIPTOR = msg({
	message: 'There is nothing to restore.',
	comment: 'Shown in place of the restore confirmation for signals everywhere when there is no earlier change to undo.',
});
const RESTORE_UNAVAILABLE_DESCRIPTOR = msg({
	message: 'Could not load what Restore would change. Try again.',
	comment: 'Shown in place of the restore confirmation when its preview could not be loaded.',
});

/** Chats listed before "+ N more". */
const MAX_LISTED_CHATS = 6;
const BADGE_SIZE = 16;

function formatWhen(i18n: I18n, at: number): string {
	const date = new Date(at);
	const today = new Date();
	const sameDay = date.toDateString() === today.toDateString();
	return i18n.date(date, sameDay ? {timeStyle: 'short'} : {dateStyle: 'medium', timeStyle: 'short'});
}

function sameRefs(a: ReadonlyArray<UserSignalRef>, b: ReadonlyArray<UserSignalRef>): boolean {
	return (
		a.length === b.length &&
		a.every((ref) => b.some((other) => other.signal_id === ref.signal_id && other.persona_id === ref.persona_id))
	);
}

const SignalRefs = observer(({refs}: {refs: ReadonlyArray<UserSignalRef>}) => {
	const user = Users.getUser(Authentication.currentUserId ?? '');
	return (
		<span className={styles.refs} data-flx="signal-bar.signals-restore-modal.refs">
			{refs.map((ref) => {
				const signal = SignalBarStore.signals.find((candidate) => candidate.id === ref.signal_id);
				if (!signal) return null;
				const persona = ref.persona_id ? PersonaStore.getKnownPersona(ref.persona_id) : null;
				return (
					<span
						key={ref.signal_id}
						className={styles.ref}
						title={getSignalLabel(signal)}
						data-flx="signal-bar.signals-restore-modal.ref"
					>
						<SignalEmoji
							signal={signal}
							className={styles.refEmoji}
							data-flx="signal-bar.signals-restore-modal.ref-emoji"
						/>
						{user && (
							<span className={styles.refBadge} data-flx="signal-bar.signals-restore-modal.ref-badge">
								<PersonaAvatar
									user={user}
									size={BADGE_SIZE}
									persona={persona}
									disableStatusTooltip={true}
									data-flx="signal-bar.signals-restore-modal.ref-avatar"
								/>
							</span>
						)}
					</span>
				);
			})}
		</span>
	);
});

interface PreviewRow {
	channel: Channel;
	now: ReadonlyArray<UserSignalRef>;
	after: ReadonlyArray<UserSignalRef>;
}

const SignalsRestorePreview = observer(({preview, i18n}: {preview: UserSignalsRestoreResponse; i18n: I18n}) => {
	const rows: Array<PreviewRow> = [];
	const leftOut: Array<string> = [];
	for (const chat of preview.chats) {
		const channel = Channels.getChannel(chat.channel_id);
		if (!channel) continue;
		if (!chat.available) {
			leftOut.push(getDMDisplayName(channel));
		} else if (!sameRefs(chat.now, chat.after)) {
			rows.push({channel, now: chat.now, after: chat.after});
		}
	}
	const action = preview.action;
	const time = formatWhen(i18n, preview.created_at ?? Date.now());
	const setSignal =
		action?.kind === 'set' ? SignalBarStore.signals.find((signal) => signal.id === action.signal_id) : undefined;
	let summary: string;
	if (action?.kind === 'set' && setSignal) {
		summary = i18n._(RESTORE_BEFORE_SET_DESCRIPTOR, {label: getSignalLabel(setSignal), time});
	} else if (action?.kind === 'restore') {
		summary = i18n._(RESTORE_BEFORE_RESTORE_DESCRIPTOR, {time});
	} else {
		summary = i18n._(RESTORE_BEFORE_OFF_DESCRIPTOR, {time});
	}
	return (
		<div className={styles.body} data-flx="signal-bar.signals-restore-modal.body">
			<p className={styles.summary} data-flx="signal-bar.signals-restore-modal.summary">
				{summary}
			</p>
			{rows.length > 0 && (
				<div className={styles.table} data-flx="signal-bar.signals-restore-modal.table">
					<span className={styles.columnHeading} data-flx="signal-bar.signals-restore-modal.chat-heading" />
					<span className={styles.columnHeading} data-flx="signal-bar.signals-restore-modal.now-heading">
						{i18n._(RESTORE_NOW_DESCRIPTOR)}
					</span>
					<span className={styles.columnHeading} data-flx="signal-bar.signals-restore-modal.arrow-heading" />
					<span className={styles.columnHeading} data-flx="signal-bar.signals-restore-modal.after-heading">
						{i18n._(RESTORE_AFTER_DESCRIPTOR)}
					</span>
					{rows.slice(0, MAX_LISTED_CHATS).map((row) => (
						<div key={row.channel.id} className={styles.row} data-flx="signal-bar.signals-restore-modal.row">
							<span className={styles.chat} data-flx="signal-bar.signals-restore-modal.chat">
								<SignalChatIcon channel={row.channel} size={20} data-flx="signal-bar.signals-restore-modal.chat-icon" />
								<span className={styles.chatName} data-flx="signal-bar.signals-restore-modal.chat-name">
									{getDMDisplayName(row.channel)}
								</span>
							</span>
							<SignalRefs refs={row.now} data-flx="signal-bar.signals-restore-modal.now" />
							<ArrowRightIcon
								size={14}
								weight="bold"
								className={styles.arrow}
								aria-hidden="true"
								data-flx="signal-bar.signals-restore-modal.arrow"
							/>
							<SignalRefs refs={row.after} data-flx="signal-bar.signals-restore-modal.after" />
						</div>
					))}
				</div>
			)}
			{rows.length > MAX_LISTED_CHATS && (
				<p className={styles.note} data-flx="signal-bar.signals-restore-modal.more">
					{i18n._(RESTORE_MORE_CHATS_DESCRIPTOR, {count: rows.length - MAX_LISTED_CHATS})}
				</p>
			)}
			{leftOut.length > 0 && (
				<p className={styles.note} data-flx="signal-bar.signals-restore-modal.left-out">
					{i18n._(RESTORE_LEFT_OUT_DESCRIPTOR, {chats: leftOut.join(', ')})}
				</p>
			)}
		</div>
	);
});

/**
 * Loads what Restore would change, then asks before doing it. One GET to open it; one POST to
 * confirm. If the preview cannot be loaded, it says so and offers nothing to confirm.
 */
export async function openSignalsRestoreModal(i18n: I18n): Promise<void> {
	const preview = await SignalBarStore.fetchRestorePreview();
	if (!preview?.available) {
		ModalCommands.push(
			modal(() => (
				<ConfirmModal
					title={i18n._(RESTORE_TITLE_DESCRIPTOR)}
					description={i18n._(preview ? RESTORE_NOTHING_DESCRIPTOR : RESTORE_UNAVAILABLE_DESCRIPTOR)}
					data-flx="signal-bar.signals-restore-modal.unavailable"
				/>
			)),
		);
		void SignalBarStore.fetchMyChats();
		return;
	}
	ModalCommands.push(
		modal(() => (
			<ConfirmModal
				title={i18n._(RESTORE_TITLE_DESCRIPTOR)}
				description={
					<SignalsRestorePreview preview={preview} i18n={i18n} data-flx="signal-bar.signals-restore-modal.preview" />
				}
				primaryText={i18n._(RESTORE_CONFIRM_DESCRIPTOR)}
				onPrimary={() => SignalBarStore.restoreEverywhere()}
				data-flx="signal-bar.signals-restore-modal.confirm"
			/>
		)),
	);
}
