// SPDX-License-Identifier: AGPL-3.0-or-later

import skeletonStyles from '@app/features/app/components/skeleton/Skeleton.module.css';
import {useAnimatedImageUrl} from '@app/features/app/hooks/useAnimatedImageUrl';
import Authentication from '@app/features/auth/state/Authentication';
import * as PrivateChannelCommands from '@app/features/channel/commands/PrivateChannelCommands';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import GuildMembers from '@app/features/member/state/GuildMembers';
import {SafeMarkdown} from '@app/features/messaging/components/markdown';
import {MarkdownContext} from '@app/features/messaging/components/markdown/renderers/RendererTypes';
import {PersonaTag} from '@app/features/persona/components/PersonaTag';
import PersonaProfileMobile from '@app/features/persona/state/PersonaProfileMobile';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {usePersonaProfile} from '@app/features/persona/utils/usePersonaProfile';
import markupStyles from '@app/features/theme/styles/Markup.module.css';
import {getUserAccentColor} from '@app/features/theme/utils/AccentColorUtils';
import * as ColorUtils from '@app/features/theme/utils/ColorUtils';
import {BottomSheet} from '@app/features/ui/bottom_sheet/BottomSheet';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Scroller} from '@app/features/ui/components/Scroller';
import * as Sheet from '@app/features/ui/sheet/Sheet';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import {getContrastingNotchColor} from '@app/features/user/components/modals/UserProfileUtils';
import {UserSettingsModal} from '@app/features/user/components/modals/UserSettingsModal';
import sharedStyles from '@app/features/user/components/popouts/UserProfileShared.module.css';
import type {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {DEFAULT_ACCENT_COLOR} from '@fluxer/constants/src/AppConstants';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {CaretRightIcon, ChatTeardropIcon, PencilIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useMemo} from 'react';
import styles from './PersonaProfileMobileSheet.module.css';

const PERSONA_PROFILE_DESCRIPTOR = msg({
	message: 'Persona profile: {name}',
	comment:
		'Screen reader label for the persona profile modal. Keep it concise. Preserve {name}; it is inserted by code.',
});
const PERSONA_PROFILE_FALLBACK_DESCRIPTOR = msg({
	message: 'Persona profile',
	comment: 'Fallback screen reader label for the persona profile modal. Keep it concise.',
});

export const PersonaProfileMobileSheet: React.FC = observer(function PersonaProfileMobileSheet() {
	const {subprofile, user, guildId, guildMember, isOpen} = PersonaProfileMobile;

	if (!isOpen || !subprofile || !user) {
		return null;
	}

	const handleClose = () => {
		PersonaProfileMobile.close();
	};

	const profileIdentityKey = `${user.id}:${subprofile.id}:${guildId ?? 'global'}`;

	return (
		<PersonaProfileMobileSheetContent
			key={profileIdentityKey}
			subprofile={subprofile}
			user={user}
			guildId={guildId}
			guildMember={guildMember}
			onClose={handleClose}
			data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content"
		/>
	);
});

interface PersonaProfileMobileSheetContentProps {
	subprofile: MessageSubprofileResponse;
	user: User;
	guildId?: string;
	guildMember?: GuildMember | null;
	onClose: () => void;
}

const PersonaProfileMobileSheetContent: React.FC<PersonaProfileMobileSheetContentProps> = observer(
	function PersonaProfileMobileSheetContent({subprofile, user, guildId, guildMember, onClose}) {
		const {i18n} = useLingui();
		const currentUserId = Authentication.currentUserId ?? Users.currentUser?.id;
		const isCurrentUser = Boolean(currentUserId && user?.id && user.id === currentUserId);
		const localPersona = isCurrentUser ? (PersonaStore.personas.find((p) => p.id === subprofile.id) ?? null) : null;

		const {profile, isLoading, isPrivate} = usePersonaProfile(user.id, subprofile.id, localPersona);

		const effectivePronouns = profile ? profile.pronouns : subprofile.pronouns;
		const effectiveDisplayTagText = isCurrentUser ? PersonaStore.displayTagText : (subprofile.display_tag_text ?? null);
		const effectiveDisplayTagIcon = isCurrentUser ? PersonaStore.displayTagIcon : (subprofile.display_tag_icon ?? null);
		// The bio and banner are the profile's, and the profile comes from the server for this viewer.
		const effectiveBio = profile?.bio ?? null;
		const rawBanner = profile?.banner_hash ?? null;
		const staticBannerUrl = useMemo(() => {
			return AvatarUtils.getPersonaBannerURL({userId: user.id, banner: rawBanner}, false);
		}, [user.id, rawBanner]);

		const hoverBannerUrl = useMemo(() => {
			return AvatarUtils.getPersonaBannerURL({userId: user.id, banner: rawBanner}, true);
		}, [user.id, rawBanner]);

		const {hoverRef: bannerHoverRef, imageUrl: effectiveBannerUrl} = useAnimatedImageUrl({
			staticUrl: staticBannerUrl,
			animatedUrl: hoverBannerUrl,
			kind: 'gif',
		});

		const resolvedGuildMember = useMemo(() => {
			if (guildMember) return guildMember;
			if (guildId) return GuildMembers.getMember(guildId, user.id);
			return null;
		}, [guildMember, guildId, user.id]);

		const effectiveColor = subprofile.color ?? profile?.color ?? null;

		const effectiveAvatarColor = subprofile.avatar_color ?? profile?.avatar_color ?? null;

		const hasCustomPersonaAvatar = Boolean(subprofile.avatar || profile?.avatar_hash);

		const accentColor = useMemo(() => {
			if (effectiveColor != null && effectiveColor !== 0) {
				return ColorUtils.int2hex(effectiveColor);
			}
			if (hasCustomPersonaAvatar) {
				if (effectiveAvatarColor != null && effectiveAvatarColor !== 0) {
					return ColorUtils.int2hex(effectiveAvatarColor);
				}
				if (subprofile.id && /^\d+$/.test(subprofile.id)) {
					try {
						return ColorUtils.int2hex(AvatarUtils.getDefaultAvatarPrimaryColor(subprofile.id));
					} catch {
						// Fall through to DEFAULT_ACCENT_COLOR
					}
				}
				return DEFAULT_ACCENT_COLOR;
			}
			// Persona has no avatar of its own; inherits root account's avatar and color
			return getUserAccentColor(user);
		}, [effectiveColor, hasCustomPersonaAvatar, effectiveAvatarColor, subprofile.id, user]);

		const effectiveNotchBaseColor = useMemo(() => {
			if (effectiveColor != null && effectiveColor !== 0) {
				return effectiveColor;
			}
			if (hasCustomPersonaAvatar) {
				if (effectiveAvatarColor != null && effectiveAvatarColor !== 0) {
					return effectiveAvatarColor;
				}
			} else if (user && typeof user.avatarColor === 'number') {
				return user.avatarColor;
			}
			return null;
		}, [effectiveColor, hasCustomPersonaAvatar, effectiveAvatarColor, user]);

		const notchColor = useMemo(
			() => getContrastingNotchColor(effectiveNotchBaseColor, true),
			[effectiveNotchBaseColor],
		);

		const rootDisplayName = useMemo(() => {
			if (resolvedGuildMember?.nick) {
				return NicknameUtils.formatNicknameForStreamerMode(resolvedGuildMember.nick);
			}
			return NicknameUtils.getNickname(user, guildId);
		}, [resolvedGuildMember, user, guildId]);

		const personaAvatarUrl = useMemo(() => {
			return subprofile.avatar
				? AvatarUtils.getPersonaAvatarURL({userId: user.id, avatar: subprofile.avatar}, false, 80)
				: AvatarUtils.getUserAvatarURL(user, false, 80);
		}, [subprofile.avatar, user]);

		const hoverPersonaAvatarUrl = useMemo(() => {
			return subprofile.avatar
				? AvatarUtils.getPersonaAvatarURL({userId: user.id, avatar: subprofile.avatar}, true, 80)
				: AvatarUtils.getUserAvatarURL(user, true, 80);
		}, [subprofile.avatar, user]);

		const handleOpenRootProfile = useCallback(() => {
			onClose();
			UserProfileCommands.openUserProfile(user.id, guildId);
		}, [user.id, guildId, onClose]);

		const handleEditPersona = useCallback(() => {
			onClose();
			ModalCommands.push(
				modal(() => (
					<UserSettingsModal
						initialTab="personas"
						initialSubtab={subprofile.id}
						data-flx="persona.persona-profile-mobile-sheet.user-settings-modal"
					/>
				)),
			);
		}, [subprofile.id, onClose]);

		const handleMessage = useCallback(async () => {
			try {
				onClose();
				await PrivateChannelCommands.openDMChannel(user.id);
			} catch {
				// Handled in platform transport
			}
		}, [user.id, onClose]);

		const screenReaderLabel = useMemo(() => {
			if (subprofile?.name) {
				return i18n._(PERSONA_PROFILE_DESCRIPTOR, {name: subprofile.name});
			}
			return i18n._(PERSONA_PROFILE_FALLBACK_DESCRIPTOR);
		}, [subprofile?.name, i18n.locale]);

		return (
			<BottomSheet
				isOpen={true}
				onClose={onClose}
				snapPoints={[0, 0.9, 1]}
				initialSnap={1}
				disablePadding={true}
				disableDefaultHeader={true}
				showHandle={false}
				containerClassName={styles.sheetContainer}
				ariaLabel={screenReaderLabel}
				data-flx="persona.persona-profile-mobile-sheet.bottom-sheet"
			>
				<div className={styles.container} data-flx="persona.persona-profile-mobile-sheet.container">
					<Scroller
						key="persona-profile-mobile-sheet-scroller"
						data-flx="persona.persona-profile-mobile-sheet.scroller"
					>
						<div
							style={{paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)'}}
							data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.div"
						>
							<div
								ref={bannerHoverRef}
								className={styles.bannerContainer}
								data-flx="persona.persona-profile-mobile-sheet.banner-container"
							>
								{effectiveBannerUrl ? (
									<div
										className={styles.bannerImage}
										style={{backgroundImage: `url(${effectiveBannerUrl})`}}
										data-flx="persona.persona-profile-mobile-sheet.banner-image"
									/>
								) : (
									<div
										className={styles.bannerColor}
										style={{backgroundColor: accentColor}}
										data-flx="persona.persona-profile-mobile-sheet.banner-color"
									/>
								)}
								<Sheet.Handle
									className={styles.notchContainer}
									data-flx="persona.persona-profile-mobile-sheet.notch-container"
								>
									<div
										className={styles.notch}
										style={{backgroundColor: notchColor}}
										data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.notch"
									/>
								</Sheet.Handle>
							</div>
							<div className={styles.profileContent} data-flx="persona.persona-profile-mobile-sheet.profile-content">
								<div
									className={styles.avatarContainer}
									data-flx="persona.persona-profile-mobile-sheet.avatar-container"
								>
									<div
										className={styles.avatarBorder}
										style={{borderRadius: '9999px'}}
										data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.avatar-border"
									>
										<Avatar
											user={user}
											avatarUrl={personaAvatarUrl}
											hoverAvatarUrl={hoverPersonaAvatarUrl}
											size={80}
											disableStatusTooltip
											data-flx="persona.persona-profile-mobile-sheet.avatar"
										/>
									</div>
								</div>
								<div className={styles.contentPadding} data-flx="persona.persona-profile-mobile-sheet.content-padding">
									<div
										className={styles.actionsContainer}
										data-flx="persona.persona-profile-mobile-sheet.actions-container"
									>
										{isCurrentUser ? (
											<button
												type="button"
												onClick={handleEditPersona}
												className={styles.actionButton}
												aria-label={i18n._(msg({message: 'Edit persona', comment: 'Action button to edit persona'}))}
												data-flx="persona.persona-profile-mobile-sheet.action-button.edit"
											>
												<PencilIcon
													className={styles.icon}
													weight="bold"
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.icon"
												/>
											</button>
										) : (
											<button
												type="button"
												onClick={handleMessage}
												className={styles.actionButton}
												aria-label={i18n._(msg({message: 'Message', comment: 'Action button to open DM'}))}
												data-flx="persona.persona-profile-mobile-sheet.action-button.message"
											>
												<ChatTeardropIcon
													className={styles.icon}
													weight="bold"
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.icon--2"
												/>
											</button>
										)}
									</div>
									<div
										className={styles.usernameContainer}
										data-flx="persona.persona-profile-mobile-sheet.username-container"
									>
										<div className={styles.usernameRow} data-flx="persona.persona-profile-mobile-sheet.username-row">
											<span className={styles.username} data-flx="persona.persona-profile-mobile-sheet.username">
												{subprofile.name}
											</span>
										</div>
										{(effectiveDisplayTagText || effectiveDisplayTagIcon) && (
											<div className={styles.tagBadgeRow} data-flx="persona.persona-profile-mobile-sheet.tag-badge-row">
												<div
													className={styles.badgesWrapper}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.badges-wrapper"
												>
													<PersonaTag
														subprofile={{
															...subprofile,
															display_tag_text: effectiveDisplayTagText,
															display_tag_icon: effectiveDisplayTagIcon,
														}}
														rootUser={user}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.persona-tag"
													/>
												</div>
											</div>
										)}
										{effectivePronouns && (
											<div
												className={styles.customStatusRow}
												data-flx="persona.persona-profile-mobile-sheet.custom-status-row"
											>
												<span
													className={styles.customStatusText}
													data-flx="persona.persona-profile-mobile-sheet.pronouns"
												>
													{effectivePronouns}
												</span>
											</div>
										)}
									</div>

									<div
										className={styles.actionButtonsContainer}
										data-flx="persona.persona-profile-mobile-sheet.action-buttons-container"
									>
										{isCurrentUser ? (
											<button
												type="button"
												onClick={handleEditPersona}
												className={styles.editProfileButton}
												data-flx="persona.persona-profile-mobile-sheet.edit-profile-button"
											>
												<PencilIcon
													className={styles.editProfileIcon}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.edit-profile-icon"
												/>
												<span
													className={styles.editProfileText}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.edit-profile-text"
												>
													<Trans>Edit persona</Trans>
												</span>
											</button>
										) : (
											<button
												type="button"
												onClick={handleMessage}
												className={styles.actionCard}
												data-flx="persona.persona-profile-mobile-sheet.action-card.message"
											>
												<div
													className={styles.actionIconContainer}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.action-icon-container"
												>
													<ChatTeardropIcon
														className={styles.actionIcon}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.action-icon"
													/>
												</div>
												<span
													className={styles.actionLabel}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.action-label"
												>
													<Trans context="message-action">Message</Trans>
												</span>
											</button>
										)}
									</div>

									<div className={styles.infoCard} data-flx="persona.persona-profile-mobile-sheet.info-card">
										{isLoading ? (
											<div
												className={styles.bioSection}
												data-flx="persona.persona-profile-mobile-sheet.bio-section.loading"
											>
												<h3
													className={styles.bioHeader}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.bio-header"
												>
													<Trans>About me</Trans>
												</h3>
												<div
													style={{display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0'}}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.div--2"
												>
													<div
														className={skeletonStyles.skeleton}
														style={{width: '75%', height: '12px', borderRadius: '4px'}}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.div--3"
													/>
													<div
														className={skeletonStyles.skeleton}
														style={{width: '90%', height: '12px', borderRadius: '4px'}}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.div--4"
													/>
													<div
														className={skeletonStyles.skeleton}
														style={{width: '50%', height: '12px', borderRadius: '4px'}}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.div--5"
													/>
												</div>
											</div>
										) : isPrivate ? (
											<div
												className={styles.bioSection}
												data-flx="persona.persona-profile-mobile-sheet.bio-section.private"
											>
												<div
													className={styles.privateNotice}
													data-flx="persona.persona-profile-mobile-sheet.private-notice"
												>
													<Trans>This persona’s profile is private.</Trans>
												</div>
											</div>
										) : effectiveBio ? (
											<div className={styles.bioSection} data-flx="persona.persona-profile-mobile-sheet.bio-section">
												<h3
													className={styles.bioHeader}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.bio-header--2"
												>
													<Trans>About me</Trans>
												</h3>
												<div
													className={clsx(
														markupStyles.markup,
														markupStyles.bio,
														markupStyles.mutedSpoilerContext,
														styles.bioContent,
													)}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.bio-content"
												>
													<SafeMarkdown
														content={effectiveBio}
														options={{context: MarkdownContext.RESTRICTED_USER_BIO, guildId}}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.safe-markdown"
													/>
												</div>
											</div>
										) : null}

										<div
											className={styles.rolesSection}
											data-flx="persona.persona-profile-mobile-sheet.main-account-section"
										>
											<h3
												className={styles.bioHeader}
												data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.bio-header--3"
											>
												<Trans>Main account</Trans>
											</h3>
											<button
												type="button"
												className={clsx(sharedStyles.connectionCard, styles.rootAccountButton)}
												onClick={handleOpenRootProfile}
												data-flx="persona.persona-profile-mobile-sheet.root-account-button"
											>
												<Avatar
													user={user}
													size={32}
													className={styles.rootAccountAvatar}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.root-account-avatar"
												/>
												<div
													className={styles.rootAccountInfo}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.root-account-info"
												>
													<span
														className={sharedStyles.connectionCardName}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.span"
													>
														{rootDisplayName}
													</span>
													<span
														className={styles.rootAccountUsername}
														data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.root-account-username"
													>
														@{user.username}
													</span>
												</div>
												<CaretRightIcon
													size={16}
													className={styles.rootAccountChevron}
													data-flx="persona.persona-profile-mobile-sheet.persona-profile-mobile-sheet-content.root-account-chevron"
												/>
											</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</Scroller>
				</div>
			</BottomSheet>
		);
	},
);
