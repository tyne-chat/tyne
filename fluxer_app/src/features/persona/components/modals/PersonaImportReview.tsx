// SPDX-License-Identifier: AGPL-3.0-or-later

// The review of an import (tyne-chat/tyne#243, laid out as "Pick a side", tyne-chat/tyne#563): what
// needs no decision is one line each at the top; every member that needs one is a question with the
// file's version on the left and Tyne's on the right, and the person taps the one Tyne should have.
// Each member starts on the choice that changes nothing, and a sentence under it says what will
// happen. Nothing here writes; the dialog applies the decisions. Pictures come only from this
// instance (a stored hash) or from the export's zip in memory, never from a link in the file.

import {PRODUCT_NAME} from '@app/features/app/config/ProductConstants';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import {bundlePictureBytes} from '@app/features/persona/utils/PersonaImportImages';
import {
	defaultDecision,
	heldTags,
	keepBothDecision,
	parseTagInput,
	type ReviewConflict,
	type ReviewDecision,
	type ReviewMember,
	reviewNeedCount,
	sharedTags,
	suggestTag,
	tagHolder,
	tagInputText,
} from '@app/features/persona/utils/PersonaImportReview';
import Users from '@app/features/user/state/Users';
import {getPersonaAvatarURL, getPersonaBannerURL} from '@app/features/user/utils/AvatarUtils';
import type {PersonaResponse, PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	PersonaImportCandidate,
	PersonaImportField,
	PersonaImportPreviewEntry,
	PersonaImportPreviewResponse,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {imageFileExtension} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import type {MessageDescriptor} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {
	ArrowRightIcon,
	CaretDownIcon,
	ChatTeardropIcon,
	CheckIcon,
	FileTextIcon,
	LinkSimpleIcon,
	PlusIcon,
	ShieldCheckIcon,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useMemo, useState} from 'react';
import styles from './PersonaImportReview.module.css';

const FIELD_HEADING: Record<PersonaImportField, MessageDescriptor> = {
	name: msg({message: 'Name', comment: 'Row heading in the table comparing a persona with the import file'}),
	pronouns: msg({message: 'Pronouns', comment: 'Row heading in the table comparing a persona with the import file'}),
	bio: msg({message: 'Bio', comment: 'Row heading in the table comparing a persona with the import file'}),
	color: msg({message: 'Colour', comment: 'Row heading in the table comparing a persona with the import file'}),
	persona_tags: msg({message: 'Tags', comment: 'Row heading in the table comparing a persona with the import file'}),
	avatar: msg({message: 'Avatar', comment: 'Row heading in the table comparing a persona with the import file'}),
	banner: msg({message: 'Banner', comment: 'Row heading in the table comparing a persona with the import file'}),
	signature_emojis: msg({
		message: 'Signature emojis',
		comment: 'Row heading in the table comparing a persona with the import file',
	}),
	auto_tag_disabled: msg({
		message: 'Tag matching',
		comment: 'Row heading in the table comparing a persona with the import file: whether its tags are matched',
	}),
	visibility: msg({
		message: 'Visibility',
		comment: 'Row heading in the table comparing a persona with the import file',
	}),
};

const INTRO_MEMBERS_DESCRIPTOR = msg({
	message:
		'These look like personas you already have in {productName}. For each one, pick what {productName} should have. Not sure? Leave it as it is: nothing changes.',
	comment: 'Explanation at the top of the import review. {productName} is the app name',
});
const INTRO_NONE_DESCRIPTOR = msg({
	message: 'Not sure? Leave it as it is: nothing changes.',
	comment: 'Explanation at the top of the import review when no member needs a choice, only the display tag',
});
const READY_NEW_DESCRIPTOR = msg({
	message: '{count, plural, one {# new member will be added} other {# new members will be added}}',
	comment: 'Line at the top of the import review. {count} is a number of members of the import file',
});
const READY_LINKED_DESCRIPTOR = msg({
	message:
		'{count, plural, one {# persona you made by hand will be connected to its member. Nothing about it changes.} other {# personas you made by hand will be connected to their members. Nothing about them changes.}}',
	comment:
		'Line at the top of the import review: personas with the same name and tag as a member of the import file are connected to it, which records only which member they are. {count} is a number',
});
const READY_SAME_DESCRIPTOR = msg({
	message:
		'{count, plural, one {# member already matches its persona in {productName}. Nothing to do.} other {# members already match their persona in {productName}. Nothing to do.}}',
	comment: 'Line at the top of the import review. {count} is a number, {productName} the app name',
});
const READY_UNTOUCHED_DESCRIPTOR = msg({
	message:
		"{count, plural, one {# persona in {productName} isn't in your file. It stays as it is.} other {# personas in {productName} aren't in your file. They stay as they are.}}",
	comment: 'Line at the top of the import review. {count} is a number, {productName} the app name',
});
const SHOW_DESCRIPTOR = msg({
	message: 'Show',
	context: 'persona-import-list',
	comment: 'Button that shows the list behind a line at the top of the import review',
});
const HIDE_DESCRIPTOR = msg({
	message: 'Hide',
	context: 'persona-import-list',
	comment: 'Button that hides the list behind a line at the top of the import review again',
});
const ADD_TOGGLE_DESCRIPTOR = msg({
	message: 'Add {name}',
	comment: 'Accessible label of the checkbox that adds a new member of the import file. {name} is its name',
});
const CONNECT_TOGGLE_DESCRIPTOR = msg({
	message: 'Connect {name}',
	comment:
		'Accessible label of the checkbox that connects a persona made by hand to its member in the import file. {name} is its name',
});
const YOUR_FILE_DESCRIPTOR = msg({
	message: 'Your file',
	comment: 'Column heading in the import review, above the import file side; the other column is the app name',
});
const FROM_FILE_DESCRIPTOR = msg({
	message: 'From your file',
	comment: 'Small line on a card in the import review showing a member of the import file',
});
const USED_TIMES_DESCRIPTOR = msg({
	message: '{count, plural, one {Used once} other {Used # times}}',
	comment: 'How often a persona has been used, shown in the import review',
});
const DELETED_ON_DESCRIPTOR = msg({
	message: 'Deleted {date}',
	comment: 'When a persona was deleted, in the import review. {date} is a date',
});
const LINKED_ELSEWHERE_DESCRIPTOR = msg({
	message: 'Linked to another PluralKit member',
	comment: 'Shown on a persona in the import review that is already connected to a different member',
});
const NO_PICTURE_DESCRIPTOR = msg({
	message: 'None',
	comment: 'Comparison of a persona picture with the import file: there is none',
});
const PICTURES_MISSING_DESCRIPTOR = msg({
	message: "The file's picture couldn't be loaded",
	comment:
		'Shown on a member of the import file in the import review when its avatar or banner could not be stored or shown',
});
const NO_PRONOUNS_DESCRIPTOR = msg({
	message: 'No pronouns',
	comment: 'Shown in the import review where a persona or a member of the file has no pronouns',
});
const NO_TAGS_DESCRIPTOR = msg({
	message: 'No tags',
	comment: 'Shown in the import review where a persona or a member of the file has no proxy tags',
});
const NO_BIO_DESCRIPTOR = msg({
	message: 'No bio',
	comment: 'Shown in the import review where a persona or a member of the file has no bio',
});
const NOTHING_CHANGES_DESCRIPTOR = msg({
	message: 'Nothing changes',
	comment: 'Badge on the choice in the import review that leaves everything as it is',
});
const DIFFERS_QUESTION_DESCRIPTOR = msg({
	message: '{name} is different in your file. Which one should {productName} have?',
	comment:
		'Question in the import review for a persona whose details differ from the import file. {name} is its name, {productName} the app name',
});
const DIFFERS_GROUP_DESCRIPTOR = msg({
	message: '{count, plural, one {# persona is different in your file} other {# personas are different in your file}}',
	comment:
		'Heading in the import review over the list of personas whose details differ from the import file. {count} is how many',
});
const DIFFERS_HINT_DESCRIPTOR = msg({
	message: "Each keeps {productName}'s version unless you open it and choose the file's.",
	comment: 'Hint under the list of differing personas in the import review. {productName} is the app name',
});
const KEEPING_TYNE_DESCRIPTOR = msg({
	message: "Keeping {productName}'s",
	comment:
		"Badge on a collapsed persona in the import review: the app's version is kept. {productName} is the app name",
});
const USING_FILE_DESCRIPTOR = msg({
	message: "Using the file's",
	comment: "Badge on a collapsed persona in the import review: the import file's version replaces it",
});
const KEEPING_BOTH_DESCRIPTOR = msg({
	message: 'Keeping both',
	comment: "Badge on a collapsed persona in the import review: the file's version is added next to the app's",
});
const SWITCH_FILE_DESCRIPTOR = msg({
	context: 'persona-import-switch',
	message: "Use the file's",
	comment:
		"Option of the three-way switch for a persona that differs from the import file: the file's version replaces the app's",
});
const SWITCH_BOTH_DESCRIPTOR = msg({
	message: 'Keep both',
	comment:
		"Option of the three-way switch for a persona that differs from the import file: the file's version is added as another persona",
});
const SWITCH_TYNE_DESCRIPTOR = msg({
	message: "Use {productName}'s",
	comment:
		"Option of the three-way switch for a persona that differs from the import file: the app's version stays and the file's is not imported. {productName} is the app name",
});
const STATUS_NOT_IMPORTED_DESCRIPTOR = msg({
	message: 'Not imported',
	comment: "What happens to the import file's version of a persona in the import review",
});
const STATUS_REPLACES_DESCRIPTOR = msg({
	message: "Replaces {productName}'s {name}",
	comment:
		"What happens to the import file's version of a persona in the import review. {productName} is the app name, {name} the persona",
});
const STATUS_ADDED_DESCRIPTOR = msg({
	message: 'Added as a new persona',
	comment: "What happens to the import file's version of a persona in the import review",
});
const STATUS_STAYS_DESCRIPTOR = msg({
	message: 'Stays as it is',
	comment: "What happens to the app's version of a persona in the import review",
});
const STATUS_OVERWRITTEN_DESCRIPTOR = msg({
	message: 'Gets overwritten',
	comment: "What happens to the app's version of a persona in the import review when the file's version is used",
});
const CANT_TELL_QUESTION_DESCRIPTOR = msg({
	message: 'Is {name} from your file one of these personas in {productName}?',
	comment:
		'Question in the import review for a member that shares a name or a tag with personas, but not both. {name} is its name',
});
const SAME_PERSONA_DESCRIPTOR = msg({
	message: 'Same persona as this one',
	comment: "Choice on a persona's card in the import review: the member of the import file is this persona",
});
const MATCHED_ON_DESCRIPTORS: Record<PersonaImportCandidate['matched_on'], MessageDescriptor> = {
	name: msg({message: 'Same name', comment: 'Why a persona in the import review may be the member: same name'}),
	tag: msg({message: 'Same tag', comment: 'Why a persona in the import review may be the member: same proxy tag'}),
	name_and_tag: msg({
		message: 'Same name and tag',
		comment: 'Why a persona in the import review may be the member: same name and proxy tag',
	}),
	tag_case: msg({
		message: 'Similar tag',
		comment: 'Why a persona in the import review may be the member: the proxy tags differ only in letter case',
	}),
};
const ADD_DIFFERENT_DESCRIPTOR = msg({
	message: 'A different persona: add it',
	comment: 'Choice in the import review: the member of the file is someone else, add it as a new persona',
});
const NOT_SURE_SKIP_DESCRIPTOR = msg({
	message: 'Not sure: leave {name} out this time',
	comment: 'Choice in the import review: do nothing with this member of the import file. {name} is its name',
});
const TAG_TAKEN_QUESTION_DESCRIPTOR = msg({
	message: "{name}'s tag is already taken",
	comment:
		'Heading in the import review for a member whose proxy tag another persona or member already has. {name} is its name',
});
const LEAVE_OUT_DESCRIPTOR = msg({
	message: 'Leave {name} out this time',
	comment: 'Choice in the import review: do nothing with this member of the import file. {name} is its name',
});
const ADD_OWN_TAG_DESCRIPTOR = msg({
	message: 'Add {name} with a tag of its own',
	comment: 'Choice in the import review: add the member as a new persona with another proxy tag. {name} is its name',
});
const KEEPS_TAG_DESCRIPTOR = msg({
	message: 'Keeps its tag',
	comment: 'Small line on the card of the persona in the import review that already has the proxy tag',
});
const TAG_FIELD_DESCRIPTOR = msg({
	message: 'Tag',
	context: 'persona-import-field',
	comment: 'Label of the field for a new proxy tag in the import review',
});
const TAG_INSTEAD_DESCRIPTOR = msg({
	message: 'Instead of {tag}',
	comment:
		'Label of a field for a new proxy tag in the import review, when a member has several clashing tags. {tag} is the tag it replaces',
});
const TAG_FREE_DESCRIPTOR = msg({
	message: 'Free',
	context: 'persona-import-tag-status',
	comment: 'Status beside the field for a new proxy tag in the import review: no persona has this tag',
});
const TAG_HELD_DESCRIPTOR = msg({
	message: '{name} already has it',
	comment: 'Status beside the field for a new proxy tag in the import review. {name} is the persona that has it',
});
const TAG_NONE_DESCRIPTOR = msg({
	message: 'No tag: added without one',
	comment: 'Status beside an empty field for a new proxy tag in the import review',
});
const DELETED_QUESTION_DESCRIPTOR = msg({
	message: 'You deleted {name} in {productName} on {date}. Bring {name} back?',
	comment:
		'Question in the import review for a persona that was deleted. {name} is its name, {productName} the app name, {date} a date',
});
const DELETED_QUESTION_NO_DATE_DESCRIPTOR = msg({
	message: 'You deleted {name} in {productName}. Bring {name} back?',
	comment:
		'Question in the import review for a persona that was deleted. {name} is its name, {productName} the app name',
});
const BRING_BACK_DESCRIPTOR = msg({
	message: 'Bring {name} back',
	comment: 'Switch on a deleted persona in the import review that restores it. {name} is its name',
});
const COMES_BACK_DESCRIPTOR = msg({
	message: 'Comes back as it was, with its old messages',
	comment: 'Small line on a deleted persona in the import review once it is set to come back',
});
const DISPLAY_TAG_QUESTION_DESCRIPTOR = msg({
	message: "Your display tag shows after every persona's name. Which one should {productName} use?",
	comment: 'Question in the import review when the import file has another display tag. {productName} is the app name',
});
const USE_FILES_TAG_DESCRIPTOR = msg({
	message: "Use the file's",
	comment: "Choice on the import file's card in the import review: use the file's display tag",
});
const KEEP_TYNES_TAG_DESCRIPTOR = msg({
	message: "Keep {productName}'s",
	comment: "Choice on the app's card in the import review: keep the display tag. {productName} is the app name",
});
const NO_DISPLAY_TAG_DESCRIPTOR = msg({
	message: 'No display tag',
	comment: 'Shown on a card in the import review when the account has no display tag',
});

function tagText(tag: PersonaTag): string {
	return `${(tag.prefix ?? '').trim()}text${(tag.suffix ?? '').trim()}`;
}

function listFormat(locale: string, items: ReadonlyArray<string>): string {
	try {
		return new Intl.ListFormat(locale, {type: 'conjunction', style: 'narrow'}).format(items);
	} catch {
		return items.join(', ');
	}
}

function Tags({
	tags,
	highlight,
}: {
	tags: ReadonlyArray<PersonaTag> | null | undefined;
	highlight?: ReadonlySet<string>;
}) {
	if (!tags || tags.length === 0) return null;
	return (
		<span className={styles.tags} data-flx="persona.persona-import-review.tags.span">
			{tags.map((tag) => (
				<code
					key={tagText(tag)}
					className={clsx(styles.tag, highlight?.has(tagText(tag)) && styles.tagClash)}
					data-flx="persona.persona-import-review.tags.tag"
				>
					{tagText(tag)}
				</code>
			))}
		</span>
	);
}

/** Local addresses of a zip's pictures for one member, shown when storing them failed. */
type LocalPictures = {avatar?: string; banner?: string};

/** Local addresses for the zip's pictures of the members shown, released when the review closes. */
function useLocalPictures(
	source: PersonaImportSource,
	members: ReadonlyArray<ReviewMember>,
): Map<number, LocalPictures> {
	const urls = useMemo(() => {
		const map = new Map<number, LocalPictures>();
		members.forEach((member, index) => {
			const local: LocalPictures = {};
			for (const kind of ['avatar', 'banner'] as const) {
				const bytes = bundlePictureBytes(source, member, kind);
				if (!bytes) continue;
				const type = `image/${imageFileExtension(bytes) === 'jpg' ? 'jpeg' : imageFileExtension(bytes)}`;
				local[kind] = URL.createObjectURL(new Blob([bytes as BlobPart], {type}));
			}
			if (local.avatar || local.banner) map.set(index, local);
		});
		return map;
	}, [source, members]);
	useEffect(
		() => () =>
			urls.forEach((local) => {
				if (local.avatar) URL.revokeObjectURL(local.avatar);
				if (local.banner) URL.revokeObjectURL(local.banner);
			}),
		[urls],
	);
	return urls;
}

const Initial = ({name}: {name: string}) => (
	<span className={styles.placeholderAvatar} aria-hidden="true" data-flx="persona.persona-import-review.initial">
		{Array.from(name.trim())[0] ?? '?'}
	</span>
);

function colorHex(color: number | null | undefined): string | undefined {
	return color != null ? `#${color.toString(16).padStart(6, '0')}` : undefined;
}

/** A picture to show: a stored copy's hash, or a zip's picture in memory. */
interface HeaderPicture {
	hash?: string | null;
	localUrl?: string;
}

/**
 * Banner and avatar together, as a profile card shows them: the banner (or the persona's colour) with
 * the avatar over its lower corner. A picture that differs from the other side is marked.
 */
const ProfileHeader = observer(
	({
		name,
		color,
		avatar,
		banner,
		compact,
		avatarDiffers,
		bannerDiffers,
		missing,
	}: {
		name: string;
		color: number | null | undefined;
		avatar: HeaderPicture;
		banner: HeaderPicture;
		compact?: boolean;
		avatarDiffers?: boolean;
		bannerDiffers?: boolean;
		/** The file has a picture that could not be stored or shown. */
		missing?: boolean;
	}) => {
		const {i18n} = useLingui();
		const user = Users.currentUser;
		const avatarUrl =
			avatar.hash && user ? getPersonaAvatarURL({userId: user.id, avatar: avatar.hash}, false, 160) : avatar.localUrl;
		const bannerUrl =
			banner.hash && user ? getPersonaBannerURL({userId: user.id, banner: banner.hash}, false, 640) : banner.localUrl;
		return (
			<div
				className={clsx(styles.profileHeader, compact && styles.profileHeaderCompact)}
				data-flx="persona.persona-import-review.profile-header"
			>
				<div
					className={clsx(styles.profileBanner, bannerDiffers && styles.profileDiffers)}
					style={{
						backgroundColor: colorHex(color),
						backgroundImage: bannerUrl ? `url("${bannerUrl}")` : undefined,
					}}
					aria-hidden="true"
					data-flx="persona.persona-import-review.profile-header.banner"
				/>
				<span
					className={clsx(styles.profileAvatar, avatarDiffers && styles.profileAvatarDiffers)}
					data-flx="persona.persona-import-review.profile-header.avatar"
				>
					{avatarUrl ? (
						<img src={avatarUrl} alt="" data-flx="persona.persona-import-review.profile-header.avatar-image" />
					) : (
						<Initial name={name} data-flx="persona.persona-import-review.profile-header.initial" />
					)}
				</span>
				{missing && (
					<span className={styles.profileMissing} data-flx="persona.persona-import-review.profile-header.missing">
						{i18n._(PICTURES_MISSING_DESCRIPTOR)}
					</span>
				)}
			</div>
		);
	},
);

/** The file's pictures for a member: stored copies the preview names, else the zip's in memory. */
function filePictures(
	entry: PersonaImportPreviewEntry,
	member: ReviewMember,
	local: LocalPictures | undefined,
): {avatar: HeaderPicture; banner: HeaderPicture; missing: boolean} {
	const avatar = {hash: entry.avatar_hash, localUrl: local?.avatar};
	const banner = {hash: entry.banner_hash, localUrl: local?.banner};
	const shown = (picture: HeaderPicture) => Boolean(picture.hash || picture.localUrl);
	const missing =
		(Boolean(member.preview.avatar) && !shown(avatar)) || (Boolean(member.preview.banner) && !shown(banner));
	return {avatar, banner, missing};
}

const PersonaPicture = observer(({persona}: {persona: PersonaResponse}) => {
	const user = Users.currentUser;
	if (!user || !persona.avatar_hash)
		return <Initial name={persona.name} data-flx="persona.persona-import-review.persona-picture.initial" />;
	return (
		<PersonaAvatar
			user={user}
			persona={{avatar: persona.avatar_hash}}
			size={40}
			data-flx="persona.persona-import-review.persona-picture.persona-avatar"
		/>
	);
});

/** The file's member: picture, name, pronouns, tags and bio. */
function MemberBlock({
	entry,
	member,
	local,
	clashing,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	local?: LocalPictures;
	clashing?: ReadonlySet<string>;
}) {
	const {i18n} = useLingui();
	const pictures = filePictures(entry, member, local);
	return (
		<div className={styles.block} data-flx="persona.persona-import-review.member-block">
			<ProfileHeader
				name={member.preview.name}
				color={member.preview.color}
				avatar={pictures.avatar}
				banner={pictures.banner}
				missing={pictures.missing}
				compact
				data-flx="persona.persona-import-review.member-block.header"
			/>
			<div className={styles.blockHead} data-flx="persona.persona-import-review.member-block.head">
				<div className={styles.blockTitle} data-flx="persona.persona-import-review.member-block.title">
					<span className={styles.blockName} data-flx="persona.persona-import-review.member-block.name">
						{member.preview.name}
					</span>
					{member.preview.pronouns && (
						<span className={styles.blockMeta} data-flx="persona.persona-import-review.member-block.pronouns">
							{member.preview.pronouns}
						</span>
					)}
				</div>
			</div>
			<Tags
				tags={member.preview.persona_tags}
				highlight={clashing}
				data-flx="persona.persona-import-review.member-block.tags"
			/>
			{member.preview.bio && (
				<span className={styles.blockBio} data-flx="persona.persona-import-review.member-block.bio">
					{member.preview.bio}
				</span>
			)}
			<span className={styles.blockMeta} data-flx="persona.persona-import-review.member-block.meta">
				{i18n._(FROM_FILE_DESCRIPTOR)}
			</span>
		</div>
	);
}

/** A persona in Tyne: picture, name, pronouns, tags, bio and how often it was used. */
function PersonaBlock({
	persona,
	note,
	compact,
	clashing,
}: {
	persona: PersonaResponse;
	note?: string;
	compact?: boolean;
	clashing?: ReadonlySet<string>;
}) {
	const {i18n} = useLingui();
	return (
		<div className={styles.block} data-flx="persona.persona-import-review.persona-block">
			<ProfileHeader
				name={persona.name}
				color={persona.color}
				avatar={{hash: persona.avatar_hash}}
				banner={{hash: persona.banner_hash}}
				compact
				data-flx="persona.persona-import-review.persona-block.header"
			/>
			<div className={styles.blockHead} data-flx="persona.persona-import-review.persona-block.head">
				<div className={styles.blockTitle} data-flx="persona.persona-import-review.persona-block.title">
					<span className={styles.blockName} data-flx="persona.persona-import-review.persona-block.name">
						{persona.name}
					</span>
					{persona.pronouns && (
						<span className={styles.blockMeta} data-flx="persona.persona-import-review.persona-block.pronouns">
							{persona.pronouns}
						</span>
					)}
				</div>
			</div>
			<Tags
				tags={persona.persona_tags}
				highlight={clashing}
				data-flx="persona.persona-import-review.persona-block.tags"
			/>
			{!compact && persona.bio && (
				<span className={styles.blockBio} data-flx="persona.persona-import-review.persona-block.bio">
					{persona.bio}
				</span>
			)}
			<span className={styles.blockMeta} data-flx="persona.persona-import-review.persona-block.meta">
				{note ?? i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0})}
			</span>
		</div>
	);
}

