// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import SessionManager from '@app/features/platform/state/AuthSession';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import type {PersonaCreateRequest} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {CheckCircle, UploadSimple, Warning} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useRef, useState} from 'react';
import * as PersonaCommands from '../../commands/PersonaCommands';
import {PersonaStore} from '../../state/PersonaStore';
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

interface PKProxyTag {
	prefix?: string | null;
	suffix?: string | null;
}

interface PKMember {
	id: string;
	name: string;
	display_name?: string | null;
	avatar_url?: string | null;
	webhook_avatar_url?: string | null;
	color?: string | null;
	pronouns?: string | null;
	description?: string | null;
	system_name?: string | null;
	proxy_tags?: Array<PKProxyTag>;
}

interface PKSystemExport {
	id?: string;
	name?: string | null;
	description?: string | null;
	tag?: string | null;
	system_name?: string | null;
	avatar_url?: string | null;
	members?: Array<PKMember>;
}

interface ImportWarning {
	displayName: string;
	prefix?: string;
	reason: string;
}

export const PluralKitImportModal: React.FC<{onClose: () => void}> = observer(({onClose}) => {
	const {i18n} = useLingui();
	const [step, setStep] = useState<'select' | 'importing' | 'completed'>('select');
	const [fileName, setFileName] = useState<string | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [pkData, setPkData] = useState<PKSystemExport | null>(null);
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

	const handleFileChosen = (file: File) => {
		setFileError(null);
		setFileName(file.name);

		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				const content = e.target?.result as string;
				const parsed = JSON.parse(content) as PKSystemExport;

				if (!parsed || typeof parsed !== 'object') {
					setFileError(i18n._(FILE_INVALID_JSON_DESCRIPTOR));
					return;
				}

				if (!Array.isArray(parsed.members)) {
					setFileError(i18n._(FILE_NO_MEMBERS_DESCRIPTOR));
					return;
				}

				setPkData(parsed);
				const candidateTag =
					parsed.tag?.trim() ||
					parsed.system_name?.trim() ||
					parsed.name?.trim() ||
					parsed.members.find((m) => m.system_name?.trim())?.system_name?.trim() ||
					'';
				if (candidateTag) {
					setSystemTagOverride(candidateTag);
				}
			} catch (_err: unknown) {
				setFileError(i18n._(FILE_PARSE_FAILED_DESCRIPTOR));
			}
		};
		reader.onerror = () => {
			setFileError(i18n._(FILE_READ_FAILED_DESCRIPTOR));
		};
		reader.readAsText(file);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			handleFileChosen(e.dataTransfer.files[0]);
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
	};

	const executeImport = async () => {
		if (!pkData?.members || pkData.members.length === 0) return;

		setStep('importing');
		const members = pkData.members;
		const warnings: Array<ImportWarning> = [];

		// 1. Gather all unique remote avatar URLs
		const avatarUrls = members
			.map((m) => (m.avatar_url || m.webhook_avatar_url || '').trim())
			.filter((url) => url.length > 0 && (url.startsWith('http://') || url.startsWith('https://')));
		const uniqueAvatarUrls = Array.from(new Set(avatarUrls));
		const totalAvatars = uniqueAvatarUrls.length;

		const avatarMap = new Map<string, string>();
		const avatarErrors = new Map<string, string>();

		if (totalAvatars > 0) {
			setProgress({
				current: 0,
				total: totalAvatars,
				currentName: i18n._(PREPARING_BATCH_DESCRIPTOR),
				percent: 0,
				label: i18n._(AVATARS_DOWNLOADED_LABEL),
			});

			const BATCH_LIMIT = 500;
			for (let b = 0; b < totalAvatars; b += BATCH_LIMIT) {
				const batch = uniqueAvatarUrls.slice(b, b + BATCH_LIMIT);
				const batchStartIndex = b;

				try {
					const res = await fetch(`/api/v1${Endpoints.USER_PERSONA_IMPORT_BATCH_AVATARS}`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							...(SessionManager.token ? {Authorization: SessionManager.token} : {}),
						},
						body: JSON.stringify({urls: batch}),
					});

					if (!res.ok) {
						let errorMessage = `HTTP ${res.status}`;
						try {
							const errorJson = await res.json();
							if (errorJson.message) errorMessage = errorJson.message;
						} catch {
							// fallback
						}
						for (const url of batch) {
							avatarErrors.set(url, errorMessage);
						}
						continue;
					}

					const reader = res.body?.getReader();
					if (reader) {
						const decoder = new TextDecoder();
						let buffer = '';
						while (true) {
							const {done, value} = await reader.read();
							if (done) break;
							buffer += decoder.decode(value, {stream: true});
							const lines = buffer.split('\n');
							buffer = lines.pop() ?? '';
							for (const line of lines) {
								const trimmed = line.trim();
								if (!trimmed) continue;
								try {
									const event = JSON.parse(trimmed);
									if (event.type === 'progress') {
										if (event.url) {
											if (event.avatar_url) avatarMap.set(event.url, event.avatar_url);
											if (event.error) avatarErrors.set(event.url, event.error);
										}
										const completedOverall = batchStartIndex + event.completed;
										setProgress({
											current: completedOverall,
											total: totalAvatars,
											currentName: i18n._(
												msg({
													message: 'Downloading avatar {current} of {total}...',
													comment: 'Progress status during avatar download',
												}),
												{current: completedOverall, total: totalAvatars},
											),
											percent: Math.round((completedOverall / totalAvatars) * 100),
											label: i18n._(AVATARS_DOWNLOADED_LABEL),
										});
									} else if (event.type === 'complete' && event.results) {
										for (const [url, r] of Object.entries(
											event.results as Record<string, {avatar_url?: string; error?: string}>,
										)) {
											if (r.avatar_url) avatarMap.set(url, r.avatar_url);
											if (r.error) avatarErrors.set(url, r.error);
										}
									}
								} catch {
									// ignore partial chunk json parse errors
								}
							}
						}
						if (buffer.trim()) {
							try {
								const event = JSON.parse(buffer.trim());
								if (event.type === 'progress') {
									if (event.url) {
										if (event.avatar_url) avatarMap.set(event.url, event.avatar_url);
										if (event.error) avatarErrors.set(event.url, event.error);
									}
								} else if (event.type === 'complete' && event.results) {
									for (const [url, r] of Object.entries(
										event.results as Record<string, {avatar_url?: string; error?: string}>,
									)) {
										if (r.avatar_url) avatarMap.set(url, r.avatar_url);
										if (r.error) avatarErrors.set(url, r.error);
									}
								}
							} catch {}
						}
					}
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : 'Network error';
					for (const url of batch) {
						avatarErrors.set(url, errorMsg);
					}
				}
			}
		}

		// 2. Build imported persona objects
		const totalMembers = members.length;
		const importedPersonas: Array<PersonaCreateRequest> = [];

		for (let i = 0; i < totalMembers; i++) {
			const member = members[i];
			const displayName = (member.name || member.display_name || '').trim();
			const primaryPrefix = member.proxy_tags?.[0]?.prefix?.trim() || undefined;

			if (!displayName) {
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
				continue;
			}

			setProgress({
				current: i + 1,
				total: totalMembers,
				currentName: i18n._(
					msg({
						message: 'Configuring {name}...',
						comment: 'Progress status for configuring persona',
					}),
					{name: displayName},
				),
				percent: Math.round(((i + 1) / totalMembers) * 100),
				label: i18n._(PERSONAS_PREPARED_LABEL),
			});

			const remoteAvatarUrl = (member.avatar_url || member.webhook_avatar_url || '').trim();
			let localAvatarUrl: string | undefined;

			if (remoteAvatarUrl) {
				if (avatarMap.has(remoteAvatarUrl)) {
					localAvatarUrl = avatarMap.get(remoteAvatarUrl);
				} else if (avatarErrors.has(remoteAvatarUrl)) {
					warnings.push({
						displayName,
						prefix: primaryPrefix,
						reason: i18n._(
							msg({
								message: 'Avatar image failed to download: {error}. Persona was imported without an avatar.',
								comment: 'Import warning when avatar fails to download',
							}),
							{error: avatarErrors.get(remoteAvatarUrl) ?? 'Error'},
						),
					});
				}
			}

			let colorInt: number | undefined;
			if (member.color) {
				const cleaned = member.color.replace('#', '').trim();
				const parsedColor = parseInt(cleaned, 16);
				if (!Number.isNaN(parsedColor)) {
					colorInt = parsedColor;
				}
			}

			const uniqueMemberTags = new Set<string>();
			const personaTags: Array<{prefix?: string; suffix?: string}> = [];
			for (const t of member.proxy_tags ?? []) {
				const prefix = t.prefix?.trim() || undefined;
				const suffix = t.suffix?.trim() || undefined;
				if (!prefix && !suffix) continue;
				const key = `${prefix ?? ''}:::${suffix ?? ''}`;
				if (uniqueMemberTags.has(key)) continue;
				uniqueMemberTags.add(key);
				personaTags.push({prefix, suffix});
				if (personaTags.length >= 5) break;
			}

			importedPersonas.push({
				name: displayName,
				avatar_url: localAvatarUrl,
				pronouns: member.pronouns?.trim() || undefined,
				color: colorInt,
				bio: member.description?.trim() || undefined,
				persona_tags: personaTags,
				visibility: 'unlisted',
				external_uuid: member.id || undefined,
			});
		}

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

			if (systemTagOverride.trim()) {
				try {
					await PersonaStore.setDisplayTag(systemTagOverride.trim());
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
		if (!pkData?.members || pkData.members.length === 0) return;

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
									{fileName ? fileName : <Trans>Choose a PluralKit export (.json) or drag & drop</Trans>}
								</div>
								<div className={styles.dropzoneSubtext} data-flx="persona.plural-kit-import-modal.dropzone-subtext">
									<Trans>Supports PluralKit system export files</Trans>
								</div>
								<input
									ref={fileInputRef}
									type="file"
									accept=".json,application/json"
									className={styles.hiddenFileInput}
									onChange={(e) => {
										if (e.target.files && e.target.files.length > 0) {
											handleFileChosen(e.target.files[0]);
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

							{pkData && (
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
												{pkData.name || i18n._(msg({message: 'None', comment: 'None value'}))}{' '}
												{pkData.tag ? `(${pkData.tag})` : ''}
											</span>
										</div>
										<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row--2">
											<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label--2">
												<Trans>Total Members</Trans>
											</span>
											<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value--2">
												{pkData.members?.length ?? 0}
											</span>
										</div>
										<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row--3">
											<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label--3">
												<Trans>Members with Avatars</Trans>
											</span>
											<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value--3">
												{pkData.members?.filter((m) => Boolean(m.avatar_url || m.webhook_avatar_url)).length ?? 0}
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
																Keep your {existingCount} current persona(s) and add all {pkData.members?.length ?? 0}{' '}
																imported personas alongside them as new entries.
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
							disabled={!pkData?.members || pkData.members.length === 0}
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
