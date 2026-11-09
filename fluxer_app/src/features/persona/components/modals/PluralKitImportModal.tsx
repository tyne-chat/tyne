// SPDX-License-Identifier: AGPL-3.0-or-later

// The persona import (tyne-chat/tyne#243): choose a file and press Import. The server classifies
// every member first (one request, which changes nothing); when nothing needs a decision the import
// is applied at once, otherwise the review opens, every member on its safest choice. Pictures are
// stored only for the members whose choice needs them, then the whole import is one request, written
// whole or not at all. Nothing in here deletes a persona.

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import {PRODUCT_NAME} from '@app/features/app/config/ProductConstants';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {downloadBlob} from '@app/features/platform/utils/DownloadFile';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import Users from '@app/features/user/state/Users';
import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaImportPreviewResponse} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {CheckCircle, DownloadSimple, ShieldCheck, UploadSimple, Warning} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useMemo, useRef, useState} from 'react';
import * as PersonaCommands from '../../commands/PersonaCommands';
import {PersonaStore} from '../../state/PersonaStore';
import {type PersonaImportSource, readPersonaImportFile} from '../../utils/PersonaImportFile';
import {
	type PictureProgress,
	type StoredFilePictures,
	storeMemberPictures,
	storeTagIcon,
} from '../../utils/PersonaImportImages';
import {
	allPictures,
	buildActions,
	buildPreviewRequest,
	defaultDecision,
	findConflicts,
	picturesNeeded,
	type ReviewDecision,
	type ReviewMember,
	type ReviewSummary,
	reviewNeedCount,
	sourceKindOf,
	summarize,
} from '../../utils/PersonaImportReview';
import {PersonaImportReview} from './PersonaImportReview';
import reviewStyles from './PersonaImportReview.module.css';
import styles from './PluralKitImportModal.module.css';

const PROGRESS_ITEMS_DESCRIPTOR = msg({
	message: 'items',
	comment: 'What the import progress counts when no more specific name is known, as in "3 of 10 items (30%)"',
});
const FILE_INVALID_JSON_DESCRIPTOR = msg({
	message: 'The chosen file is not a valid JSON object.',
	comment: 'Error message when uploaded file is not valid JSON',
});
const FILE_NO_MEMBERS_DESCRIPTOR = msg({
	message: 'No "members" array found in this export file.',
	comment: 'Error message when PluralKit export lacks members array',
});
const FILE_PARSE_FAILED_DESCRIPTOR = msg({
	message: 'Failed to parse JSON file. Please ensure it is a valid PluralKit export.',
	comment: 'Error message when parsing PluralKit JSON fails',
});
const FILE_READ_FAILED_DESCRIPTOR = msg({
	message: 'Failed to read the selected file.',
	comment: 'Error message when reading uploaded file fails',
});
const AVATARS_DOWNLOADED_LABEL = msg({
	message: 'avatars downloaded',
	comment: 'Progress label for avatar downloads',
});
const SAVING_PERSONAS_STATUS = msg({
	message: 'Saving personas...',
	comment: 'Progress status when saving personas',
});
const SAVING_PERSONAS_LABEL = msg({
	message: 'saving personas',
	comment: 'Progress label when saving personas',
});
const SKIPPED_NO_NAME_DESCRIPTOR = msg({
	message: 'Skipped member because they have no name configured.',
	comment: 'Import warning when member has no name',
});
const FAILED_TO_IMPORT_DESCRIPTOR = msg({
	message: 'Failed to import personas',
	comment: 'Toast error message on persona import failure',
});
const ZIP_UNREADABLE_DESCRIPTOR = msg({
	message: 'This .zip file could not be read.',
	comment: 'Error in the persona import dialog when the chosen .zip file is damaged',
});
const ZIP_NOT_EXPORT_DESCRIPTOR = msg({
	message: 'This .zip file is not a persona export from {productName}.',
	comment:
		'Error in the persona import dialog when the chosen .zip file is not a persona export. Preserve {productName}; it is the app name, inserted by code.',
});
const BANNERS_DOWNLOADED_LABEL = msg({
	message: 'banners downloaded',
	comment: 'Progress label for banner downloads during persona import',
});
const IMAGES_STORED_LABEL = msg({
	message: 'images stored',
	comment: 'Progress label while the images inside an imported persona export are stored',
});
const TAG_ICON_LABEL_DESCRIPTOR = msg({
	message: 'Tag Icon',
	comment: 'Names the display tag icon in the list of import warnings, where personas are named otherwise',
});
const TAG_ICON_FAILED_DESCRIPTOR = msg({
	message: 'The tag icon could not be stored: {error}. It can be set again in the persona settings.',
	comment:
		'Import warning when the icon of the display tag in a Tyne export could not be stored. {error} is the reason, inserted by code.',
});
const DROPPED_TAGS_DESCRIPTOR = msg({
	message: 'Some proxy tags were left out: {productName} allows up to 5 per persona, each at most 32 characters.',
	comment:
		'Import warning when a PluralKit member has more or longer proxy tags than a persona can have. Preserve {productName}; it is the app name, inserted by code.',
});
const AVATAR_FAILED_DESCRIPTOR = msg({
	message: 'Avatar image failed to download: {error}. Persona was imported without an avatar.',
	comment: 'Import warning when avatar fails to download',
});
const BANNER_FAILED_DESCRIPTOR = msg({
	message: 'Banner image failed to download: {error}. Persona was imported without a banner.',
	comment: 'Import warning when a persona banner fails to download',
});
const AVATAR_KEPT_DESCRIPTOR = msg({
	message: 'Avatar image failed to download: {error}. The persona kept the avatar it had.',
	comment: "Import warning when the file's avatar for an existing persona fails to download, so the old one stays",
});
const BANNER_KEPT_DESCRIPTOR = msg({
	message: 'Banner image failed to download: {error}. The persona kept the banner it had.',
	comment: "Import warning when the file's banner for an existing persona fails to download, so the old one stays",
});
const RESTORED_WITHOUT_DESCRIPTOR = msg({
	message: 'Came back without {items}: another persona has them now.',
	comment: 'Import warning for a restored persona whose proxy tags or signature emojis another persona took meanwhile',
});
const MEMBER_INDEX_DESCRIPTOR = msg({
	message: 'Member #{index}',
	comment: 'Placeholder name for unnamed member in import',
});
const STORING_FROM_FILE_DESCRIPTOR = msg({
	message: 'Storing image {current} of {total} from the file...',
	comment: 'Progress status while the images inside an imported persona export are stored',
});
const DOWNLOADING_AVATAR_DESCRIPTOR = msg({
	message: 'Downloading avatar {current} of {total}...',
	comment: 'Progress status during avatar download',
});
const DOWNLOADING_BANNER_DESCRIPTOR = msg({
	message: 'Downloading banner {current} of {total}...',
	comment: 'Progress status during banner download in the persona import',
});
const SUMMARY_LINK_DESCRIPTOR = msg({
	message: 'link {count}',
	comment: 'Part of the import summary "Import will link 17, add 7, skip 3"',
});
const SUMMARY_ADD_DESCRIPTOR = msg({
	message: 'add {count}',
	comment: 'Part of the import summary "Import will link 17, add 7, skip 3"',
});
const SUMMARY_RESTORE_DESCRIPTOR = msg({
	message: 'restore {count}',
	comment: 'Part of the import summary "Import will link 17, restore 2, skip 3"',
});
const SUMMARY_USE_FILE_DESCRIPTOR = msg({
	message: "use the file's version for {count}",
	comment: 'Part of the import summary "Import will link 17, use the file\'s version for 2"',
});
const SUMMARY_SKIP_DESCRIPTOR = msg({
	message: 'skip {count}',
	comment: 'Part of the import summary "Import will link 17, add 7, skip 3"',
});
const SUMMARY_DISPLAY_TAG_DESCRIPTOR = msg({
	message: 'change your display tag',
	comment: 'Part of the import summary "Import will add 7 and change your display tag"',
});
const SUMMARY_MAIN_DESCRIPTOR = msg({
	message: 'Import will {actions}',
	comment: 'Summary in the import review footer. {actions} is a list such as "link 17, add 7, skip 3"',
});
const SUMMARY_NOTHING_DESCRIPTOR = msg({
	message: 'Import will change nothing',
	comment: 'Summary in the import review footer when every choice leaves things as they are',
});
const SUMMARY_KEPT_DESCRIPTOR = msg({
	message: '{count, plural, one {# persona stays as it is} other {# personas stay as they are}}',
	comment: 'Second line of the import review footer',
});
const SUMMARY_STAY_DELETED_DESCRIPTOR = msg({
	message: '{count} stay deleted',
	comment: 'Second line of the import review footer: deleted personas that are not restored',
});

