// SPDX-License-Identifier: AGPL-3.0-or-later

import {UserSettingsModal} from '@app/features/app/components/dialogs/LoadableSettingsModals';
import forumStyles from '@app/features/forum/components/Forum.module.css';
import {CLEAR_SEARCH_DESCRIPTOR, TRY_AGAIN_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {PersonaGalleryDetail} from '@app/features/persona/components/gallery/PersonaGalleryDetail';
import {galleryBannerUrl, galleryPersonaColor} from '@app/features/persona/components/gallery/PersonaGalleryImages';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {PersonaGalleryNav} from '@app/features/persona/state/PersonaGalleryNav';
import {PersonaGalleryPrefs} from '@app/features/persona/state/PersonaGalleryPrefs';
import {personaAvatarUrls} from '@app/features/persona/utils/PersonaAvatarUrls';
import * as BulkMessages from '@app/features/persona/utils/PersonaBulkMessages';
import {
	filterGalleryItems,
	type GalleryPersona,
	type PersonaGallerySort,
	type PersonaGalleryView,
	plainBio,
	sortGalleryItems,
} from '@app/features/persona/utils/PersonaGalleryItems';
import * as M from '@app/features/persona/utils/PersonaGalleryMessages';
import {usePersonaDirectory} from '@app/features/persona/utils/usePersonaDirectory';
import {BottomSheet} from '@app/features/ui/bottom_sheet/BottomSheet';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Switch} from '@app/features/ui/components/form/FormSwitch';
import {Spinner} from '@app/features/ui/components/Spinner';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {RadioGroup} from '@app/features/ui/radio_group/RadioGroup';
import {SegmentedTabs} from '@app/features/ui/segmented_tabs/SegmentedTabs';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import type {User} from '@app/features/user/models/User';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {getFormattedShortDate} from '@app/features/user/utils/DateFormatting';
import {useLingui} from '@lingui/react/macro';
import {
	CaretDownIcon,
	CaretRightIcon,
	EyeSlashIcon,
	ListBulletsIcon,
	LockSimpleIcon,
	MagnifyingGlassIcon,
	SortAscendingIcon,
	SquaresFourIcon,
	UserSquareIcon,
	UsersThreeIcon,
	XIcon,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useState} from 'react';
import styles from './PersonaGallery.module.css';

export interface PersonaGalleryProps {
	/** The account whose personas to show. */
	user: User;
	/** Closes what holds the gallery, before it opens something else (settings, a direct message). */
	onClose?: () => void;
	/** The phone layout: chips for the view, the sort in a sheet, two cards a row. */
	isMobile?: boolean;
}

/**
 * An account's personas (tyne-chat/tyne#189): the Personas tab of the full profile, and the body of
 * the Personas sheet on phones. Others see the public personas; the owner sees them as others do,
 * and can add their unlisted and private ones. A persona opens in place, in `PersonaGalleryDetail`.
 */
