// SPDX-License-Identifier: AGPL-3.0-or-later

import skeletonStyles from '@app/features/app/components/skeleton/Skeleton.module.css';
import Authentication from '@app/features/auth/state/Authentication';
import * as PrivateChannelCommands from '@app/features/channel/commands/PrivateChannelCommands';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import GuildMembers from '@app/features/member/state/GuildMembers';
import {SafeMarkdown} from '@app/features/messaging/components/markdown';
import {MarkdownContext} from '@app/features/messaging/components/markdown/renderers/RendererTypes';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {PersonaTag} from '@app/features/persona/components/PersonaTag';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import markupStyles from '@app/features/theme/styles/Markup.module.css';
import {getUserAccentColor} from '@app/features/theme/utils/AccentColorUtils';
import * as ColorUtils from '@app/features/theme/utils/ColorUtils';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import FocusRingScope from '@app/features/ui/focus_ring/FocusRingScope';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import {UserSettingsModal} from '@app/features/user/components/modals/UserSettingsModal';
import popoutStyles from '@app/features/user/components/popouts/UserProfilePopout.module.css';
import sharedStyles from '@app/features/user/components/popouts/UserProfileShared.module.css';
import {ProfileCardBanner} from '@app/features/user/components/profile/profile_card/ProfileCardBanner';
import {ProfileCardContent} from '@app/features/user/components/profile/profile_card/ProfileCardContent';
import {ProfileCardFooter} from '@app/features/user/components/profile/profile_card/ProfileCardFooter';
import {ProfileCardLayout} from '@app/features/user/components/profile/profile_card/ProfileCardLayout';
import {ProfileCardUserInfo} from '@app/features/user/components/profile/profile_card/ProfileCardUserInfo';
import {PROFILE_POPOUT_GEOMETRY_STYLE} from '@app/features/user/constants/UserProfileSurfaceGeometry';
import type {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import type {PublicPersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {Trans} from '@lingui/react/macro';
import {CaretRightIcon, ChatTeardropIcon, PencilIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import styles from './PersonaProfilePopout.module.css';

export interface PersonaProfilePopoutProps {
	popoutKey?: string | number;
	subprofile: MessageSubprofileResponse;
	user: User;
	guildId?: string;
	guildMember?: GuildMember | null;
	onClose?: () => void;
}

export const PersonaProfilePopout: React.FC<PersonaProfilePopoutProps> = observer(
	({subprofile, user, guildId, guildMember, onClose}) => {
		const popoutContainerRef = useRef<HTMLDivElement | null>(null);
		const currentUserId = Authentication.currentUserId ?? Users.currentUser?.id;
		const isCurrentUser = Boolean(currentUserId && user?.id && user.id === currentUserId);
		const localPersona = isCurrentUser ? (PersonaStore.personas.find((p) => p.id === subprofile.id) ?? null) : null;

		const [publicPersona, setPublicPersona] = useState<PublicPersonaResponse | null>(null);
		const [isLoading, setIsLoading] = useState<boolean>(!localPersona);

		useEffect(() => {
			if (localPersona) {
				setPublicPersona({
					id: localPersona.id,
					name: localPersona.name,
					avatar_url: localPersona.avatar_url ?? localPersona.avatarUrl ?? null,
					system_name: localPersona.system_name ?? localPersona.systemName ?? null,
					pronouns: localPersona.pronouns ?? null,
					color: localPersona.color ?? localPersona.accentColor ?? null,
					bio: localPersona.bio ?? null,
					visibility: localPersona.visibility ?? 'unlisted',
				});
				setIsLoading(false);
				return;
			}

			let isMounted = true;
			setIsLoading(true);
			void PersonaCommands.fetchPublicPersona(user.id, subprofile.id)
				.then((res) => {
					if (isMounted) {
						setPublicPersona(res);
						setIsLoading(false);
					}
				})
				.catch(() => {
					if (isMounted) {
						setIsLoading(false);
					}
				});

			return () => {
				isMounted = false;
			};
		}, [user.id, subprofile.id, localPersona]);

		const effectivePronouns = publicPersona?.pronouns ?? localPersona?.pronouns ?? subprofile.pronouns;
		const effectiveDisplayTagText = isCurrentUser
			? PersonaStore.displayTagText
			: (subprofile.display_tag_text ?? subprofile.system_name ?? publicPersona?.system_name ?? null);
		const effectiveDisplayTagIcon = isCurrentUser ? PersonaStore.displayTagIcon : (subprofile.display_tag_icon ?? null);
		const effectiveBio = publicPersona?.bio ?? localPersona?.bio ?? subprofile.bio;

		const resolvedGuildMember = useMemo(() => {
			if (guildMember) return guildMember;
			if (guildId) return GuildMembers.getMember(guildId, user.id);
			return null;
		}, [guildMember, guildId, user.id]);

		const accentColor = useMemo(() => {
			if (subprofile.color != null && subprofile.color !== 0) {
				return ColorUtils.int2hex(subprofile.color);
			}
			return getUserAccentColor(user);
		}, [subprofile.color, user]);

		const rootDisplayName = useMemo(() => {
			if (resolvedGuildMember?.nick) {
				return NicknameUtils.formatNicknameForStreamerMode(resolvedGuildMember.nick);
			}
			return NicknameUtils.getNickname(user, guildId);
		}, [resolvedGuildMember, user, guildId]);

		const handleOpenRootProfile = useCallback(() => {
			onClose?.();
			UserProfileCommands.openUserProfile(user.id, guildId);
		}, [user.id, guildId, onClose]);

		const handleEditPersona = useCallback(() => {
			onClose?.();
			ModalCommands.push(
				modal(() => (
					<UserSettingsModal
						initialTab="personas"
						initialSubtab={subprofile.id}
						data-flx="persona.persona-profile-popout.user-settings-modal"
					/>
				)),
			);
		}, [subprofile.id, onClose]);

		const handleMessage = useCallback(async () => {
			try {
				onClose?.();
				await PrivateChannelCommands.openDMChannel(user.id);
			} catch {
				// Handled in platform transport
			}
		}, [user.id, onClose]);

		const personaAvatarUrl = useMemo(() => {
			return subprofile.avatar ?? AvatarUtils.getUserAvatarURL(user, false);
		}, [subprofile.avatar, user]);

		return (
			<FocusRingScope containerRef={popoutContainerRef} data-flx="persona.persona-profile-popout.focus-ring-scope">
				<div ref={popoutContainerRef} data-flx="persona.persona-profile-popout.container">
					<ProfileCardLayout
						borderColor={accentColor}
						className={popoutStyles.profilePopoutCard}
						style={PROFILE_POPOUT_GEOMETRY_STYLE}
						data-flx="persona.persona-profile-popout.profile-card-layout"
					>
						<ProfileCardBanner
							bannerUrl={null}
							hoverBannerUrl={null}
							bannerColor={accentColor}
							user={user}
							avatarUrl={personaAvatarUrl}
							hoverAvatarUrl={null}
							disablePresence={true}
							isClickable={false}
							data-flx="persona.persona-profile-popout.profile-card-banner"
						/>
						<ProfileCardContent data-flx="persona.persona-profile-popout.profile-card-content">
							<ProfileCardUserInfo
								displayName={subprofile.name}
								displayNameClassName={popoutStyles.profileDisplayName}
								user={user}
								pronouns={effectivePronouns}
								showUsername={false}
								isClickable={false}
								actions={
									effectiveDisplayTagText || effectiveDisplayTagIcon ? (
										<PersonaTag
											subprofile={{
												...subprofile,
												display_tag_text: effectiveDisplayTagText,
												display_tag_icon: effectiveDisplayTagIcon,
											}}
											rootUser={user}
											data-flx="persona.persona-profile-popout.persona-tag"
										/>
									) : undefined
								}
								data-flx="persona.persona-profile-popout.profile-card-user-info"
							/>
							{isLoading ? (
								<section
									className={sharedStyles.bioContainer}
									data-flx="persona.persona-profile-popout.bio-container-loading"
								>
									<div
										style={{display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0'}}
										data-flx="persona.persona-profile-popout.div"
									>
										<div
											className={skeletonStyles.skeleton}
											style={{width: '75%', height: '12px', borderRadius: '4px'}}
											data-flx="persona.persona-profile-popout.div--2"
										/>
										<div
											className={skeletonStyles.skeleton}
											style={{width: '90%', height: '12px', borderRadius: '4px'}}
											data-flx="persona.persona-profile-popout.div--3"
										/>
										<div
											className={skeletonStyles.skeleton}
											style={{width: '50%', height: '12px', borderRadius: '4px'}}
											data-flx="persona.persona-profile-popout.div--4"
										/>
									</div>
								</section>
							) : effectiveBio ? (
								<section className={sharedStyles.bioContainer} data-flx="persona.persona-profile-popout.bio-container">
									<div
										className={clsx(
											markupStyles.markup,
											markupStyles.bio,
											markupStyles.mutedSpoilerContext,
											styles.bioContent,
										)}
										data-flx="persona.persona-profile-popout.bio-content"
									>
										<SafeMarkdown
											content={effectiveBio}
											options={{context: MarkdownContext.RESTRICTED_USER_BIO, guildId}}
											data-flx="persona.persona-profile-popout.safe-markdown"
										/>
									</div>
								</section>
							) : null}
							<div
								className={sharedStyles.connectionsCompactSeparator}
								data-flx="persona.persona-profile-popout.separator"
							/>
							<div
								className={sharedStyles.connectionsContainer}
								data-flx="persona.persona-profile-popout.root-account-section"
							>
								<div
									className={sharedStyles.connectionsTitle}
									data-flx="persona.persona-profile-popout.root-account-title"
								>
									<Trans>Main account</Trans>
								</div>
								<FocusRing offset={-2} data-flx="persona.persona-profile-popout.root-account-focus-ring">
									<button
										type="button"
										className={clsx(sharedStyles.connectionCard, styles.rootAccountButton)}
										onClick={handleOpenRootProfile}
										data-flx="persona.persona-profile-popout.root-account-button"
									>
										<Avatar
											user={user}
											size={32}
											className={styles.rootAccountAvatar}
											data-flx="persona.persona-profile-popout.root-account-avatar"
										/>
										<div className={styles.rootAccountInfo} data-flx="persona.persona-profile-popout.root-account-info">
											<span className={sharedStyles.connectionCardName} data-flx="persona.persona-profile-popout.span">
												{rootDisplayName}
											</span>
											<span
												className={styles.rootAccountUsername}
												data-flx="persona.persona-profile-popout.root-account-username"
											>
												@{user.username}
											</span>
										</div>
										<CaretRightIcon
											size={16}
											className={styles.rootAccountChevron}
											data-flx="persona.persona-profile-popout.root-account-chevron"
										/>
									</button>
								</FocusRing>
							</div>
						</ProfileCardContent>
						<ProfileCardFooter data-flx="persona.persona-profile-popout.profile-card-footer">
							{isCurrentUser ? (
								<Button
									small={true}
									fitContainer={true}
									leftIcon={
										<PencilIcon
											className={popoutStyles.iconSmall}
											data-flx="persona.persona-profile-popout.pencil-icon"
										/>
									}
									onClick={handleEditPersona}
									data-flx="persona.persona-profile-popout.button.edit-persona"
								>
									<Trans>Edit persona</Trans>
								</Button>
							) : (
								<Button
									small={true}
									fitContainer={true}
									leftIcon={
										<ChatTeardropIcon
											className={popoutStyles.iconSmall}
											data-flx="persona.persona-profile-popout.chat-teardrop-icon"
										/>
									}
									onClick={handleMessage}
									data-flx="persona.persona-profile-popout.button.message"
								>
									<Trans>Message</Trans>
								</Button>
							)}
						</ProfileCardFooter>
					</ProfileCardLayout>
				</div>
			</FocusRingScope>
		);
	},
);