const PROGRESS_STATUS = {
	zip: STORING_FROM_FILE_DESCRIPTOR,
	avatar: DOWNLOADING_AVATAR_DESCRIPTOR,
	banner: DOWNLOADING_BANNER_DESCRIPTOR,
};
const PROGRESS_LABEL = {zip: IMAGES_STORED_LABEL, avatar: AVATARS_DOWNLOADED_LABEL, banner: BANNERS_DOWNLOADED_LABEL};
const PICTURE_FAILED = {avatar: AVATAR_FAILED_DESCRIPTOR, banner: BANNER_FAILED_DESCRIPTOR};
const PICTURE_KEPT = {avatar: AVATAR_KEPT_DESCRIPTOR, banner: BANNER_KEPT_DESCRIPTOR};

interface ImportWarning {
	displayName: string;
	prefix?: string;
	reason: string;
}

interface ImportResult {
	reviewed: boolean;
	summary: ReviewSummary;
	added: Array<{name: string; tags: Array<PersonaTag>}>;
	warnings: Array<ImportWarning>;
}

function listFormat(locale: string, items: ReadonlyArray<string>): string {
	try {
		return new Intl.ListFormat(locale, {type: 'conjunction'}).format(items);
	} catch {
		return items.join(', ');
	}
}

const EXPORT_FAILED_DESCRIPTOR = msg({
	message: 'Could not export your personas.',
	comment: 'Toast when downloading the persona export fails',
});
const STOP_IMPORT_TITLE_DESCRIPTOR = msg({
	message: 'Stop this import?',
	comment: 'Title of the confirmation when the persona import review is closed before importing',
});
const STOP_IMPORT_BODY_DESCRIPTOR = msg({
	message: 'Your choices for these members will be lost, and nothing is imported.',
	comment: 'Text of the confirmation when the persona import review is closed before importing',
});
const STOP_IMPORT_PRIMARY_DESCRIPTOR = msg({
	message: 'Stop importing',
	comment: 'Button that closes the persona import review without importing',
});
const KEEP_REVIEWING_DESCRIPTOR = msg({
	message: 'Keep reviewing',
	comment: 'Button that goes back to the persona import review',
});

