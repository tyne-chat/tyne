// SPDX-License-Identifier: AGPL-3.0-or-later

// The review of an import (tyne-chat/tyne#243): one section per kind of decision, the hardest first,
// each member on the safest choice until the person picks another. Nothing here writes; the dialog
// applies the decisions. Pictures come only from this instance (a stored hash) or from the export's
// zip in memory, never from a link in the file.

import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import {bundlePictureBytes} from '@app/features/persona/utils/PersonaImportImages';
import {
	defaultDecision,
	heldTags,
	type ReviewConflict,
	type ReviewDecision,
	type ReviewMember,
	sharedTags,
} from '@app/features/persona/utils/PersonaImportReview';
import {Button} from '@app/features/ui/button/Button';
import Users from '@app/features/user/state/Users';
import {getPersonaBannerURL} from '@app/features/user/utils/AvatarUtils';
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
import {CheckCircle, ShieldCheck, Warning} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useMemo, useState} from 'react';
import styles from './PersonaImportReview.module.css';

const FIELD_IN_SENTENCE: Record<PersonaImportField, MessageDescriptor> = {
	name: msg({
		message: 'name',
		context: 'persona-field',
		comment: 'A persona\'s name as a field, listed in "Differs: name, bio"',
	}),
	pronouns: msg({message: 'pronouns', comment: 'A persona field, listed in "Differs: name, pronouns"'}),
	bio: msg({message: 'bio', comment: 'A persona field, listed in "Differs: name, bio"'}),
	color: msg({message: 'colour', comment: 'A persona field (its accent colour), listed in "Differs: name, colour"'}),
	persona_tags: msg({message: 'tags', comment: 'A persona field (its proxy tags), listed in "Differs: name, tags"'}),
	avatar: msg({message: 'avatar', comment: 'A persona field, listed in "Differs: name, avatar"'}),
	banner: msg({message: 'banner', comment: 'A persona field, listed in "Differs: name, banner"'}),
	signature_emojis: msg({
		message: 'signature emojis',
		comment: 'A persona field, listed in "Differs: name, signature emojis"',
	}),
	auto_tag_disabled: msg({
		message: 'tag matching',
		comment: 'A persona setting (whether its tags are matched), listed in "Differs: name, tag matching"',
	}),
	visibility: msg({message: 'visibility', comment: 'A persona field, listed in "Differs: name, visibility"'}),
};

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

const NEED_LOOK_DESCRIPTOR = msg({
	message: '{needCount, plural, one {# member needs a look} other {# members need a look}}',
	comment: 'Heading of the import review. {needCount} is a number of members',
});
const NEED_LOOK_WITH_TAG_DESCRIPTOR = msg({
	message:
		'{needCount, plural, one {# member and your display tag need a look} other {# members and your display tag need a look}}',
	comment: 'Heading of the import review when the display tag needs a choice too. {needCount} is a number of members',
});
const DIFFERS_DESCRIPTOR = msg({
	message: 'Differs: {fields}',
	comment: 'What differs between a persona and the import file. {fields} is a list such as "name, bio"',
});
const REMOVES_DESCRIPTOR = msg({
	message: 'removes {fields}',
	comment:
		'Fields the import file has empty, so using its version would remove them, as in "Differs: name · removes bio". {fields} is a list',
});
const PICTURE_NOT_COMPARED_DESCRIPTOR = msg({
	message: 'picture not compared',
	comment:
		'Shown on a row when the import cannot tell whether a persona picture changed, because it does not know where the stored one came from',
});
const USED_TIMES_DESCRIPTOR = msg({
	message: '{count, plural, one {Used once} other {Used # times}}',
	comment: 'How often a persona has been used, shown in the import review',
});
const DELETED_ON_DESCRIPTOR = msg({
	message: 'Deleted {date}',
	comment: 'When a persona was deleted, in the import review. {date} is a date',
});
const SHOW_MORE_DESCRIPTOR = msg({
	message: 'Show {count} more',
	comment: 'Button that shows the rest of a list in the import review',
});
const SHOW_FEWER_DESCRIPTOR = msg({
	message: 'Show fewer',
	comment: 'Button that collapses a list in the import review again',
});
const COMPARE_DESCRIPTOR = msg({
	message: 'Compare',
	comment: 'Button that shows a persona next to its version in the import file',
});
const HIDE_COMPARISON_DESCRIPTOR = msg({
	message: 'Hide comparison',
	comment: 'Button that hides the comparison of a persona with the import file',
});
const KEEP_TYNE_DESCRIPTOR = msg({
	message: 'Keep this version',
	comment: "Choice in the import review: keep the persona as it is in this app, ignoring the import file's version",
});
const USE_FILE_DESCRIPTOR = msg({
	message: "Use the file's version",
	comment: "Choice in the import review: replace the persona's details with those in the import file",
});
const LEAVE_DELETED_DESCRIPTOR = msg({
	message: 'Leave deleted',
	comment: 'Choice in the import review for a persona that was deleted: keep it deleted',
});
const RESTORE_DESCRIPTOR = msg({
	message: 'Restore',
	comment: 'Choice in the import review: bring a deleted persona back, with its old messages',
});
const LINK_DESCRIPTOR = msg({
	message: 'Link',
	context: 'persona-import-choice',
	comment:
		'Choice in the import review: connect an existing persona to its member in the import file, changing nothing else',
});
const ADD_WITHOUT_TAG_DESCRIPTOR = msg({
	message: 'Add without {tags}',
	comment: 'Choice in the import review: add the member as a new persona without the proxy tags listed in {tags}',
});
const ADD_SEPARATELY_DESCRIPTOR = msg({
	message: 'Add as a separate persona',
	comment: 'Choice in the import review: add the member as a new persona next to the existing one',
});
const SKIP_DESCRIPTOR = msg({
	message: 'Skip this member',
	comment: 'Choice in the import review: do nothing with this member of the import file',
});
const SKIP_SHORT_DESCRIPTOR = msg({
	message: 'Skip',
	comment: 'Choice in the import review, in a short menu: do nothing with this member of the import file',
});
const SAME_AS_DESCRIPTOR = msg({
	message: 'Same as your {name}: link them',
	comment: 'Choice in the import review: the member in the import file is the existing persona {name}; connect them',
});
const WHAT_TO_DO_DESCRIPTOR = msg({
	message: 'What should happen to {name} from your file?',
	comment: 'Heading of the choices for one member of the import file',
});
const WHAT_TO_DO_SHORT_DESCRIPTOR = msg({
	message: 'What to do with {name}',
	comment: 'Accessible label of the menu of choices for one persona in the import review',
});
const LINKED_ELSEWHERE_DESCRIPTOR = msg({
	message: 'Linked to another PluralKit member',
	comment: 'Shown on a persona in the import review that is already connected to a different member',
});
const NEW_PICTURE_DESCRIPTOR = msg({
	message: 'New picture in the file, shown once imported',
	comment: "Shown instead of a picture from the import file, which isn't loaded until it is stored on this server",
});
const SAME_PICTURE_DESCRIPTOR = msg({
	message: 'Same picture',
	comment: 'Comparison of a persona picture with the import file: they are the same',
});
const DIFFERENT_PICTURE_DESCRIPTOR = msg({
	message: 'Different picture',
	comment: 'Comparison of a persona picture with the import file: they differ',
});
const NO_PICTURE_DESCRIPTOR = msg({
	message: 'None',
	comment: 'Comparison of a persona picture with the import file: there is none',
});
const UNKNOWN_PICTURE_DESCRIPTOR = msg({
	message: "Can't compare",
	comment: "Comparison of a persona picture with the import file: it can't be compared",
});
const VISIBILITY_KEPT_DESCRIPTOR = msg({
	message: "{visibility} (this app's is kept)",
	comment:
		"The import file's visibility for a persona, shown for information: the persona's own visibility is never changed by an import",
});
const RESTORE_ALL_DESCRIPTOR = msg({
	message: 'Restore all {count}',
	comment: 'Button in the import review that restores every deleted persona listed',
});
const LINK_ALL_DESCRIPTOR = msg({
	message: 'Link all {count}',
	comment: 'Button in the import review that links every persona listed',
});
const VISIBILITY_NAMES: Record<string, MessageDescriptor> = {
	public: msg({message: 'Public', comment: 'Persona visibility'}),
	unlisted: msg({message: 'Unlisted', comment: 'Persona visibility'}),
	private: msg({message: 'Private', comment: 'Persona visibility'}),
};