export const PersonaGallery = observer(({user, onClose, isMobile = false}: PersonaGalleryProps) => {
	const {i18n} = useLingui();
	const directory = usePersonaDirectory(user.id);
	const [query, setQuery] = useState('');
	const [sort, setSort] = useState<PersonaGallerySort>('name');
	const [showHidden, setShowHidden] = useState(false);
	const [sortSheetOpen, setSortSheetOpen] = useState(false);
	const [openId, setOpenId] = useState<string | null>(() => PersonaGalleryNav.takePersonaRequest(user.id));
	const pendingPersona = PersonaGalleryNav.pendingPersona(user.id);
	useEffect(() => {
		if (!pendingPersona) return;
		const personaId = PersonaGalleryNav.takePersonaRequest(user.id);
		if (personaId) setOpenId(personaId);
	}, [pendingPersona, user.id]);

	const view = PersonaGalleryPrefs.currentView;
	const effectiveSort: PersonaGallerySort = sort === 'recent' && !directory.isOwn ? 'name' : sort;
	const shown =
		directory.isOwn && !showHidden ? directory.items.filter((p) => p.visibility === 'public') : directory.items;
	const list = sortGalleryItems(filterGalleryItems(shown, query), effectiveSort, i18n.locale);

	// Persona settings with the unlisted personas shown and Select on (tyne-chat/tyne#542).
	const handleChooseFeatured = () => {
		onClose?.();
		ModalCommands.push(
			modal(() => (
				<UserSettingsModal
					initialTab="personas"
					initialSubtab="feature"
					data-flx="persona.gallery.choose-featured.user-settings-modal"
				/>
			)),
		);
	};

	const handleManage = () => {
		onClose?.();
		ModalCommands.push(
			modal(() => <UserSettingsModal initialTab="personas" data-flx="persona.gallery.manage.user-settings-modal" />),
		);
	};

	if (openId) {
		return (
			<PersonaGalleryDetail
				user={user}
				personaId={openId}
				list={list}
				isOwn={directory.isOwn}
				displayTagText={directory.displayTagText}
				displayTagIcon={directory.displayTagIcon}
				isMobile={isMobile}
				onBack={() => setOpenId(null)}
				onNavigate={setOpenId}
				onClose={onClose}
				data-flx="persona.gallery.detail"
			/>
		);
	}

	const sortOptions = [
		{value: 'name' as const, name: i18n._(M.SORT_PERSONAS_NAME_DESCRIPTOR)},
		{value: 'used' as const, name: i18n._(M.SORT_PERSONAS_USED_DESCRIPTOR)},
		...(directory.isOwn ? [{value: 'recent' as const, name: i18n._(M.SORT_PERSONAS_RECENT_DESCRIPTOR)}] : []),
	];
	const sortLabel = sortOptions.find((o) => o.value === effectiveSort)?.name ?? sortOptions[0]!.name;
	const sortPanel = (
		<div
			className={clsx(forumStyles.sortPanel, isMobile && forumStyles.sortPanelSheet)}
			data-flx="persona.gallery.sort-panel"
		>
			<section className={forumStyles.sortSection} data-flx="persona.gallery.sort-panel.section">
				<h3 className={forumStyles.sortHeading} data-flx="persona.gallery.sort-panel.heading">
					{i18n._(M.SORT_PERSONAS_DESCRIPTOR)}
				</h3>
				<RadioGroup
					aria-label={i18n._(M.SORT_PERSONAS_DESCRIPTOR)}
					optionAlign="center"
					value={effectiveSort}
					onChange={(value) => {
						setSort(value);
						setSortSheetOpen(false);
					}}
					options={sortOptions}
					data-flx="persona.gallery.sort-panel.radio-group"
				/>
			</section>
		</div>
	);
	const sortButton = (
		<Button
			variant="secondary"
			small
			fitContent
			leftIcon={<SortAscendingIcon size={16} weight="bold" data-flx="persona.gallery.sort-icon" />}
			rightIcon={<CaretDownIcon size={12} weight="bold" data-flx="persona.gallery.sort-caret" />}
			className={forumStyles.filterPill}
			aria-haspopup="menu"
			aria-label={`${i18n._(M.SORT_PERSONAS_DESCRIPTOR)}: ${sortLabel}`}
			onClick={isMobile ? () => setSortSheetOpen(true) : undefined}
			data-flx="persona.gallery.sort-button"
		>
			{sortLabel}
		</Button>
	);

	const viewTabs = (
		<SegmentedTabs<PersonaGalleryView>
			semantics="radio"
			ariaLabel={i18n._(M.VIEW_PERSONAS_AS_DESCRIPTOR)}
			selectedTab={view}
			onTabChange={PersonaGalleryPrefs.setView}
			className={styles.viewTabs}
			tabs={[
				{
					id: 'gallery',
					label: i18n._(M.PERSONA_VIEW_GALLERY_DESCRIPTOR),
					icon: <SquaresFourIcon size={16} weight="bold" data-flx="persona.gallery.view-gallery-icon" />,
				},
				{
					id: 'list',
					label: i18n._(M.PERSONA_VIEW_LIST_DESCRIPTOR),
					icon: <ListBulletsIcon size={16} weight="bold" data-flx="persona.gallery.view-list-icon" />,
				},
				{
					id: 'avatars',
					label: i18n._(M.PERSONA_VIEW_AVATARS_DESCRIPTOR),
					icon: <UserSquareIcon size={16} weight="bold" data-flx="persona.gallery.view-avatars-icon" />,
				},
			]}
			data-flx="persona.gallery.view-tabs"
		/>
	);

	const renderBody = (): React.ReactNode => {
		if (directory.items.length === 0 && directory.status === 'loading') {
			return (
				<div className={styles.state} data-flx="persona.gallery.loading">
					<Spinner data-flx="persona.gallery.loading.spinner" />
				</div>
			);
		}
		if (directory.items.length === 0 && (directory.status === 'failed' || directory.status === 'forbidden')) {
			return (
				<div className={styles.state} data-flx="persona.gallery.failed">
					<p data-flx="persona.gallery.failed.text">{i18n._(M.PERSONAS_LOAD_FAILED_DESCRIPTOR)}</p>
					{directory.status === 'failed' && (
						<Button variant="secondary" small fitContent onClick={directory.retry} data-flx="persona.gallery.retry">
							{i18n._(TRY_AGAIN_DESCRIPTOR)}
						</Button>
					)}
				</div>
			);
		}
		if (shown.length === 0) {
			return (
				<div className={styles.state} data-flx="persona.gallery.none-public">
					<UsersThreeIcon size={32} className={styles.stateIcon} data-flx="persona.gallery.none-public.icon" />
					<p data-flx="persona.gallery.none-public.text">
						{directory.isOwn ? i18n._(M.NO_PUBLIC_PERSONAS_DESCRIPTOR) : i18n._(M.NO_PUBLIC_PERSONAS_OTHERS_DESCRIPTOR)}
					</p>
					{directory.isOwn && directory.items.length > 0 && (
						<Button
							variant="primary"
							small
							fitContent
							onClick={handleChooseFeatured}
							data-flx="persona.gallery.choose-featured"
						>
							{i18n._(BulkMessages.CHOOSE_PERSONAS_TO_FEATURE_DESCRIPTOR)}
						</Button>
					)}
				</div>
			);
		}
		if (list.length === 0) {
			return (
				<div className={styles.state} data-flx="persona.gallery.no-match">
					<p data-flx="persona.gallery.no-match.text">{i18n._(M.NO_PERSONAS_MATCH_DESCRIPTOR)}</p>
				</div>
			);
		}
		const itemProps = {user, isOwn: directory.isOwn, onOpen: setOpenId};
		if (view === 'list') {
			return (
				<ul className={styles.rows} data-flx="persona.gallery.rows">
					{list.map((p) => (
						<PersonaRow key={p.id} persona={p} {...itemProps} data-flx="persona.gallery.row" />
					))}
				</ul>
			);
		}
		if (view === 'avatars') {
			return (
				<ul className={styles.tiles} data-flx="persona.gallery.tiles">
					{list.map((p) => (
						<PersonaTile key={p.id} persona={p} {...itemProps} data-flx="persona.gallery.tile" />
					))}
				</ul>
			);
		}
		return (
			<ul className={clsx(styles.cards, isMobile && styles.cardsMobile)} data-flx="persona.gallery.cards">
				{list.map((p) => (
					<PersonaCard key={p.id} persona={p} {...itemProps} hideFooter={isMobile} data-flx="persona.gallery.card" />
				))}
			</ul>
		);
	};

	return (
		<div className={clsx(styles.gallery, isMobile && styles.galleryMobile)} data-flx="persona.gallery">
			{directory.isOwn && (
				<div className={styles.ownerBar} data-flx="persona.gallery.owner-bar">
					<span className={styles.ownerBarText} data-flx="persona.gallery.owner-bar.text">
						{i18n._(M.OTHERS_SEE_PUBLIC_PERSONAS_DESCRIPTOR, {count: directory.publicCount})}
					</span>
					<button
						type="button"
						className={styles.ownerManage}
						onClick={handleManage}
						data-flx="persona.gallery.owner-bar.manage"
					>
						{i18n._(M.MANAGE_PERSONAS_DESCRIPTOR)}
					</button>
					<Switch
						compact
						label={i18n._(M.SHOW_HIDDEN_PERSONAS_DESCRIPTOR)}
						value={showHidden}
						onChange={setShowHidden}
						className={styles.ownerSwitch}
						data-flx="persona.gallery.owner-bar.switch"
					/>
				</div>
			)}
			<div className={styles.toolbar} data-flx="persona.gallery.toolbar">
				<div className={styles.searchWrap} data-flx="persona.gallery.search-wrap">
					<Input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={
							directory.isOwn
								? i18n._(M.SEARCH_OWN_PERSONAS_DESCRIPTOR)
								: i18n._(M.SEARCH_PERSONAS_OF_DESCRIPTOR, {name: user.displayName})
						}
						aria-label={
							directory.isOwn
								? i18n._(M.SEARCH_OWN_PERSONAS_DESCRIPTOR)
								: i18n._(M.SEARCH_PERSONAS_OF_DESCRIPTOR, {name: user.displayName})
						}
						leftIcon={<MagnifyingGlassIcon size={16} weight="bold" data-flx="persona.gallery.search-icon" />}
						rightElement={
							query ? (
								<button
									type="button"
									onClick={() => setQuery('')}
									className={styles.clearSearch}
									aria-label={i18n._(CLEAR_SEARCH_DESCRIPTOR)}
									data-flx="persona.gallery.clear-search"
								>
									<XIcon size={14} weight="bold" data-flx="persona.gallery.clear-search-icon" />
								</button>
							) : undefined
						}
						className={styles.search}
						data-flx="persona.gallery.search"
					/>
				</div>
				{isMobile ? (
					sortButton
				) : (
					<Popout position="bottom-start" render={() => sortPanel} data-flx="persona.gallery.sort-popout">
						{sortButton}
					</Popout>
				)}
				{!isMobile && (
					<PersonaViewSwitch
						view={view}
						onChange={PersonaGalleryPrefs.setView}
						data-flx="persona.gallery.view-switch"
					/>
				)}
			</div>
			{isMobile && (
				<div className={styles.mobileViewTabs} data-flx="persona.gallery.persona-gallery.mobile-view-tabs">
					{viewTabs}
				</div>
			)}
			<div className={styles.countLine} aria-live="polite" data-flx="persona.gallery.count">
				{query.trim()
					? i18n._(M.PERSONA_COUNT_FILTERED_DESCRIPTOR, {shown: list.length, total: shown.length})
					: i18n._(M.PERSONA_COUNT_LINE_DESCRIPTOR, {count: shown.length})}
			</div>
			<div className={styles.body} data-flx="persona.gallery.body">
				{renderBody()}
			</div>
			{isMobile && (
				<BottomSheet
					isOpen={sortSheetOpen}
					onClose={() => setSortSheetOpen(false)}
					title={i18n._(M.SORT_PERSONAS_DESCRIPTOR)}
					snapPoints={[0, 1]}
					initialSnap={1}
					data-flx="persona.gallery.sort-sheet"
				>
					{sortPanel}
				</BottomSheet>
			)}
		</div>
	);
});