function summaryLines(i18n: I18n, summary: ReviewSummary, changesTag: boolean): {main: string; rest: string} {
	const parts: Array<string> = [];
	if (summary.link) parts.push(i18n._(SUMMARY_LINK_DESCRIPTOR, {count: summary.link}));
	if (summary.add) parts.push(i18n._(SUMMARY_ADD_DESCRIPTOR, {count: summary.add}));
	if (summary.restore) parts.push(i18n._(SUMMARY_RESTORE_DESCRIPTOR, {count: summary.restore}));
	if (summary.useFile) parts.push(i18n._(SUMMARY_USE_FILE_DESCRIPTOR, {count: summary.useFile}));
	if (summary.skip) parts.push(i18n._(SUMMARY_SKIP_DESCRIPTOR, {count: summary.skip}));
	if (changesTag) parts.push(i18n._(SUMMARY_DISPLAY_TAG_DESCRIPTOR));
	const rest: Array<string> = [];
	if (summary.kept) rest.push(i18n._(SUMMARY_KEPT_DESCRIPTOR, {count: summary.kept}));
	if (summary.stayDeleted) rest.push(i18n._(SUMMARY_STAY_DELETED_DESCRIPTOR, {count: summary.stayDeleted}));
	return {
		main:
			parts.length > 0
				? i18n._(SUMMARY_MAIN_DESCRIPTOR, {actions: listFormat(i18n.locale, parts)})
				: i18n._(SUMMARY_NOTHING_DESCRIPTOR),
		rest: rest.join(' · '),
	};
}

function tagText(tag: PersonaTag): string {
	return `${(tag.prefix ?? '').trim()}text${(tag.suffix ?? '').trim()}`;
}

