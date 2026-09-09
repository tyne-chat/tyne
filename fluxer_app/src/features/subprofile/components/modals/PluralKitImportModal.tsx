// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import type {Persona} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/preferences_pb';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';
import {CheckCircle, UploadSimple, Warning} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useRef, useState} from 'react';
import {SubprofileStore} from '../../state/SubprofileStore';
import styles from './PluralKitImportModal.module.css';

let importIdCounter = 0;

interface PKProxyTag {
	prefix?: string | null;
	suffix?: string | null;
}

interface PKMember {
	id?: string;
	name?: string;
	display_name?: string | null;
	color?: string | null;
	pronouns?: string | null;
	avatar_url?: string | null;
	webhook_avatar_url?: string | null;
	description?: string | null;
	proxy_tags?: Array<PKProxyTag>;
}

interface PKExport {
	version?: number;
	name?: string;
	tag?: string;
	members?: Array<PKMember>;
}

interface ImportWarning {
	displayName: string;
	prefix: string;
	reason: string;
}

interface PluralKitImportModalProps {
	onClose: () => void;
}

type Step = 'select' | 'importing' | 'completed';
type ImportMode = 'replace' | 'append';

export const PluralKitImportModal: React.FC<PluralKitImportModalProps> = observer(({onClose}) => {
	const existingCount = SubprofileStore.personas.length;

	const [step, setStep] = useState<Step>('select');
	const [fileError, setFileError] = useState<string | null>(null);
	const [pkData, setPkData] = useState<PKExport | null>(null);
	const [fileName, setFileName] = useState<string>('');
	const [importMode, setImportMode] = useState<ImportMode>(existingCount > 0 ? 'replace' : 'append');
	const [systemTagOverride, setSystemTagOverride] = useState<string>('');

	const [progress, setProgress] = useState({
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

	const handleFileChosen = (file: File) => {
		setFileError(null);
		setFileName(file.name);
		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				const content = e.target?.result as string;
				const parsed = JSON.parse(content) as PKExport;
				if (!parsed || !Array.isArray(parsed.members)) {
					setFileError('Invalid file: PluralKit export must contain a "members" list.');
					setPkData(null);
					return;
				}
				setPkData(parsed);
				setSystemTagOverride(parsed.tag?.trim() || parsed.name?.trim() || '');
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : 'Invalid JSON file';
				setFileError(`Failed to read file: ${msg}`);
				setPkData(null);
			}
		};
		reader.onerror = () => {
			setFileError('Failed to read the selected file.');
			setPkData(null);
		};
		reader.readAsText(file);
	};

	const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			handleFileChosen(e.dataTransfer.files[0]);
		}
	};

	const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
	};

	const handleStartImport = async () => {
		if (!pkData?.members || pkData.members.length === 0) return;

		setStep('importing');
		const members = pkData.members;
		const total = members.length;
		const warnings: Array<ImportWarning> = [];
		const importedPersonas: Array<Persona> = [];

		for (let i = 0; i < total; i++) {
			const member = members[i];
			const displayName =
				member.display_name && member.display_name.trim().length > 0
					? member.display_name.trim()
					: member.name && member.name.trim().length > 0
						? member.name.trim()
						: '';

			const primaryPrefix = member.proxy_tags?.[0]?.prefix?.trim() || '(none)';

			if (!displayName) {
				warnings.push({
					displayName: member.id ? `Member [${member.id}]` : '(Unnamed entry)',
					prefix: primaryPrefix,
					reason: 'Skipped: Entry has neither display name nor name.',
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
					const res = await http.post<{avatar_url: string; message?: string}>(Endpoints.USER_SUBPROFILE_IMPORT_AVATAR, {
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
							reason: `Avatar image failed to download: ${failureReason}. Subprofile was imported without an avatar.`,
						});
					}
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : 'Network error';
					warnings.push({
						displayName,
						prefix: primaryPrefix,
						reason: `Avatar download failed: ${errorMsg}. Subprofile was imported without an avatar.`,
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

			const proxyTags = (member.proxy_tags ?? [])
				.filter((t) => t.prefix?.trim() || t.suffix?.trim())
				.map((t) => ({
					$typeName: 'fluxer.user.preferences.v1.ProxyTag' as const,
					prefix: t.prefix?.trim() || undefined,
					suffix: t.suffix?.trim() || undefined,
				}));

			const id = `${SnowflakeUtils.fromTimestamp(Date.now())}_${++importIdCounter}`;
			const persona: Persona = {
				$typeName: 'fluxer.user.preferences.v1.Persona',
				id,
				name: displayName,
				avatarUrl: localAvatarUrl,
				systemName: systemTagOverride.trim() || undefined,
				pronouns: member.pronouns?.trim() || undefined,
				color: colorInt,
				bio: member.description?.trim() || undefined,
				autoProxyDisabled: false,
				useCount: 0,
				lastUsedAtMs: 0n,
				proxyTags,
			};

			importedPersonas.push(persona);
		}

		if (importMode === 'replace') {
			await SubprofileStore.replaceAllPersonas(importedPersonas);
		} else {
			await SubprofileStore.appendPersonas(importedPersonas);
		}

		setImportResults({
			successCount: importedPersonas.length,
			warnings,
		});
		setStep('completed');
	};

	const modalTitle =
		step === 'select' ? 'Import from PluralKit' : step === 'importing' ? 'Importing Subprofiles...' : 'Import Complete';

	return (
		<Modal.Root
			size="medium"
			onClose={step === 'importing' ? () => {} : onClose}
			data-flx="subprofile.plural-kit-import-modal.modal-root"
		>
			<Modal.Header
				title={modalTitle}
				hideCloseButton={step === 'importing'}
				data-flx="subprofile.plural-kit-import-modal.modal-header"
			/>

			<Modal.Content data-flx="subprofile.plural-kit-import-modal.modal-content">
				<div className={styles.container} data-flx="subprofile.plural-kit-import-modal.container">
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
								data-flx="subprofile.plural-kit-import-modal.dropzone.click"
							>
								<UploadSimple
									size={36}
									style={{color: 'var(--brand-primary)'}}
									data-flx="subprofile.plural-kit-import-modal.upload-simple"
								/>
								<div className={styles.dropzoneText} data-flx="subprofile.plural-kit-import-modal.dropzone-text">
									{fileName ? fileName : 'Choose a PluralKit export (.json) or drag & drop'}
								</div>
								<div className={styles.dropzoneSubtext} data-flx="subprofile.plural-kit-import-modal.dropzone-subtext">
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
									data-flx="subprofile.plural-kit-import-modal.hidden-file-input"
								/>
							</div>

							{fileError && (
								<div className={styles.errorBanner} data-flx="subprofile.plural-kit-import-modal.error-banner">
									{fileError}
								</div>
							)}

							{pkData && (
								<>
									<div className={styles.summaryBox} data-flx="subprofile.plural-kit-import-modal.summary-box">
										<div className={styles.summaryTitle} data-flx="subprofile.plural-kit-import-modal.summary-title">
											Export Summary
										</div>
										<div className={styles.summaryRow} data-flx="subprofile.plural-kit-import-modal.summary-row">
											<span className={styles.summaryLabel} data-flx="subprofile.plural-kit-import-modal.summary-label">
												Detected System Name / Tag
											</span>
											<span className={styles.summaryValue} data-flx="subprofile.plural-kit-import-modal.summary-value">
												{pkData.name || 'None'} {pkData.tag ? `(${pkData.tag})` : ''}
											</span>
										</div>
										<div className={styles.summaryRow} data-flx="subprofile.plural-kit-import-modal.summary-row--2">
											<span
												className={styles.summaryLabel}
												data-flx="subprofile.plural-kit-import-modal.summary-label--2"
											>
												Total Members
											</span>
											<span
												className={styles.summaryValue}
												data-flx="subprofile.plural-kit-import-modal.summary-value--2"
											>
												{pkData.members?.length ?? 0}
											</span>
										</div>
										<div className={styles.summaryRow} data-flx="subprofile.plural-kit-import-modal.summary-row--3">
											<span
												className={styles.summaryLabel}
												data-flx="subprofile.plural-kit-import-modal.summary-label--3"
											>
												Members with Avatars
											</span>
											<span
												className={styles.summaryValue}
												data-flx="subprofile.plural-kit-import-modal.summary-value--3"
											>
												{pkData.members?.filter((m) => Boolean(m.avatar_url || m.webhook_avatar_url)).length ?? 0}
											</span>
										</div>
									</div>

									<div className={styles.formField} data-flx="subprofile.plural-kit-import-modal.form-field">
										<div className={styles.formLabel} data-flx="subprofile.plural-kit-import-modal.form-label">
											System Tag (Applied to imported personas)
										</div>
										<input
											type="text"
											className={styles.textInput}
											value={systemTagOverride}
											onChange={(e) => setSystemTagOverride(e.target.value)}
											placeholder="Optional system badge, e.g. ⚞Seraphim⚟"
											maxLength={100}
											data-flx="subprofile.plural-kit-import-modal.text-input.set-system-tag-override"
										/>
									</div>

									{existingCount > 0 && (
										<div className={styles.formField} data-flx="subprofile.plural-kit-import-modal.form-field--2">
											<div className={styles.formLabel} data-flx="subprofile.plural-kit-import-modal.form-label--2">
												Import Strategy
											</div>
											<div className={styles.optionsGroup} data-flx="subprofile.plural-kit-import-modal.options-group">
												<label
													className={clsx(styles.radioOption, importMode === 'replace' && styles.radioOptionSelected)}
													data-flx="subprofile.plural-kit-import-modal.radio-option"
												>
													<input
														type="radio"
														name="importMode"
														checked={importMode === 'replace'}
														onChange={() => setImportMode('replace')}
														style={{marginTop: 3}}
														data-flx="subprofile.plural-kit-import-modal.input.set-import-mode.radio"
													/>
													<div data-flx="subprofile.plural-kit-import-modal.div">
														<div
															className={styles.radioTitle}
															data-flx="subprofile.plural-kit-import-modal.radio-title"
														>
															Replace all existing subprofiles
														</div>
														<div className={styles.radioDesc} data-flx="subprofile.plural-kit-import-modal.radio-desc">
															Erase all {existingCount} existing subprofile(s) and replace them completely with the
															imported profiles.
														</div>
													</div>
												</label>
												<label
													className={clsx(styles.radioOption, importMode === 'append' && styles.radioOptionSelected)}
													data-flx="subprofile.plural-kit-import-modal.radio-option--2"
												>
													<input
														type="radio"
														name="importMode"
														checked={importMode === 'append'}
														onChange={() => setImportMode('append')}
														style={{marginTop: 3}}
														data-flx="subprofile.plural-kit-import-modal.input.set-import-mode.radio--2"
													/>
													<div data-flx="subprofile.plural-kit-import-modal.div--2">
														<div
															className={styles.radioTitle}
															data-flx="subprofile.plural-kit-import-modal.radio-title--2"
														>
															Keep existing and add new
														</div>
														<div
															className={styles.radioDesc}
															data-flx="subprofile.plural-kit-import-modal.radio-desc--2"
														>
															Keep your {existingCount} current subprofile(s) and add all {pkData.members?.length ?? 0}{' '}
															imported profiles alongside them as new entries.
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
						<div style={{padding: '16px 0'}} data-flx="subprofile.plural-kit-import-modal.div--3">
							<div
								className={styles.progressCurrentName}
								data-flx="subprofile.plural-kit-import-modal.progress-current-name"
							>
								Processing: {progress.currentName}
							</div>
							<div
								className={styles.progressBarContainer}
								data-flx="subprofile.plural-kit-import-modal.progress-bar-container"
							>
								<div
									className={styles.progressBarFill}
									style={{width: `${progress.percent}%`}}
									data-flx="subprofile.plural-kit-import-modal.progress-bar-fill"
								/>
							</div>
							<div className={styles.progressDetail} data-flx="subprofile.plural-kit-import-modal.progress-detail">
								{progress.current} of {progress.total} members ({progress.percent}%) &bull; Downloading avatars to local
								S3
							</div>
						</div>
					)}

					{/* STEP 3: COMPLETED & WARNINGS */}
					{step === 'completed' && (
						<>
							<div className={styles.successBox} data-flx="subprofile.plural-kit-import-modal.success-box">
								<CheckCircle
									size={36}
									style={{color: 'var(--accent-success)', marginBottom: 8}}
									data-flx="subprofile.plural-kit-import-modal.check-circle"
								/>
								<div className={styles.successTitle} data-flx="subprofile.plural-kit-import-modal.success-title">
									Import Complete!
								</div>
								<div className={styles.successDesc} data-flx="subprofile.plural-kit-import-modal.success-desc">
									Successfully imported {importResults.successCount} subprofile(s) into your account. All avatar images
									are safely stored on your local server.
								</div>
							</div>

							{importResults.warnings.length > 0 && (
								<div className={styles.warningBox} data-flx="subprofile.plural-kit-import-modal.warning-box">
									<div className={styles.warningHeader} data-flx="subprofile.plural-kit-import-modal.warning-header">
										<Warning size={18} data-flx="subprofile.plural-kit-import-modal.warning" />
										<span data-flx="subprofile.plural-kit-import-modal.span">
											{importResults.warnings.length} notice
											{importResults.warnings.length > 1 ? 's' : ''} during import
										</span>
									</div>
									<div className={styles.warningList} data-flx="subprofile.plural-kit-import-modal.warning-list">
										{importResults.warnings.map((w, idx) => (
											<div
												key={idx}
												className={styles.warningItem}
												data-flx="subprofile.plural-kit-import-modal.warning-item"
											>
												<div
													className={styles.warningItemName}
													data-flx="subprofile.plural-kit-import-modal.warning-item-name"
												>
													{w.displayName}{' '}
													<span
														style={{fontWeight: 400, color: 'var(--text-primary-muted)'}}
														data-flx="subprofile.plural-kit-import-modal.span--2"
													>
														(Prefix: {w.prefix})
													</span>
												</div>
												<div
													className={styles.warningItemDetail}
													data-flx="subprofile.plural-kit-import-modal.warning-item-detail"
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

			<Modal.Footer data-flx="subprofile.plural-kit-import-modal.modal-footer">
				{step === 'select' && (
					<>
						<Button variant="secondary" onClick={onClose} data-flx="subprofile.plural-kit-import-modal.button.close">
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!pkData?.members || pkData.members.length === 0}
							onClick={handleStartImport}
							data-flx="subprofile.plural-kit-import-modal.button.start-import"
						>
							Start Import
						</Button>
					</>
				)}

				{step === 'importing' && (
					<Button variant="secondary" disabled data-flx="subprofile.plural-kit-import-modal.button">
						Importing...
					</Button>
				)}

				{step === 'completed' && (
					<Button variant="primary" onClick={onClose} data-flx="subprofile.plural-kit-import-modal.button.close--2">
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
				data-flx="subprofile.plural-kit-import-modal.open-plural-kit-import-modal.plural-kit-import-modal"
			/>
		)),
	);
}