interface PersonaItemProps {
	persona: GalleryPersona;
	user: User;
	isOwn: boolean;
	onOpen: (personaId: string) => void;
}

const VIEW_OPTIONS: ReadonlyArray<{
	view: PersonaGalleryView;
	label: typeof M.PERSONA_VIEW_GALLERY_DESCRIPTOR;
	Icon: typeof SquaresFourIcon;
}> = [
	{view: 'gallery', label: M.PERSONA_VIEW_GALLERY_DESCRIPTOR, Icon: SquaresFourIcon},
	{view: 'list', label: M.PERSONA_VIEW_LIST_DESCRIPTOR, Icon: ListBulletsIcon},
	{view: 'avatars', label: M.PERSONA_VIEW_AVATARS_DESCRIPTOR, Icon: UserSquareIcon},
];

/** The view switch beside the search on wide layouts: icons only, to keep the list in view. */
const PersonaViewSwitch = ({
	view,
	onChange,
}: {
	view: PersonaGalleryView;
	onChange: (view: PersonaGalleryView) => void;
}) => {
	const {i18n} = useLingui();
	return (
		<div
			role="group"
			aria-label={i18n._(M.VIEW_PERSONAS_AS_DESCRIPTOR)}
			className={styles.viewSwitch}
			data-flx="persona.gallery.view-switch.group"
		>
			{VIEW_OPTIONS.map(({view: option, label, Icon}) => (
				<Tooltip key={option} text={i18n._(label)} position="top" data-flx="persona.gallery.view-switch.tooltip">
					<button
						type="button"
						aria-pressed={view === option}
						aria-label={i18n._(label)}
						className={clsx(styles.viewButton, view === option && styles.viewButtonActive)}
						onClick={() => onChange(option)}
						data-flx="persona.gallery.view-switch.button"
					>
						<Icon size={18} weight="bold" data-flx="persona.gallery.view-switch.icon" />
					</button>
				</Tooltip>
			))}
		</div>
	);
};