export const PluralKitImportModal: React.FC<{onClose: () => void}> = observer(({onClose}) => {
	const {i18n} = useLingui();
	const [step, setStep] = useState<'select' | 'backup' | 'checking' | 'review' | 'importing' | 'completed'>('select');
	// Before an import into an account that has personas, a backup is offered once.
	const [backupOffered, setBackupOffered] = useState(false);
	const [exporting, setExporting] = useState(false);
	// This dialog's place in the modal stack, to close it under the "Stop this import?" confirmation.
	const [ownModalKey] = useState(() => ModalCommands.getTopModalKey());
	const [fileName, setFileName] = useState<string | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [source, setSource] = useState<PersonaImportSource | null>(null);
	const [preview, setPreview] = useState<PersonaImportPreviewResponse | null>(null);
	const [reviewMembers, setReviewMembers] = useState<Array<ReviewMember>>([]);
	const [decisions, setDecisions] = useState<ReadonlyMap<number, ReviewDecision>>(new Map());
	const [displayTagChoice, setDisplayTagChoice] = useState<'keep' | 'file'>('keep');
	const [fileTagText, setFileTagText] = useState<string | null>(null);
	const [progress, setProgress] = useState<{
		current: number;
		total: number;
		currentName: string;
		percent: number;
		label?: string;
	}>({current: 0, total: 0, currentName: '', percent: 0});
	const [result, setResult] = useState<ImportResult | null>(null);
	// The file's pictures, stored before the review (tyne-chat/tyne#567); kept for the file they came
	// from, so going back and importing again stores nothing twice.
	const storedFor = useRef<{source: PersonaImportSource; pictures: StoredFilePictures} | null>(null);
	const [storingPictures, setStoringPictures] = useState(false);

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const productName = PRODUCT_NAME;
	const members = source?.system.members ?? [];
	const namedCount = members.filter((member) => member.name !== null).length;

	// The account's personas with the live ones the preview names, as the review checks tags against.
	const conflicts = useMemo(() => {
		if (!preview || !source) return [];
		const live = new Map(PersonaStore.personas.map((persona) => [persona.id, persona]));
		for (const persona of preview.personas) if (!persona.deleted_at) live.set(persona.id, persona);
		return findConflicts(preview.entries, decisions, reviewMembers, [...live.values()], source.kind === 'bundle');
	}, [preview, source, decisions, reviewMembers, PersonaStore.personas]);

	const handleFileChosen = async (file: File) => {
		setFileError(null);
		setFileName(file.name);
		setSource(null);
		let read: Awaited<ReturnType<typeof readPersonaImportFile>>;
		try {
			read = await readPersonaImportFile(file);
		} catch {
			setFileError(i18n._(FILE_READ_FAILED_DESCRIPTOR));
			return;
		}
		if (!read.ok) {
			const descriptor = {
				not_object: FILE_INVALID_JSON_DESCRIPTOR,
				no_members: FILE_NO_MEMBERS_DESCRIPTOR,
				invalid_json: FILE_PARSE_FAILED_DESCRIPTOR,
				zip_unreadable: ZIP_UNREADABLE_DESCRIPTOR,
				zip_not_export: ZIP_NOT_EXPORT_DESCRIPTOR,
			}[read.error];
			setFileError(i18n._(descriptor, {productName: PRODUCT_NAME}));
			return;
		}
		setSource(read.source);
	};

	const showPictureProgress = (p: PictureProgress) => {
		const descriptor = PROGRESS_STATUS[p.phase];
		const label = PROGRESS_LABEL[p.phase];
		setProgress({
			current: p.done,
			total: p.total,
			currentName: i18n._(descriptor, {current: p.done, total: p.total}),
			percent: p.total > 0 ? Math.round((p.done / p.total) * 100) : 100,
			label: i18n._(label),
		});
	};

	const applyImport = async (
		chosenSource: PersonaImportSource,
		answer: PersonaImportPreviewResponse,
		memberList: ReadonlyArray<ReviewMember>,
		chosen: ReadonlyMap<number, ReviewDecision>,
		tagChoice: 'keep' | 'file',
		fileTag: string | null,
		pictures: StoredFilePictures,
	) => {
		setStep('importing');
		const warnings: Array<ImportWarning> = [];
		const ownUserId = Users.currentUser?.id ?? null;
		const mediaEndpoint = RuntimeConfig.mediaEndpoint;
		chosenSource.system.members.forEach((member, i) => {
			if (member.name === null) {
				warnings.push({
					displayName: i18n._(MEMBER_INDEX_DESCRIPTOR, {index: i + 1}),
					reason: i18n._(SKIPPED_NO_NAME_DESCRIPTOR),
				});
			}
		});

		// 1. The pictures were stored before the review; a failure is reported where the choice used it.
		const {stored, failures} = pictures;
		for (const entry of answer.entries) {
			const member = memberList[entry.index];
			if (!member) continue;
			const decision = chosen.get(entry.index) ?? defaultDecision(entry);
			const prefix = member.member.personaTags[0]?.prefix;
			const used = picturesNeeded(entry, decision);
			for (const kind of ['avatar', 'banner'] as const) {
				const error = failures.get(`${entry.index}:${kind}`);
				if (!error || !used[kind]) continue;
				const descriptor = (decision.choice === 'use_file' ? PICTURE_KEPT : PICTURE_FAILED)[kind];
				warnings.push({displayName: member.member.name, prefix, reason: i18n._(descriptor, {error})});
			}
			if (member.member.droppedTagCount > 0 && (decision.choice === 'add' || decision.choice === 'use_file')) {
				warnings.push({
					displayName: member.member.name,
					prefix,
					reason: i18n._(DROPPED_TAGS_DESCRIPTOR, {productName: PRODUCT_NAME}),
				});
			}
		}

		// 2. One request, written whole or not at all.
		const actions = buildActions(answer.entries, chosen, memberList, stored, answer.personas);
		setProgress({
			current: actions.length,
			total: actions.length,
			currentName: i18n._(SAVING_PERSONAS_STATUS),
			percent: 100,
			label: i18n._(SAVING_PERSONAS_LABEL),
		});
		try {
			const applied =
				actions.length > 0
					? await PersonaCommands.applyPersonaImport({source: sourceKindOf(chosenSource), actions})
					: {personas: [], dropped: []};
			for (const dropped of applied.dropped) {
				const persona = applied.personas.find((p) => p.id === dropped.persona_id);
				const items = [...dropped.tags.map(tagText), ...dropped.signature_emojis.map((emoji) => emoji.name)];
				if (persona && items.length > 0) {
					warnings.push({
						displayName: persona.name,
						reason: i18n._(RESTORED_WITHOUT_DESCRIPTOR, {items: listFormat(i18n.locale, items)}),
					});
				}
			}

			// 3. The display tag, when the file's is used: its icon is stored first, never linked.
			if (tagChoice === 'file') {
				const icon = await storeTagIcon(chosenSource, ownUserId, mediaEndpoint);
				if (icon.error) {
					warnings.push({
						displayName: i18n._(TAG_ICON_LABEL_DESCRIPTOR),
						reason: i18n._(TAG_ICON_FAILED_DESCRIPTOR, {error: icon.error}),
					});
				}
				if (fileTag || icon.hash !== undefined) {
					try {
						await PersonaStore.setDisplayTag(fileTag || PersonaStore.displayTagText, icon.hash);
					} catch {
						// The personas are in; the tag can be set again in Settings.
					}
				}
			}

			const added = answer.entries.flatMap((entry) => {
				const decision = chosen.get(entry.index) ?? defaultDecision(entry);
				const member = memberList[entry.index];
				return decision.choice === 'add' && member ? [{name: member.member.name, tags: member.member.personaTags}] : [];
			});
			setResult({reviewed: answer.needs_review, summary: summarize(answer.entries, chosen), added, warnings});
			setStep('completed');
		} catch (err: unknown) {
			const message = PersonaCommands.personaErrorMessage(err, i18n._(FAILED_TO_IMPORT_DESCRIPTOR));
			if (message) ToastCommands.error(message);
			setStep(answer.needs_review ? 'review' : 'select');
		}
	};

	const handleImport = () => {
		if (!source || namedCount === 0) return;
		if (!backupOffered && PersonaStore.personas.length > 0) {
			setBackupOffered(true);
			setStep('backup');
			return;
		}
		void startImport();
	};

	// The backup is the same zip as Export in the Personas settings; the import carries on once it is saved.
	const handleExportThenImport = async () => {
		setExporting(true);
		try {
			const {blob, fileName} = await PersonaCommands.exportPersonas();
			downloadBlob(blob, fileName);
		} catch {
			ToastCommands.error(i18n._(EXPORT_FAILED_DESCRIPTOR));
			return;
		} finally {
			setExporting(false);
		}
		void startImport();
	};

	const startImport = async () => {
		if (!source || namedCount === 0) return;
		setStep('checking');
		const ownUserId = Users.currentUser?.id ?? null;
		const mediaEndpoint = RuntimeConfig.mediaEndpoint;
		const {members: memberList} = buildPreviewRequest(source, ownUserId, mediaEndpoint);
		// 1. Every picture in the file, so the review compares and shows the real ones.
		let pictures = storedFor.current?.source === source ? storedFor.current.pictures : null;
		if (!pictures) {
			setStoringPictures(true);
			try {
				pictures = await storeMemberPictures(
					source,
					memberList,
					allPictures(memberList),
					ownUserId,
					mediaEndpoint,
					showPictureProgress,
				);
			} catch (err: unknown) {
				const message = PersonaCommands.personaErrorMessage(err, i18n._(FAILED_TO_IMPORT_DESCRIPTOR));
				if (message) ToastCommands.error(message);
				setStep('select');
				return;
			} finally {
				setStoringPictures(false);
			}
			storedFor.current = {source, pictures};
		}
		// 2. The comparison, with the stored pictures' hashes.
		const {request} = buildPreviewRequest(source, ownUserId, mediaEndpoint, pictures.stored);
		const tagText = request.display_tag?.text ?? null;
		setFileTagText(tagText);
		let answer: PersonaImportPreviewResponse;
		try {
			answer = await PersonaCommands.previewPersonaImport(request);
		} catch (err: unknown) {
			const message = PersonaCommands.personaErrorMessage(err, i18n._(FAILED_TO_IMPORT_DESCRIPTOR));
			if (message) ToastCommands.error(message);
			setStep('select');
			return;
		}
		setPreview(answer);
		setReviewMembers(memberList);
		setDecisions(new Map());
		setDisplayTagChoice('keep');
		if (answer.needs_review) {
			setStep('review');
			return;
		}
		await applyImport(
			source,
			answer,
			memberList,
			new Map(),
			answer.display_tag.decision === 'auto_apply' ? 'file' : 'keep',
			tagText,
			pictures,
		);
	};

	const handleApplyReviewed = () => {
		const pictures = storedFor.current?.source === source ? storedFor.current?.pictures : null;
		if (!source || !preview || !pictures || conflicts.length > 0) return;
		void applyImport(source, preview, reviewMembers, decisions, displayTagChoice, fileTagText, pictures);
	};

	const decide = (changes: ReadonlyArray<[number, ReviewDecision]>) =>
		setDecisions((current) => {
			const next = new Map(current);
			for (const [index, decision] of changes) next.set(index, decision);
			return next;
		});

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			void handleFileChosen(e.dataTransfer.files[0]);
		}
	};

	const visibilityCounts = {public: 0, unlisted: 0, private: 0};
	for (const member of members) visibilityCounts[member.visibility]++;
	const publicCount = visibilityCounts.public;
	const unlistedCount = visibilityCounts.unlisted;
	const privateCount = visibilityCounts.private;
	const membersWithAvatars = members.filter((member) => {
		if (member.avatarUrl !== null) return true;
		if (source?.kind !== 'bundle' || !member.id) return false;
		return Boolean(source.manifest.members[member.id]?.avatar);
	}).length;
	const systemName = source?.system.name ?? null;
	const systemTag = source?.system.tag ?? null;

	const titles = {
		select: msg({message: 'Import personas', comment: 'Title of the persona import dialog'}),
		backup: msg({message: 'Import personas', comment: 'Title of the persona import dialog'}),
		checking: msg({
			message: 'Checking your file...',
			comment: 'Title of the persona import dialog while the file is checked',
		}),
		review: msg({
			message: 'Check before importing',
			comment: 'Title of the persona import review when no member needs a choice, only the display tag',
		}),
		importing: msg({message: 'Importing Personas...', comment: 'Modal title for PluralKit import step importing'}),
		completed: msg({message: 'Import finished', comment: 'Title of the persona import dialog when the import is done'}),
	};
	const busy = step === 'checking' || step === 'importing';
	// While the review is open, a click outside, Escape or the close button asks first: the review can
	// hold many choices (tyne-chat/tyne#564). While importing, the dialog cannot be closed.
	const requestClose = () => {
		if (busy) return;
		if (step !== 'review') {
			onClose();
			return;
		}
		ModalCommands.push(
			ModalCommands.modal(() => (
				<ConfirmModal
					title={i18n._(STOP_IMPORT_TITLE_DESCRIPTOR)}
					description={i18n._(STOP_IMPORT_BODY_DESCRIPTOR)}
					primaryText={i18n._(STOP_IMPORT_PRIMARY_DESCRIPTOR)}
					primaryVariant="danger"
					secondaryText={i18n._(KEEP_REVIEWING_DESCRIPTOR)}
					onPrimary={() => {
						if (ownModalKey != null) ModalCommands.popWithKey(ownModalKey);
						else onClose();
					}}
					data-flx="persona.plural-kit-import-modal.request-close.confirm-modal"
				/>
			)),
		);
	};
	const footerSummary =
		step === 'review' && preview
			? summaryLines(i18n, summarize(preview.entries, decisions), displayTagChoice === 'file')
			: null;
	const addedCount = result?.added.length ?? 0;

	return (
		<Modal.Root
			size={step === 'review' ? 'large' : 'medium'}
			onClose={requestClose}
			data-flx="persona.plural-kit-import-modal.modal-root"
		>
			<Modal.Header
				onClose={requestClose}
				title={
					step === 'review' && preview && reviewNeedCount(preview.entries) > 0
						? i18n._(
								msg({
									message:
										'{count, plural, one {Check # member before importing} other {Check # members before importing}}',
									comment: 'Title of the persona import review. {count} is the number of members that need a choice',
								}),
								{count: reviewNeedCount(preview.entries)},
							)
						: i18n._(titles[step])
				}
				hideCloseButton={busy}
				data-flx="persona.plural-kit-import-modal.modal-header"
			/>

			<Modal.Content data-flx="persona.plural-kit-import-modal.modal-content">
				<div className={styles.container} data-flx="persona.plural-kit-import-modal.container">
					{step === 'select' && (
						<>
							<div
								className={styles.dropzone}
								role="button"
								tabIndex={0}
								onDrop={handleDrop}
								onDragOver={(e) => e.preventDefault()}
								onClick={() => fileInputRef.current?.click()}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										fileInputRef.current?.click();
									}
								}}
								data-flx="persona.plural-kit-import-modal.dropzone.click"
							>
								<UploadSimple
									size={36}
									style={{color: 'var(--brand-primary)'}}
									data-flx="persona.plural-kit-import-modal.upload-simple"
								/>
								<div className={styles.dropzoneText} data-flx="persona.plural-kit-import-modal.dropzone-text">
									{fileName ? (
										fileName
									) : (
										<Trans>Choose a PluralKit export (.json) or a {productName} export (.zip), or drag & drop</Trans>
									)}
								</div>
								<div className={styles.dropzoneSubtext} data-flx="persona.plural-kit-import-modal.dropzone-subtext">
									<Trans>Supports PluralKit system export files</Trans>
								</div>
								<input
									ref={fileInputRef}
									type="file"
									accept=".json,.zip,application/json,application/zip"
									className={styles.hiddenFileInput}
									onChange={(e) => {
										if (e.target.files && e.target.files.length > 0) {
											void handleFileChosen(e.target.files[0]);
										}
									}}
									data-flx="persona.plural-kit-import-modal.hidden-file-input"
								/>
							</div>

							{fileError && (
								<div className={styles.errorBanner} data-flx="persona.plural-kit-import-modal.error-banner">
									{fileError}
								</div>
							)}

							{source && (
								<div className={styles.summaryBox} data-flx="persona.plural-kit-import-modal.summary-box">
									<div className={styles.summaryTitle} data-flx="persona.plural-kit-import-modal.summary-title">
										<Trans>Export Summary</Trans>
									</div>
									<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row">
										<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label">
											<Trans>Detected System Name / Tag</Trans>
										</span>
										<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value">
											{`${systemName || i18n._(msg({message: 'None', comment: 'None value'}))}${systemTag ? ` (${systemTag})` : ''}`}
										</span>
									</div>
									<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row--2">
										<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label--2">
											<Trans>Total Members</Trans>
										</span>
										<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value--2">
											{members.length}
										</span>
									</div>
									<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row--3">
										<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label--3">
											<Trans>Members with Avatars</Trans>
										</span>
										<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value--3">
											{membersWithAvatars}
										</span>
									</div>
									<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row--4">
										<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label--4">
											<Trans>Privacy</Trans>
										</span>
										<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value--4">
											<Trans>
												{publicCount} public, {unlistedCount} unlisted, {privateCount} private
											</Trans>
										</span>
									</div>
								</div>
							)}

							<div className={reviewStyles.infoLine} data-flx="persona.plural-kit-import-modal.div">
								<ShieldCheck
									size={20}
									aria-hidden="true"
									style={{flex: 'none', color: 'var(--brand-primary)'}}
									data-flx="persona.plural-kit-import-modal.shield-check"
								/>
								<span data-flx="persona.plural-kit-import-modal.span">
									<Trans comment="Information line in the persona import dialog, above the Import button">
										Import will never overwrite existing personas without your permission.
									</Trans>
								</span>
							</div>
						</>
					)}

					{step === 'backup' && (
						<div className={reviewStyles.infoLine} data-flx="persona.plural-kit-import-modal.backup">
							<DownloadSimple
								size={20}
								aria-hidden="true"
								style={{flex: 'none', color: 'var(--brand-primary)'}}
								data-flx="persona.plural-kit-import-modal.backup-icon"
							/>
							<span data-flx="persona.plural-kit-import-modal.backup-text">
								<Trans comment="Shown after pressing Import in the persona import dialog, before anything happens">
									Use Export to make a backup before continuing.
								</Trans>
							</span>
						</div>
					)}

					{step === 'review' && preview && source && (
						<PersonaImportReview
							preview={preview}
							members={reviewMembers}
							source={source}
							decisions={decisions}
							onDecide={decide}
							fileTagText={fileTagText}
							displayTagChoice={displayTagChoice}
							onDisplayTagChoice={setDisplayTagChoice}
							conflicts={conflicts}
							livePersonas={PersonaStore.personas}
							data-flx="persona.plural-kit-import-modal.persona-import-review"
						/>
					)}

					{busy && (
						<div style={{padding: '16px 0'}} data-flx="persona.plural-kit-import-modal.div--2">
							<div
								className={styles.progressCurrentName}
								data-flx="persona.plural-kit-import-modal.progress-current-name"
							>
								{step === 'checking' && !storingPictures ? (
									<Trans comment="Status while the import file is compared with the account's personas">
										Comparing your file with your personas...
									</Trans>
								) : (
									<Trans>Processing: {progress.currentName}</Trans>
								)}
							</div>
							{(step === 'importing' || storingPictures) && (
								<>
									<div
										className={styles.progressBarContainer}
										data-flx="persona.plural-kit-import-modal.progress-bar-container"
									>
										<div
											className={styles.progressBarFill}
											style={{width: `${progress.percent}%`}}
											data-flx="persona.plural-kit-import-modal.progress-bar-fill"
										/>
									</div>
									<div className={styles.progressDetail} data-flx="persona.plural-kit-import-modal.progress-detail">
										<Trans>
											{progress.current} of {progress.total} {progress.label ?? i18n._(PROGRESS_ITEMS_DESCRIPTOR)} (
											{progress.percent}%)
										</Trans>
									</div>
								</>
							)}
						</div>
					)}

					{step === 'completed' && result && (
						<>
							<div className={styles.successBox} data-flx="persona.plural-kit-import-modal.success-box">
								<CheckCircle
									size={36}
									style={{color: 'var(--accent-success)', marginBottom: 8}}
									data-flx="persona.plural-kit-import-modal.check-circle"
								/>
								<div className={styles.successTitle} data-flx="persona.plural-kit-import-modal.success-title">
									{result.reviewed ? (
										<Trans comment="Heading when a reviewed persona import is done">Here is what changed</Trans>
									) : (
										<Trans comment="Heading when a persona import with nothing to decide is done. {addedCount} is a number">
											{addedCount} personas added
										</Trans>
									)}
								</div>
								<div className={styles.successDesc} data-flx="persona.plural-kit-import-modal.success-desc">
									{result.reviewed ? (
										<Trans comment="Text under the heading when a reviewed persona import is done">
											Everything else is exactly as it was.
										</Trans>
									) : (
										<Trans comment="Text when a persona import with nothing to decide is done">
											Everything in the file was either new or already matched a persona exactly, so there was nothing
											to decide. Nothing else changed.
										</Trans>
									)}
								</div>
							</div>
							{result.reviewed ? (
								<ResultCounts summary={result.summary} data-flx="persona.plural-kit-import-modal.result-counts" />
							) : (
								result.added.length > 0 && (
									<div className={reviewStyles.resultList} data-flx="persona.plural-kit-import-modal.div--3">
										{result.added.map((persona, index) => (
											<div
												key={`${persona.name}-${index}`}
												className={reviewStyles.resultRow}
												data-flx="persona.plural-kit-import-modal.div--4"
											>
												<span className={reviewStyles.rowName} data-flx="persona.plural-kit-import-modal.span--2">
													{persona.name}
												</span>
												{persona.tags.map((tag) => (
													<code
														key={tagText(tag)}
														className={reviewStyles.tag}
														data-flx="persona.plural-kit-import-modal.code"
													>
														{tagText(tag)}
													</code>
												))}
											</div>
										))}
									</div>
								)
							)}
							{result.warnings.length > 0 && (
								<Warnings warnings={result.warnings} data-flx="persona.plural-kit-import-modal.warnings" />
							)}
						</>
					)}
				</div>
			</Modal.Content>

			<Modal.Footer data-flx="persona.plural-kit-import-modal.modal-footer">
				{step === 'select' && (
					<>
						<Button variant="secondary" onClick={onClose} data-flx="persona.plural-kit-import-modal.button.close">
							<Trans>Cancel</Trans>
						</Button>
						<Button
							variant="primary"
							disabled={!source || namedCount === 0}
							onClick={handleImport}
							data-flx="persona.plural-kit-import-modal.button"
						>
							<Trans comment="Button that starts the persona import">Import</Trans>
						</Button>
					</>
				)}
				{step === 'backup' && (
					<>
						<Button
							variant="secondary"
							disabled={exporting}
							onClick={() => setStep('select')}
							data-flx="persona.plural-kit-import-modal.backup-back"
						>
							<Trans comment="Button in the persona import's backup step that goes back to choosing the file">
								Back
							</Trans>
						</Button>
						<Button
							variant="secondary"
							disabled={exporting}
							onClick={() => void startImport()}
							data-flx="persona.plural-kit-import-modal.backup-skip"
						>
							<Trans comment="Button in the persona import's backup step: import without making a backup">Skip</Trans>
						</Button>
						<Button
							variant="primary"
							submitting={exporting}
							onClick={() => void handleExportThenImport()}
							data-flx="persona.plural-kit-import-modal.backup-export"
						>
							<Trans comment="Button in the persona import's backup step: download a backup of the personas, then import">
								Export
							</Trans>
						</Button>
					</>
				)}
				{step === 'review' && footerSummary && (
					<>
						<div className={reviewStyles.summary} aria-live="polite" data-flx="persona.plural-kit-import-modal.div--5">
							<span className={reviewStyles.summaryMain} data-flx="persona.plural-kit-import-modal.span--3">
								{footerSummary.main}
							</span>
							{footerSummary.rest && (
								<span className={reviewStyles.summaryRest} data-flx="persona.plural-kit-import-modal.span--4">
									{footerSummary.rest}
								</span>
							)}
						</div>
						<Button
							variant="secondary"
							onClick={() => setStep('select')}
							data-flx="persona.plural-kit-import-modal.button.set-step"
						>
							<Trans comment="Button in the import review that goes back to choosing the file">Back</Trans>
						</Button>
						<Button
							variant="primary"
							disabled={conflicts.length > 0}
							onClick={handleApplyReviewed}
							data-flx="persona.plural-kit-import-modal.button.apply-reviewed"
						>
							<Trans comment="Button that starts the persona import">Import</Trans>
						</Button>
					</>
				)}
				{busy && (
					<Button variant="secondary" disabled data-flx="persona.plural-kit-import-modal.button--2">
						{step === 'checking' ? (
							<Trans comment="Disabled button while the import file is checked">Checking...</Trans>
						) : (
							<Trans>Importing...</Trans>
						)}
					</Button>
				)}
				{step === 'completed' && (
					<Button variant="primary" onClick={onClose} data-flx="persona.plural-kit-import-modal.button.close--2">
						<Trans>Done</Trans>
					</Button>
				)}
			</Modal.Footer>
		</Modal.Root>
	);
});