/** A card that is itself the choice: picked, it is lit; another option picked, it greys out. */
function SideCard({
	name,
	label,
	checked,
	dimmed,
	disabled,
	dashed,
	onSelect,
	children,
}: {
	name: string;
	label: string;
	checked: boolean;
	dimmed: boolean;
	disabled?: boolean;
	dashed?: boolean;
	onSelect: () => void;
	children?: React.ReactNode;
}) {
	return (
		<label
			className={clsx(
				styles.card,
				styles.cardChoice,
				checked && styles.cardChosen,
				dimmed && styles.cardDimmed,
				dashed && styles.cardDashed,
				disabled && styles.cardDisabled,
			)}
			data-flx="persona.persona-import-review.side-card"
		>
			<span className={styles.cardChoiceHead} data-flx="persona.persona-import-review.side-card.head">
				<input
					type="radio"
					className={styles.radio}
					name={name}
					checked={checked}
					disabled={disabled}
					onChange={onSelect}
					data-flx="persona.persona-import-review.side-card.radio"
				/>
				<span className={styles.cardChoiceLabel} data-flx="persona.persona-import-review.side-card.label">
					{label}
				</span>
			</span>
			{children}
		</label>
	);
}

/** A full-width option under a question, such as leaving the member out. */
function OptionRow({
	name,
	label,
	checked,
	safe,
	onSelect,
	children,
}: {
	name: string;
	label: string;
	checked: boolean;
	safe?: boolean;
	onSelect: () => void;
	children?: React.ReactNode;
}) {
	const {i18n} = useLingui();
	return (
		<div className={clsx(styles.option, checked && styles.cardChosen)} data-flx="persona.persona-import-review.option">
			<label className={styles.optionHead} data-flx="persona.persona-import-review.option.head">
				<input
					type="radio"
					className={styles.radio}
					name={name}
					checked={checked}
					onChange={onSelect}
					data-flx="persona.persona-import-review.option.radio"
				/>
				<span className={styles.optionLabel} data-flx="persona.persona-import-review.option.label">
					{label}
				</span>
				{safe && (
					<span className={styles.safeChip} data-flx="persona.persona-import-review.option.safe-chip">
						{i18n._(NOTHING_CHANGES_DESCRIPTOR)}
					</span>
				)}
			</label>
			{children}
		</div>
	);
}