const VisibilityBadge = ({persona}: {persona: GalleryPersona}) => {
	const {i18n} = useLingui();
	if (persona.visibility === 'public') return null;
	const isPrivate = persona.visibility === 'private';
	return (
		<span
			className={clsx(styles.visibility, isPrivate ? styles.visibilityPrivate : styles.visibilityUnlisted)}
			data-flx="persona.gallery.visibility"
		>
			{isPrivate ? (
				<LockSimpleIcon size={11} weight="bold" data-flx="persona.gallery.visibility.private-icon" />
			) : (
				<EyeSlashIcon size={11} weight="bold" data-flx="persona.gallery.visibility.unlisted-icon" />
			)}
			<span data-flx="persona.gallery.visibility.label">
				{isPrivate ? i18n._(M.PERSONA_VISIBILITY_PRIVATE_DESCRIPTOR) : i18n._(M.PERSONA_VISIBILITY_UNLISTED_DESCRIPTOR)}
			</span>
		</span>
	);
};

const PersonaCard = observer(({persona, user, isOwn, onOpen, hideFooter}: PersonaItemProps & {hideFooter: boolean}) => {
	const {i18n} = useLingui();
	const color = galleryPersonaColor(persona);
	const bannerUrl = galleryBannerUrl(user, persona);
	const bio = plainBio(persona.bio);
	return (
		<li className={styles.cardItem} data-flx="persona.gallery.card.item">
			<button
				type="button"
				className={clsx(styles.card, persona.visibility !== 'public' && styles.dim)}
				onClick={() => onOpen(persona.id)}
				data-flx="persona.gallery.card.button"
			>
				<span className={styles.cardBannerWrap} data-flx="persona.gallery.card.banner-wrap">
					<span
						className={styles.cardBanner}
						style={{backgroundColor: color ?? undefined}}
						data-flx="persona.gallery.card.banner"
					>
						{bannerUrl && (
							<img
								src={bannerUrl}
								alt=""
								loading="lazy"
								className={styles.bannerImage}
								data-flx="persona.gallery.card.banner-image"
							/>
						)}
					</span>
					<span className={styles.cardAvatar} data-flx="persona.gallery.card.avatar">
						<PersonaAvatar
							user={user}
							persona={{avatar: persona.avatar}}
							size={48}
							disableStatusTooltip
							data-flx="persona.gallery.card.persona-avatar"
						/>
					</span>
				</span>
				<span className={styles.cardBody} data-flx="persona.gallery.card.body">
					<span className={styles.cardName} data-flx="persona.gallery.card.name">
						<span className={styles.cardNameText} style={{color}} data-flx="persona.gallery.card.name-text">
							{persona.name}
						</span>
						{persona.pronouns && (
							<span className={styles.cardPronouns} data-flx="persona.gallery.card.pronouns">
								{persona.pronouns}
							</span>
						)}
					</span>
					<span className={clsx(styles.cardBio, !bio && styles.muted)} data-flx="persona.gallery.card.bio">
						{bio || i18n._(M.PERSONA_NO_BIO_DESCRIPTOR)}
					</span>
				</span>
				{!hideFooter && (
					<span className={styles.cardFooter} data-flx="persona.gallery.card.footer">
						<span data-flx="persona.gallery.card.created">
							{Number.isFinite(persona.createdAt)
								? i18n._(M.PERSONA_CREATED_DESCRIPTOR, {date: getFormattedShortDate(persona.createdAt)})
								: null}
						</span>
						{isOwn && (
							<VisibilityBadge
								persona={persona}
								data-flx="persona.gallery.persona-gallery.persona-card.visibility-badge"
							/>
						)}
					</span>
				)}
				{hideFooter && isOwn && persona.visibility !== 'public' && (
					<span className={styles.cardBadgeCorner} data-flx="persona.gallery.card.badge-corner">
						<VisibilityBadge
							persona={persona}
							data-flx="persona.gallery.persona-gallery.persona-card.visibility-badge--2"
						/>
					</span>
				)}
			</button>
		</li>
	);
});