function tagText(tag: PersonaTag): string {
	return `${(tag.prefix ?? '').trim()}text${(tag.suffix ?? '').trim()}`;
}

function Tags({tags}: {tags: ReadonlyArray<PersonaTag> | null | undefined}) {
	if (!tags || tags.length === 0) return null;
	return (
		<span data-flx="persona.persona-import-review.tags.span">
			{tags.map((tag) => (
				<code key={tagText(tag)} className={styles.tag} data-flx="persona.persona-import-review.tags.tag">
					{tagText(tag)}
				</code>
			))}
		</span>
	);
}

/** Local addresses for the zip's pictures of the members shown, released when the review closes. */
function useLocalPictures(source: PersonaImportSource, members: ReadonlyArray<ReviewMember>): Map<number, string> {
	const urls = useMemo(() => {
		const map = new Map<number, string>();
		members.forEach((member, index) => {
			const bytes = bundlePictureBytes(source, member, 'avatar');
			if (!bytes) return;
			const type = `image/${imageFileExtension(bytes) === 'jpg' ? 'jpeg' : imageFileExtension(bytes)}`;
			map.set(index, URL.createObjectURL(new Blob([bytes as BlobPart], {type})));
		});
		return map;
	}, [source, members]);
	useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
	return urls;
}

const MemberPicture = observer(
	({entry, member, localUrl}: {entry: PersonaImportPreviewEntry; member: ReviewMember; localUrl?: string}) => {
		const user = Users.currentUser;
		if (entry.avatar_hash && user) {
			return (
				<PersonaAvatar
					user={user}
					persona={{avatar: entry.avatar_hash}}
					size={40}
					data-flx="persona.persona-import-review.member-picture.persona-avatar"
				/>
			);
		}
		if (localUrl)
			return (
				<img
					className={styles.localAvatar}
					src={localUrl}
					alt=""
					data-flx="persona.persona-import-review.member-picture.local-avatar"
				/>
			);
		return (
			<span
				className={styles.placeholderAvatar}
				aria-hidden="true"
				data-flx="persona.persona-import-review.member-picture.placeholder-avatar"
			>
				{Array.from(member.member.name.trim())[0] ?? '?'}
			</span>
		);
	},
);

const PersonaPicture = observer(({persona, size = 40}: {persona: PersonaResponse; size?: number}) => {
	const user = Users.currentUser;
	if (!user) return null;
	if (!persona.avatar_hash) {
		return (
			<span
				className={styles.placeholderAvatar}
				aria-hidden="true"
				data-flx="persona.persona-import-review.persona-picture.placeholder-avatar"
			>
				{Array.from(persona.name.trim())[0] ?? '?'}
			</span>
		);
	}
	return (
		<PersonaAvatar
			user={user}
			persona={{avatar: persona.avatar_hash}}
			size={size}
			data-flx="persona.persona-import-review.persona-picture.persona-avatar"
		/>
	);
});

function MemberIdentity({
	entry,
	member,
	localUrl,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	localUrl?: string;
}) {
	const {i18n} = useLingui();
	const showsPicture = Boolean(entry.avatar_hash || localUrl);
	return (
		<div className={styles.identity} data-flx="persona.persona-import-review.member-identity.identity">
			<MemberPicture
				entry={entry}
				member={member}
				localUrl={localUrl}
				data-flx="persona.persona-import-review.member-identity.member-picture"
			/>
			<div className={styles.identityText} data-flx="persona.persona-import-review.member-identity.identity-text">
				<span className={styles.identityName} data-flx="persona.persona-import-review.member-identity.identity-name">
					{member.preview.name}
				</span>
				{member.preview.pronouns && (
					<span className={styles.identityMeta} data-flx="persona.persona-import-review.member-identity.identity-meta">
						{member.preview.pronouns}
					</span>
				)}
				<Tags tags={member.preview.persona_tags} data-flx="persona.persona-import-review.member-identity.tags" />
				{member.preview.bio && (
					<span className={styles.identityBio} data-flx="persona.persona-import-review.member-identity.identity-bio">
						{member.preview.bio}
					</span>
				)}
				{member.preview.avatar && !showsPicture && (
					<span
						className={styles.identityMeta}
						data-flx="persona.persona-import-review.member-identity.identity-meta--2"
					>
						{i18n._(NEW_PICTURE_DESCRIPTOR)}
					</span>
				)}
			</div>
		</div>
	);
}

