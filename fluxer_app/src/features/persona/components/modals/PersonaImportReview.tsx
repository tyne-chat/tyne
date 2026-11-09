// SPDX-License-Identifier: AGPL-3.0-or-later

// The review of an import (tyne-chat/tyne#243, laid out as "Pick a side", tyne-chat/tyne#563): what
// needs no decision is one line each at the top; every member that needs one is a question with the
// file's version on the left and Tyne's on the right, and the person taps the one Tyne should have.
// Each member starts on the choice that changes nothing, and a sentence under it says what will
// happen. Nothing here writes; the dialog applies the decisions. Pictures come only from this
// instance (a stored hash) or from the export's zip in memory, never from a link in the file.

import {PRODUCT_NAME} from '@app/features/app/config/ProductConstants';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {diffBios} from '@app/features/persona/utils/PersonaBioDiff';
import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import {bundlePictureBytes} from '@app/features/persona/utils/PersonaImportImages';
import {
	defaultDecision,
	heldTags,
	keepBothDecision,
	type PersonaCopy,
	parseTagInput,
	type ReviewConflict,
	type ReviewDecision,
	type ReviewMember,
	reviewNeedCount,
	samePictureFile,
	sharedTags,
	tagHolder,
	tagInputText,
} from '@app/features/persona/utils/PersonaImportReview';
import Users from '@app/features/user/state/Users';
import {getPersonaAvatarURL, getPersonaBannerURL} from '@app/features/user/utils/AvatarUtils';
import type {PersonaResponse, PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	PersonaImportField,
	PersonaImportPreviewEntry,
	PersonaImportPreviewResponse,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {imageFileExtension} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import type {MessageDescriptor} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {CaretDownIcon, CheckIcon, PlusIcon, ShieldCheckIcon} from '@phosphor-icons/react';
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
	message: '{count, plural, one {# new member} other {# new members}}',
	comment: 'Line at the top of the import review. {count} is a number of members of the import file',
});
const READY_MATCHED_DESCRIPTOR = msg({
	message: '{count, plural, one {# exact match} other {# exact matches}}',
	comment:
		'Line at the top of the import review: members already linked to an identical persona, or connected to one with the same name and tag. {count} is a number',
});
const READY_UNTOUCHED_DESCRIPTOR = msg({
	message:
		"{count, plural, one {# persona in {productName} isn't in your file} other {# personas in {productName} aren't in your file}}",
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
const TAKEN_GROUP_DESCRIPTOR = msg({
	message:
		'{count, plural, one {# member has a tag that is already taken} other {# members have a tag that is already taken}}',
	comment: 'Heading in the import review over the list of members whose proxy tag another persona already has',
});
const SKIPPING_DESCRIPTOR = msg({
	message: 'Skipping',
	comment: 'Badge on a collapsed member in the import review: it is not imported',
});
const KEEPING_DESCRIPTOR = msg({
	message: 'Keeping',
	comment: 'Badge on a collapsed member in the import review: it is imported with a tag of its own',
});
const SWITCH_SKIP_DESCRIPTOR = msg({
	context: 'persona-import-switch',
	message: 'Skip',
	comment: 'Option of the switch for a member whose tag is already taken: do not import it',
});
const SWITCH_KEEP_DESCRIPTOR = msg({
	context: 'persona-import-switch',
	message: 'Keep',
	comment: 'Option of the switch for a member whose tag is already taken: import it with a name and tag of its own',
});
const CANT_TELL_GROUP_DESCRIPTOR = msg({
	message:
		'{count, plural, one {# member might be a persona you already have} other {# members might be personas you already have}}',
	comment: 'Heading in the import review over the members that share a name or tag with personas of the account',
});
const MATCHES_COUNT_DESCRIPTOR = msg({
	message: '{count, plural, one {# possible match} other {# possible matches}}',
	comment: 'On a collapsed member in the import review: how many personas of the account it might be',
});
const PICK_QUESTION_DESCRIPTOR = msg({
	message: 'Which persona is {name}?',
	comment: 'Question over the personas a member of the import file might be. {name} is the member',
});
const NONE_OF_THESE_DESCRIPTOR = msg({
	message: 'None of these',
	comment: 'Choice beside the personas a member of the import file might be: it is none of them',
});
const STATUS_REPLACES_TAG_DESCRIPTOR = msg({
	message: 'Replaces your display tag',
	comment: "What happens to the import file's display tag in the import review when it is used",
});
const DELETED_GROUP_DESCRIPTOR = msg({
	message:
		'{count, plural, one {# persona was deleted in {productName}} other {# personas were deleted in {productName}}}',
	comment: 'Heading in the import review over the members whose persona was deleted. {productName} is the app name',
});
const SWITCH_LEAVE_DELETED_DESCRIPTOR = msg({
	context: 'persona-import-switch',
	message: 'Leave deleted',
	comment: 'Option of the switch on a deleted persona in the import review: it stays deleted',
});
const SWITCH_BRING_BACK_DESCRIPTOR = msg({
	context: 'persona-import-switch',
	message: 'Bring back',
	comment: 'Option of the switch on a deleted persona in the import review: it is restored',
});
const STAYING_DELETED_DESCRIPTOR = msg({
	message: 'Staying deleted',
	comment: 'Badge on a collapsed deleted persona in the import review: it stays deleted',
});
const BRINGING_BACK_DESCRIPTOR = msg({
	message: 'Bringing back',
	comment: 'Badge on a collapsed deleted persona in the import review: it comes back as it was',
});
const STATUS_STAYS_DELETED_DESCRIPTOR = msg({
	message: 'Stays deleted',
	comment: "What happens to the app's deleted persona in the import review",
});
const STATUS_COMES_BACK_DESCRIPTOR = msg({
	message: 'Comes back as it was',
	comment: "What happens to the app's deleted persona in the import review when it is brought back",
});
const TAG_TAKEN_QUESTION_DESCRIPTOR = msg({
	message: "{name}'s tag is already taken",
	comment:
		'Heading in the import review for a member whose proxy tag another persona or member already has. {name} is its name',
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
const DISPLAY_TAG_QUESTION_DESCRIPTOR = msg({
	message: "Your display tag shows after every persona's name. Which one should {productName} use?",
	comment: 'Question in the import review when the import file has another display tag. {productName} is the app name',
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
 * the avatar over its lower corner.
 */
const ProfileHeader = observer(
	({
		name,
		color,
		avatar,
		banner,
		compact,
		missing,
	}: {
		name: string;
		color: number | null | undefined;
		avatar: HeaderPicture;
		banner: HeaderPicture;
		compact?: boolean;
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
					className={styles.profileBanner}
					style={{
						backgroundColor: colorHex(color),
						backgroundImage: bannerUrl ? `url("${bannerUrl}")` : undefined,
					}}
					aria-hidden="true"
					data-flx="persona.persona-import-review.profile-header.banner"
				/>
				<span className={styles.profileAvatar} data-flx="persona.persona-import-review.profile-header.avatar">
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
		const toggleOpen = (index: number) =>
			setOpenDiffers((open) => {
				const next = new Set(open);
				if (!next.delete(index)) next.add(index);
				return next;
			});
		const localPictures = useLocalPictures(source, members);
		const personas = useMemo(() => new Map(preview.personas.map((p) => [p.id, p])), [preview.personas]);
		// Each section in alphabetical order, by the name it shows.
		const collator = useMemo(() => new Intl.Collator(i18n.locale, {sensitivity: 'base', numeric: true}), [i18n.locale]);
		const memberName = (entry: PersonaImportPreviewEntry) => members[entry.index]?.preview.name ?? '';
		const personaName = (entry: PersonaImportPreviewEntry) =>
			(entry.persona_id ? personas.get(entry.persona_id)?.name : undefined) ?? memberName(entry);
		const byKind = (kind: PersonaImportPreviewEntry['kind'], nameOf = memberName) =>
			preview.entries.filter((e) => e.kind === kind).sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
		const cantTell = byKind('cant_tell');
		const tagInUse = byKind('tag_in_use');
		const differs = byKind('differs', personaName);
		const deleted = byKind('deleted', personaName);
		const probable = byKind('probably_same');
		const fresh = byKind('new');
		const sameEntries = byKind('up_to_date', personaName);
		const upToDate = sameEntries.length;
		const samePersonas = sameEntries.flatMap((entry) => {
			const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
			return persona ? [persona] : [];
		});
		const decisionOf = (entry: PersonaImportPreviewEntry) => decisions.get(entry.index) ?? defaultDecision(entry);
		const decide = (entry: PersonaImportPreviewEntry, decision: ReviewDecision) => onDecide([[entry.index, decision]]);
		// The account's personas, with the live ones the preview names: those are current for sure.
		const allLive = useMemo(() => {
			const byId = new Map(livePersonas.map((p) => [p.id, p]));
			for (const persona of preview.personas) if (!persona.deleted_at) byId.set(persona.id, persona);
			return [...byId.values()];
		}, [livePersonas, preview.personas]);
		// The personas no member matched or might match: the server counts them as untouched.
		const untouchedPersonas = useMemo(() => {
			const matched = new Set(
				preview.entries.flatMap((entry) => [
					...(entry.persona_id ? [entry.persona_id] : []),
					...(entry.candidates ?? []).map((candidate) => candidate.persona_id),
				]),
			);
			return allLive.filter((persona) => !matched.has(persona.id)).sort((a, b) => collator.compare(a.name, b.name));
		}, [allLive, preview.entries, collator]);
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
				if (decision.choice === 'link') return decision.personaId === personaId;
				if (decision.choice === 'use_file') return decision.personaId === personaId;
				return decision.choice === 'add' && decision.copy?.connectTo === personaId;
			});
		const needCount = reviewNeedCount(preview.entries);
		const tagNeedsChoice = preview.display_tag.decision === 'ask';

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
					samePersonas={samePersonas}
					untouchedPersonas={untouchedPersonas}
					localPictures={localPictures}
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

				<div className={styles.items} data-flx="persona.persona-import-review.items">
					{cantTell.length > 0 && (
						<section
							className={styles.item}
							aria-labelledby="import-cant-tell-heading"
							data-flx="persona.persona-import-review.cant-tell-group"
						>
							<Question id="import-cant-tell-heading" data-flx="persona.persona-import-review.cant-tell-group.question">
								{i18n._(CANT_TELL_GROUP_DESCRIPTOR, {count: cantTell.length})}
							</Question>
							<ul className={styles.differsList} data-flx="persona.persona-import-review.cant-tell-group.list">
								{cantTell.map((entry) => {
									const member = members[entry.index];
									if (!member) return null;
									return (
										<CantTellItem
											key={entry.index}
											entry={entry}
											member={member}
											personas={personas}
											localPictures={localPictures}
											context={context}
											decision={decisionOf(entry)}
											onDecide={(decision) => decide(entry, decision)}
											expanded={openDiffers.has(entry.index)}
											onToggle={() => toggleOpen(entry.index)}
											linkedByOthers={linkedByOthers}
											data-flx="persona.persona-import-review.cant-tell-item"
										/>
									);
								})}
							</ul>
						</section>
					)}

					{tagInUse.length > 0 && (
						<section
							className={styles.item}
							aria-labelledby="import-taken-heading"
							data-flx="persona.persona-import-review.taken-group"
						>
							<Question id="import-taken-heading" data-flx="persona.persona-import-review.taken-group.question">
								{i18n._(TAKEN_GROUP_DESCRIPTOR, {count: tagInUse.length})}
							</Question>
							<ul className={styles.differsList} data-flx="persona.persona-import-review.taken-group.list">
								{tagInUse.map((entry) => {
									const member = members[entry.index];
									if (!member) return null;
									return (
										<TagTakenItem
											key={entry.index}
											entry={entry}
											member={member}
											personas={personas}
											localPictures={localPictures}
											context={context}
											decision={decisionOf(entry)}
											onDecide={(decision) => decide(entry, decision)}
											expanded={openDiffers.has(entry.index)}
											onToggle={() => toggleOpen(entry.index)}
											data-flx="persona.persona-import-review.taken-item"
										/>
									);
								})}
							</ul>
						</section>
					)}

					{differs.length > 0 && (
						<section
							className={styles.item}
							aria-labelledby="import-differs-heading"
							data-flx="persona.persona-import-review.differs-group"
						>
							<Question id="import-differs-heading" data-flx="persona.persona-import-review.differs-group.question">
								{i18n._(DIFFERS_GROUP_DESCRIPTOR, {count: differs.length})}
							</Question>
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
											onToggle={() => toggleOpen(entry.index)}
											data-flx="persona.persona-import-review.differs-item"
										/>
									);
								})}
							</ul>
						</section>
					)}

					{deleted.length > 0 && (
						<section
							className={styles.item}
							aria-labelledby="import-deleted-heading"
							data-flx="persona.persona-import-review.deleted-group"
						>
							<Question id="import-deleted-heading" data-flx="persona.persona-import-review.deleted-group.question">
								{i18n._(DELETED_GROUP_DESCRIPTOR, {count: deleted.length, productName})}
							</Question>
							<ul className={styles.differsList} data-flx="persona.persona-import-review.deleted-group.list">
								{deleted.map((entry) => {
									const member = members[entry.index];
									const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
									if (!member || !persona) return null;
									return (
										<DeletedItem
											key={entry.index}
											entry={entry}
											member={member}
											persona={persona}
											local={localPictures.get(entry.index)}
											context={context}
											decision={decisionOf(entry)}
											onDecide={(decision) => decide(entry, decision)}
											expanded={openDiffers.has(entry.index)}
											onToggle={() => toggleOpen(entry.index)}
											data-flx="persona.persona-import-review.deleted-item"
										/>
									);
								})}
							</ul>
						</section>
					)}

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

/** One line each for what needs no decision, each with its list behind Show. */
function ReadyLines({
	fresh,
	probable,
	upToDate,
	untouched,
	samePersonas,
	untouchedPersonas,
	localPictures,
	members,
	personas,
	decisionOf,
	decide,
}: {
	fresh: ReadonlyArray<PersonaImportPreviewEntry>;
	probable: ReadonlyArray<PersonaImportPreviewEntry>;
	upToDate: number;
	untouched: number;
	samePersonas: ReadonlyArray<PersonaResponse>;
	untouchedPersonas: ReadonlyArray<PersonaResponse>;
	localPictures: ReadonlyMap<number, LocalPictures>;
	members: ReadonlyArray<ReviewMember>;
	personas: ReadonlyMap<string, PersonaResponse>;
	decisionOf: (entry: PersonaImportPreviewEntry) => ReviewDecision;
	decide: (entry: PersonaImportPreviewEntry, decision: ReviewDecision) => void;
}) {
	const {i18n} = useLingui();
	const productName = PRODUCT_NAME;
	type Line = 'new' | 'matched' | 'untouched';
	const [open, setOpen] = useState<ReadonlySet<Line>>(() => new Set());
	const adding = fresh.filter((entry) => decisionOf(entry).choice === 'add').length;
	// Connected by name and tag, or linked already: one list of exact matches, always connected.
	const collator = new Intl.Collator(i18n.locale, {sensitivity: 'base', numeric: true});
	const matchedRows = [
		...probable.flatMap((entry) => {
			const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
			return persona ? [{persona}] : [];
		}),
		...samePersonas.map((persona) => ({persona})),
	].sort((a, b) => collator.compare(a.persona.name, b.persona.name));
	if (fresh.length === 0 && probable.length === 0 && upToDate === 0 && untouched === 0) return null;
	const toggle = (which: Line) =>
		setOpen((current) => {
			const next = new Set(current);
			if (!next.delete(which)) next.add(which);
			return next;
		});
	const showButton = (which: Line) => (
		<button
			type="button"
			className={styles.readyToggle}
			aria-expanded={open.has(which)}
			onClick={() => toggle(which)}
			data-flx="persona.persona-import-review.ready.toggle"
		>
			{open.has(which) ? i18n._(HIDE_DESCRIPTOR) : i18n._(SHOW_DESCRIPTOR)}
		</button>
	);
	const personaItems = (list: ReadonlyArray<PersonaResponse>) => (
		<ul className={styles.readyList} data-flx="persona.persona-import-review.ready.persona-list">
			{list.map((persona) => (
				<li key={persona.id} className={styles.readyItem} data-flx="persona.persona-import-review.ready.persona-item">
					<span className={styles.readyItemLabel} data-flx="persona.persona-import-review.ready.persona-row">
						<RowPicture
							name={persona.name}
							picture={{hash: persona.avatar_hash}}
							data-flx="persona.persona-import-review.ready.persona-picture"
						/>
						<span className={styles.readyItemName} data-flx="persona.persona-import-review.ready.persona-name">
							{persona.name}
						</span>
						<Tags tags={persona.persona_tags} data-flx="persona.persona-import-review.ready.persona-tags" />
					</span>
				</li>
			))}
		</ul>
	);
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
						{showButton('new')}
					</div>
					{open.has('new') && (
						<ul className={styles.readyList} data-flx="persona.persona-import-review.ready.new.list">
							{fresh.map((entry) => {
								const member = members[entry.index];
								if (!member) return null;
								const checked = decisionOf(entry).choice === 'add';
								const pictures = filePictures(entry, member, localPictures.get(entry.index));
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
											<RowPicture
												name={member.preview.name}
												picture={pictures.avatar}
												data-flx="persona.persona-import-review.ready.new.picture"
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
			{(probable.length > 0 || upToDate > 0) && (
				<div className={styles.readyLine} data-flx="persona.persona-import-review.ready.matched">
					<div className={styles.readyHead} data-flx="persona.persona-import-review.ready.matched.head">
						<CheckIcon
							size={18}
							weight="bold"
							className={styles.readyIcon}
							aria-hidden="true"
							data-flx="persona.persona-import-review.ready.matched.icon"
						/>
						<span className={styles.readyText} data-flx="persona.persona-import-review.ready.matched.text">
							{i18n._(READY_MATCHED_DESCRIPTOR, {count: probable.length + upToDate})}
						</span>
						{showButton('matched')}
					</div>
					{open.has('matched') && (
						<ul className={styles.readyList} data-flx="persona.persona-import-review.ready.matched.list">
							{matchedRows.map((row) => (
								<li
									key={row.persona.id}
									className={styles.readyItem}
									data-flx="persona.persona-import-review.ready.matched.item"
								>
									<span className={styles.readyItemLabel} data-flx="persona.persona-import-review.ready.matched.row">
										<RowPicture
											name={row.persona.name}
											picture={{hash: row.persona.avatar_hash}}
											data-flx="persona.persona-import-review.ready.matched.picture"
										/>
										<span className={styles.readyItemName} data-flx="persona.persona-import-review.ready.persona-name">
											{row.persona.name}
										</span>
										<Tags tags={row.persona.persona_tags} data-flx="persona.persona-import-review.ready.matched.tags" />
									</span>
								</li>
							))}
						</ul>
					)}
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
						{untouchedPersonas.length > 0 && showButton('untouched')}
					</div>
					{open.has('untouched') && personaItems(untouchedPersonas)}
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
	const pill = {
		file: i18n._(USING_FILE_DESCRIPTOR),
		both: i18n._(KEEPING_BOTH_DESCRIPTOR),
		tyne: i18n._(KEEPING_TYNE_DESCRIPTOR, {productName}),
	}[mode];
	const copyFields =
		copy && decision.choice === 'add' ? (
			<CopyFields
				entry={entry}
				member={member}
				context={context}
				decision={decision}
				copy={copy}
				onDecide={onDecide}
				data-flx="persona.persona-import-review.differs.copy-fields"
			/>
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
					<ThreeWayBody
						entry={entry}
						member={member}
						persona={persona}
						local={local}
						mode={mode}
						onPick={pick}
						isDifferent={isDifferent}
						copyFields={copyFields}
						group={group}
						question={i18n._(DIFFERS_QUESTION_DESCRIPTOR, {name: persona.name, productName})}
						data-flx="persona.persona-import-review.differs.three-way"
					/>
				</div>
			)}
		</li>
	);
}

type DiffersMode = 'file' | 'both' | 'tyne';

/** The three-way switch over the file's version and a persona, the two cards saying what happens to each. */
function ThreeWayBody({
	entry,
	member,
	persona,
	local,
	mode,
	onPick,
	isDifferent,
	copyFields,
	group,
	question,
	tyneStatuses,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	persona: PersonaResponse;
	local?: LocalPictures;
	mode: DiffersMode;
	onPick: (mode: DiffersMode) => void;
	isDifferent: (field: PersonaImportField) => boolean;
	copyFields?: React.ReactNode;
	group: string;
	question: string;
	/** What happens to Tyne's version, when not the usual (a deleted persona brought back). */
	tyneStatuses?: Record<DiffersMode, string>;
}) {
	const {i18n} = useLingui();
	const productName = PRODUCT_NAME;
	const options: Array<{id: DiffersMode; label: string}> = [
		{id: 'file', label: i18n._(SWITCH_FILE_DESCRIPTOR)},
		{id: 'both', label: i18n._(SWITCH_BOTH_DESCRIPTOR)},
		{id: 'tyne', label: i18n._(SWITCH_TYNE_DESCRIPTOR, {productName})},
	];
	const fileStatus = {
		file: i18n._(STATUS_REPLACES_DESCRIPTOR, {productName, name: persona.name}),
		both: i18n._(STATUS_ADDED_DESCRIPTOR),
		tyne: i18n._(STATUS_NOT_IMPORTED_DESCRIPTOR),
	}[mode];
	const tyneStatus =
		tyneStatuses?.[mode] ?? (mode === 'file' ? i18n._(STATUS_OVERWRITTEN_DESCRIPTOR) : i18n._(STATUS_STAYS_DESCRIPTOR));
	return (
		<>
			<fieldset className={styles.switch} data-flx="persona.persona-import-review.three-way.switch">
				<legend className={styles.srOnly} data-flx="persona.persona-import-review.three-way.question">
					{question}
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
							onChange={() => onPick(option.id)}
							data-flx="persona.persona-import-review.differs.switch-radio"
						/>
						<span data-flx="persona.persona-import-review.differs.switch-label">{option.label}</span>
					</label>
				))}
			</fieldset>
			<div className={styles.sides} data-flx="persona.persona-import-review.three-way.sides">
				<div
					className={clsx(styles.card, mode === 'tyne' ? styles.cardDimmed : styles.cardChosen)}
					data-flx="persona.persona-import-review.three-way.file"
				>
					<SideHead
						title={i18n._(YOUR_FILE_DESCRIPTOR)}
						status={fileStatus}
						danger={mode === 'file'}
						data-flx="persona.persona-import-review.three-way.file-head"
					/>
					<VersionDetails
						side="file"
						entry={entry}
						member={member}
						persona={persona}
						local={local}
						isDifferent={isDifferent}
						editor={copyFields}
						data-flx="persona.persona-import-review.three-way.file-details"
					/>
				</div>
				<div
					className={clsx(styles.card, mode === 'file' ? styles.cardDimmed : styles.cardChosen)}
					data-flx="persona.persona-import-review.three-way.tyne"
				>
					<SideHead
						title={productName}
						status={tyneStatus}
						danger={mode === 'file'}
						data-flx="persona.persona-import-review.three-way.tyne-head"
					/>
					<VersionDetails
						side="tyne"
						entry={entry}
						member={member}
						persona={persona}
						local={local}
						isDifferent={isDifferent}
						data-flx="persona.persona-import-review.three-way.tyne-details"
					/>
				</div>
			</div>
		</>
	);
}

/** Which details of a member differ from a persona the review asks about, compared as the server does. */
function differencesFrom(member: ReviewMember, persona: PersonaResponse): Set<PersonaImportField> {
	const text = (value: string | null | undefined) => (value ?? '').trim();
	const tagKeys = (tags: ReadonlyArray<PersonaTag> | null | undefined) =>
		new Set((tags ?? []).map((tag) => `${text(tag.prefix)}\u0000${text(tag.suffix)}`));
	const fileTags = tagKeys(member.preview.persona_tags);
	const tyneTags = tagKeys(persona.persona_tags);
	const different = new Set<PersonaImportField>();
	if (text(member.preview.name).normalize('NFC') !== text(persona.name).normalize('NFC')) different.add('name');
	if (text(member.preview.pronouns) !== text(persona.pronouns)) different.add('pronouns');
	if (text(member.preview.bio) !== text(persona.bio)) different.add('bio');
	if ((member.preview.color ?? null) !== (persona.color ?? null)) different.add('color');
	if (fileTags.size !== tyneTags.size || [...fileTags].some((key) => !tyneTags.has(key))) different.add('persona_tags');
	return different;
}

/**
 * A member that might be one of the account's personas (tyne-chat/tyne#573): pick which one, or none;
 * a picked persona gets the three-way switch, none gets Skip / Keep. Nothing picked leaves it out.
 */
function CantTellItem({
	entry,
	member,
	personas,
	localPictures,
	context,
	decision,
	onDecide,
	expanded,
	onToggle,
	linkedByOthers,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	personas: ReadonlyMap<string, PersonaResponse>;
	localPictures: ReadonlyMap<number, LocalPictures>;
	context: ReviewContext;
	decision: ReviewDecision;
	onDecide: (decision: ReviewDecision) => void;
	expanded: boolean;
	onToggle: () => void;
	linkedByOthers: (personaId: string, except: number) => boolean;
}) {
	const {i18n} = useLingui();
	const productName = PRODUCT_NAME;
	const candidates = (entry.candidates ?? []).flatMap((candidate) => {
		const persona = personas.get(candidate.persona_id);
		return persona ? [persona] : [];
	});
	let picked: string | null = null;
	let mode: DiffersMode = 'tyne';
	let none = false;
	let keepNew = false;
	if (decision.choice === 'link') picked = decision.personaId;
	else if (decision.choice === 'use_file' && decision.personaId) {
		picked = decision.personaId;
		mode = 'file';
	} else if (decision.choice === 'add' && decision.copy?.connectTo) {
		picked = decision.copy.connectTo;
		mode = 'both';
	} else if (decision.choice === 'add') {
		none = true;
		keepNew = true;
	} else if (decision.choice === 'skip' && decision.none) none = true;
	const pickedPersona = picked ? personas.get(picked) : undefined;
	const local = localPictures.get(entry.index);
	const pictures = filePictures(entry, member, local);
	const bodyId = `import-cant-tell-${entry.index}`;
	const keepAsNew = (connectTo?: string): ReviewDecision => {
		const kept = keepBothDecision(
			entry,
			context.entries,
			context.decisions,
			context.members,
			context.livePersonas,
			context.fromTyne,
			!connectTo,
		);
		return kept.choice === 'add' && kept.copy && connectTo ? {...kept, copy: {...kept.copy, connectTo}} : kept;
	};
	const choose = (personaId: string, next: DiffersMode) => {
		if (next === 'file') onDecide({choice: 'use_file', personaId});
		else if (next === 'tyne') onDecide({choice: 'link', personaId});
		else onDecide(keepAsNew(personaId));
	};
	const different = pickedPersona ? differencesFrom(member, pickedPersona) : new Set<PersonaImportField>();
	let pill = keepNew ? i18n._(KEEPING_DESCRIPTOR) : i18n._(SKIPPING_DESCRIPTOR);
	if (picked) {
		pill = {
			file: i18n._(USING_FILE_DESCRIPTOR),
			both: i18n._(KEEPING_BOTH_DESCRIPTOR),
			tyne: i18n._(KEEPING_TYNE_DESCRIPTOR, {productName}),
		}[mode];
	}
	const copyFields =
		decision.choice === 'add' && decision.copy ? (
			<CopyFields
				entry={entry}
				member={member}
				context={context}
				decision={decision}
				copy={decision.copy}
				onDecide={onDecide}
				data-flx="persona.persona-import-review.cant-tell.copy-fields"
			/>
		) : undefined;
	const pickGroup = `import-pick-${entry.index}`;
	return (
		<li className={styles.differsRow} data-flx="persona.persona-import-review.cant-tell">
			<h4 className={styles.differsHeading} data-flx="persona.persona-import-review.cant-tell.heading">
				<button
					type="button"
					className={styles.differsToggle}
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={onToggle}
					data-flx="persona.persona-import-review.cant-tell.toggle"
				>
					<RowPicture
						name={member.preview.name}
						picture={pictures.avatar}
						data-flx="persona.persona-import-review.cant-tell.picture"
					/>
					<span className={styles.differsSummary} data-flx="persona.persona-import-review.cant-tell.summary">
						<span className={styles.differsName} data-flx="persona.persona-import-review.cant-tell.name">
							{member.preview.name}
						</span>
						<span className={styles.differsFields} data-flx="persona.persona-import-review.cant-tell.matches">
							{i18n._(MATCHES_COUNT_DESCRIPTOR, {count: candidates.length})}
						</span>
					</span>
					<span
						className={clsx(
							styles.choicePill,
							picked && mode === 'file' && styles.choicePillChange,
							((picked && mode === 'both') || keepNew) && styles.choicePillBoth,
						)}
						data-flx="persona.persona-import-review.cant-tell.choice"
					>
						{pill}
					</span>
					<CaretDownIcon
						size={16}
						weight="bold"
						className={clsx(styles.caret, expanded && styles.caretOpen)}
						aria-hidden="true"
						data-flx="persona.persona-import-review.cant-tell.caret"
					/>
				</button>
			</h4>
			{expanded && (
				<div id={bodyId} className={styles.differsBody} data-flx="persona.persona-import-review.cant-tell.body">
					<fieldset className={styles.pick} data-flx="persona.persona-import-review.cant-tell.pick">
						<legend className={styles.pickQuestion} data-flx="persona.persona-import-review.cant-tell.pick-question">
							{i18n._(PICK_QUESTION_DESCRIPTOR, {name: member.preview.name})}
						</legend>
						<div className={styles.pickGrid} data-flx="persona.persona-import-review.cant-tell.pick-grid">
							{candidates.map((persona) => {
								const on = picked === persona.id;
								const taken = !on && linkedByOthers(persona.id, entry.index);
								return (
									<label
										key={persona.id}
										className={clsx(styles.pickCard, on && styles.pickCardOn, taken && styles.cardDisabled)}
										data-flx="persona.persona-import-review.cant-tell.candidate"
									>
										<span
											className={styles.pickCardHead}
											data-flx="persona.persona-import-review.cant-tell.candidate-head"
										>
											<input
												type="radio"
												className={styles.radio}
												name={pickGroup}
												checked={on}
												disabled={taken}
												onChange={() => choose(persona.id, picked ? mode : 'tyne')}
												data-flx="persona.persona-import-review.cant-tell.candidate-radio"
											/>
											<RowPicture
												name={persona.name}
												picture={{hash: persona.avatar_hash}}
												data-flx="persona.persona-import-review.cant-tell.candidate-picture"
											/>
										</span>
										<span
											className={styles.blockName}
											data-flx="persona.persona-import-review.cant-tell.candidate-name"
										>
											{persona.name}
										</span>
										<Tags
											tags={persona.persona_tags}
											data-flx="persona.persona-import-review.cant-tell.candidate-tags"
										/>
										<span
											className={styles.blockMeta}
											data-flx="persona.persona-import-review.cant-tell.candidate-meta"
										>
											{i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0})}
										</span>
									</label>
								);
							})}
							<label
								className={clsx(styles.pickCard, styles.pickCardNone, none && styles.pickCardOn)}
								data-flx="persona.persona-import-review.cant-tell.none"
							>
								<span className={styles.pickCardHead} data-flx="persona.persona-import-review.cant-tell.none-head">
									<input
										type="radio"
										className={styles.radio}
										name={pickGroup}
										checked={none}
										onChange={() => onDecide({choice: 'skip', none: true})}
										data-flx="persona.persona-import-review.cant-tell.none-radio"
									/>
								</span>
								<span className={styles.blockName} data-flx="persona.persona-import-review.cant-tell.none-label">
									{i18n._(NONE_OF_THESE_DESCRIPTOR)}
								</span>
							</label>
						</div>
					</fieldset>
					{pickedPersona && picked && (
						<ThreeWayBody
							entry={entry}
							member={member}
							persona={pickedPersona}
							local={local}
							mode={mode}
							onPick={(next) => choose(picked, next)}
							isDifferent={(field) => different.has(field)}
							copyFields={mode === 'both' ? copyFields : undefined}
							group={`import-${entry.index}`}
							question={i18n._(DIFFERS_QUESTION_DESCRIPTOR, {name: pickedPersona.name, productName})}
							data-flx="persona.persona-import-review.cant-tell.three-way"
						/>
					)}
					{none && (
						<div className={styles.takenGrid} data-flx="persona.persona-import-review.cant-tell.none-grid">
							<fieldset
								className={clsx(styles.switch, styles.switchTwo)}
								data-flx="persona.persona-import-review.cant-tell.none-switch"
							>
								<legend className={styles.srOnly} data-flx="persona.persona-import-review.cant-tell.none-question">
									{i18n._(NONE_OF_THESE_DESCRIPTOR)}
								</legend>
								{[false, true].map((keep) => (
									<label
										key={String(keep)}
										className={clsx(styles.switchOption, keepNew === keep && styles.switchOptionOn)}
										data-flx="persona.persona-import-review.cant-tell.none-option"
									>
										<input
											type="radio"
											className={styles.switchRadio}
											name={`import-${entry.index}`}
											checked={keepNew === keep}
											onChange={() => onDecide(keep ? keepAsNew() : {choice: 'skip', none: true})}
											data-flx="persona.persona-import-review.cant-tell.none-radio--2"
										/>
										<span data-flx="persona.persona-import-review.cant-tell.none-option-label">
											{keep ? i18n._(SWITCH_KEEP_DESCRIPTOR) : i18n._(SWITCH_SKIP_DESCRIPTOR)}
										</span>
									</label>
								))}
							</fieldset>
							<span
								className={styles.takenSpacer}
								aria-hidden="true"
								data-flx="persona.persona-import-review.cant-tell.spacer"
							/>
							<div
								className={clsx(styles.card, keepNew ? styles.cardChosen : styles.cardDimmed)}
								data-flx="persona.persona-import-review.cant-tell.file"
							>
								<SideHead
									title={i18n._(YOUR_FILE_DESCRIPTOR)}
									status={keepNew ? i18n._(STATUS_ADDED_DESCRIPTOR) : i18n._(STATUS_NOT_IMPORTED_DESCRIPTOR)}
									data-flx="persona.persona-import-review.cant-tell.file-head"
								/>
								<VersionDetails
									side="file"
									entry={entry}
									member={member}
									local={local}
									editor={keepNew ? copyFields : undefined}
									data-flx="persona.persona-import-review.cant-tell.member-details"
								/>
							</div>
							<div
								className={clsx(styles.card, styles.emptyCard)}
								aria-hidden="true"
								data-flx="persona.persona-import-review.cant-tell.empty"
							/>
						</div>
					)}
					{!pickedPersona && !none && (
						<div className={styles.sides} data-flx="persona.persona-import-review.cant-tell.sides">
							<div
								className={clsx(styles.card, styles.cardDimmed)}
								data-flx="persona.persona-import-review.cant-tell.unpicked-file"
							>
								<SideHead
									title={i18n._(YOUR_FILE_DESCRIPTOR)}
									status={i18n._(STATUS_NOT_IMPORTED_DESCRIPTOR)}
									data-flx="persona.persona-import-review.cant-tell.unpicked-head"
								/>
								<VersionDetails
									side="file"
									entry={entry}
									member={member}
									local={local}
									data-flx="persona.persona-import-review.cant-tell.unpicked-details"
								/>
							</div>
							<div
								className={clsx(styles.card, styles.emptyCard)}
								aria-hidden="true"
								data-flx="persona.persona-import-review.cant-tell.unpicked-empty"
							/>
						</div>
					)}
				</div>
			)}
		</li>
	);
}

/** A side's title, and what happens to it: in red when something is overwritten. */
function SideHead({title, status, danger}: {title: string; status: string; danger?: boolean}) {
	return (
		<div className={styles.sideHead} data-flx="persona.persona-import-review.side-head">
			<span className={styles.sideTitle} data-flx="persona.persona-import-review.side-head.title">
				{title}
			</span>
			<span
				className={clsx(styles.sideStatus, danger && styles.sideStatusDanger)}
				aria-live="polite"
				data-flx="persona.persona-import-review.side-head.status"
			>
				{status}
			</span>
		</div>
	);
}

/** The name and tag fields of the file's version when it is added under its own (a Keep). */
function CopyFields({
	entry,
	member,
	context,
	decision,
	copy,
	onDecide,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	context: ReviewContext;
	decision: Extract<ReviewDecision, {choice: 'add'}>;
	copy: PersonaCopy;
	onDecide: (decision: ReviewDecision) => void;
}) {
	const {i18n} = useLingui();
	const nameId = `import-copy-name-${entry.index}`;
	return (
		<div className={styles.copyFields} data-flx="persona.persona-import-review.copy-fields">
			<label
				htmlFor={nameId}
				className={styles.tagFieldLabel}
				data-flx="persona.persona-import-review.copy-fields.name-label"
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
				data-flx="persona.persona-import-review.copy-fields.name"
			/>
			{copy.replacedTags.length > 0 && (
				<TagFields
					entry={entry}
					member={member}
					context={context}
					clashing={copy.replacedTags}
					replacements={decision.replacements ?? []}
					onChange={(replacements) => onDecide({...decision, replacements})}
					data-flx="persona.persona-import-review.copy-fields.tags"
				/>
			)}
		</div>
	);
}

/** A small round picture for a collapsed row: a stored copy, else the zip's, else the initial. */
const RowPicture = observer(({name, picture}: {name: string; picture: HeaderPicture}) => {
	const user = Users.currentUser;
	const url =
		picture.hash && user ? getPersonaAvatarURL({userId: user.id, avatar: picture.hash}, false, 80) : picture.localUrl;
	if (!url) return <Initial name={name} data-flx="persona.persona-import-review.row-picture.initial" />;
	return (
		<img className={styles.rowAvatar} src={url} alt="" data-flx="persona.persona-import-review.row-picture.image" />
	);
});

/**
 * A member whose tag another persona (or member) has, as a collapsed row; opened, a Skip / Keep switch
 * over the file's version, beside the one that has the tag (tyne-chat/tyne#570). Keep adds it with a name
 * and tags of its own, linked to its member.
 */
function TagTakenItem({
	entry,
	member,
	personas,
	localPictures,
	context,
	decision,
	onDecide,
	expanded,
	onToggle,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	personas: ReadonlyMap<string, PersonaResponse>;
	localPictures: ReadonlyMap<number, LocalPictures>;
	context: ReviewContext;
	decision: ReviewDecision;
	onDecide: (decision: ReviewDecision) => void;
	expanded: boolean;
	onToggle: () => void;
}) {
	const {i18n} = useLingui();
	const productName = PRODUCT_NAME;
	const copy = decision.choice === 'add' ? decision.copy : undefined;
	const keep = decision.choice === 'add';
	const bodyId = `import-taken-${entry.index}`;
	const group = `import-${entry.index}`;
	const clashes = (entry.clashes ?? []).filter((clash) => clash.tag);
	const clashing = new Set(clashingTags(entry).map(tagText));
	const holderId = clashes.find((clash) => clash.held_by_persona_id)?.held_by_persona_id;
	const holder = holderId ? personas.get(holderId) : undefined;
	const otherIndex = clashes.find((clash) => clash.shared_with_member != null)?.shared_with_member;
	const otherEntry = otherIndex != null ? context.entries[otherIndex] : undefined;
	const other = otherIndex != null ? context.members[otherIndex] : undefined;
	const pictures = filePictures(entry, member, localPictures.get(entry.index));
	const pick = (next: 'skip' | 'keep') => {
		if (next === 'skip') onDecide({choice: 'skip'});
		else if (!keep)
			onDecide(
				keepBothDecision(
					entry,
					context.entries,
					context.decisions,
					context.members,
					context.livePersonas,
					context.fromTyne,
					true,
				),
			);
	};
	const options: Array<{id: 'skip' | 'keep'; label: string}> = [
		{id: 'skip', label: i18n._(SWITCH_SKIP_DESCRIPTOR)},
		{id: 'keep', label: i18n._(SWITCH_KEEP_DESCRIPTOR)},
	];
	return (
		<li className={styles.differsRow} data-flx="persona.persona-import-review.taken">
			<h4 className={styles.differsHeading} data-flx="persona.persona-import-review.taken.heading">
				<button
					type="button"
					className={styles.differsToggle}
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={onToggle}
					data-flx="persona.persona-import-review.taken.toggle"
				>
					<RowPicture
						name={member.preview.name}
						picture={pictures.avatar}
						data-flx="persona.persona-import-review.taken.picture"
					/>
					<span className={styles.differsSummary} data-flx="persona.persona-import-review.taken.summary">
						<span className={styles.differsName} data-flx="persona.persona-import-review.taken.name">
							{member.preview.name}
						</span>
						<span className={styles.differsFields} data-flx="persona.persona-import-review.taken.tags">
							{listFormat(i18n.locale, [...clashing])}
						</span>
					</span>
					<span
						className={clsx(styles.choicePill, keep && styles.choicePillBoth)}
						data-flx="persona.persona-import-review.taken.choice"
					>
						{keep ? i18n._(KEEPING_DESCRIPTOR) : i18n._(SKIPPING_DESCRIPTOR)}
					</span>
					<CaretDownIcon
						size={16}
						weight="bold"
						className={clsx(styles.caret, expanded && styles.caretOpen)}
						aria-hidden="true"
						data-flx="persona.persona-import-review.taken.caret"
					/>
				</button>
			</h4>
			{expanded && (
				<div id={bodyId} className={styles.differsBody} data-flx="persona.persona-import-review.taken.body">
					{clashes.map((clash) => {
						const tag = tagText(clash.tag!);
						const name =
							(clash.held_by_persona_id ? personas.get(clash.held_by_persona_id)?.name : undefined) ??
							(clash.shared_with_member != null
								? context.members[clash.shared_with_member]?.preview.name
								: undefined) ??
							'?';
						return (
							<p key={tag} className={styles.why} data-flx="persona.persona-import-review.taken.why">
								{clash.held_by_persona_id ? (
									<Trans comment="Why a member is in the import review. {tag} is a proxy tag, {name} an existing persona">
										<code className={styles.tag} data-flx="persona.persona-import-review.taken.why-tag">
											{tag}
										</code>{' '}
										already belongs to your persona {name}.
									</Trans>
								) : (
									<Trans comment="Why a member is in the import review. {tag} is a proxy tag, {name} another member of the file">
										<code className={styles.tag} data-flx="persona.persona-import-review.taken.why-tag--2">
											{tag}
										</code>{' '}
										is also used by {name} in your file.
									</Trans>
								)}
							</p>
						);
					})}
					<div className={styles.takenGrid} data-flx="persona.persona-import-review.taken.grid">
						<fieldset
							className={clsx(styles.switch, styles.switchTwo)}
							data-flx="persona.persona-import-review.taken.switch"
						>
							<legend className={styles.srOnly} data-flx="persona.persona-import-review.taken.question">
								{i18n._(TAG_TAKEN_QUESTION_DESCRIPTOR, {name: member.preview.name})}
							</legend>
							{options.map((option) => {
								const on = (option.id === 'keep') === keep;
								return (
									<label
										key={option.id}
										className={clsx(styles.switchOption, on && styles.switchOptionOn)}
										data-flx="persona.persona-import-review.taken.switch-option"
									>
										<input
											type="radio"
											className={styles.switchRadio}
											name={group}
											checked={on}
											onChange={() => pick(option.id)}
											data-flx="persona.persona-import-review.taken.switch-radio"
										/>
										<span data-flx="persona.persona-import-review.taken.switch-label">{option.label}</span>
									</label>
								);
							})}
						</fieldset>
						<span
							className={styles.takenSpacer}
							aria-hidden="true"
							data-flx="persona.persona-import-review.taken.spacer"
						/>
						<div
							className={clsx(styles.card, keep ? styles.cardChosen : styles.cardDimmed)}
							data-flx="persona.persona-import-review.taken.file"
						>
							<SideHead
								title={i18n._(YOUR_FILE_DESCRIPTOR)}
								status={keep ? i18n._(STATUS_ADDED_DESCRIPTOR) : i18n._(STATUS_NOT_IMPORTED_DESCRIPTOR)}
								data-flx="persona.persona-import-review.taken.file-head"
							/>
							<VersionDetails
								side="file"
								entry={entry}
								member={member}
								local={localPictures.get(entry.index)}
								clashing={clashing}
								editor={
									copy && decision.choice === 'add' ? (
										<CopyFields
											entry={entry}
											member={member}
											context={context}
											decision={decision}
											copy={copy}
											onDecide={onDecide}
											data-flx="persona.persona-import-review.taken.copy-fields"
										/>
									) : undefined
								}
								data-flx="persona.persona-import-review.taken.member-details"
							/>
						</div>
						<div className={styles.card} data-flx="persona.persona-import-review.taken.holder">
							<SideHead
								title={holder ? productName : i18n._(YOUR_FILE_DESCRIPTOR)}
								status={i18n._(KEEPS_TAG_DESCRIPTOR)}
								data-flx="persona.persona-import-review.taken.holder-head"
							/>
							{holder && (
								<VersionDetails
									side="tyne"
									entry={entry}
									member={member}
									persona={holder}
									clashing={clashing}
									data-flx="persona.persona-import-review.taken.holder-details"
								/>
							)}
							{!holder && other && otherEntry && (
								<VersionDetails
									side="file"
									entry={otherEntry}
									member={other}
									local={localPictures.get(otherEntry.index)}
									clashing={clashing}
									data-flx="persona.persona-import-review.taken.other-details"
								/>
							)}
						</div>
					</div>
				</div>
			)}
		</li>
	);
}

/**
 * A member whose persona was deleted in Tyne (tyne-chat/tyne#574): Leave deleted (the default) or
 * Bring back, over Tyne's card; brought back, the three-way switch says which version it comes back as,
 * or whether the file's is added beside it.
 */
function DeletedItem({
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
	let back = true;
	let mode: DiffersMode = 'tyne';
	if (decision.choice === 'use_file') mode = 'file';
	else if (decision.choice === 'add' && decision.copy?.restore) mode = 'both';
	else if (decision.choice !== 'restore') back = false;
	const bodyId = `import-deleted-${entry.index}`;
	const date = persona.deleted_at ? new Date(persona.deleted_at).toLocaleDateString(i18n.locale) : null;
	const different = differencesFrom(member, persona);
	// The same in the file as when it was deleted: bringing it back is the only question.
	const samePicture = (kind: 'avatar' | 'banner') => {
		const fileHas = Boolean(kind === 'avatar' ? member.preview.avatar : member.preview.banner);
		const tyneHash = kind === 'avatar' ? persona.avatar_hash : persona.banner_hash;
		return fileHas ? samePictureFile(member, entry, kind, tyneHash) : !tyneHash;
	};
	const identical = different.size === 0 && samePicture('avatar') && samePicture('banner');
	const choose = (next: DiffersMode) => {
		if (next === 'file') onDecide({choice: 'use_file', personaId: persona.id});
		else if (next === 'tyne') onDecide({choice: 'restore'});
		else {
			const kept = keepBothDecision(
				entry,
				context.entries,
				context.decisions,
				context.members,
				context.livePersonas,
				context.fromTyne,
				false,
				persona,
			);
			onDecide(kept.choice === 'add' && kept.copy ? {...kept, copy: {...kept.copy, restore: persona.id}} : kept);
		}
	};
	let pill = i18n._(STAYING_DELETED_DESCRIPTOR);
	if (back) {
		pill = {
			file: i18n._(USING_FILE_DESCRIPTOR),
			both: i18n._(KEEPING_BOTH_DESCRIPTOR),
			tyne: i18n._(BRINGING_BACK_DESCRIPTOR),
		}[mode];
	}
	const copyFields =
		decision.choice === 'add' && decision.copy ? (
			<CopyFields
				entry={entry}
				member={member}
				context={context}
				decision={decision}
				copy={decision.copy}
				onDecide={onDecide}
				data-flx="persona.persona-import-review.deleted.copy-fields"
			/>
		) : undefined;
	const comesBack = i18n._(STATUS_COMES_BACK_DESCRIPTOR);
	return (
		<li className={styles.differsRow} data-flx="persona.persona-import-review.deleted">
			<h4 className={styles.differsHeading} data-flx="persona.persona-import-review.deleted.heading">
				<button
					type="button"
					className={styles.differsToggle}
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={onToggle}
					data-flx="persona.persona-import-review.deleted.toggle"
				>
					<PersonaPicture persona={persona} data-flx="persona.persona-import-review.deleted.picture" />
					<span className={styles.differsSummary} data-flx="persona.persona-import-review.deleted.summary">
						<span className={styles.differsName} data-flx="persona.persona-import-review.deleted.name">
							{persona.name}
						</span>
						{date && (
							<span className={styles.differsFields} data-flx="persona.persona-import-review.deleted.date">
								{i18n._(DELETED_ON_DESCRIPTOR, {date})}
							</span>
						)}
					</span>
					<span
						className={clsx(
							styles.choicePill,
							back && mode === 'file' && styles.choicePillChange,
							back && mode === 'both' && styles.choicePillBoth,
						)}
						data-flx="persona.persona-import-review.deleted.choice"
					>
						{pill}
					</span>
					<CaretDownIcon
						size={16}
						weight="bold"
						className={clsx(styles.caret, expanded && styles.caretOpen)}
						aria-hidden="true"
						data-flx="persona.persona-import-review.deleted.caret"
					/>
				</button>
			</h4>
			{expanded && (
				<div id={bodyId} className={styles.differsBody} data-flx="persona.persona-import-review.deleted.body">
					<div className={styles.takenGrid} data-flx="persona.persona-import-review.deleted.back-grid">
						<span
							className={styles.takenSpacer}
							aria-hidden="true"
							data-flx="persona.persona-import-review.deleted.spacer"
						/>
						<fieldset
							className={clsx(styles.switch, styles.switchTwo)}
							data-flx="persona.persona-import-review.deleted.back-switch"
						>
							<legend className={styles.srOnly} data-flx="persona.persona-import-review.deleted.question">
								{date
									? i18n._(DELETED_QUESTION_DESCRIPTOR, {name: persona.name, productName, date})
									: i18n._(DELETED_QUESTION_NO_DATE_DESCRIPTOR, {name: persona.name, productName})}
							</legend>
							{[false, true].map((option) => (
								<label
									key={String(option)}
									className={clsx(styles.switchOption, back === option && styles.switchOptionOn)}
									data-flx="persona.persona-import-review.deleted.back-option"
								>
									<input
										type="radio"
										className={styles.switchRadio}
										name={`import-back-${entry.index}`}
										checked={back === option}
										onChange={() => (option ? choose('tyne') : onDecide({choice: 'keep'}))}
										data-flx="persona.persona-import-review.deleted.back-radio"
									/>
									<span data-flx="persona.persona-import-review.deleted.back-label">
										{option ? i18n._(SWITCH_BRING_BACK_DESCRIPTOR) : i18n._(SWITCH_LEAVE_DELETED_DESCRIPTOR)}
									</span>
								</label>
							))}
						</fieldset>
					</div>
					{back && !identical ? (
						<ThreeWayBody
							entry={entry}
							member={member}
							persona={persona}
							local={local}
							mode={mode}
							onPick={choose}
							isDifferent={(field) => different.has(field)}
							copyFields={mode === 'both' ? copyFields : undefined}
							group={`import-${entry.index}`}
							question={i18n._(DIFFERS_QUESTION_DESCRIPTOR, {name: persona.name, productName})}
							tyneStatuses={{file: i18n._(STATUS_OVERWRITTEN_DESCRIPTOR), both: comesBack, tyne: comesBack}}
							data-flx="persona.persona-import-review.deleted.three-way"
						/>
					) : (
						<div className={styles.sides} data-flx="persona.persona-import-review.deleted.sides">
							<div
								className={clsx(styles.card, styles.cardDimmed)}
								data-flx="persona.persona-import-review.deleted.file"
							>
								<SideHead
									title={i18n._(YOUR_FILE_DESCRIPTOR)}
									status={i18n._(STATUS_NOT_IMPORTED_DESCRIPTOR)}
									data-flx="persona.persona-import-review.deleted.file-head"
								/>
								<VersionDetails
									side="file"
									entry={entry}
									member={member}
									local={local}
									data-flx="persona.persona-import-review.deleted.file-details"
								/>
							</div>
							<div
								className={clsx(styles.card, back ? styles.cardChosen : styles.cardDimmed)}
								data-flx="persona.persona-import-review.deleted.tyne"
							>
								<SideHead
									title={productName}
									status={back ? comesBack : i18n._(STATUS_STAYS_DELETED_DESCRIPTOR)}
									data-flx="persona.persona-import-review.deleted.tyne-head"
								/>
								<VersionDetails
									side="tyne"
									entry={entry}
									member={member}
									persona={persona}
									data-flx="persona.persona-import-review.deleted.tyne-details"
								/>
							</div>
						</div>
					)}
				</div>
			)}
		</li>
	);
}

/** One side of a differing persona: every detail, the ones that differ marked on both sides alike. */
function VersionDetails({
	side,
	entry,
	member,
	persona,
	local,
	isDifferent = () => false,
	editor,
	clashing,
}: {
	side: 'file' | 'tyne';
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	/** Tyne's side, and on the file's side the persona it is compared with, if any. */
	persona?: PersonaResponse;
	local?: LocalPictures;
	isDifferent?: (field: PersonaImportField) => boolean;
	/** Fields in place of the name and tags, for a member added under its own. */
	editor?: React.ReactNode;
	/** Tags to mark as taken. */
	clashing?: ReadonlySet<string>;
}) {
	const {i18n} = useLingui();
	const fromFile = side === 'file' || !persona;
	const name = fromFile ? member.preview.name : persona.name;
	const pronouns = fromFile ? member.preview.pronouns : persona.pronouns;
	const tags = fromFile ? member.preview.persona_tags : persona.persona_tags;
	const bio = fromFile ? member.preview.bio : persona.bio;
	const file = filePictures(entry, member, local);
	// A changed bio marks just the words the other side does not have.
	const bioDiff =
		persona && isDifferent('bio') && member.preview.bio && persona.bio
			? diffBios(member.preview.bio, persona.bio)
			: null;
	let bioParts: Array<{text: string; changed: boolean; at: number}> | null = null;
	if (bioDiff) {
		let at = 0;
		bioParts = (fromFile ? bioDiff.file : bioDiff.tyne).map((part) => {
			const placed = {...part, at};
			at += part.text.length;
			return placed;
		});
	}
	const bioValue = bio ? (
		<span className={styles.bioText} data-flx="persona.persona-import-review.version.bio">
			{bioParts
				? bioParts.map((part) =>
						part.changed ? (
							<mark
								key={part.at}
								className={styles.bioChanged}
								data-flx="persona.persona-import-review.version.bio-changed"
							>
								{part.text}
							</mark>
						) : (
							<span key={part.at} data-flx="persona.persona-import-review.version.bio-same">
								{part.text}
							</span>
						),
					)
				: bio}
		</span>
	) : null;
	const empty = (descriptor: MessageDescriptor) => (
		<span className={styles.empty} data-flx="persona.persona-import-review.version.empty">
			{i18n._(descriptor)}
		</span>
	);
	const rows: Array<[PersonaImportField, React.ReactNode]> = [
		...(editor
			? []
			: ([
					[
						'persona_tags',
						tags && tags.length > 0 ? (
							<Tags tags={tags} highlight={clashing} data-flx="persona.persona-import-review.version.tags" />
						) : (
							empty(NO_TAGS_DESCRIPTOR)
						),
					],
				] as Array<[PersonaImportField, React.ReactNode]>)),
		['pronouns', pronouns || empty(NO_PRONOUNS_DESCRIPTOR)],
		['bio', bioValue ?? empty(NO_BIO_DESCRIPTOR)],
	];
	if (isDifferent('color')) {
		const color = fromFile ? member.preview.color : persona?.color;
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
				color={fromFile ? member.preview.color : persona?.color}
				avatar={fromFile ? file.avatar : {hash: persona?.avatar_hash}}
				banner={fromFile ? file.banner : {hash: persona?.banner_hash}}
				missing={fromFile && file.missing}
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
				{fromFile ? i18n._(FROM_FILE_DESCRIPTOR) : i18n._(USED_TIMES_DESCRIPTOR, {count: persona?.use_count ?? 0})}
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
	const useFile = choice === 'file';
	// Two boxes, each the choice itself: the display tag is one line, too light for the full switch.
	const box = (option: 'file' | 'keep', title: string, status: string, text: string | null) => (
		<label
			className={clsx(styles.card, styles.cardChoice, choice === option ? styles.cardChosen : styles.cardDimmed)}
			data-flx="persona.persona-import-review.display-tag.box"
		>
			<span className={styles.sideHead} data-flx="persona.persona-import-review.display-tag.box-head">
				<span className={styles.cardChoiceHead} data-flx="persona.persona-import-review.display-tag.box-title">
					<input
						type="radio"
						className={styles.radio}
						name="import-display-tag"
						checked={choice === option}
						onChange={() => onChoice(option)}
						data-flx="persona.persona-import-review.display-tag.radio"
					/>
					<span className={styles.sideTitle} data-flx="persona.persona-import-review.display-tag.title">
						{title}
					</span>
				</span>
				<span
					className={clsx(styles.sideStatus, useFile && styles.sideStatusDanger)}
					data-flx="persona.persona-import-review.display-tag.status"
				>
					{status}
				</span>
			</span>
			{sample(text)}
		</label>
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
			<div
				className={styles.sides}
				role="radiogroup"
				aria-labelledby="import-q-display-tag"
				data-flx="persona.persona-import-review.display-tag.sides"
			>
				{box(
					'file',
					i18n._(YOUR_FILE_DESCRIPTOR),
					useFile ? i18n._(STATUS_REPLACES_TAG_DESCRIPTOR) : i18n._(STATUS_NOT_IMPORTED_DESCRIPTOR),
					fileTagText,
				)}
				{box(
					'keep',
					productName,
					useFile ? i18n._(STATUS_OVERWRITTEN_DESCRIPTOR) : i18n._(STATUS_STAYS_DESCRIPTOR),
					currentText,
				)}
			</div>
		</section>
	);
}
