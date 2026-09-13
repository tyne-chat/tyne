// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import type {PersonaCreateRequest} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {CheckCircle, UploadSimple, Warning} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useRef, useState} from 'react';
import * as PersonaCommands from '../../commands/PersonaCommands';
import {PersonaStore} from '../../state/PersonaStore';
import styles from './PluralKitImportModal.module.css';

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
	proxy_tags?: Array<PKProxyTag>;
}

interface PKSystemExport {
	id?: string;
	name?: string | null;
	description?: string | null;
	tag?: string | null;
	avatar_url?: string | null;
	members?: Array<PKMember>;
}

interface ImportWarning {
	displayName: string;
	prefix?: string;
	reason: string;
}

export const PluralKitImportModal: React.FC<{onClose: () => void}> = observer(({onClose}) => {
	const [step, setStep] = useState<'select' | 'importing' | 'completed'>('select');
	const [fileName, setFileName] = useState<string | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [pkData, setPkData] = useState<PKSystemExport | null>(null);
	const [systemTagOverride, setSystemTagOverride] = useState<string>('');
	const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');
	const [progress, setProgress] = useState<{current: number; total: number; currentName: string; percent: number}>({
		current: 0,
		total: 0,
		currentName: '',
		percent: 0,
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
					setFileError('The chosen file is not a valid JSON object.');
					return;
				}

				if (!Array.isArray(parsed.members)) {
					setFileError('No "members" array found in this export file.');
					return;
				}

				setPkData(parsed);
				if (parsed.tag) {
					setSystemTagOverride(parsed.tag);
				}
			} catch (_err: unknown) {
				setFileError('Failed to parse JSON file. Please ensure it is a valid PluralKit export.');
			}
		};
		reader.onerror = () => {
			setFileError('Failed to read the selected file.');
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

	const handleStartImport = async () => {
		if (!pkData?.members || pkData.members.length === 0) return;

		setStep('importing');
		const members = pkData.members;
		const total = members.length;
		const warnings: Array<ImportWarning> = [];
		const importedPersonas: Array<PersonaCreateRequest> = [];

		for (let i = 0; i < total; i++) {
			const member = members[i];
			const displayName = (member.name || member.display_name || '').trim();
			const primaryPrefix = member.proxy_tags?.[0]?.prefix?.trim() || undefined;

			if (!displayName) {
				warnings.push({
					displayName: `Member #${i + 1}`,
					reason: 'Skipped member because they have no name configured.',
				});
				setProgress({
					current: i + 1,
					total,
					currentName: '(Skipped entry)',
					percent: Math.round(((i + 1) / total) * 100),
				});
				continue;
			}

			setProgress({
				current: i + 1,
				total,
				currentName: displayName,
				percent: Math.round(((i + 1) / total) * 100),
			});

			const remoteAvatarUrl = member.avatar_url || member.webhook_avatar_url || null;
			let localAvatarUrl: string | undefined;

			if (remoteAvatarUrl) {
				try {
					const res = await http.post<{avatar_url: string; message?: string}>(Endpoints.USER_PERSONA_IMPORT_AVATAR, {
						body: {url: remoteAvatarUrl},
					});
					if (res.ok && res.body?.avatar_url) {
						localAvatarUrl = res.body.avatar_url;
					} else {
						const failureReason =
							res.body?.message || (res.status === 404 ? 'HTTP 404 Not Found' : `HTTP ${res.status || 'Failed'}`);
						warnings.push({
							displayName,
							prefix: primaryPrefix,
							reason: `Avatar image failed to download: ${failureReason}. Persona was imported without an avatar.`,
						});
					}
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : 'Network error';
					warnings.push({
						displayName,
						prefix: primaryPrefix,
						reason: `Avatar download failed: ${errorMsg}. Persona was imported without an avatar.`,
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
				system_name: systemTagOverride.trim() || undefined,
				pronouns: member.pronouns?.trim() || undefined,
				color: colorInt,
				bio: member.description?.trim() || undefined,
				persona_tags: personaTags,
				visibility: 'unlisted',
				external_uuid: member.id || undefined,
			});
		}

		if (importMode === 'replace') {
			for (const existing of PersonaStore.personas) {
				await PersonaCommands.deletePersona(existing.id).catch(() => {});
			}
		}

		try {
			await PersonaCommands.importPersonas(importedPersonas);

			setImportResults({
				successCount: importedPersonas.length,
				warnings,
			});
			setStep('completed');
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to import personas';
			ToastCommands.error(message);
			setStep('select');
		}
	};

	const modalTitle =
		step === 'select' ? 'Import from PluralKit' : step === 'importing' ? 'Importing Personas...' : 'Import Complete';

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
									{fileName ? fileName : 'Choose a PluralKit export (.json) or drag & drop'}
								</div>
								<div className={styles.dropzoneSubtext} data-flx="persona.plural-kit-import-modal.dropzone-subtext">
									Supports PluralKit system export files
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
											Export Summary
										</div>
										<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row">
											<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label">
												Detected System Name / Tag
											</span>
											<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value">
												{pkData.name || 'None'} {pkData.tag ? `(${pkData.tag})` : ''}
											</span>
										</div>
										<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row--2">
											<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label--2">
												Total Members
											</span>
											<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value--2">
												{pkData.members?.length ?? 0}
											</span>
										</div>
										<div className={styles.summaryRow} data-flx="persona.plural-kit-import-modal.summary-row--3">
											<span className={styles.summaryLabel} data-flx="persona.plural-kit-import-modal.summary-label--3">
												Members with Avatars
											</span>
											<span className={styles.summaryValue} data-flx="persona.plural-kit-import-modal.summary-value--3">
												{pkData.members?.filter((m) => Boolean(m.avatar_url || m.webhook_avatar_url)).length ?? 0}
											</span>
										</div>
									</div>

									<div className={styles.formField} data-flx="persona.plural-kit-import-modal.form-field">
										<div className={styles.formLabel} data-flx="persona.plural-kit-import-modal.form-label">
											System Tag (Applied to imported personas)
										</div>
										<input
											type="text"
											className={styles.textInput}
											value={systemTagOverride}
											onChange={(e) => setSystemTagOverride(e.target.value)}
											placeholder="Optional system badge, e.g. ⚞Seraphim⚟"
											maxLength={100}
											data-flx="persona.plural-kit-import-modal.text-input.set-system-tag-override"
										/>
									</div>

									{existingCount > 0 && (
										<div className={styles.formField} data-flx="persona.plural-kit-import-modal.form-field--2">
											<div className={styles.formLabel} data-flx="persona.plural-kit-import-modal.form-label--2">
												Import Strategy
											</div>
											<div className={styles.optionsGroup} data-flx="persona.plural-kit-import-modal.options-group">
												<label
													className={clsx(styles.radioOption, importMode === 'replace' && styles.radioOptionSelected)}
													data-flx="persona.plural-kit-import-modal.radio-option"
												>
													<input
														type="radio"
														name="importMode"
														checked={importMode === 'replace'}
														onChange={() => setImportMode('replace')}
														style={{marginTop: 3}}
														data-flx="persona.plural-kit-import-modal.input.set-import-mode.radio"
													/>
													<div data-flx="persona.plural-kit-import-modal.div">
														<div className={styles.radioTitle} data-flx="persona.plural-kit-import-modal.radio-title">
															Replace all existing personas
														</div>
														<div className={styles.radioDesc} data-flx="persona.plural-kit-import-modal.radio-desc">
															Erase all {existingCount} existing persona(s) and replace them completely with the
															imported personas.
														</div>
													</div>
												</label>
												<label
													className={clsx(styles.radioOption, importMode === 'append' && styles.radioOptionSelected)}
													data-flx="persona.plural-kit-import-modal.radio-option--2"
												>
													<input
														type="radio"
														name="importMode"
														checked={importMode === 'append'}
														onChange={() => setImportMode('append')}
														style={{marginTop: 3}}
														data-flx="persona.plural-kit-import-modal.input.set-import-mode.radio--2"
													/>
													<div data-flx="persona.plural-kit-import-modal.div--2">
														<div
															className={styles.radioTitle}
															data-flx="persona.plural-kit-import-modal.radio-title--2"
														>
															Keep existing and add new
														</div>
														<div className={styles.radioDesc} data-flx="persona.plural-kit-import-modal.radio-desc--2">
															Keep your {existingCount} current persona(s) and add all {pkData.members?.length ?? 0}{' '}
															imported personas alongside them as new entries.
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
								Processing: {progress.currentName}
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
								{progress.current} of {progress.total} members ({progress.percent}%) &bull; Downloading avatars to local
								S3
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
									Import Complete!
								</div>
								<div className={styles.successDesc} data-flx="persona.plural-kit-import-modal.success-desc">
									Successfully imported {importResults.successCount} persona(s) into your account. All avatar images are
									safely stored on your local server.
								</div>
							</div>

							{importResults.warnings.length > 0 && (
								<div className={styles.warningBox} data-flx="persona.plural-kit-import-modal.warning-box">
									<div className={styles.warningHeader} data-flx="persona.plural-kit-import-modal.warning-header">
										<Warning size={18} data-flx="persona.plural-kit-import-modal.warning" />
										<span data-flx="persona.plural-kit-import-modal.span">
											{importResults.warnings.length} notice
											{importResults.warnings.length > 1 ? 's' : ''} during import
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
														data-flx="persona.plural-kit-import-modal.span--2"
													>
														(Prefix: {w.prefix})
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
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!pkData?.members || pkData.members.length === 0}
							onClick={handleStartImport}
							data-flx="persona.plural-kit-import-modal.button.start-import"
						>
							Start Import
						</Button>
					</>
				)}

				{step === 'importing' && (
					<Button variant="secondary" disabled data-flx="persona.plural-kit-import-modal.button">
						Importing...
					</Button>
				)}

				{step === 'completed' && (
					<Button variant="primary" onClick={onClose} data-flx="persona.plural-kit-import-modal.button.close--2">
						Done
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