function PersonaIdentity({persona, linkedElsewhere}: {persona: PersonaResponse; linkedElsewhere?: boolean}) {
	const {i18n} = useLingui();
	return (
		<div className={styles.identity} data-flx="persona.persona-import-review.persona-identity.identity">
			<PersonaPicture persona={persona} data-flx="persona.persona-import-review.persona-identity.persona-picture" />
			<div className={styles.identityText} data-flx="persona.persona-import-review.persona-identity.identity-text">
				<span className={styles.identityName} data-flx="persona.persona-import-review.persona-identity.identity-name">
					{persona.name}
				</span>
				{persona.pronouns && (
					<span className={styles.identityMeta} data-flx="persona.persona-import-review.persona-identity.identity-meta">
						{persona.pronouns}
					</span>
				)}
				<Tags tags={persona.persona_tags} data-flx="persona.persona-import-review.persona-identity.tags" />
				{persona.bio && (
					<span className={styles.identityBio} data-flx="persona.persona-import-review.persona-identity.identity-bio">
						{persona.bio}
					</span>
				)}
				<span
					className={styles.identityMeta}
					data-flx="persona.persona-import-review.persona-identity.identity-meta--2"
				>
					{i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0})}
				</span>
				{linkedElsewhere && (
					<span
						className={styles.identityMeta}
						data-flx="persona.persona-import-review.persona-identity.identity-meta--3"
					>
						{i18n._(LINKED_ELSEWHERE_DESCRIPTOR)}
					</span>
				)}
			</div>
		</div>
	);
}

interface ChoiceOption {
	key: string;
	label: string;
	hint?: string;
	safest?: boolean;
	disabled?: boolean;
	decision: ReviewDecision;
}

function sameDecision(a: ReviewDecision, b: ReviewDecision): boolean {
	if (a.choice !== b.choice) return false;
	if (a.choice === 'link' && b.choice === 'link') return a.personaId === b.personaId;
	if (a.choice === 'add' && b.choice === 'add') return a.withTags === b.withTags;
	return true;
}

function Choices({
	name,
	legend,
	options,
	current,
	onChange,
}: {
	name: string;
	legend: string;
	options: ReadonlyArray<ChoiceOption>;
	current: ReviewDecision;
	onChange: (decision: ReviewDecision) => void;
}) {
	const {i18n} = useLingui();
	return (
		<fieldset className={styles.choices} data-flx="persona.persona-import-review.choices.choices">
			<legend className={styles.legend} data-flx="persona.persona-import-review.choices.legend">
				{legend}
			</legend>
			{options.map((option) => (
				<label key={option.key} className={styles.choice} data-flx="persona.persona-import-review.choices.choice">
					<input
						type="radio"
						className={styles.choiceInput}
						name={name}
						checked={sameDecision(option.decision, current)}
						disabled={option.disabled}
						onChange={() => onChange(option.decision)}
						data-flx="persona.persona-import-review.choices.choice-input.change.radio"
					/>
					<span className={styles.choiceText} data-flx="persona.persona-import-review.choices.choice-text">
						<span className={styles.choiceLabel} data-flx="persona.persona-import-review.choices.choice-label">
							{option.label}
						</span>
						{option.hint && (
							<span className={styles.choiceHint} data-flx="persona.persona-import-review.choices.choice-hint">
								{option.hint}
							</span>
						)}
					</span>
					{option.safest && (
						<span className={styles.safest} data-flx="persona.persona-import-review.choices.safest">
							{i18n._(msg({message: 'Safest', comment: 'Badge on the safest choice in the import review'}))}
						</span>
					)}
				</label>
			))}
		</fieldset>
	);
}

function SectionHeader({
	id,
	number,
	hard,
	title,
	count,
}: {
	id: string;
	number: number;
	hard?: boolean;
	title: React.ReactNode;
	count?: number;
}) {
	return (
		<div className={styles.sectionHeader} data-flx="persona.persona-import-review.section-header.section-header">
			<span
				className={clsx(styles.sectionNumber, hard && styles.sectionNumberHard)}
				aria-hidden="true"
				data-flx="persona.persona-import-review.section-header.section-number"
			>
				{number}
			</span>
			<h3 className={styles.sectionTitle} id={id} data-flx="persona.persona-import-review.section-header.section-title">
				{title}
			</h3>
			{count !== undefined && (
				<span className={styles.sectionCount} data-flx="persona.persona-import-review.section-header.section-count">
					{count}
				</span>
			)}
			{hard && (
				<span className={styles.needsDecision} data-flx="persona.persona-import-review.section-header.needs-decision">
					<Trans comment="Badge on a section of the import review where every member needs a choice">
						Needs a decision
					</Trans>
				</span>
			)}
		</div>
	);
}

function listFormat(locale: string, items: ReadonlyArray<string>): string {
	try {
		return new Intl.ListFormat(locale, {type: 'conjunction', style: 'narrow'}).format(items);
	} catch {
		return items.join(', ');
	}
}

/** "Differs: name, bio · removes banner", or nothing when only information differs. */
function useDifferenceText(entry: PersonaImportPreviewEntry): string {
	const {i18n} = useLingui();
	const changed = (entry.differences ?? [])
		.filter((d) => d.change === 'changed')
		.map((d) => i18n._(FIELD_IN_SENTENCE[d.field]));
	const removed = (entry.differences ?? [])
		.filter((d) => d.change === 'removed')
		.map((d) => i18n._(FIELD_IN_SENTENCE[d.field]));
	const notCompared = (entry.differences ?? []).some((d) => d.change === 'not_compared');
	const parts: Array<string> = [];
	if (changed.length > 0) parts.push(i18n._(DIFFERS_DESCRIPTOR, {fields: listFormat(i18n.locale, changed)}));
	if (removed.length > 0) parts.push(i18n._(REMOVES_DESCRIPTOR, {fields: listFormat(i18n.locale, removed)}));
	if (notCompared) parts.push(i18n._(PICTURE_NOT_COMPARED_DESCRIPTOR));
	return parts.join(' · ');
}