PluralKitImportModal.displayName = 'PluralKitImportModal';

function ResultCounts({summary}: {summary: ReviewSummary}) {
	const {i18n} = useLingui();
	const lines: Array<{count: number; label: string; hint: string}> = [];
	const push = (count: number, label: string, hint: string) => {
		if (count > 0) lines.push({count, label, hint});
	};
	push(
		summary.link,
		i18n._(msg({message: 'Linked', comment: 'Line of the import result: personas connected to their file members'})),
		i18n._(
			msg({
				message: 'Connected to their members in the file. Nothing in them changed.',
				comment: 'Explanation of the "Linked" line of the import result',
			}),
		),
	);
	push(
		summary.add,
		i18n._(msg({message: 'Added', comment: 'Line of the import result: new personas'})),
		i18n._(
			msg({message: 'New personas from your file.', comment: 'Explanation of the "Added" line of the import result'}),
		),
	);
	push(
		summary.restore,
		i18n._(msg({message: 'Restored', comment: 'Line of the import result: deleted personas brought back'})),
		i18n._(
			msg({
				message: 'Back as they were, with their old messages.',
				comment: 'Explanation of the "Restored" line of the import result',
			}),
		),
	);
	push(
		summary.useFile,
		i18n._(
			msg({message: 'Updated from the file', comment: "Line of the import result: personas given the file's details"}),
		),
		i18n._(
			msg({
				message: "Their details are the file's now; their messages and history stayed.",
				comment: 'Explanation of the "Updated from the file" line of the import result',
			}),
		),
	);
	push(
		summary.skip,
		i18n._(msg({message: 'Skipped', comment: 'Line of the import result: members left out'})),
		i18n._(
			msg({
				message: 'Still in your file. Import it again any time to decide about them.',
				comment: 'Explanation of the "Skipped" line of the import result',
			}),
		),
	);
	push(
		summary.kept,
		i18n._(msg({message: 'Kept as they were', comment: 'Line of the import result: personas left unchanged'})),
		i18n._(
			msg({
				message: 'Including any that differ from the file, where you kept the version you had.',
				comment: 'Explanation of the "Kept as they were" line of the import result',
			}),
		),
	);
	push(
		summary.stayDeleted,
		i18n._(msg({message: 'Still deleted', comment: 'Line of the import result: deleted personas not restored'})),
		i18n._(
			msg({
				message: 'Restore them from Deleted personas in Settings if you change your mind.',
				comment: 'Explanation of the "Still deleted" line of the import result',
			}),
		),
	);
	return (
		<div className={reviewStyles.resultList} data-flx="persona.plural-kit-import-modal.result-counts.div">
			{lines.map((line) => (
				<div
					key={line.label}
					className={reviewStyles.resultRow}
					data-flx="persona.plural-kit-import-modal.result-counts.div--2"
				>
					<span className={reviewStyles.resultCount} data-flx="persona.plural-kit-import-modal.result-counts.span">
						{line.count}
					</span>
					<span className={reviewStyles.rowText} data-flx="persona.plural-kit-import-modal.result-counts.span--2">
						<span className={reviewStyles.rowName} data-flx="persona.plural-kit-import-modal.result-counts.span--3">
							{line.label}
						</span>
						<span className={reviewStyles.rowMeta} data-flx="persona.plural-kit-import-modal.result-counts.span--4">
							{line.hint}
						</span>
					</span>
				</div>
			))}
		</div>
	);
}