/** The two sides of a question with the import's direction between them. */
function Pair({left, right, top}: {left: React.ReactNode; right: React.ReactNode; top?: boolean}) {
	return (
		<div className={clsx(styles.pair, top && styles.pairTop)} data-flx="persona.persona-import-review.pair">
			{left}
			<ArrowRightIcon
				size={20}
				weight="bold"
				className={styles.pairArrow}
				aria-hidden="true"
				data-flx="persona.persona-import-review.pair.arrow"
			/>
			{right}
		</div>
	);
}

function Question({id, children}: {id: string; children: React.ReactNode}) {
	return (
		<h3 id={id} className={styles.question} data-flx="persona.persona-import-review.question">
			{children}
		</h3>
	);
}

interface ReviewContext {
	entries: ReadonlyArray<PersonaImportPreviewEntry>;
	members: ReadonlyArray<ReviewMember>;
	decisions: ReadonlyMap<number, ReviewDecision>;
	livePersonas: ReadonlyArray<PersonaResponse>;
	fromTyne: boolean;
}

/** The tags a new persona for this member cannot keep: those another persona holds, and shared ones. */
function clashingTags(entry: PersonaImportPreviewEntry): Array<PersonaTag> {
	return [...heldTags(entry), ...sharedTags(entry)];
}