function CompareTable({
	entry,
	member,
	persona,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember;
	persona: PersonaResponse;
}) {
	const {i18n} = useLingui();
	const differs = new Map((entry.differences ?? []).map((d) => [d.field, d.change]));
	const user = Users.currentUser;
	// A stored picture as a thumbnail; never one from a link in the file.
	const thumbnail = (field: 'avatar' | 'banner', hash: string | null | undefined): React.ReactNode => {
		if (!hash || !user) return null;
		if (field === 'avatar')
			return (
				<PersonaAvatar
					user={user}
					persona={{avatar: hash}}
					size={32}
					data-flx="persona.persona-import-review.thumbnail.persona-avatar"
				/>
			);
		const url = getPersonaBannerURL({userId: user.id, banner: hash}, false, 320);
		return url ? (
			<img
				className={styles.compareBanner}
				src={url}
				alt=""
				data-flx="persona.persona-import-review.thumbnail.compare-banner"
			/>
		) : null;
	};
	const picture = (
		field: 'avatar' | 'banner',
		tyneHash: string | null | undefined,
		fileHas: boolean,
		fileHash: string | null | undefined,
	): [React.ReactNode, React.ReactNode] => {
		const change = differs.get(field);
		const none = i18n._(NO_PICTURE_DESCRIPTOR);
		const tyne = thumbnail(field, tyneHash) ?? none;
		if (change === 'not_compared') return [tyne, i18n._(UNKNOWN_PICTURE_DESCRIPTOR)];
		if (change === 'removed') return [tyne, none];
		if (change === 'changed') {
			return [tyne, thumbnail(field, fileHash) ?? (fileHas ? i18n._(DIFFERENT_PICTURE_DESCRIPTOR) : none)];
		}
		if (!tyneHash && !fileHas) return [none, none];
		return [tyne, i18n._(SAME_PICTURE_DESCRIPTOR)];
	};
	const tags = (list: ReadonlyArray<PersonaTag> | null | undefined) => (list ?? []).map(tagText).join('  ') || '—';
	const rows: Array<[PersonaImportField, React.ReactNode, React.ReactNode]> = [
		['name', persona.name, member.preview.name],
		['pronouns', persona.pronouns ?? '—', member.preview.pronouns ?? '—'],
		['persona_tags', tags(persona.persona_tags), tags(member.preview.persona_tags)],
		['bio', persona.bio ?? '—', member.preview.bio ?? '—'],
		['avatar', ...picture('avatar', persona.avatar_hash, Boolean(member.preview.avatar), entry.avatar_hash)],
		['banner', ...picture('banner', persona.banner_hash, Boolean(member.preview.banner), entry.banner_hash)],
		[
			'color',
			persona.color != null ? `#${persona.color.toString(16).padStart(6, '0')}` : '—',
			member.preview.color != null ? `#${member.preview.color.toString(16).padStart(6, '0')}` : '—',
		],
		[
			'visibility',
			i18n._(VISIBILITY_NAMES[persona.visibility] ?? VISIBILITY_NAMES.unlisted!),
			member.preview.visibility
				? i18n._(VISIBILITY_KEPT_DESCRIPTOR, {
						visibility: i18n._(VISIBILITY_NAMES[member.preview.visibility] ?? VISIBILITY_NAMES.unlisted!),
					})
				: '—',
		],
	];
	return (
		<table className={styles.compareTable} data-flx="persona.persona-import-review.compare-table.compare-table">
			<thead data-flx="persona.persona-import-review.compare-table.thead">
				<tr data-flx="persona.persona-import-review.compare-table.tr">
					<th scope="col" data-flx="persona.persona-import-review.compare-table.th" />
					<th scope="col" data-flx="persona.persona-import-review.compare-table.th--2">
						<Trans comment="Column heading in the table comparing a persona with the import file">
							In this app now
						</Trans>
					</th>
					<th scope="col" data-flx="persona.persona-import-review.compare-table.th--3">
						<Trans comment="Column heading in the table comparing a persona with the import file">In your file</Trans>
					</th>
				</tr>
			</thead>
			<tbody data-flx="persona.persona-import-review.compare-table.tbody">
				{rows.map(([field, tyne, file]) => {
					const change = differs.get(field);
					return (
						<tr
							key={field}
							className={change === 'changed' || change === 'removed' ? styles.compareDiffers : undefined}
							data-flx="persona.persona-import-review.compare-table.compare-differs"
						>
							<th scope="row" data-flx="persona.persona-import-review.compare-table.th--4">
								{i18n._(FIELD_HEADING[field])}
							</th>
							<td data-flx="persona.persona-import-review.compare-table.td">{tyne}</td>
							<td data-flx="persona.persona-import-review.compare-table.td--2">{file}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
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
	}: PersonaImportReviewProps) => {
		const {i18n} = useLingui();
		const [showAllDiffers, setShowAllDiffers] = useState(false);
		const [showAllProbable, setShowAllProbable] = useState(false);
		const [comparing, setComparing] = useState<ReadonlySet<number>>(new Set());
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
		const untouched = preview.untouched;
		const decisionOf = (entry: PersonaImportPreviewEntry) => decisions.get(entry.index) ?? defaultDecision(entry);
		const decide = (entry: PersonaImportPreviewEntry, decision: ReviewDecision) => onDecide([[entry.index, decision]]);
		const linkedByOthers = (personaId: string, except: number) =>
			preview.entries.some((other) => {
				if (other.index === except) return false;
				const decision = decisions.get(other.index) ?? defaultDecision(other);
				return decision.choice === 'link' && decision.personaId === personaId;
			});
		const toggleCompare = (index: number) =>
			setComparing((current) => {
				const next = new Set(current);
				if (next.has(index)) next.delete(index);
				else next.add(index);
				return next;
			});
		const needCount = cantTell.length + tagInUse.length + differs.length + deleted.length + probable.length;
		const tagNeedsChoice = preview.display_tag.decision === 'ask';
		let sectionNumber = 0;
		const links: Array<{id: string; label: string; hard?: boolean}> = [];
		const addLink = (id: string, label: MessageDescriptor, count: number | null, hard?: boolean) =>
			links.push({id, label: count === null ? i18n._(label) : `${i18n._(label)} · ${count}`, hard});
		if (cantTell.length)
			addLink(
				'import-cant-tell',
				msg({message: "Can't tell", comment: 'Short name of a section of the import review'}),
				cantTell.length,
				true,
			);
		if (tagInUse.length)
			addLink(
				'import-tag-in-use',
				msg({message: 'Tag in use', comment: 'Short name of a section of the import review'}),
				tagInUse.length,
				true,
			);
		if (differs.length)
			addLink(
				'import-differs',
				msg({message: 'Differs', comment: 'Short name of a section of the import review'}),
				differs.length,
			);
		if (deleted.length)
			addLink(
				'import-deleted',
				msg({message: 'Deleted', comment: 'Short name of a section of the import review'}),
				deleted.length,
			);
		if (probable.length)
			addLink(
				'import-probable',
				msg({message: 'Probably the same', comment: 'Short name of a section of the import review'}),
				probable.length,
			);
		if (tagNeedsChoice)
			addLink(
				'import-display-tag',
				msg({message: 'Display tag', comment: 'Short name of a section of the import review'}),
				null,
			);
		if (fresh.length)
			addLink(
				'import-new',
				msg({message: 'New', comment: 'Short name of a section of the import review'}),
				fresh.length,
			);

		const removedChoice = (entry: PersonaImportPreviewEntry, member: ReviewMember): ChoiceOption | null => {
			const held = heldTags(entry);
			const shared = sharedTags(entry);
			const dropping = [...held, ...shared];
			if (dropping.length > 0) {
				return {
					key: 'add-without',
					label: i18n._(ADD_WITHOUT_TAG_DESCRIPTOR, {tags: listFormat(i18n.locale, dropping.map(tagText))}),
					hint: i18n._(
						msg({
							message: 'You can give it another tag later in Settings.',
							comment: 'Hint on the choice to add a member without its proxy tag, in the import review',
						}),
					),
					decision: {choice: 'add', withTags: false},
				};
			}
			return {
				key: 'add',
				label: i18n._(ADD_SEPARATELY_DESCRIPTOR),
				hint: i18n._(
					msg({
						message: 'You will have one more {name}.',
						comment: 'Hint on the choice to add a member as a separate persona, in the import review',
					}),
					{name: member.preview.name},
				),
				decision: {choice: 'add', withTags: true},
			};
		};
		const skipChoice: ChoiceOption = {
			key: 'skip',
			label: i18n._(SKIP_DESCRIPTOR),
			hint: i18n._(
				msg({
					message: 'Nothing changes. It stays in your file for next time.',
					comment: 'Hint on the choice to skip a member in the import review',
				}),
			),
			safest: true,
			decision: {choice: 'skip'},
		};

		return (
			<div className={styles.review} data-flx="persona.persona-import-review.review">
				<div className={styles.banner} role="note" data-flx="persona.persona-import-review.banner">
					<Warning
						size={22}
						weight="bold"
						className={styles.bannerIcon}
						aria-hidden="true"
						data-flx="persona.persona-import-review.banner-icon"
					/>
					<div data-flx="persona.persona-import-review.div">
						<div className={styles.bannerTitle} data-flx="persona.persona-import-review.banner-title">
							{tagNeedsChoice
								? i18n._(NEED_LOOK_WITH_TAG_DESCRIPTOR, {needCount})
								: i18n._(NEED_LOOK_DESCRIPTOR, {needCount})}
						</div>
						<div className={styles.bannerText} data-flx="persona.persona-import-review.banner-text">
							<Trans comment="Explanation at the top of the import review">
								Each one already has the safest choice picked, so nothing you have changes unless you choose it. Please
								read every section before importing. The hardest ones are at the top.
							</Trans>
						</div>
						<nav className={styles.sectionLinks} data-flx="persona.persona-import-review.section-links">
							{links.map((link) => (
								<button
									key={link.id}
									type="button"
									className={clsx(styles.sectionLink, link.hard && styles.sectionLinkHard)}
									onClick={() => document.getElementById(link.id)?.scrollIntoView({behavior: 'smooth', block: 'start'})}
									data-flx="persona.persona-import-review.section-link.scroll-into-view.button"
								>
									{link.label}
								</button>
							))}
						</nav>
					</div>
				</div>

				{conflicts.length > 0 && (
					<div className={styles.conflicts} role="alert" data-flx="persona.persona-import-review.conflicts">
						{conflicts.map((conflict) => {
							const names = listFormat(i18n.locale, conflict.names);
							const label = conflict.label;
							return (
								<div key={label} data-flx="persona.persona-import-review.div--2">
									<Trans comment="A clash in the import review. {label} is a proxy tag or emoji, {names} a list of persona names">
										{names} would all have {label}. Change one of the choices.
									</Trans>
								</div>
							);
						})}
					</div>
				)}

				{cantTell.length > 0 && (
					<section
						className={styles.section}
						aria-labelledby="import-cant-tell"
						data-flx="persona.persona-import-review.section"
					>
						<SectionHeader
							id="import-cant-tell"
							number={++sectionNumber}
							hard
							title={<Trans comment="Section of the import review">Can't tell if it's the same persona</Trans>}
							count={cantTell.length}
							data-flx="persona.persona-import-review.import-cant-tell"
						/>
						<p className={styles.explanation} data-flx="persona.persona-import-review.explanation">
							<Trans comment="Explanation of a section of the import review">
								Each of these shares a name or a tag with one of your personas, but not both, so it may be the same
								character or a different one. Compare them and choose. Skipped members stay in your file for next time.
							</Trans>
						</p>
						{cantTell.map((entry) => {
							const member = members[entry.index];
							if (!member) return null;
							const options: Array<ChoiceOption> = (entry.candidates ?? []).flatMap((candidate) => {
								const persona = personas.get(candidate.persona_id);
								if (!persona || !member.member.id) return [];
								return [
									{
										key: `link-${candidate.persona_id}`,
										label: i18n._(SAME_AS_DESCRIPTOR, {name: persona.name}),
										hint: candidate.linked_elsewhere
											? i18n._(LINKED_ELSEWHERE_DESCRIPTOR)
											: i18n._(
													msg({
														message: 'Your persona stays as it is; it is connected to this member.',
														comment: 'Hint on the choice to link a member to an existing persona, in the import review',
													}),
												),
										disabled: linkedByOthers(candidate.persona_id, entry.index),
										decision: {choice: 'link', personaId: candidate.persona_id},
									},
								];
							});
							const add = removedChoice(entry, member);
							if (add) options.push(add);
							options.push(skipChoice);
							return (
								<div key={entry.index} className={styles.card} data-flx="persona.persona-import-review.card">
									<div className={styles.compareGrid} data-flx="persona.persona-import-review.compare-grid">
										<div data-flx="persona.persona-import-review.div--3">
											<div className={styles.columnLabel} data-flx="persona.persona-import-review.column-label">
												<Trans comment="Column heading in the import review">In your file</Trans>
											</div>
											<MemberIdentity
												entry={entry}
												member={member}
												localUrl={localPictures.get(entry.index)}
												data-flx="persona.persona-import-review.member-identity"
											/>
										</div>
										<div data-flx="persona.persona-import-review.div--4">
											<div className={styles.columnLabel} data-flx="persona.persona-import-review.column-label--2">
												<Trans comment="Column heading in the import review">In this app</Trans>
											</div>
											{(entry.candidates ?? []).map((candidate) => {
												const persona = personas.get(candidate.persona_id);
												return persona ? (
													<PersonaIdentity
														key={candidate.persona_id}
														persona={persona}
														linkedElsewhere={candidate.linked_elsewhere}
														data-flx="persona.persona-import-review.persona-identity"
													/>
												) : null;
											})}
										</div>
									</div>
									<Choices
										name={`import-${entry.index}`}
										legend={i18n._(WHAT_TO_DO_DESCRIPTOR, {name: member.preview.name})}
										options={options}
										current={decisionOf(entry)}
										onChange={(decision) => decide(entry, decision)}
										data-flx="persona.persona-import-review.choices.decide"
									/>
								</div>
							);
						})}
					</section>
				)}

				{tagInUse.length > 0 && (
					<section
						className={styles.section}
						aria-labelledby="import-tag-in-use"
						data-flx="persona.persona-import-review.section--2"
					>
						<SectionHeader
							id="import-tag-in-use"
							number={++sectionNumber}
							hard
							title={<Trans comment="Section of the import review">Tag already in use</Trans>}
							count={tagInUse.length}
							data-flx="persona.persona-import-review.import-tag-in-use"
						/>
						<p className={styles.explanation} data-flx="persona.persona-import-review.explanation--2">
							<Trans comment="Explanation of a section of the import review">
								In this app each proxy tag belongs to one persona. These members have a tag another persona already has,
								or that another member of your file has too.
							</Trans>
						</p>
						{tagInUse.map((entry) => {
							const member = members[entry.index];
							if (!member) return null;
							const holders = (entry.clashes ?? []).flatMap((clash) => {
								if (!clash.tag) return [];
								const holder = clash.held_by_persona_id ? personas.get(clash.held_by_persona_id) : undefined;
								const other = clash.shared_with_member != null ? members[clash.shared_with_member] : undefined;
								return [{tag: clash.tag, name: holder?.name ?? other?.preview.name ?? '?', shared: !holder}];
							});
							const options: Array<ChoiceOption> = [skipChoice];
							const add = removedChoice(entry, member);
							if (add) options.push(add);
							if (heldTags(entry).length === 0 && sharedTags(entry).length > 0) {
								options.push({
									key: 'add-with',
									label: i18n._(
										msg({
											message: 'Add with the tag',
											comment:
												'Choice in the import review: add the member with a proxy tag another member of the file has too (that one then needs another choice)',
										}),
									),
									decision: {choice: 'add', withTags: true},
								});
							}
							return (
								<div key={entry.index} className={styles.card} data-flx="persona.persona-import-review.card--2">
									<MemberIdentity
										entry={entry}
										member={member}
										localUrl={localPictures.get(entry.index)}
										data-flx="persona.persona-import-review.member-identity--2"
									/>
									{holders.map((holder) => {
										const tag = tagText(holder.tag);
										const name = holder.name;
										return (
											<div key={tag} className={styles.why} data-flx="persona.persona-import-review.why">
												{holder.shared ? (
													<Trans comment="Why a member is in the import review. {tag} is a proxy tag, {name} another member of the file">
														<code className={styles.tag} data-flx="persona.persona-import-review.tag">
															{tag}
														</code>{' '}
														is also used by {name} in your file.
													</Trans>
												) : (
													<Trans comment="Why a member is in the import review. {tag} is a proxy tag, {name} an existing persona">
														<code className={styles.tag} data-flx="persona.persona-import-review.tag--2">
															{tag}
														</code>{' '}
														already belongs to your persona {name}.
													</Trans>
												)}
											</div>
										);
									})}
									<Choices
										name={`import-${entry.index}`}
										legend={i18n._(WHAT_TO_DO_DESCRIPTOR, {name: member.preview.name})}
										options={options}
										current={decisionOf(entry)}
										onChange={(decision) => decide(entry, decision)}
										data-flx="persona.persona-import-review.choices.decide--2"
									/>
								</div>
							);
						})}
					</section>
				)}

				{differs.length > 0 && (
					<section
						className={styles.section}
						aria-labelledby="import-differs"
						data-flx="persona.persona-import-review.section--3"
					>
						<SectionHeader
							id="import-differs"
							number={++sectionNumber}
							title={<Trans comment="Section of the import review">Different in your file</Trans>}
							count={differs.length}
							data-flx="persona.persona-import-review.import-differs"
						/>
						<p className={styles.explanation} data-flx="persona.persona-import-review.explanation--3">
							<Trans comment="Explanation of a section of the import review">
								These came from your file before, but the file has different details now, or you changed them here
								since. There is no telling which side changed, so this app's version is kept unless you choose the
								file's for a persona. The file's version replaces that persona's details; its messages, history,
								visibility and signature emojis stay, and so does any picture that can't be downloaded.
							</Trans>
						</p>
						<div className={styles.groupButtons} data-flx="persona.persona-import-review.group-buttons">
							<Button
								variant="secondary"
								small
								onClick={() => onDecide(differs.map((entry) => [entry.index, {choice: 'keep'}]))}
								data-flx="persona.persona-import-review.button.decide"
							>
								<Trans comment="Button in the import review: keep every listed persona as it is">
									Keep this version for all
								</Trans>
							</Button>
						</div>
						<div className={styles.rows} data-flx="persona.persona-import-review.rows">
							{(showAllDiffers ? differs : differs.slice(0, 3)).map((entry) => (
								<DiffersRow
									key={entry.index}
									entry={entry}
									member={members[entry.index]}
									persona={entry.persona_id ? personas.get(entry.persona_id) : undefined}
									decision={decisionOf(entry)}
									onDecide={(decision) => decide(entry, decision)}
									comparing={comparing.has(entry.index)}
									onToggleCompare={() => toggleCompare(entry.index)}
									data-flx="persona.persona-import-review.differs-row"
								/>
							))}
							{differs.length > 3 && (
								<button
									type="button"
									className={styles.moreButton}
									onClick={() => setShowAllDiffers((v) => !v)}
									data-flx="persona.persona-import-review.more-button.set-show-all-differs"
								>
									{showAllDiffers
										? i18n._(SHOW_FEWER_DESCRIPTOR)
										: i18n._(SHOW_MORE_DESCRIPTOR, {count: differs.length - 3})}
								</button>
							)}
						</div>
					</section>
				)}

				{deleted.length > 0 && (
					<section
						className={styles.section}
						aria-labelledby="import-deleted"
						data-flx="persona.persona-import-review.section--4"
					>
						<SectionHeader
							id="import-deleted"
							number={++sectionNumber}
							title={<Trans comment="Section of the import review">You deleted these</Trans>}
							count={deleted.length}
							data-flx="persona.persona-import-review.import-deleted"
						/>
						<p className={styles.explanation} data-flx="persona.persona-import-review.explanation--4">
							<Trans comment="Explanation of a section of the import review">
								They stay deleted unless you restore them. Restoring brings the same persona back as it was, with its
								old messages and usage, instead of making a copy.
							</Trans>
						</p>
						{deleted.length > 1 && (
							<div className={styles.groupButtons} data-flx="persona.persona-import-review.group-buttons--2">
								<Button
									variant="secondary"
									small
									onClick={() => onDecide(deleted.map((entry) => [entry.index, {choice: 'restore'}]))}
									data-flx="persona.persona-import-review.button.decide--2"
								>
									{i18n._(RESTORE_ALL_DESCRIPTOR, {count: deleted.length})}
								</Button>
							</div>
						)}
						<div className={styles.rows} data-flx="persona.persona-import-review.rows--2">
							{deleted.map((entry) => {
								const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
								if (!persona) return null;
								const deletedAt = persona.deleted_at ? new Date(persona.deleted_at) : null;
								return (
									<div key={entry.index} className={styles.row} data-flx="persona.persona-import-review.row">
										<div className={styles.rowMain} data-flx="persona.persona-import-review.row-main">
											<PersonaPicture
												persona={persona}
												size={36}
												data-flx="persona.persona-import-review.persona-picture"
											/>
											<div className={styles.rowText} data-flx="persona.persona-import-review.row-text">
												<span className={styles.rowName} data-flx="persona.persona-import-review.row-name">
													{persona.name}
												</span>
												<span className={styles.rowMeta} data-flx="persona.persona-import-review.row-meta">
													{[
														deletedAt
															? i18n._(DELETED_ON_DESCRIPTOR, {date: deletedAt.toLocaleDateString(i18n.locale)})
															: null,
														i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0}),
													]
														.filter(Boolean)
														.join(' · ')}
												</span>
											</div>
											<select
												className={styles.select}
												aria-label={i18n._(WHAT_TO_DO_SHORT_DESCRIPTOR, {name: persona.name})}
												value={decisionOf(entry).choice === 'restore' ? 'restore' : 'keep'}
												onChange={(e) => decide(entry, {choice: e.target.value === 'restore' ? 'restore' : 'keep'})}
												data-flx="persona.persona-import-review.select.decide"
											>
												<option value="keep" data-flx="persona.persona-import-review.option">
													{i18n._(LEAVE_DELETED_DESCRIPTOR)}
												</option>
												<option value="restore" data-flx="persona.persona-import-review.option--2">
													{i18n._(RESTORE_DESCRIPTOR)}
												</option>
											</select>
										</div>
									</div>
								);
							})}
						</div>
					</section>
				)}

				{probable.length > 0 && (
					<section
						className={styles.section}
						aria-labelledby="import-probable"
						data-flx="persona.persona-import-review.section--5"
					>
						<SectionHeader
							id="import-probable"
							number={++sectionNumber}
							title={<Trans comment="Section of the import review">Probably the same persona</Trans>}
							count={probable.length}
							data-flx="persona.persona-import-review.import-probable"
						/>
						<p className={styles.explanation} data-flx="persona.persona-import-review.explanation--5">
							<Trans comment="Explanation of a section of the import review">
								Same name and same tag as one of your personas, but not connected to your file yet, for example because
								you made them by hand. Linking only records which member of the file each one is, so future imports
								recognise it. Nothing in the persona changes.
							</Trans>
						</p>
						{probable.length > 1 && (
							<div className={styles.groupButtons} data-flx="persona.persona-import-review.group-buttons--3">
								<Button
									variant="secondary"
									small
									onClick={() =>
										onDecide(
											probable.flatMap((entry) =>
												entry.persona_id ? [[entry.index, {choice: 'link', personaId: entry.persona_id}]] : [],
											),
										)
									}
									data-flx="persona.persona-import-review.button.decide--3"
								>
									{i18n._(LINK_ALL_DESCRIPTOR, {count: probable.length})}
								</Button>
							</div>
						)}
						<div className={styles.rows} data-flx="persona.persona-import-review.rows--3">
							{(showAllProbable ? probable : probable.slice(0, 4)).map((entry) => {
								const persona = entry.persona_id ? personas.get(entry.persona_id) : undefined;
								const member = members[entry.index];
								if (!persona || !member) return null;
								const decision = decisionOf(entry);
								const held = heldTags(entry);
								return (
									<div key={entry.index} className={styles.row} data-flx="persona.persona-import-review.row--2">
										<div className={styles.rowMain} data-flx="persona.persona-import-review.row-main--2">
											<PersonaPicture
												persona={persona}
												size={36}
												data-flx="persona.persona-import-review.persona-picture--2"
											/>
											<div className={styles.rowText} data-flx="persona.persona-import-review.row-text--2">
												<span className={styles.rowName} data-flx="persona.persona-import-review.row-name--2">
													{persona.name}
												</span>
												<span className={styles.rowMeta} data-flx="persona.persona-import-review.row-meta--2">
													<Tags tags={member.preview.persona_tags} data-flx="persona.persona-import-review.tags" />
												</span>
											</div>
											<select
												className={styles.select}
												aria-label={i18n._(WHAT_TO_DO_SHORT_DESCRIPTOR, {name: persona.name})}
												value={decision.choice}
												onChange={(e) => {
													const value = e.target.value;
													if (value === 'link') decide(entry, {choice: 'link', personaId: persona.id});
													else if (value === 'add') decide(entry, {choice: 'add', withTags: false});
													else decide(entry, {choice: 'skip'});
												}}
												data-flx="persona.persona-import-review.select"
											>
												<option value="link" data-flx="persona.persona-import-review.option--3">
													{i18n._(LINK_DESCRIPTOR)}
												</option>
												<option value="add" data-flx="persona.persona-import-review.option--4">
													{held.length > 0
														? i18n._(ADD_WITHOUT_TAG_DESCRIPTOR, {tags: listFormat(i18n.locale, held.map(tagText))})
														: i18n._(ADD_SEPARATELY_DESCRIPTOR)}
												</option>
												<option value="skip" data-flx="persona.persona-import-review.option--5">
													{i18n._(SKIP_SHORT_DESCRIPTOR)}
												</option>
											</select>
										</div>
									</div>
								);
							})}
							{probable.length > 4 && (
								<button
									type="button"
									className={styles.moreButton}
									onClick={() => setShowAllProbable((v) => !v)}
									data-flx="persona.persona-import-review.more-button.set-show-all-probable"
								>
									{showAllProbable
										? i18n._(SHOW_FEWER_DESCRIPTOR)
										: i18n._(SHOW_MORE_DESCRIPTOR, {count: probable.length - 4})}
								</button>
							)}
						</div>
					</section>
				)}

				{tagNeedsChoice && (
					<section
						className={styles.section}
						aria-labelledby="import-display-tag"
						data-flx="persona.persona-import-review.section--6"
					>
						<SectionHeader
							id="import-display-tag"
							number={++sectionNumber}
							title={<Trans comment="Section of the import review">Display tag</Trans>}
							data-flx="persona.persona-import-review.import-display-tag"
						/>
						<p className={styles.explanation} data-flx="persona.persona-import-review.explanation--6">
							<Trans comment="Explanation of a section of the import review">
								Your account has one display tag, shown after every persona's name. The file's system tag is different.
							</Trans>
						</p>
						<Choices
							name="import-display-tag-choice"
							legend={i18n._(
								msg({message: 'Display tag', comment: 'Heading of the display tag choice in the import review'}),
							)}
							options={[
								{
									key: 'keep',
									label: i18n._(
										msg({
											message: 'Keep yours: {tag}',
											comment: 'Choice in the import review: keep the display tag {tag}',
										}),
										{tag: preview.display_tag.current_text ?? '—'},
									),
									safest: true,
									decision: {choice: 'keep'},
								},
								{
									key: 'file',
									label: i18n._(
										msg({
											message: "Use the file's: {tag}",
											comment: "Choice in the import review: use the import file's system tag {tag} as the display tag",
										}),
										{tag: fileTagText ?? '—'},
									),
									decision: {choice: 'use_file'},
								},
							]}
							current={displayTagChoice === 'file' ? {choice: 'use_file'} : {choice: 'keep'}}
							onChange={(decision) => onDisplayTagChoice(decision.choice === 'use_file' ? 'file' : 'keep')}
							data-flx="persona.persona-import-review.choices.display-tag-choice"
						/>
					</section>
				)}

				{fresh.length > 0 && (
					<section
						className={styles.section}
						aria-labelledby="import-new"
						data-flx="persona.persona-import-review.section--7"
					>
						<SectionHeader
							id="import-new"
							number={++sectionNumber}
							title={<Trans comment="Section of the import review">New in your file</Trans>}
							count={fresh.length}
							data-flx="persona.persona-import-review.import-new"
						/>
						<p className={styles.explanation} data-flx="persona.persona-import-review.explanation--7">
							<Trans comment="Explanation of a section of the import review">
								Members you don't have yet, with no name or tag clash. Untick any you don't want.
							</Trans>
						</p>
						<div className={styles.newGrid} data-flx="persona.persona-import-review.new-grid">
							{fresh.map((entry) => {
								const member = members[entry.index];
								if (!member) return null;
								const checked = decisionOf(entry).choice === 'add';
								return (
									<label key={entry.index} className={styles.choice} data-flx="persona.persona-import-review.choice">
										<input
											type="checkbox"
											className={styles.choiceInput}
											checked={checked}
											onChange={() => decide(entry, checked ? {choice: 'skip'} : {choice: 'add', withTags: true})}
											data-flx="persona.persona-import-review.choice-input.decide.checkbox"
										/>
										<span className={styles.choiceText} data-flx="persona.persona-import-review.choice-text">
											<span className={styles.choiceLabel} data-flx="persona.persona-import-review.choice-label">
												{member.preview.name}
											</span>
											<Tags tags={member.preview.persona_tags} data-flx="persona.persona-import-review.tags--2" />
										</span>
									</label>
								);
							})}
						</div>
					</section>
				)}

				<div className={styles.closing} data-flx="persona.persona-import-review.closing">
					{upToDate > 0 && (
						<div className={styles.closingLine} data-flx="persona.persona-import-review.closing-line">
							<CheckCircle size={18} aria-hidden="true" data-flx="persona.persona-import-review.check-circle" />
							<Trans comment="Closing line of the import review. {upToDate} is a number of members">
								{upToDate} members match their persona exactly. Nothing to do.
							</Trans>
						</div>
					)}
					{preview.untouched > 0 && (
						<div className={styles.closingLine} data-flx="persona.persona-import-review.closing-line--2">
							<ShieldCheck size={18} aria-hidden="true" data-flx="persona.persona-import-review.shield-check" />
							<Trans comment="Closing line of the import review. {untouched} is a number of personas">
								{untouched} of your personas aren't in this file. They stay as they are.
							</Trans>
						</div>
					)}
				</div>
			</div>
		);
	},
);

function DiffersRow({
	entry,
	member,
	persona,
	decision,
	onDecide,
	comparing,
	onToggleCompare,
}: {
	entry: PersonaImportPreviewEntry;
	member: ReviewMember | undefined;
	persona: PersonaResponse | undefined;
	decision: ReviewDecision;
	onDecide: (decision: ReviewDecision) => void;
	comparing: boolean;
	onToggleCompare: () => void;
}) {
	const {i18n} = useLingui();
	const text = useDifferenceText(entry);
	if (!member || !persona) return null;
	return (
		<div className={styles.row} data-flx="persona.persona-import-review.differs-row.row">
			<div className={styles.rowMain} data-flx="persona.persona-import-review.differs-row.row-main">
				<PersonaPicture
					persona={persona}
					size={36}
					data-flx="persona.persona-import-review.differs-row.persona-picture"
				/>
				<div className={styles.rowText} data-flx="persona.persona-import-review.differs-row.row-text">
					<span className={styles.rowName} data-flx="persona.persona-import-review.differs-row.row-name">
						{persona.name}
					</span>
					<span className={styles.rowMeta} data-flx="persona.persona-import-review.differs-row.row-meta">
						{text}
					</span>
				</div>
				<button
					type="button"
					className={styles.linkButton}
					aria-expanded={comparing}
					onClick={onToggleCompare}
					data-flx="persona.persona-import-review.differs-row.link-button.toggle-compare"
				>
					{comparing ? i18n._(HIDE_COMPARISON_DESCRIPTOR) : i18n._(COMPARE_DESCRIPTOR)}
				</button>
				<select
					className={styles.select}
					aria-label={i18n._(WHAT_TO_DO_SHORT_DESCRIPTOR, {name: persona.name})}
					value={decision.choice === 'use_file' ? 'use_file' : 'keep'}
					onChange={(e) => onDecide({choice: e.target.value === 'use_file' ? 'use_file' : 'keep'})}
					data-flx="persona.persona-import-review.differs-row.select.decide"
				>
					<option value="keep" data-flx="persona.persona-import-review.differs-row.option">
						{i18n._(KEEP_TYNE_DESCRIPTOR)}
					</option>
					<option value="use_file" data-flx="persona.persona-import-review.differs-row.option--2">
						{i18n._(USE_FILE_DESCRIPTOR)}
					</option>
				</select>
			</div>
			{comparing && (
				<CompareTable
					entry={entry}
					member={member}
					persona={persona}
					data-flx="persona.persona-import-review.differs-row.compare-table"
				/>
			)}
		</div>
	);
}
