// SPDX-License-Identifier: AGPL-3.0-or-later

import {UserSettingsModal} from '@app/features/app/components/dialogs/LoadableSettingsModals';
import * as PrivateChannelCommands from '@app/features/channel/commands/PrivateChannelCommands';
import {SafeMarkdown} from '@app/features/messaging/components/markdown';
import {MarkdownContext} from '@app/features/messaging/components/markdown/renderers/RendererTypes';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {galleryBannerUrl, galleryPersonaColor} from '@app/features/persona/components/gallery/PersonaGalleryImages';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {PersonaTag} from '@app/features/persona/components/PersonaTag';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {
	type GalleryPersona,
	galleryItemsFromOwn,
	galleryItemsFromPublic,
} from '@app/features/persona/utils/PersonaGalleryItems';
import * as M from '@app/features/persona/utils/PersonaGalleryMessages';
import {usePersonaImageMenus} from '@app/features/persona/utils/usePersonaImageMenus';
import markupStyles from '@app/features/theme/styles/Markup.module.css';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Spinner} from '@app/features/ui/components/Spinner';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import type {User} from '@app/features/user/models/User';
import {getFormattedShortDate} from '@app/features/user/utils/DateFormatting';
import type {PublicPersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {Trans, useLingui} from '@lingui/react/macro';
import {ArrowsOutSimpleIcon, CaretLeftIcon, CaretRightIcon, ChatTeardropIcon, PencilIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import styles from './PersonaGallery.module.css';

const SWIPE_MIN_PX = 60;

export interface PersonaGalleryDetailProps {
	user: User;
	personaId: string;
	/** The gallery's personas in its current order, for previous and next. */
	list: ReadonlyArray<GalleryPersona>;
	isOwn: boolean;
	displayTagText: string | null;
	displayTagIcon: string | null;
	isMobile: boolean;
	onBack: () => void;
	onNavigate: (personaId: string) => void;
	onClose?: () => void;
	/** Gives the profile window to the gallery, as the list's own Expand does; unset when expanded or on phones. */
	onExpand?: () => void;
}

/**
 * One persona's full profile, opened from the Personas list (tyne-chat/tyne#189, and the full
 * profile of tyne-chat/tyne#108): banner, avatar, name, display tag, pronouns, the whole bio and
 * the date it was made, with Back and previous/next (buttons, the arrow keys). A persona not in the
 * list, such as an unlisted one opened from its popout, is fetched on its own, and a private one
 * says so.
 */
export const PersonaGalleryDetail = observer(
	({
		user,
		personaId,
		list,
		isOwn,
		displayTagText,
		displayTagIcon,
		isMobile,
		onBack,
		onNavigate,
		onClose,
		onExpand,
	}: PersonaGalleryDetailProps) => {
		const {i18n} = useLingui();
		const rootRef = useRef<HTMLDivElement>(null);
		const index = list.findIndex((p) => p.id === personaId);
		const listed = index >= 0 ? list[index]! : null;
		const ownPersona = isOwn ? (PersonaStore.personas.find((p) => p.id === personaId) ?? null) : null;
		const fetched = useUnlistedPersona(user.id, personaId, Boolean(listed || ownPersona));
		let persona: GalleryPersona | null = listed;
		if (!persona && ownPersona) persona = galleryItemsFromOwn([ownPersona])[0] ?? null;
		if (!persona && fetched.profile) persona = galleryItemsFromPublic([fetched.profile])[0] ?? null;
		const canStep = index >= 0 && list.length > 1;
		const {onAvatarContextMenu, onBannerContextMenu} = usePersonaImageMenus({
			user,
			avatarHash: persona?.avatar ?? null,
			bannerHash: persona?.banner ?? null,
		});

		const step = useCallback(
			(delta: number) => {
				if (!canStep) return;
				const next = list[(index + delta + list.length) % list.length];
				if (next) onNavigate(next.id);
			},
			[canStep, index, list, onNavigate],
		);

		useEffect(() => {
			rootRef.current?.focus({preventScroll: true});
		}, []);

		const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
			const target = event.target as HTMLElement;
			if (target.closest('input, textarea, [contenteditable="true"]')) return;
			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				step(-1);
			} else if (event.key === 'ArrowRight') {
				event.preventDefault();
				step(1);
			}
		};

		// On phones a sideways swipe steps too: mostly horizontal, and longer than a tap's wobble.
		const touchStart = useRef<{x: number; y: number} | null>(null);
		const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
			const touch = event.touches[0];
			touchStart.current =
				isMobile && touch && event.touches.length === 1 ? {x: touch.clientX, y: touch.clientY} : null;
		};
		const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
			const start = touchStart.current;
			const touch = event.changedTouches[0];
			touchStart.current = null;
			if (!start || !touch) return;
			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;
			if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
		};

		const handleMessage = async () => {
			onClose?.();
			try {
				await PrivateChannelCommands.openDMChannel(user.id);
			} catch {
				// Handled in platform transport
			}
		};
		const handleEdit = () => {
			onClose?.();
			ModalCommands.push(
				modal(() => (
					<UserSettingsModal
						initialTab="personas"
						initialSubtab={personaId}
						data-flx="persona.gallery.detail.edit.user-settings-modal"
					/>
				)),
			);
		};

		const color = persona ? galleryPersonaColor(persona) : undefined;
		const bannerUrl = persona ? galleryBannerUrl(user, persona, 1024) : '';

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: the arrow keys and swipes step between personas wherever focus is in the profile.
			<div
				ref={rootRef}
				tabIndex={-1}
				className={styles.detail}
				onKeyDown={handleKeyDown}
				onTouchStart={handleTouchStart}
				onTouchEnd={handleTouchEnd}
				data-flx="persona.gallery.detail.root"
			>
				<div className={styles.detailNav} data-flx="persona.gallery.detail.nav">
					<button type="button" className={styles.detailBack} onClick={onBack} data-flx="persona.gallery.detail.back">
						<CaretLeftIcon size={16} weight="bold" data-flx="persona.gallery.detail.back-icon" />
						{i18n._(M.ALL_PERSONAS_DESCRIPTOR)}
					</button>
					{canStep && (
						<>
							<span className={styles.detailPosition} data-flx="persona.gallery.detail.position">
								{i18n._(M.PERSONA_POSITION_DESCRIPTOR, {position: index + 1, total: list.length})}
							</span>
							<button
								type="button"
								className={styles.detailStep}
								onClick={() => step(-1)}
								aria-label={i18n._(M.PREVIOUS_PERSONA_DESCRIPTOR)}
								data-flx="persona.gallery.detail.previous"
							>
								<CaretLeftIcon size={16} weight="bold" data-flx="persona.gallery.detail.previous-icon" />
							</button>
							<button
								type="button"
								className={styles.detailStep}
								onClick={() => step(1)}
								aria-label={i18n._(M.NEXT_PERSONA_DESCRIPTOR)}
								data-flx="persona.gallery.detail.next"
							>
								<CaretRightIcon size={16} weight="bold" data-flx="persona.gallery.detail.next-icon" />
							</button>
						</>
					)}
					{onExpand && (
						<Tooltip
							text={i18n._(M.EXPAND_PERSONAS_DESCRIPTOR)}
							position="top"
							data-flx="persona.gallery.detail.expand.tooltip"
						>
							<button
								type="button"
								className={clsx(styles.expandButton, !canStep && styles.detailNavEnd)}
								aria-label={i18n._(M.EXPAND_PERSONAS_DESCRIPTOR)}
								onClick={onExpand}
								data-flx="persona.gallery.detail.expand"
							>
								<ArrowsOutSimpleIcon size={18} weight="bold" data-flx="persona.gallery.detail.expand-icon" />
							</button>
						</Tooltip>
					)}
				</div>
				{!persona && fetched.isLoading && (
					<div className={styles.state} data-flx="persona.gallery.detail.loading">
						<Spinner data-flx="persona.gallery.detail.loading.spinner" />
					</div>
				)}
				{!persona && !fetched.isLoading && (
					<div className={styles.state} data-flx="persona.gallery.detail.unavailable">
						{fetched.isPrivate ? (
							<Trans>This persona’s profile is private.</Trans>
						) : (
							i18n._(M.PERSONAS_LOAD_FAILED_DESCRIPTOR)
						)}
					</div>
				)}
				{persona && (
					<div className={styles.detailBody} data-flx="persona.gallery.detail.body">
						<div className={styles.detailBannerWrap} data-flx="persona.gallery.detail.banner-wrap">
							<div
								role="group"
								className={styles.detailBanner}
								style={{backgroundColor: color ?? undefined}}
								onContextMenu={onBannerContextMenu}
								data-flx="persona.gallery.detail.banner"
							>
								{bannerUrl && (
									<img
										src={bannerUrl}
										alt=""
										className={styles.bannerImage}
										data-flx="persona.gallery.detail.banner-image"
									/>
								)}
							</div>
							<span
								role="group"
								className={styles.detailAvatar}
								onContextMenu={onAvatarContextMenu}
								data-flx="persona.gallery.detail.avatar"
							>
								<PersonaAvatar
									user={user}
									persona={{avatar: persona.avatar}}
									size={80}
									disableStatusTooltip
									data-flx="persona.gallery.detail.persona-avatar"
								/>
							</span>
						</div>
						<div className={styles.detailInfo} data-flx="persona.gallery.detail.info">
							<div className={styles.detailNameRow} data-flx="persona.gallery.detail.name-row">
								<h3 className={styles.detailName} style={{color}} data-flx="persona.gallery.detail.name">
									{persona.name}
								</h3>
								{(displayTagText || displayTagIcon) && (
									<PersonaTag
										subprofile={{
											id: persona.id,
											name: persona.name,
											avatar: persona.avatar,
											display_tag_text: displayTagText,
											display_tag_icon: displayTagIcon,
										}}
										rootUser={user}
										inProfile={!isMobile}
										data-flx="persona.gallery.detail.persona-tag"
									/>
								)}
							</div>
							{persona.pronouns && (
								<div className={styles.detailPronouns} data-flx="persona.gallery.detail.pronouns">
									{persona.pronouns}
								</div>
							)}
							<div className={styles.detailActions} data-flx="persona.gallery.detail.actions">
								{isOwn ? (
									<Button
										small
										fitContent
										leftIcon={<PencilIcon size={16} data-flx="persona.gallery.detail.edit-icon" />}
										onClick={handleEdit}
										data-flx="persona.gallery.detail.edit"
									>
										<Trans>Edit persona</Trans>
									</Button>
								) : (
									<Button
										small
										fitContent
										leftIcon={<ChatTeardropIcon size={16} data-flx="persona.gallery.detail.message-icon" />}
										onClick={handleMessage}
										data-flx="persona.gallery.detail.message"
									>
										<Trans>Message</Trans>
									</Button>
								)}
							</div>
							<div className={styles.detailSeparator} data-flx="persona.gallery.detail.separator" />
							{persona.bio ? (
								<div
									className={clsx(markupStyles.markup, markupStyles.bio, styles.detailBio)}
									data-flx="persona.gallery.detail.bio"
								>
									<SafeMarkdown
										content={persona.bio}
										options={{context: MarkdownContext.RESTRICTED_USER_BIO}}
										data-flx="persona.gallery.detail.bio-markdown"
									/>
								</div>
							) : (
								<p className={clsx(styles.detailBio, styles.muted)} data-flx="persona.gallery.detail.no-bio">
									{i18n._(M.PERSONA_NO_BIO_DESCRIPTOR)}
								</p>
							)}
							{Number.isFinite(persona.createdAt) && (
								<div className={styles.detailFact} data-flx="persona.gallery.detail.since">
									<span className={styles.detailFactLabel} data-flx="persona.gallery.detail.since-label">
										{i18n._(M.PERSONA_SINCE_DESCRIPTOR)}
									</span>
									<span data-flx="persona.gallery.detail.since-value">{getFormattedShortDate(persona.createdAt)}</span>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		);
	},
);

interface UnlistedPersonaView {
	profile: PublicPersonaResponse | null;
	isLoading: boolean;
	isPrivate: boolean;
}

/**
 * A persona the gallery does not list (someone else's unlisted or private persona, opened from its
 * popout), fetched once through `fetchPersonaProfile`, which caches answers for a minute. Nothing is
 * asked when `skip` is set.
 */
function useUnlistedPersona(userId: string, personaId: string, skip: boolean): UnlistedPersonaView {
	const [result, setResult] = useState<PersonaCommands.PersonaProfileResult | null>(null);
	useEffect(() => {
		if (skip) return;
		let isMounted = true;
		setResult(null);
		void PersonaCommands.fetchPersonaProfile(userId, personaId).then((answer) => {
			if (isMounted) setResult(answer);
		});
		return () => {
			isMounted = false;
		};
	}, [userId, personaId, skip]);
	return {
		profile: result?.status === 'ready' ? result.profile : null,
		isLoading: !skip && result === null,
		isPrivate: result?.status === 'private',
	};
}