/** Fields for new tags in place of the clashing ones, each filled in with a free one until changed. */
function TagFields({
	entry,
	member,
	context,
	replacements,
	onChange,
	...fork
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	context: ReviewContext;
	replacements: ReadonlyArray<PersonaTag>;
	onChange: (replacements: Array<PersonaTag>) => void;
	/** The tags the fields stand in for, when not the member's clashing ones (a Keep both copy). */
	clashing?: ReadonlyArray<PersonaTag>;
}) {
	const {i18n} = useLingui();
	const clashing = fork.clashing ?? clashingTags(entry);
	return (
		<div className={styles.tagFields} data-flx="persona.persona-import-review.tag-fields">
			{clashing.map((tag, position) => {
				const value = replacements[position] ?? {};
				const empty = !(value.prefix ?? '').trim() && !(value.suffix ?? '').trim();
				const holder = empty
					? null
					: tagHolder(
							value,
							entry.index,
							context.entries,
							context.decisions,
							context.members,
							context.livePersonas,
							context.fromTyne,
						);
				const fieldId = `import-tag-${entry.index}-${position}`;
				let status = i18n._(TAG_FREE_DESCRIPTOR);
				if (empty) status = i18n._(TAG_NONE_DESCRIPTOR);
				else if (holder) status = i18n._(TAG_HELD_DESCRIPTOR, {name: holder});
				return (
					<div key={tagText(tag)} className={styles.tagField} data-flx="persona.persona-import-review.tag-field">
						<div className={styles.tagFieldRow} data-flx="persona.persona-import-review.tag-field.row">
							<label
								htmlFor={fieldId}
								className={styles.tagFieldLabel}
								data-flx="persona.persona-import-review.tag-field.label"
							>
								{clashing.length > 1
									? i18n._(TAG_INSTEAD_DESCRIPTOR, {tag: tagText(tag)})
									: i18n._(TAG_FIELD_DESCRIPTOR)}
							</label>
							<input
								id={fieldId}
								type="text"
								className={clsx(styles.tagInput, holder && styles.tagInputTaken)}
								value={tagInputText(value)}
								spellCheck={false}
								autoComplete="off"
								onChange={(event) => {
									const next = clashing.map((_, i) => replacements[i] ?? {});
									next[position] = parseTagInput(event.target.value);
									onChange(next);
								}}
								data-flx="persona.persona-import-review.tag-field.input"
							/>
							<span
								className={clsx(styles.tagStatus, holder ? styles.tagStatusTaken : !empty && styles.tagStatusFree)}
								aria-live="polite"
								data-flx="persona.persona-import-review.tag-field.status"
							>
								{!empty && !holder && (
									<CheckIcon
										size={14}
										weight="bold"
										aria-hidden="true"
										data-flx="persona.persona-import-review.tag-field.check"
									/>
								)}
								<span data-flx="persona.persona-import-review.tag-field.status-text">{status}</span>
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}

/** Free tags for a member's clashing ones, each checked against what the import will leave in place. */
function suggestedReplacements(entry: PersonaImportPreviewEntry, member: ReviewMember, context: ReviewContext) {
	const chosen: Array<PersonaTag> = [];
	for (const tag of clashingTags(entry)) {
		const isTaken = (candidate: PersonaTag) =>
			chosen.some((t) => tagText(t) === tagText(candidate)) ||
			tagHolder(
				candidate,
				entry.index,
				context.entries,
				context.decisions,
				context.members,
				context.livePersonas,
				context.fromTyne,
			) !== null;
		chosen.push(suggestTag(tag, member.preview.name, isTaken) ?? {});
	}
	return chosen;
}

interface PersonaImportReviewProps {
	preview: PersonaImportPreviewResponse;
	members: ReadonlyArray<ReviewMember>;
	source: PersonaImportSource;
	decisions: ReadonlyMap<number, ReviewDecision>;
	onDecide: (changes: ReadonlyArray<[number, ReviewDecision]>) => void;
	fileTagText: string | null;
	displayTagChoice: 'keep' | 'file';
	onDisplayTagChoice: (choice: 'keep' | 'file') => void;
	conflicts: ReadonlyArray<ReviewConflict>;
	/** The account's live personas, for checking new tags. */
	livePersonas: ReadonlyArray<PersonaResponse>;
}

export const PersonaImportReview = observer(
	({
		preview,
		members,
		source,
		decisions,
		onDecide,
		fileTagText,
		displayTagChoice,
		onDisplayTagChoice,
		conflicts,
		livePersonas,
	}: PersonaImportReviewProps) => {
		const {i18n} = useLingui();
		const productName = PRODUCT_NAME;
		const [openDiffers, setOpenDiffers] = useState<ReadonlySet<number>>(() => new Set());
		const localPictures = useLocalPictures(source, members);
		const personas = useMemo(() => new Map(preview.personas.map((p) => [p.id, p])), [preview.personas]);
		const byKind = (kind: PersonaImportPreviewEntry['kind']) => preview.entries.filter((e) => e.kind === kind);
		const cantTell = byKind('cant_tell');
		const tagInUse = byKind('tag_in_use');
		const differs = byKind('differs');
		const deleted = byKind('deleted');
		const probable = byKind('probably_same');
		const fresh = byKind('new');
		const upToDate = byKind('up_to_date').length;
		const decisionOf = (entry: PersonaImportPreviewEntry) => decisions.get(entry.index) ?? defaultDecision(entry);
		const decide = (entry: PersonaImportPreviewEntry, decision: ReviewDecision) => onDecide([[entry.index, decision]]);
		// The account's personas, with the live ones the preview names: those are current for sure.
		const allLive = useMemo(() => {
			const byId = new Map(livePersonas.map((p) => [p.id, p]));
			for (const persona of preview.personas) if (!persona.deleted_at) byId.set(persona.id, persona);
			return [...byId.values()];
		}, [livePersonas, preview.personas]);
		const context: ReviewContext = {
			entries: preview.entries,
			members,
			decisions,
			livePersonas: allLive,
			fromTyne: source.kind === 'bundle',
		};
		const linkedByOthers = (personaId: string, except: number) =>
			preview.entries.some((other) => {
				if (other.index === except) return false;
				const decision = decisions.get(other.index) ?? defaultDecision(other);
				return decision.choice === 'link' && decision.personaId === personaId;
			});
		const needCount = reviewNeedCount(preview.entries);
		const tagNeedsChoice = preview.display_tag.decision === 'ask';
		const addWithSuggestions = (entry: PersonaImportPreviewEntry, member: ReviewMember): ReviewDecision => {
			const current = decisionOf(entry);
			if (current.choice === 'add') return current;
			if (clashingTags(entry).length === 0) return {choice: 'add', withTags: true};
			return {choice: 'add', withTags: false, replacements: suggestedReplacements(entry, member, context)};
		};
		const replacementsOf = (entry: PersonaImportPreviewEntry, member: ReviewMember) => {
			const decision = decisionOf(entry);
			return decision.choice === 'add' && decision.replacements
				? decision.replacements
				: suggestedReplacements(entry, member, context);
		};

		return (
			<div className={styles.review} data-flx="persona.persona-import-review.review">
				<p className={styles.intro} data-flx="persona.persona-import-review.intro">
					{needCount > 0 ? i18n._(INTRO_MEMBERS_DESCRIPTOR, {productName}) : i18n._(INTRO_NONE_DESCRIPTOR)}
				</p>

				<ReadyLines
					fresh={fresh}
					probable={probable}
					upToDate={upToDate}
					untouched={preview.untouched}
					members={members}
					personas={personas}
					decisionOf={decisionOf}
					decide={decide}
					data-flx="persona.persona-import-review.ready-lines"
				/>

				{conflicts.length > 0 && (
					<div className={styles.conflicts} role="alert" data-flx="persona.persona-import-review.conflicts">
						{conflicts.map((conflict) => {
							const names = listFormat(i18n.locale, conflict.names);
							const label = conflict.label;
							return (
								<div key={label} data-flx="persona.persona-import-review.conflict">
									<Trans comment="A clash in the import review. {label} is a proxy tag or emoji, {names} a list of persona names">
										{names} would all have {label}. Change one of the choices.
									</Trans>
								</div>
							);
						})}
					</div>
				)}

				{(needCount > 0 || tagNeedsChoice) && (
					<div className={styles.pair} aria-hidden="true" data-flx="persona.persona-import-review.column-heads">
						<span className={styles.columnHead} data-flx="persona.persona-import-review.column-head-file">
							<FileTextIcon size={16} weight="bold" data-flx="persona.persona-import-review.column-head-file.icon" />
							{i18n._(YOUR_FILE_DESCRIPTOR)}
						</span>
						<ArrowRightIcon
							size={20}
							weight="bold"
							className={styles.pairArrow}
							data-flx="persona.persona-import-review.column-heads.arrow"
						/>
						<span className={styles.columnHead} data-flx="persona.persona-import-review.column-head-tyne">
							<ChatTeardropIcon
								size={16}
								weight="bold"
								data-flx="persona.persona-import-review.column-head-tyne.icon"
							/>
							{productName}
						</span>
					</div>
				)}

				<div className={styles.items} data-flx="persona.persona-import-review.items">
					{cantTell.map((entry) => {
						const member = members[entry.index];
						if (!member) return null;
						const decision = decisionOf(entry);
						const questionId = `import-q-${entry.index}`;
						const group = `import-${entry.index}`;
						return (
							<section
								key={entry.index}
								className={styles.item}
								aria-labelledby={questionId}
								data-flx="persona.persona-import-review.cant-tell"
							>
								<Question id={questionId} data-flx="persona.persona-import-review.cant-tell.question">
									{i18n._(CANT_TELL_QUESTION_DESCRIPTOR, {name: member.preview.name, productName})}
								</Question>
								<Pair
									left={
										<div className={styles.card} data-flx="persona.persona-import-review.cant-tell.file">
											<MemberBlock
												entry={entry}
												member={member}
												local={localPictures.get(entry.index)}
												data-flx="persona.persona-import-review.cant-tell.member-block"
											/>
										</div>
									}
									right={
										<div className={styles.stack} data-flx="persona.persona-import-review.cant-tell.candidates">
											{(entry.candidates ?? []).map((candidate) => {
												const persona = personas.get(candidate.persona_id);
												if (!persona || !member.member.id) return null;
												const chosen = decision.choice === 'link' && decision.personaId === candidate.persona_id;
												return (
													<SideCard
														key={candidate.persona_id}
														name={group}
														label={i18n._(SAME_PERSONA_DESCRIPTOR)}
														checked={chosen}
														dimmed={decision.choice !== 'skip' && !chosen}
														disabled={linkedByOthers(candidate.persona_id, entry.index)}
														onSelect={() => decide(entry, {choice: 'link', personaId: candidate.persona_id})}
														data-flx="persona.persona-import-review.cant-tell.candidate"
													>
														<PersonaBlock
															persona={persona}
															compact
															note={
																candidate.linked_elsewhere
																	? i18n._(LINKED_ELSEWHERE_DESCRIPTOR)
																	: `${i18n._(MATCHED_ON_DESCRIPTORS[candidate.matched_on])} · ${i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0})}`
															}
															data-flx="persona.persona-import-review.cant-tell.persona-block"
														/>
													</SideCard>
												);
											})}
											<SideCard
												name={group}
												label={i18n._(ADD_DIFFERENT_DESCRIPTOR)}
												checked={decision.choice === 'add'}
												dimmed={decision.choice === 'link'}
												dashed
												onSelect={() => decide(entry, addWithSuggestions(entry, member))}
												data-flx="persona.persona-import-review.cant-tell.add"
											>
												{decision.choice === 'add' && clashingTags(entry).length > 0 && (
													<TagFields
														entry={entry}
														member={member}
														context={context}
														replacements={replacementsOf(entry, member)}
														onChange={(replacements) => decide(entry, {choice: 'add', withTags: false, replacements})}
														data-flx="persona.persona-import-review.cant-tell.tag-fields"
													/>
												)}
											</SideCard>
										</div>
									}
									top
									data-flx="persona.persona-import-review.cant-tell.pair"
								/>
								<OptionRow
									name={group}
									label={i18n._(NOT_SURE_SKIP_DESCRIPTOR, {name: member.preview.name})}
									checked={decision.choice === 'skip'}
									safe
									onSelect={() => decide(entry, {choice: 'skip'})}
									data-flx="persona.persona-import-review.cant-tell.skip"
								/>
							</section>
						);
					})}

					{tagInUse.map((entry) => {
						const member = members[entry.index];
						if (!member) return null;
						const decision = decisionOf(entry);
						const questionId = `import-q-${entry.index}`;
						const group = `import-${entry.index}`;
						const clashes = (entry.clashes ?? []).filter((clash) => clash.tag);
						const clashing = new Set(clashingTags(entry).map(tagText));
						const holderId = clashes.find((clash) => clash.held_by_persona_id)?.held_by_persona_id;
						const holder = holderId ? personas.get(holderId) : undefined;
						const otherIndex = clashes.find((clash) => clash.shared_with_member != null)?.shared_with_member;
						const otherEntry = otherIndex != null ? preview.entries[otherIndex] : undefined;
						const other = otherIndex != null ? members[otherIndex] : undefined;
						const adding = decision.choice === 'add';
						return (
							<section
								key={entry.index}
								className={styles.item}
								aria-labelledby={questionId}
								data-flx="persona.persona-import-review.tag-in-use"
							>
								<Question id={questionId} data-flx="persona.persona-import-review.tag-in-use.question">
									{i18n._(TAG_TAKEN_QUESTION_DESCRIPTOR, {name: member.preview.name})}
								</Question>
								{clashes.map((clash) => {
									const tag = tagText(clash.tag!);
									const name =
										(clash.held_by_persona_id ? personas.get(clash.held_by_persona_id)?.name : undefined) ??
										(clash.shared_with_member != null ? members[clash.shared_with_member]?.preview.name : undefined) ??
										'?';
									return (
										<p key={tag} className={styles.why} data-flx="persona.persona-import-review.tag-in-use.why">
											{clash.held_by_persona_id ? (
												<Trans comment="Why a member is in the import review. {tag} is a proxy tag, {name} an existing persona">
													<code className={styles.tag} data-flx="persona.persona-import-review.tag-in-use.why-tag">
														{tag}
													</code>{' '}
													already belongs to your persona {name}.
												</Trans>
											) : (
												<Trans comment="Why a member is in the import review. {tag} is a proxy tag, {name} another member of the file">
													<code className={styles.tag} data-flx="persona.persona-import-review.tag-in-use.why-tag--2">
														{tag}
													</code>{' '}
													is also used by {name} in your file.
												</Trans>
											)}
										</p>
									);
								})}
								<Pair
									left={
										<div className={styles.card} data-flx="persona.persona-import-review.tag-in-use.file">
											<MemberBlock
												entry={entry}
												member={member}
												local={localPictures.get(entry.index)}
												clashing={clashing}
												data-flx="persona.persona-import-review.tag-in-use.member-block"
											/>
										</div>
									}
									right={
										<div className={styles.card} data-flx="persona.persona-import-review.tag-in-use.holder">
											{holder && (
												<PersonaBlock
													persona={holder}
													compact
													clashing={clashing}
													note={i18n._(KEEPS_TAG_DESCRIPTOR)}
													data-flx="persona.persona-import-review.tag-in-use.persona-block"
												/>
											)}
											{!holder && other && otherEntry && (
												<MemberBlock
													entry={otherEntry}
													member={other}
													local={localPictures.get(otherEntry.index)}
													clashing={clashing}
													data-flx="persona.persona-import-review.tag-in-use.other-member"
												/>
											)}
										</div>
									}
									data-flx="persona.persona-import-review.tag-in-use.pair"
								/>
								<OptionRow
									name={group}
									label={i18n._(LEAVE_OUT_DESCRIPTOR, {name: member.preview.name})}
									checked={!adding}
									safe
									onSelect={() => decide(entry, {choice: 'skip'})}
									data-flx="persona.persona-import-review.tag-in-use.skip"
								/>
								<OptionRow
									name={group}
									label={i18n._(ADD_OWN_TAG_DESCRIPTOR, {name: member.preview.name})}
									checked={adding}
									onSelect={() => decide(entry, addWithSuggestions(entry, member))}
									data-flx="persona.persona-import-review.tag-in-use.add"
								>
									<TagFields
										entry={entry}
										member={member}
										context={context}
										replacements={replacementsOf(entry, member)}
										onChange={(replacements) => decide(entry, {choice: 'add', withTags: false, replacements})}
										data-flx="persona.persona-import-review.tag-in-use.tag-fields"
									/>
								</OptionRow>
							</section>
						);
					})}

					{differs.length > 0 && (
						<section
							className={styles.item}
							aria-labelledby="import-differs-heading"
							data-flx="persona.persona-import-review.differs-group"
						>
							<Question id="import-differs-heading" data-flx="persona.persona-import-review.differs-group.question">
								{i18n._(DIFFERS_GROUP_DESCRIPTOR, {count: differs.length})}
							</Question>
							<p className={styles.why} data-flx="persona.persona-import-review.differs-group.hint">
								{i18n._(DIFFERS_HINT_DESCRIPTOR, {productName})}
							</p>
							<ul className={styles.differsList} data-flx="persona.persona-import-review.differs-group.list">
								{differs.map((entry) => {
									const member = members[entry.index];
									const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
									if (!member || !persona) return null;
									return (
										<DiffersItem
											key={entry.index}
											entry={entry}
											member={member}
											persona={persona}
											local={localPictures.get(entry.index)}
											context={context}
											decision={decisionOf(entry)}
											onDecide={(decision) => decide(entry, decision)}
											expanded={openDiffers.has(entry.index)}
											onToggle={() =>
												setOpenDiffers((open) => {
													const next = new Set(open);
													if (!next.delete(entry.index)) next.add(entry.index);
													return next;
												})
											}
											data-flx="persona.persona-import-review.differs-item"
										/>
									);
								})}
							</ul>
						</section>
					)}

					{deleted.map((entry) => {
						const member = members[entry.index];
						const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
						if (!member || !persona) return null;
						const restoring = decisionOf(entry).choice === 'restore';
						const deletedAt = persona.deleted_at ? new Date(persona.deleted_at) : null;
						const date = deletedAt ? deletedAt.toLocaleDateString(i18n.locale) : null;
						const questionId = `import-q-${entry.index}`;
						const switchId = `import-restore-${entry.index}`;
						return (
							<section
								key={entry.index}
								className={styles.item}
								aria-labelledby={questionId}
								data-flx="persona.persona-import-review.deleted"
							>
								<Question id={questionId} data-flx="persona.persona-import-review.deleted.question">
									{date
										? i18n._(DELETED_QUESTION_DESCRIPTOR, {name: persona.name, productName, date})
										: i18n._(DELETED_QUESTION_NO_DATE_DESCRIPTOR, {name: persona.name, productName})}
								</Question>
								<Pair
									left={
										<div className={styles.card} data-flx="persona.persona-import-review.deleted.file">
											<MemberBlock
												entry={entry}
												member={member}
												local={localPictures.get(entry.index)}
												data-flx="persona.persona-import-review.deleted.member-block"
											/>
										</div>
									}
									right={
										<label
											htmlFor={switchId}
											className={clsx(styles.card, styles.cardChoice, restoring ? styles.cardChosen : styles.cardGhost)}
											data-flx="persona.persona-import-review.deleted.tyne"
										>
											<div
												className={restoring ? undefined : styles.ghostBody}
												data-flx="persona.persona-import-review.deleted.body"
											>
												<PersonaBlock
													persona={persona}
													compact
													note={
														restoring
															? i18n._(COMES_BACK_DESCRIPTOR)
															: [
																	date ? i18n._(DELETED_ON_DESCRIPTOR, {date}) : null,
																	i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0}),
																]
																	.filter(Boolean)
																	.join(' · ')
													}
													data-flx="persona.persona-import-review.deleted.persona-block"
												/>
											</div>
											<span className={styles.switchRow} data-flx="persona.persona-import-review.deleted.switch-row">
												<input
													id={switchId}
													type="checkbox"
													role="switch"
													aria-checked={restoring}
													className={styles.switchInput}
													checked={restoring}
													onChange={() => decide(entry, {choice: restoring ? 'keep' : 'restore'})}
													data-flx="persona.persona-import-review.deleted.switch"
												/>
												<span
													className={clsx(styles.switchTrack, restoring && styles.switchTrackOn)}
													aria-hidden="true"
													data-flx="persona.persona-import-review.deleted.switch-track"
												>
													<span
														className={styles.switchKnob}
														data-flx="persona.persona-import-review.deleted.switch-knob"
													/>
												</span>
												<span
													className={styles.cardChoiceLabel}
													data-flx="persona.persona-import-review.deleted.switch-label"
												>
													{i18n._(BRING_BACK_DESCRIPTOR, {name: persona.name})}
												</span>
											</span>
										</label>
									}
									data-flx="persona.persona-import-review.deleted.pair"
								/>
							</section>
						);
					})}

					{tagNeedsChoice && (
						<DisplayTagItem
							fileTagText={fileTagText}
							currentText={preview.display_tag.current_text ?? null}
							choice={displayTagChoice}
							onChoice={onDisplayTagChoice}
							data-flx="persona.persona-import-review.display-tag-item"
						/>
					)}
				</div>
			</div>
		);
	},
);

/** One line each for what needs no decision, with the lists of new and connected members behind Show. */
function ReadyLines({
	fresh,
	probable,
	upToDate,
	untouched,
	members,
	personas,
	decisionOf,
	decide,
}: {
	fresh: ReadonlyArray<PersonaImportPreviewEntry>;
	probable: ReadonlyArray<PersonaImportPreviewEntry>;
	upToDate: number;
	untouched: number;
	members: ReadonlyArray<ReviewMember>;
	personas: ReadonlyMap<string, PersonaResponse>;
	decisionOf: (entry: PersonaImportPreviewEntry) => ReviewDecision;
	decide: (entry: PersonaImportPreviewEntry, decision: ReviewDecision) => void;
}) {
	const {i18n} = useLingui();
	const productName = PRODUCT_NAME;
	const [open, setOpen] = useState<'new' | 'linked' | null>(null);
	const adding = fresh.filter((entry) => decisionOf(entry).choice === 'add').length;
	const linking = probable.filter((entry) => decisionOf(entry).choice === 'link').length;
	if (fresh.length === 0 && probable.length === 0 && upToDate === 0 && untouched === 0) return null;
	const toggle = (which: 'new' | 'linked') => setOpen((current) => (current === which ? null : which));
	return (
		<div className={styles.ready} data-flx="persona.persona-import-review.ready">
			{fresh.length > 0 && (
				<div className={styles.readyLine} data-flx="persona.persona-import-review.ready.new">
					<div className={styles.readyHead} data-flx="persona.persona-import-review.ready.new.head">
						<PlusIcon
							size={18}
							weight="bold"
							className={styles.readyIconAdd}
							aria-hidden="true"
							data-flx="persona.persona-import-review.ready.new.icon"
						/>
						<span className={styles.readyText} data-flx="persona.persona-import-review.ready.new.text">
							{i18n._(READY_NEW_DESCRIPTOR, {count: adding})}
						</span>
						<button
							type="button"
							className={styles.readyToggle}
							aria-expanded={open === 'new'}
							onClick={() => toggle('new')}
							data-flx="persona.persona-import-review.ready.new.toggle"
						>
							{open === 'new' ? i18n._(HIDE_DESCRIPTOR) : i18n._(SHOW_DESCRIPTOR)}
						</button>
					</div>
					{open === 'new' && (
						<ul className={styles.readyList} data-flx="persona.persona-import-review.ready.new.list">
							{fresh.map((entry) => {
								const member = members[entry.index];
								if (!member) return null;
								const checked = decisionOf(entry).choice === 'add';
								return (
									<li
										key={entry.index}
										className={styles.readyItem}
										data-flx="persona.persona-import-review.ready.new.item"
									>
										<label
											className={styles.readyItemLabel}
											data-flx="persona.persona-import-review.ready.new.item-label"
										>
											<input
												type="checkbox"
												className={styles.checkbox}
												checked={checked}
												aria-label={i18n._(ADD_TOGGLE_DESCRIPTOR, {name: member.preview.name})}
												onChange={() => decide(entry, checked ? {choice: 'skip'} : {choice: 'add', withTags: true})}
												data-flx="persona.persona-import-review.ready.new.checkbox"
											/>
											<span className={styles.readyItemName} data-flx="persona.persona-import-review.ready.new.name">
												{member.preview.name}
											</span>
											<Tags
												tags={member.preview.persona_tags}
												data-flx="persona.persona-import-review.ready.new.tags"
											/>
										</label>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			)}
			{probable.length > 0 && (
				<div className={styles.readyLine} data-flx="persona.persona-import-review.ready.linked">
					<div className={styles.readyHead} data-flx="persona.persona-import-review.ready.linked.head">
						<LinkSimpleIcon
							size={18}
							weight="bold"
							className={styles.readyIcon}
							aria-hidden="true"
							data-flx="persona.persona-import-review.ready.linked.icon"
						/>
						<span className={styles.readyText} data-flx="persona.persona-import-review.ready.linked.text">
							{i18n._(READY_LINKED_DESCRIPTOR, {count: linking})}
						</span>
						<button
							type="button"
							className={styles.readyToggle}
							aria-expanded={open === 'linked'}
							onClick={() => toggle('linked')}
							data-flx="persona.persona-import-review.ready.linked.toggle"
						>
							{open === 'linked' ? i18n._(HIDE_DESCRIPTOR) : i18n._(SHOW_DESCRIPTOR)}
						</button>
					</div>
					{open === 'linked' && (
						<ul className={styles.readyList} data-flx="persona.persona-import-review.ready.linked.list">
							{probable.map((entry) => {
								const member = members[entry.index];
								const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
								if (!member || !persona) return null;
								const checked = decisionOf(entry).choice === 'link';
								return (
									<li
										key={entry.index}
										className={styles.readyItem}
										data-flx="persona.persona-import-review.ready.linked.item"
									>
										<label
											className={styles.readyItemLabel}
											data-flx="persona.persona-import-review.ready.linked.item-label"
										>
											<input
												type="checkbox"
												className={styles.checkbox}
												checked={checked}
												aria-label={i18n._(CONNECT_TOGGLE_DESCRIPTOR, {name: persona.name})}
												onChange={() =>
													decide(entry, checked ? {choice: 'skip'} : {choice: 'link', personaId: persona.id})
												}
												data-flx="persona.persona-import-review.ready.linked.checkbox"
											/>
											<span className={styles.readyItemName} data-flx="persona.persona-import-review.ready.linked.name">
												{persona.name}
											</span>
											<Tags tags={persona.persona_tags} data-flx="persona.persona-import-review.ready.linked.tags" />
										</label>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			)}
			{upToDate > 0 && (
				<div className={styles.readyLine} data-flx="persona.persona-import-review.ready.same">
					<div className={styles.readyHead} data-flx="persona.persona-import-review.ready.same.head">
						<CheckIcon
							size={18}
							weight="bold"
							className={styles.readyIcon}
							aria-hidden="true"
							data-flx="persona.persona-import-review.ready.same.icon"
						/>
						<span
							className={clsx(styles.readyText, styles.readyMuted)}
							data-flx="persona.persona-import-review.ready.same.text"
						>
							{i18n._(READY_SAME_DESCRIPTOR, {count: upToDate, productName})}
						</span>
					</div>
				</div>
			)}
			{untouched > 0 && (
				<div className={styles.readyLine} data-flx="persona.persona-import-review.ready.untouched">
					<div className={styles.readyHead} data-flx="persona.persona-import-review.ready.untouched.head">
						<ShieldCheckIcon
							size={18}
							weight="bold"
							className={styles.readyIcon}
							aria-hidden="true"
							data-flx="persona.persona-import-review.ready.untouched.icon"
						/>
						<span
							className={clsx(styles.readyText, styles.readyMuted)}
							data-flx="persona.persona-import-review.ready.untouched.text"
						>
							{i18n._(READY_UNTOUCHED_DESCRIPTOR, {count: untouched, productName})}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * One persona whose details differ from the file, as a row that names what differs and the current
 * choice; opened, a three-way switch over the two versions side by side (tyne-chat/tyne#568).
 */
function DiffersItem({
	entry,
	member,
	persona,
	local,
	context,
	decision,
	onDecide,
	expanded,
	onToggle,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	persona: PersonaResponse;
	local?: LocalPictures;
	context: ReviewContext;
	decision: ReviewDecision;
	onDecide: (decision: ReviewDecision) => void;
	expanded: boolean;
	onToggle: () => void;
}) {
	const {i18n} = useLingui();
	const productName = PRODUCT_NAME;
	const copy = decision.choice === 'add' ? decision.copy : undefined;
	let mode: DiffersMode = copy ? 'both' : 'tyne';
	if (decision.choice === 'use_file') mode = 'file';
	const bodyId = `import-differs-${entry.index}`;
	const group = `import-${entry.index}`;
	const differs = new Map((entry.differences ?? []).map((d) => [d.field, d.change]));
	const isDifferent = (field: PersonaImportField) => {
		const change = differs.get(field);
		return change === 'changed' || change === 'removed' || change === 'not_compared';
	};
	const differentFields = (entry.differences ?? [])
		.filter((d) => isDifferent(d.field))
		.map((d) => i18n._(FIELD_HEADING[d.field]));
	const pick = (next: DiffersMode) => {
		if (next === mode) return;
		if (next === 'file') onDecide({choice: 'use_file'});
		else if (next === 'tyne') onDecide({choice: 'keep'});
		else
			onDecide(
				keepBothDecision(
					entry,
					context.entries,
					context.decisions,
					context.members,
					context.livePersonas,
					context.fromTyne,
				),
			);
	};
	const options: Array<{id: DiffersMode; label: string}> = [
		{id: 'file', label: i18n._(SWITCH_FILE_DESCRIPTOR)},
		{id: 'both', label: i18n._(SWITCH_BOTH_DESCRIPTOR)},
		{id: 'tyne', label: i18n._(SWITCH_TYNE_DESCRIPTOR, {productName})},
	];
	const pill = {
		file: i18n._(USING_FILE_DESCRIPTOR),
		both: i18n._(KEEPING_BOTH_DESCRIPTOR),
		tyne: i18n._(KEEPING_TYNE_DESCRIPTOR, {productName}),
	}[mode];
	const fileStatus = {
		file: i18n._(STATUS_REPLACES_DESCRIPTOR, {productName, name: persona.name}),
		both: i18n._(STATUS_ADDED_DESCRIPTOR),
		tyne: i18n._(STATUS_NOT_IMPORTED_DESCRIPTOR),
	}[mode];
	const tyneStatus = mode === 'file' ? i18n._(STATUS_OVERWRITTEN_DESCRIPTOR) : i18n._(STATUS_STAYS_DESCRIPTOR);
	const nameId = `import-copy-name-${entry.index}`;
	const copyFields =
		copy && decision.choice === 'add' ? (
			<div className={styles.copyFields} data-flx="persona.persona-import-review.differs.copy-fields">
				<label
					htmlFor={nameId}
					className={styles.tagFieldLabel}
					data-flx="persona.persona-import-review.differs.copy-name-label"
				>
					{i18n._(FIELD_HEADING.name)}
				</label>
				<input
					id={nameId}
					type="text"
					className={styles.copyNameInput}
					value={copy.name}
					maxLength={100}
					autoComplete="off"
					onChange={(event) => onDecide({...decision, copy: {...copy, name: event.target.value}})}
					data-flx="persona.persona-import-review.differs.copy-name"
				/>
				{copy.replacedTags.length > 0 && (
					<TagFields
						entry={entry}
						member={member}
						context={context}
						clashing={copy.replacedTags}
						replacements={decision.replacements ?? []}
						onChange={(replacements) => onDecide({...decision, replacements})}
						data-flx="persona.persona-import-review.differs.copy-tags"
					/>
				)}
			</div>
		) : undefined;
	return (
		<li className={styles.differsRow} data-flx="persona.persona-import-review.differs">
			<h4 className={styles.differsHeading} data-flx="persona.persona-import-review.differs.heading">
				<button
					type="button"
					className={styles.differsToggle}
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={onToggle}
					data-flx="persona.persona-import-review.differs.toggle"
				>
					<PersonaPicture persona={persona} data-flx="persona.persona-import-review.differs.picture" />
					<span className={styles.differsSummary} data-flx="persona.persona-import-review.differs.summary">
						<span className={styles.differsName} data-flx="persona.persona-import-review.differs.name">
							{persona.name}
						</span>
						<span className={styles.differsFields} data-flx="persona.persona-import-review.differs.fields">
							{listFormat(i18n.locale, differentFields)}
						</span>
					</span>
					<span
						className={clsx(
							styles.choicePill,
							mode === 'file' && styles.choicePillChange,
							mode === 'both' && styles.choicePillBoth,
						)}
						data-flx="persona.persona-import-review.differs.choice"
					>
						{pill}
					</span>
					<CaretDownIcon
						size={16}
						weight="bold"
						className={clsx(styles.caret, expanded && styles.caretOpen)}
						aria-hidden="true"
						data-flx="persona.persona-import-review.differs.caret"
					/>
				</button>
			</h4>
			{expanded && (
				<div id={bodyId} className={styles.differsBody} data-flx="persona.persona-import-review.differs.body">
					<fieldset className={styles.switch} data-flx="persona.persona-import-review.differs.switch">
						<legend className={styles.srOnly} data-flx="persona.persona-import-review.differs.question">
							{i18n._(DIFFERS_QUESTION_DESCRIPTOR, {name: persona.name, productName})}
						</legend>
						{options.map((option) => (
							<label
								key={option.id}
								className={clsx(styles.switchOption, mode === option.id && styles.switchOptionOn)}
								data-flx="persona.persona-import-review.differs.switch-option"
							>
								<input
									type="radio"
									className={styles.switchRadio}
									name={group}
									checked={mode === option.id}
									onChange={() => pick(option.id)}
									data-flx="persona.persona-import-review.differs.switch-radio"
								/>
								<span data-flx="persona.persona-import-review.differs.switch-label">{option.label}</span>
							</label>
						))}
					</fieldset>
					<div className={styles.sides} data-flx="persona.persona-import-review.differs.sides">
						<div
							className={clsx(styles.card, mode === 'tyne' ? styles.cardDimmed : styles.cardChosen)}
							data-flx="persona.persona-import-review.differs.file"
						>
							<SideHead
								title={i18n._(YOUR_FILE_DESCRIPTOR)}
								status={fileStatus}
								data-flx="persona.persona-import-review.differs.file-head"
							/>
							<VersionDetails
								side="file"
								entry={entry}
								member={member}
								persona={persona}
								local={local}
								isDifferent={isDifferent}
								editor={copyFields}
								data-flx="persona.persona-import-review.differs.file-details"
							/>
						</div>
						<div
							className={clsx(styles.card, mode === 'file' ? styles.cardDimmed : styles.cardChosen)}
							data-flx="persona.persona-import-review.differs.tyne"
						>
							<SideHead
								title={productName}
								status={tyneStatus}
								data-flx="persona.persona-import-review.differs.tyne-head"
							/>
							<VersionDetails
								side="tyne"
								entry={entry}
								member={member}
								persona={persona}
								local={local}
								isDifferent={isDifferent}
								data-flx="persona.persona-import-review.differs.tyne-details"
							/>
						</div>
					</div>
				</div>
			)}
		</li>
	);
}

type DiffersMode = 'file' | 'both' | 'tyne';

/** A side's title, and what happens to it. */
function SideHead({title, status}: {title: string; status: string}) {
	return (
		<div className={styles.sideHead} data-flx="persona.persona-import-review.side-head">
			<span className={styles.sideTitle} data-flx="persona.persona-import-review.side-head.title">
				{title}
			</span>
			<span className={styles.sideStatus} aria-live="polite" data-flx="persona.persona-import-review.side-head.status">
				{status}
			</span>
		</div>
	);
}

/** One side of a differing persona: every detail, the ones that differ marked on both sides alike. */
function VersionDetails({
	side,
	entry,
	member,
	persona,
	local,
	isDifferent,
	editor,
}: {
	side: 'file' | 'tyne';
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	persona: PersonaResponse;
	local?: LocalPictures;
	isDifferent: (field: PersonaImportField) => boolean;
	/** Fields in place of the name and tags, for the copy Keep both adds. */
	editor?: React.ReactNode;
}) {
	const {i18n} = useLingui();
	const fromFile = side === 'file';
	const name = fromFile ? member.preview.name : persona.name;
	const pronouns = fromFile ? member.preview.pronouns : persona.pronouns;
	const tags = fromFile ? member.preview.persona_tags : persona.persona_tags;
	const bio = fromFile ? member.preview.bio : persona.bio;
	const file = filePictures(entry, member, local);
	const empty = (descriptor: MessageDescriptor) => (
		<span className={styles.empty} data-flx="persona.persona-import-review.version.empty">
			{i18n._(descriptor)}
		</span>
	);
	const rows: Array<[PersonaImportField, React.ReactNode]> = [
		['pronouns', pronouns || empty(NO_PRONOUNS_DESCRIPTOR)],
		...(editor
			? []
			: ([
					[
						'persona_tags',
						tags && tags.length > 0 ? (
							<Tags tags={tags} data-flx="persona.persona-import-review.version.tags" />
						) : (
							empty(NO_TAGS_DESCRIPTOR)
						),
					],
				] as Array<[PersonaImportField, React.ReactNode]>)),
		['bio', bio || empty(NO_BIO_DESCRIPTOR)],
	];
	if (isDifferent('color')) {
		const color = fromFile ? member.preview.color : persona.color;
		rows.push([
			'color',
			color != null ? (
				<span className={styles.colorValue} data-flx="persona.persona-import-review.version.color">
					<span
						className={styles.colorSwatch}
						style={{backgroundColor: `#${color.toString(16).padStart(6, '0')}`}}
						data-flx="persona.persona-import-review.version.color-swatch"
					/>
					{`#${color.toString(16).padStart(6, '0')}`}
				</span>
			) : (
				empty(NO_PICTURE_DESCRIPTOR)
			),
		]);
	}
	return (
		<div className={styles.version} data-flx="persona.persona-import-review.version">
			<ProfileHeader
				name={name}
				color={fromFile ? member.preview.color : persona.color}
				avatar={fromFile ? file.avatar : {hash: persona.avatar_hash}}
				banner={fromFile ? file.banner : {hash: persona.banner_hash}}
				missing={fromFile && file.missing}
				avatarDiffers={isDifferent('avatar')}
				bannerDiffers={isDifferent('banner')}
				data-flx="persona.persona-import-review.version.header"
			/>
			{editor ?? (
				<span
					className={clsx(styles.blockName, isDifferent('name') && styles.differs)}
					data-flx="persona.persona-import-review.version.name"
				>
					{name}
				</span>
			)}
			{rows.map(([field, value]) => (
				<div
					key={field}
					className={clsx(styles.versionRow, isDifferent(field) && styles.differs)}
					data-flx="persona.persona-import-review.version.row"
				>
					<span className={styles.versionLabel} data-flx="persona.persona-import-review.version.label">
						{i18n._(FIELD_HEADING[field])}
					</span>
					<span className={styles.versionValue} data-flx="persona.persona-import-review.version.value">
						{value}
					</span>
				</div>
			))}
			<span className={styles.blockMeta} data-flx="persona.persona-import-review.version.meta">
				{fromFile ? i18n._(FROM_FILE_DESCRIPTOR) : i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0})}
			</span>
		</div>
	);
}

/** The display tag, when the file's differs: two cards with the name line each would give. */
function DisplayTagItem({
	fileTagText,
	currentText,
	choice,
	onChoice,
}: {
	fileTagText: string | null;
	currentText: string | null;
	choice: 'keep' | 'file';
	onChoice: (choice: 'keep' | 'file') => void;
}) {
	const {i18n} = useLingui();
	const productName = PRODUCT_NAME;
	const user = Users.currentUser;
	const sample = (text: string | null) => (
		<span className={styles.namePreview} data-flx="persona.persona-import-review.display-tag.preview">
			{user && <Initial name={user.displayName} data-flx="persona.persona-import-review.display-tag.initial" />}
			<span className={styles.blockName} data-flx="persona.persona-import-review.display-tag.name">
				{user?.displayName}
			</span>
			{text ? (
				<span className={styles.displayTagText} data-flx="persona.persona-import-review.display-tag.text">
					{text}
				</span>
			) : (
				<span className={styles.empty} data-flx="persona.persona-import-review.display-tag.none">
					{i18n._(NO_DISPLAY_TAG_DESCRIPTOR)}
				</span>
			)}
		</span>
	);
	return (
		<section
			className={styles.item}
			aria-labelledby="import-q-display-tag"
			data-flx="persona.persona-import-review.display-tag"
		>
			<Question id="import-q-display-tag" data-flx="persona.persona-import-review.display-tag.question">
				{i18n._(DISPLAY_TAG_QUESTION_DESCRIPTOR, {productName})}
			</Question>
			<Pair
				left={
					<SideCard
						name="import-display-tag"
						label={i18n._(USE_FILES_TAG_DESCRIPTOR)}
						checked={choice === 'file'}
						dimmed={choice !== 'file'}
						onSelect={() => onChoice('file')}
						data-flx="persona.persona-import-review.display-tag.file"
					>
						{sample(fileTagText)}
					</SideCard>
				}
				right={
					<SideCard
						name="import-display-tag"
						label={i18n._(KEEP_TYNES_TAG_DESCRIPTOR, {productName})}
						checked={choice === 'keep'}
						dimmed={choice !== 'keep'}
						onSelect={() => onChoice('keep')}
						data-flx="persona.persona-import-review.display-tag.tyne"
					>
						{sample(currentText)}
					</SideCard>
				}
				data-flx="persona.persona-import-review.display-tag.pair"
			/>
		</section>
	);
}