const PersonaRow = observer(({persona, user, isOwn, onOpen}: PersonaItemProps) => {
	const {i18n} = useLingui();
	const color = galleryPersonaColor(persona);
	const bannerUrl = galleryBannerUrl(user, persona);
	const bio = plainBio(persona.bio);
	return (
		<li className={styles.rowItem} data-flx="persona.gallery.row.item">
			<button
				type="button"
				className={clsx(styles.row, persona.visibility !== 'public' && styles.dim)}
				onClick={() => onOpen(persona.id)}
				data-flx="persona.gallery.row.button"
			>
				<PersonaAvatar
					user={user}
					persona={{avatar: persona.avatar}}
					size={40}
					disableStatusTooltip
					className={styles.rowAvatar}
					data-flx="persona.gallery.row.avatar"
				/>
				<span className={styles.rowText} data-flx="persona.gallery.row.text">
					<span className={styles.rowLine1} data-flx="persona.gallery.row.line1">
						<span className={styles.rowName} data-flx="persona.gallery.row.name">
							{persona.name}
						</span>
						{persona.pronouns && (
							<span className={styles.rowPronouns} data-flx="persona.gallery.row.pronouns">
								({persona.pronouns})
							</span>
						)}
						{color && (
							<span className={styles.colorDot} style={{backgroundColor: color}} data-flx="persona.gallery.row.color" />
						)}
						{isOwn && (
							<VisibilityBadge
								persona={persona}
								data-flx="persona.gallery.persona-gallery.persona-row.visibility-badge"
							/>
						)}
						{isOwn &&
							persona.tags.map((tag, index) => (
								<code key={index} className={styles.tagPill} data-flx="persona.gallery.row.tag">
									{`${tag.prefix ?? ''}${i18n._(M.TAG_EXAMPLE_TEXT_DESCRIPTOR)}${tag.suffix ?? ''}`}
								</code>
							))}
					</span>
					<span className={clsx(styles.rowBio, !bio && styles.muted)} data-flx="persona.gallery.row.bio">
						{bio || i18n._(M.PERSONA_NO_BIO_DESCRIPTOR)}
					</span>
				</span>
				<span className={styles.rowSide} data-flx="persona.gallery.row.side">
					{Number.isFinite(persona.createdAt) && (
						<span className={styles.rowDate} data-flx="persona.gallery.row.date">
							{getFormattedShortDate(persona.createdAt)}
						</span>
					)}
					<span
						className={clsx(styles.rowStrip, !bannerUrl && !color && styles.rowStripEmpty)}
						style={{backgroundColor: color ?? undefined}}
						data-flx="persona.gallery.row.strip"
					>
						{bannerUrl && (
							<img
								src={bannerUrl}
								alt=""
								loading="lazy"
								className={styles.bannerImage}
								data-flx="persona.gallery.row.strip-image"
							/>
						)}
					</span>
					<CaretRightIcon size={14} weight="bold" className={styles.rowCaret} data-flx="persona.gallery.row.caret" />
				</span>
			</button>
		</li>
	);
});

const PersonaTile = observer(({persona, user, isOwn, onOpen}: PersonaItemProps) => {
	const color = galleryPersonaColor(persona);
	const src =
		personaAvatarUrls(user.id, {avatar: persona.avatar}, 256).avatarUrl ??
		AvatarUtils.getUserAvatarURL(user, false, 256);
	return (
		<li className={styles.tileItem} data-flx="persona.gallery.tile.item">
			<button
				type="button"
				className={clsx(styles.tile, persona.visibility !== 'public' && styles.dim)}
				style={color ? {borderColor: color} : undefined}
				onClick={() => onOpen(persona.id)}
				data-flx="persona.gallery.tile.button"
			>
				<img src={src} alt="" loading="lazy" className={styles.tileImage} data-flx="persona.gallery.tile.image" />
				<span className={styles.tileName} data-flx="persona.gallery.tile.name">
					<span className={styles.tileNameText} data-flx="persona.gallery.tile.name-text">
						{persona.name}
					</span>
					{isOwn && (
						<VisibilityBadge
							persona={persona}
							data-flx="persona.gallery.persona-gallery.persona-tile.visibility-badge"
						/>
					)}
				</span>
			</button>
		</li>
	);
});