function Warnings({warnings}: {warnings: ReadonlyArray<ImportWarning>}) {
	const count = warnings.length;
	return (
		<div className={styles.warningBox} data-flx="persona.plural-kit-import-modal.warnings.warning-box">
			<div className={styles.warningHeader} data-flx="persona.plural-kit-import-modal.warnings.warning-header">
				<Warning size={18} data-flx="persona.plural-kit-import-modal.warnings.warning" />
				<span data-flx="persona.plural-kit-import-modal.warnings.span">
					<Trans>{count} notice(s) during import</Trans>
				</span>
			</div>
			<div className={styles.warningList} data-flx="persona.plural-kit-import-modal.warnings.warning-list">
				{warnings.map((w, idx) => (
					<div
						key={idx}
						className={styles.warningItem}
						data-flx="persona.plural-kit-import-modal.warnings.warning-item"
					>
						<div
							className={styles.warningItemName}
							data-flx="persona.plural-kit-import-modal.warnings.warning-item-name"
						>
							{w.displayName}
							{w.prefix && (
								<>
									{' '}
									<span
										style={{fontWeight: 400, color: 'var(--text-primary-muted)'}}
										data-flx="persona.plural-kit-import-modal.warnings.span--2"
									>
										<Trans>(Prefix: {w.prefix})</Trans>
									</span>
								</>
							)}
						</div>
						<div
							className={styles.warningItemDetail}
							data-flx="persona.plural-kit-import-modal.warnings.warning-item-detail"
						>
							{w.reason}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export function openPluralKitImportModal(): void {
	ModalCommands.push(
		ModalCommands.modal(() => (
			<PluralKitImportModal
				onClose={() => ModalCommands.pop()}
				data-flx="persona.plural-kit-import-modal.open-plural-kit-import-modal.plural-kit-import-modal"
			/>
		)),
	);
}
