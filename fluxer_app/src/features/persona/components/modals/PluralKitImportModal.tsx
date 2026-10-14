// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import {PRODUCT_NAME} from '@app/features/app/config/ProductConstants';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import SessionManager from '@app/features/platform/state/AuthSession';
import {http} from '@app/features/platform/transport/RestTransport';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import Users from '@app/features/user/state/Users';
import type {PersonaImportItem} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {
	imageFileExtension,
	ownTyneMediaImageHash,
	type PersonaImageKind,
	type PersonaImportStoredImages,
	type PluralKitImportedMember,
	personaImportItem,
} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {CheckCircle, UploadSimple, Warning} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useRef, useState} from 'react';
import * as PersonaCommands from '../../commands/PersonaCommands';
import {PersonaStore} from '../../state/PersonaStore';
import {type PersonaImportSource, readPersonaImportFile} from '../../utils/PersonaImportFile';
import styles from './PluralKitImportModal.module.css';

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
const PREPARING_BATCH_DESCRIPTOR = msg({
	message: 'Preparing avatar batch download...',
	comment: 'Progress status when preparing avatar batch download',
});
const AVATARS_DOWNLOADED_LABEL = msg({
	message: 'avatars downloaded',
	comment: 'Progress label for avatar downloads',
});
const PERSONAS_PREPARED_LABEL = msg({
	message: 'personas prepared',
	comment: 'Progress label for prepared personas',
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
const SYSTEM_TAG_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Optional system badge, e.g. ⚞Seraphim⚟',
	comment: 'Placeholder for system badge in import modal',
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
const DROPPED_TAGS_DESCRIPTOR = msg({
	message: 'Some proxy tags were left out: {productName} allows up to 5 per persona, each at most 32 characters.',
	comment:
		'Import warning when a PluralKit member has more or longer proxy tags than a persona can have. Preserve {productName}; it is the app name, inserted by code.',
});

interface ImportWarning {
	displayName: string;
	prefix?: string;
	reason: string;
}

type StoredImage = {hash: string; avatarColor: number | null};

interface BatchImportResult {
	avatar_hash?: string;
	avatar_color?: number | null;
	banner_hash?: string;
	error?: string;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	jxl: 'image/jxl',
	svg: 'image/svg+xml',
};

// Asks the server to fetch remote images (avatars or banners) in batches, and reads its NDJSON
// progress stream. Returns what was stored and what failed, by URL.
async function fetchRemoteImages(
	urls: ReadonlyArray<string>,
	kind: PersonaImageKind,
	onProgress: (completed: number) => void,
): Promise<{stored: Map<string, StoredImage>; errors: Map<string, string>}> {
	const stored = new Map<string, StoredImage>();
	const errors = new Map<string, string>();
	const record = (url: string, result: BatchImportResult) => {
		const hash = kind === 'avatar' ? result.avatar_hash : result.banner_hash;
		if (hash)
			stored.set(url, {hash, avatarColor: typeof result.avatar_color === 'number' ? result.avatar_color : null});
		if (result.error) errors.set(url, result.error);
	};
	const BATCH_LIMIT = 500;
	for (let start = 0; start < urls.length; start += BATCH_LIMIT) {
		const batch = urls.slice(start, start + BATCH_LIMIT);
		const handleLine = (line: string) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			let event: {type?: string; url?: string; completed?: number; results?: Record<string, BatchImportResult>};
			try {
				event = JSON.parse(trimmed);
			} catch {
				return;
			}
			if (event.type === 'progress') {
				if (event.url) record(event.url, event as BatchImportResult);
				if (typeof event.completed === 'number') onProgress(start + event.completed);
			} else if (event.type === 'complete' && event.results) {
				for (const [url, result] of Object.entries(event.results)) record(url, result);
			}
		};
		try {
			const res = await fetch(`/api/v1${Endpoints.USER_PERSONA_IMPORT_BATCH_AVATARS}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(SessionManager.token ? {Authorization: SessionManager.token} : {}),
				},
				body: JSON.stringify({urls: batch, kind}),
			});
			if (!res.ok) {
				let errorMessage = `HTTP ${res.status}`;
				try {
					const errorJson = await res.json();
					if (errorJson.message) errorMessage = errorJson.message;
				} catch {}
				for (const url of batch) errors.set(url, errorMessage);
				continue;
			}
			const reader = res.body?.getReader();
			if (!reader) continue;
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const {done, value} = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, {stream: true});
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) handleLine(line);
			}
			buffer += decoder.decode();
			for (const line of buffer.split('\n')) handleLine(line);
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : 'Network error';
			for (const url of batch) errors.set(url, errorMsg);
		}
	}
	return {stored, errors};
}

function imageDataUri(bytes: Uint8Array): string {
	const type = IMAGE_MIME_TYPES[imageFileExtension(bytes)] ?? 'application/octet-stream';
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return `data:${type};base64,${btoa(binary)}`;
}

/** Runs `task` on each item, a few at a time. */
async function forEachLimited<T>(items: ReadonlyArray<T>, limit: number, task: (item: T) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next++] as T;
			await task(item);
		}
	};
	await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
}

export const PluralKitImportModal: React.FC<{onClose: () => void}> = observer(({onClose}) => {
	const {i18n} = useLingui();
	const [step, setStep] = useState<'select' | 'importing' | 'completed'>('select');
	const [fileName, setFileName] = useState<string | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [source, setSource] = useState<PersonaImportSource | null>(null);
	const [systemTagOverride, setSystemTagOverride] = useState<string>('');
	const [importMode, setImportMode] = useState<'replace' | 'append'>('append');
	const [progress, setProgress] = useState<{
		current: number;
		total: number;
		currentName: string;
		percent: number;
		label?: string;
	}>({
		current: 0,
		total: 0,
		currentName: '',
		percent: 0,
		label: undefined,
	});
	const [importResults, setImportResults] = useState<{
		successCount: number;
		warnings: Array<ImportWarning>;
	}>({successCount: 0, warnings: []});

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const existingCount = PersonaStore.personas.length;
	const productName = PRODUCT_NAME;
	const members = source?.system.members ?? [];

	const handleFileChosen = async (file: File) => {
		setFileError(null);
		setFileName(file.name);
		setSource(null);
		setSystemTagOverride('');
		let result: Awaited<ReturnType<typeof readPersonaImportFile>>;
		try {
			result = await readPersonaImportFile(file);
		} catch {
			setFileError(i18n._(FILE_READ_FAILED_DESCRIPTOR));
			return;
		}
		if (!result.ok) {
			const descriptor = {
				not_object: FILE_INVALID_JSON_DESCRIPTOR,
				no_members: FILE_NO_MEMBERS_DESCRIPTOR,
				invalid_json: FILE_PARSE_FAILED_DESCRIPTOR,
				zip_unreadable: ZIP_UNREADABLE_DESCRIPTOR,
				zip_not_export: ZIP_NOT_EXPORT_DESCRIPTOR,
			}[result.error];
			setFileError(i18n._(descriptor, {productName: PRODUCT_NAME}));
			return;
		}
		setSource(result.source);
		const manifestTag = result.source.kind === 'bundle' ? result.source.manifest.tag_text : undefined;
		const candidateTag = manifestTag ?? result.source.system.tag ?? result.source.system.name ?? '';
		if (candidateTag) {
			setSystemTagOverride(candidateTag);
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			void handleFileChosen(e.dataTransfer.files[0]);
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
	};

	const executeImport = async () => {
		if (!source || source.system.members.length === 0) return;

		setStep('importing');
		const warnings: Array<ImportWarning> = [];
		const bundle = source.kind === 'bundle' ? source : null;
		const ownUserId = Users.currentUser?.id ?? null;
		const mediaEndpoint = RuntimeConfig.mediaEndpoint;
		const named = source.system.members.filter(
			(member): member is PluralKitImportedMember & {name: string} => member.name !== null,
		);

		// 1. Where each image comes from: the export's zip, this account's own copy on this instance
		// (a re-imported Tyne export without its zip), or a download by the server.
		const stored = new Map<string, StoredImage>();
		const imageFailures = new Map<string, string>();
		const uploads: Array<{key: string; kind: PersonaImageKind; bytes: Uint8Array}> = [];
		const remote: Record<PersonaImageKind, Map<string, Array<string>>> = {avatar: new Map(), banner: new Map()};
		for (const member of named) {
			const extras = bundle && member.id ? bundle.manifest.members[member.id] : undefined;
			for (const kind of ['avatar', 'banner'] as const) {
				const key = `${member.index}:${kind}`;
				const bytes = extras?.[kind] ? bundle?.images.get(extras[kind] as string) : undefined;
				const url = kind === 'avatar' ? member.avatarUrl : member.bannerUrl;
				if (bytes) {
					uploads.push({key, kind, bytes});
					continue;
				}
				if (!url) continue;
				const ownHash = ownUserId && mediaEndpoint ? ownTyneMediaImageHash(url, mediaEndpoint, kind, ownUserId) : null;
				if (ownHash) {
					stored.set(key, {hash: ownHash, avatarColor: null});
				} else if (url.startsWith('http://') || url.startsWith('https://')) {
					remote[kind].set(url, [...(remote[kind].get(url) ?? []), key]);
				}
			}
		}

		// 2. Images from the zip.
		if (uploads.length > 0) {
			let done = 0;
			const showUploadProgress = () =>
				setProgress({
					current: done,
					total: uploads.length,
					currentName: i18n._(
						msg({
							message: 'Storing image {current} of {total} from the file...',
							comment: 'Progress status while the images inside an imported persona export are stored',
						}),
						{current: done, total: uploads.length},
					),
					percent: Math.round((done / uploads.length) * 100),
					label: i18n._(IMAGES_STORED_LABEL),
				});
			showUploadProgress();
			await forEachLimited(uploads, 4, async (upload) => {
				try {
					stored.set(upload.key, await PersonaCommands.importPersonaImage(upload.kind, imageDataUri(upload.bytes)));
				} catch (err: unknown) {
					imageFailures.set(upload.key, err instanceof Error ? err.message : 'Error');
				}
				done++;
				showUploadProgress();
			});
		}

		// 3. Images the server has to download.
		for (const kind of ['avatar', 'banner'] as const) {
			const urls = Array.from(remote[kind].keys());
			if (urls.length === 0) continue;
			const label = i18n._(kind === 'avatar' ? AVATARS_DOWNLOADED_LABEL : BANNERS_DOWNLOADED_LABEL);
			const showDownloadProgress = (completed: number) =>
				setProgress({
					current: completed,
					total: urls.length,
					currentName:
						kind === 'avatar'
							? i18n._(
									msg({
										message: 'Downloading avatar {current} of {total}...',
										comment: 'Progress status during avatar download',
									}),
									{current: completed, total: urls.length},
								)
							: i18n._(
									msg({
										message: 'Downloading banner {current} of {total}...',
										comment: 'Progress status during banner download in the persona import',
									}),
									{current: completed, total: urls.length},
								),
					percent: Math.round((completed / urls.length) * 100),
					label,
				});
			if (kind === 'avatar') {
				setProgress({
					current: 0,
					total: urls.length,
					currentName: i18n._(PREPARING_BATCH_DESCRIPTOR),
					percent: 0,
					label,
				});
			} else {
				showDownloadProgress(0);
			}
			const fetched = await fetchRemoteImages(urls, kind, showDownloadProgress);
			for (const [url, keys] of remote[kind]) {
				const image = fetched.stored.get(url);
				for (const key of keys) {
					if (image) stored.set(key, image);
					else imageFailures.set(key, fetched.errors.get(url) ?? 'Error');
				}
			}
		}

		// 4. The import requests.
		const importedPersonas: Array<PersonaImportItem> = [];
		source.system.members.forEach((member, i) => {
			if (member.name === null) {
				warnings.push({
					displayName: i18n._(
						msg({
							message: 'Member #{index}',
							comment: 'Placeholder name for unnamed member in import',
						}),
						{index: i + 1},
					),
					reason: i18n._(SKIPPED_NO_NAME_DESCRIPTOR),
				});
				return;
			}
			const displayName = member.name;
			const primaryPrefix = member.personaTags[0]?.prefix;
			setProgress({
				current: i + 1,
				total: members.length,
				currentName: i18n._(
					msg({
						message: 'Configuring {name}...',
						comment: 'Progress status for configuring persona',
					}),
					{name: displayName},
				),
				percent: Math.round(((i + 1) / members.length) * 100),
				label: i18n._(PERSONAS_PREPARED_LABEL),
			});
			const avatar = stored.get(`${member.index}:avatar`) ?? null;
			const banner = stored.get(`${member.index}:banner`) ?? null;
			const avatarError = imageFailures.get(`${member.index}:avatar`);
			if (avatarError) {
				warnings.push({
					displayName,
					prefix: primaryPrefix,
					reason: i18n._(
						msg({
							message: 'Avatar image failed to download: {error}. Persona was imported without an avatar.',
							comment: 'Import warning when avatar fails to download',
						}),
						{error: avatarError},
					),
				});
			}
			const bannerError = imageFailures.get(`${member.index}:banner`);
			if (bannerError) {
				warnings.push({
					displayName,
					prefix: primaryPrefix,
					reason: i18n._(
						msg({
							message: 'Banner image failed to download: {error}. Persona was imported without a banner.',
							comment: 'Import warning when a persona banner fails to download',
						}),
						{error: bannerError},
					),
				});
			}
			if (member.droppedTagCount > 0) {
				warnings.push({
					displayName,
					prefix: primaryPrefix,
					reason: i18n._(DROPPED_TAGS_DESCRIPTOR, {productName: PRODUCT_NAME}),
				});
			}
			const images: PersonaImportStoredImages = {
				avatar,
				banner: banner ? {hash: banner.hash} : null,
			};
			const extras = bundle && member.id ? bundle.manifest.members[member.id] : undefined;
			importedPersonas.push(personaImportItem({...member, name: displayName}, images, extras));
		});

		if (importMode === 'replace') {
			const existing = [...PersonaStore.personas];
			const totalExisting = existing.length;
			let deleteFailures = 0;

			for (let i = 0; i < totalExisting; i++) {
				setProgress({
					current: i + 1,
					total: totalExisting,
					currentName: i18n._(SAVING_PERSONAS_STATUS),
					percent: Math.round(((i + 1) / totalExisting) * 100),
					label: i18n._(SAVING_PERSONAS_LABEL),
				});
				try {
					await PersonaCommands.deletePersona(existing[i].id);
				} catch {
					deleteFailures++;
				}
			}

			if (deleteFailures > 0) {
				ToastCommands.error(i18n._(FAILED_TO_IMPORT_DESCRIPTOR));
				setStep('select');
				return;
			}
		}

		const CHUNK_SIZE = 50;
		try {
			for (let i = 0; i < importedPersonas.length; i += CHUNK_SIZE) {
				const chunk = importedPersonas.slice(i, i + CHUNK_SIZE);
				const currentCount = Math.min(i + chunk.length, importedPersonas.length);
				setProgress({
					current: currentCount,
					total: importedPersonas.length,
					currentName: i18n._(SAVING_PERSONAS_STATUS),
					percent: Math.round((currentCount / importedPersonas.length) * 100),
					label: i18n._(SAVING_PERSONAS_LABEL),
				});
				await PersonaCommands.importPersonas(chunk);
			}

			// A Tyne export also brings back the tag icon.
			let tagIcon: string | undefined;
			if (bundle?.manifest.tag_icon) {
				const bytes = bundle.images.get(bundle.manifest.tag_icon);
				if (bytes) {
					try {
						const res = await http.post<{avatar_hash?: string}>(Endpoints.USER_PERSONA_AVATAR, {
							body: {avatar: imageDataUri(bytes)},
						});
						if (res.ok && res.body?.avatar_hash) tagIcon = res.body.avatar_hash;
					} catch {
						// Non-fatal: the personas are in; the icon can be set again in settings.
					}
				}
			} else if (bundle?.manifest.tag_icon_url) {
				tagIcon = bundle.manifest.tag_icon_url;
			}
			const tagText = systemTagOverride.trim();
			if (tagText || tagIcon !== undefined) {
				try {
					await PersonaStore.setDisplayTag(tagText || PersonaStore.displayTagText, tagIcon);
				} catch {
					// Non-fatal if setting update fails
				}
			}

			setImportResults({
				successCount: importedPersonas.length,
				warnings,
			});
			setStep('completed');
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : i18n._(FAILED_TO_IMPORT_DESCRIPTOR);
			ToastCommands.error(message);
			setStep('select');
		}
	};

	const handleStartImport = () => {
		if (!source || source.system.members.length === 0) return;

		if (importMode === 'replace' && existingCount > 0) {
			ModalCommands.push(
				ModalCommands.modal(() => (
					<ConfirmModal
						title={<Trans>Replace All Personas</Trans>}
						description={
							<Trans>
								Are you sure you want to replace all{' '}
								<strong data-flx="persona.plural-kit-import-modal.handle-start-import.strong">{existingCount}</strong>{' '}
								existing persona(s)? This will permanently delete them from your account and cannot be undone.
							</Trans>
						}
						primaryText={<Trans>Replace All</Trans>}
						primaryVariant="danger"
						onPrimary={async () => {
							await executeImport();
						}}
						data-flx="persona.plural-kit-import-modal.handle-start-import.confirm-modal"
					/>
				)),
			);
			return;
		}

		void executeImport();
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

	const modalTitle =
		step === 'select'
			? i18n._(
					msg({
						message: 'Import from PluralKit',
						comment: 'Modal title for PluralKit import step select',
					}),
				)
			: step === 'importing'
				? i18n._(
						msg({
							message: 'Importing Personas...',
							comment: 'Modal title for PluralKit import step importing',
						}),
					)
				: i18n._(
						msg({
							message: 'Import Complete',
							comment: 'Modal title for PluralKit import step completed',
						}),
					);

	return (
		<Modal.Root
			size="medium"
			onClose={step === 'importing' ? () => {} : onClose}
			data-flx="persona.plural-kit-import-modal.modal-root"
		>
			<Modal.Header
				title={modalTitle}
				hideCloseButton={step === 'importing'}
				data-flx="persona.plural-kit-import-modal.modal-header"
			/>

			<Modal.Content data-flx="persona.plural-kit-import-modal.modal-content">
				<div className={styles.container} data-flx="persona.plural-kit-import-modal.container">
					{/* STEP 1: SELECT & CONFIGURE */}
					{step === 'select' && (
						<>
							<div
								className={styles.dropzone}
								role="button"
								tabIndex={0}
								onDrop={handleDrop}
								onDragOver={handleDragOver}
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
								<>
									<div className={styles.summaryBox} data-flx="persona.plural-kit-import-modal.summary-box">
										<div className={styles.summaryTitle} data-flx="persona.plural-kit-import-modal.summary-title">
											<Trans>Export Summary</Trans>
										</div>
										<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row">
											<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label">
												<Trans>Detected System Name / Tag</Trans>
											</span>
											<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value">
												{`${source.system.name || i18n._(msg({message: 'None', comment: 'None value'}))}${source.system.tag ? ` (${source.system.tag})` : ''}`}
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

									<div className={styles.formField} data-flx="persona.plural-kit-import-modal.form-field">
										<div className={styles.formLabel} data-flx="persona.plural-kit-import-modal.form-label">
											<Trans>System Tag (Applied to imported personas)</Trans>
										</div>
										<input
											type="text"
											className={styles.textInput}
											value={systemTagOverride}
											onChange={(e) => setSystemTagOverride(e.target.value)}
											placeholder={i18n._(SYSTEM_TAG_PLACEHOLDER_DESCRIPTOR)}
											maxLength={100}
											data-flx="persona.plural-kit-import-modal.text-input.set-system-tag-override"
										/>
									</div>

									{existingCount > 0 && (
										<div className={styles.formField} data-flx="persona.plural-kit-import-modal.form-field--2">
											<div className={styles.formLabel} data-flx="persona.plural-kit-import-modal.form-label--2">
												<Trans>Import Strategy</Trans>
											</div>
											<div className={styles.optionsGroup} data-flx="persona.plural-kit-import-modal.options-group">
												<label
													className={clsx(styles.radioOption, importMode === 'append' && styles.radioOptionSelected)}
													data-flx="persona.plural-kit-import-modal.radio-option"
												>
													<input
														type="radio"
														name="importMode"
														checked={importMode === 'append'}
														onChange={() => setImportMode('append')}
														style={{marginTop: 3}}
														data-flx="persona.plural-kit-import-modal.input.set-import-mode.radio"
													/>
													<div data-flx="persona.plural-kit-import-modal.div">
														<div className={styles.radioTitle} data-flx="persona.plural-kit-import-modal.radio-title">
															<Trans>Keep existing and add new (Recommended)</Trans>
														</div>
														<div className={styles.radioDesc} data-flx="persona.plural-kit-import-modal.radio-desc">
															<Trans>
																Keep your {existingCount} current persona(s) and add all {members.length} imported
																personas alongside them as new entries.
															</Trans>
														</div>
													</div>
												</label>
												<label
													className={clsx(
														styles.radioOption,
														styles.radioOptionDanger,
														importMode === 'replace' && styles.radioOptionDangerSelected,
													)}
													data-flx="persona.plural-kit-import-modal.radio-option--2"
												>
													<input
														type="radio"
														name="importMode"
														checked={importMode === 'replace'}
														onChange={() => setImportMode('replace')}
														style={{marginTop: 3}}
														data-flx="persona.plural-kit-import-modal.input.set-import-mode.radio--2"
													/>
													<div data-flx="persona.plural-kit-import-modal.div--2">
														<div
															className={styles.radioTitleDanger}
															data-flx="persona.plural-kit-import-modal.radio-title-danger"
														>
															<Warning
																size={16}
																weight="fill"
																className={styles.dangerIcon}
																data-flx="persona.plural-kit-import-modal.danger-icon"
															/>
															<span data-flx="persona.plural-kit-import-modal.span">
																<Trans>Replace all existing personas (Destructive)</Trans>
															</span>
														</div>
														<div className={styles.radioDesc} data-flx="persona.plural-kit-import-modal.radio-desc--2">
															<Trans>
																Permanently delete all {existingCount} existing persona(s) and replace them completely
																with the imported personas.
															</Trans>
														</div>
													</div>
												</label>
											</div>
										</div>
									)}
								</>
							)}
						</>
					)}

					{/* STEP 2: IMPORTING PROGRESS */}
					{step === 'importing' && (
						<div style={{padding: '16px 0'}} data-flx="persona.plural-kit-import-modal.div--3">
							<div
								className={styles.progressCurrentName}
								data-flx="persona.plural-kit-import-modal.progress-current-name"
							>
								<Trans>Processing: {progress.currentName}</Trans>
							</div>
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
									{progress.current} of {progress.total} {progress.label ?? 'items'} ({progress.percent}%)
								</Trans>
							</div>
						</div>
					)}

					{/* STEP 3: COMPLETED & WARNINGS */}
					{step === 'completed' && (
						<>
							<div className={styles.successBox} data-flx="persona.plural-kit-import-modal.success-box">
								<CheckCircle
									size={36}
									style={{color: 'var(--accent-success)', marginBottom: 8}}
									data-flx="persona.plural-kit-import-modal.check-circle"
								/>
								<div className={styles.successTitle} data-flx="persona.plural-kit-import-modal.success-title">
									<Trans>Import Complete!</Trans>
								</div>
								<div className={styles.successDesc} data-flx="persona.plural-kit-import-modal.success-desc">
									<Trans>
										Successfully imported {importResults.successCount} persona(s) into your account. All avatar images
										are safely stored on your local server.
									</Trans>
								</div>
							</div>

							{importResults.warnings.length > 0 && (
								<div className={styles.warningBox} data-flx="persona.plural-kit-import-modal.warning-box">
									<div className={styles.warningHeader} data-flx="persona.plural-kit-import-modal.warning-header">
										<Warning size={18} data-flx="persona.plural-kit-import-modal.warning" />
										<span data-flx="persona.plural-kit-import-modal.span--2">
											<Trans>{importResults.warnings.length} notice(s) during import</Trans>
										</span>
									</div>
									<div className={styles.warningList} data-flx="persona.plural-kit-import-modal.warning-list">
										{importResults.warnings.map((w, idx) => (
											<div
												key={idx}
												className={styles.warningItem}
												data-flx="persona.plural-kit-import-modal.warning-item"
											>
												<div
													className={styles.warningItemName}
													data-flx="persona.plural-kit-import-modal.warning-item-name"
												>
													{w.displayName}{' '}
													<span
														style={{fontWeight: 400, color: 'var(--text-primary-muted)'}}
														data-flx="persona.plural-kit-import-modal.span--3"
													>
														<Trans>(Prefix: {w.prefix})</Trans>
													</span>
												</div>
												<div
													className={styles.warningItemDetail}
													data-flx="persona.plural-kit-import-modal.warning-item-detail"
												>
													{w.reason}
												</div>
											</div>
										))}
									</div>
								</div>
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
							disabled={!source || members.length === 0}
							onClick={handleStartImport}
							data-flx="persona.plural-kit-import-modal.button.start-import"
						>
							<Trans>Start Import</Trans>
						</Button>
					</>
				)}

				{step === 'importing' && (
					<Button variant="secondary" disabled data-flx="persona.plural-kit-import-modal.button">
						<Trans>Importing...</Trans>
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
