// SPDX-License-Identifier: AGPL-3.0-or-later

import {SettingsSection} from '@app/features/app/components/dialogs/shared/SettingsSection';
import {SettingsTabContainer, SettingsTabContent} from '@app/features/app/components/dialogs/shared/SettingsTabLayout';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {Button} from '@app/features/ui/button/Button';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {type SegmentedTab, SegmentedTabs} from '@app/features/ui/segmented_tabs/SegmentedTabs';
import {AvatarUploader} from '@app/features/user/components/modals/tabs/my_profile_tab/AvatarUploader';
import Users from '@app/features/user/state/Users';
import type {Persona} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/preferences_pb';
import {Info, LockSimple, LockSimpleOpen, PencilSimple, Plus, Trash, UploadSimple} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useState} from 'react';
import {type ActivePersonaMode, PersonaStore} from '../../state/PersonaStore';
import {openPluralKitImportModal} from '../modals/PluralKitImportModal';
import styles from './PersonaSettingsTab.module.css';

const ACTIVE_PERSONA_TABS: Array<SegmentedTab<ActivePersonaMode>> = [
	{id: 'off', label: 'Off'},
	{id: 'manual', label: 'Manual'},
	{id: 'last', label: 'Last Used'},
];

const ACTIVE_PERSONA_DESCRIPTIONS: Record<ActivePersonaMode, string> = {
	off: 'Untagged messages always send from your root account. Personas only speak when you type their tags (e.g. [text]).',
	manual:
		'Untagged messages send as your chosen persona. Typing another persona’s tags will only send that single message and won’t switch who is active.',
	last: 'Untagged messages send as the persona that spoke most recently. Whenever anyone uses a persona tag, they automatically become the active persona.',
};

interface PersonaFormState {
	id?: string;
	name: string;
	systemName: string;
	pronouns: string;
	avatarUrl: string;
	color: string;
	bio: string;
	tags: Array<{prefix: string; suffix: string}>;
}

const emptyFormState = (): PersonaFormState => ({
	name: '',
	systemName: '',
	pronouns: '',
	avatarUrl: '',
	color: '',
	bio: '',
	tags: [{prefix: '', suffix: ''}],
});

export const PersonaSettingsTab: React.FC = observer(() => {
	const currentUser = Users.getCurrentUser();
	const personas = PersonaStore.personas;
	const activePersonaId = PersonaStore.activePersonaId;
	const isLatched = PersonaStore.isPersonaLatched;

	const [isEditing, setIsEditing] = useState(false);
	const [formData, setFormData] = useState<PersonaFormState>(emptyFormState());
	const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

	const handleAvatarUpload = async (base64: string) => {
		setFormData((prev) => ({...prev, avatarUrl: base64}));
		setIsUploadingAvatar(true);
		try {
			const res = await http.post<{avatar_url: string}>(Endpoints.USER_PERSONA_AVATAR, {
				body: {avatar: base64},
			});
			if (res.ok && res.body?.avatar_url) {
				setFormData((prev) => ({...prev, avatarUrl: res.body.avatar_url}));
			} else {
				ToastCommands.createToast({
					type: 'error',
					children: 'Failed to upload avatar image to server',
				});
			}
		} catch {
			ToastCommands.createToast({
				type: 'error',
				children: 'Failed to upload avatar image to server',
			});
		} finally {
			setIsUploadingAvatar(false);
		}
	};

	const handleAvatarClear = () => {
		setFormData((prev) => ({...prev, avatarUrl: ''}));
	};

	const handleStartAdd = () => {
		setFormData(emptyFormState());
		setIsEditing(true);
	};

	const handleStartEdit = (persona: Persona) => {
		setFormData({
			id: persona.id,
			name: persona.name,
			systemName: persona.systemName ?? '',
			pronouns: persona.pronouns ?? '',
			avatarUrl: persona.avatarUrl ?? '',
			color: persona.color != null ? `#${persona.color.toString(16).padStart(6, '0')}` : '',
			bio: persona.bio ?? '',
			tags:
				(persona.personaTags ?? []).length > 0
					? (persona.personaTags ?? []).map((t) => ({prefix: t.prefix ?? '', suffix: t.suffix ?? ''}))
					: [{prefix: '', suffix: ''}],
		});
		setIsEditing(true);
	};

	const handleCancelEdit = () => {
		setIsEditing(false);
		setFormData(emptyFormState());
	};

	const handleSaveForm = async () => {
		if (isUploadingAvatar) {
			ToastCommands.createToast({
				type: 'info',
				children: 'Please wait for avatar image to finish uploading',
			});
			return;
		}

		const trimmedName = formData.name.trim();
		if (!trimmedName) return;

		let parsedColor: number | null = null;
		if (formData.color.trim()) {
			const cleanHex = formData.color.replace('#', '').trim();
			const parsed = Number.parseInt(cleanHex, 16);
			if (!Number.isNaN(parsed)) {
				parsedColor = parsed;
			}
		}

		const validTags = formData.tags
			.map((t) => ({prefix: t.prefix.trim() || undefined, suffix: t.suffix.trim() || undefined}))
			.filter((t) => t.prefix || t.suffix);

		if (formData.id) {
			await PersonaStore.updatePersona(formData.id, {
				name: trimmedName,
				systemName: formData.systemName.trim() || undefined,
				pronouns: formData.pronouns.trim() || undefined,
				avatarUrl: formData.avatarUrl.trim() || undefined,
				color: parsedColor ?? undefined,
				bio: formData.bio.trim() || undefined,
				personaTags: validTags.map((t) => ({
					$typeName: 'fluxer.user.preferences.v1.PersonaTag',
					prefix: t.prefix,
					suffix: t.suffix,
				})),
			});
		} else {
			await PersonaStore.addPersona({
				name: trimmedName,
				system_name: formData.systemName.trim() || null,
				pronouns: formData.pronouns.trim() || null,
				avatar_url: formData.avatarUrl.trim() || null,
				color: parsedColor,
				bio: formData.bio.trim() || null,
				persona_tags: validTags,
			});
		}

		setIsEditing(false);
		setFormData(emptyFormState());
	};

	const handleDeletePersona = async (id: string) => {
		if (confirm('Are you sure you want to delete this persona?')) {
			await PersonaStore.deletePersona(id);
		}
	};

	const activePersonaMode = PersonaStore.activePersonaMode;

	const handleModeChange = async (mode: ActivePersonaMode) => {
		await PersonaStore.setActivePersonaMode(mode);
	};

	const handleToggleActive = async (personaId: string) => {
		if (activePersonaId === personaId && isLatched) {
			await PersonaStore.unlatch();
		} else {
			await PersonaStore.setActivePersona(personaId, true);
		}
	};

	const handleAddTagRow = () => {
		setFormData((prev) => ({
			...prev,
			tags: [...prev.tags, {prefix: '', suffix: ''}],
		}));
	};

	const handleRemoveTagRow = (index: number) => {
		setFormData((prev) => ({
			...prev,
			tags: prev.tags.filter((_, i) => i !== index),
		}));
	};

	const handleTagChange = (index: number, field: 'prefix' | 'suffix', value: string) => {
		setFormData((prev) => {
			const updated = [...prev.tags];
			updated[index] = {...updated[index], [field]: value};
			return {...prev, tags: updated};
		});
	};

	return (
		<SettingsTabContainer data-flx="user.personas-settings-tab.container">
			<SettingsTabContent data-flx="user.personas-settings-tab.content">
				<div className={styles.container} data-flx="persona.settings.persona-settings-tab.container">
					{/* Header section */}
					<SettingsSection
						id="personas_general"
						title="Personas"
						description="Send messages with distinct names and avatars. Personas can represent plural system members, roleplay characters, or any other identity."
						linkable={false}
						data-flx="persona.settings.persona-settings-tab.personas-general"
					>
						<div className={styles.sectionHeader} data-flx="persona.settings.persona-settings-tab.section-header">
							<div data-flx="persona.settings.persona-settings-tab.div">
								<h4 className={styles.sectionTitle} data-flx="persona.settings.persona-settings-tab.section-title">
									Active Persona Mode
								</h4>
								<p
									className={styles.sectionDescription}
									data-flx="persona.settings.persona-settings-tab.section-description"
								>
									Choose how untagged messages and persona tags interact with your active persona.
								</p>
							</div>
						</div>
						<div
							className={styles.modeControlWrapper}
							data-flx="persona.settings.persona-settings-tab.mode-control-wrapper"
						>
							<SegmentedTabs<ActivePersonaMode>
								tabs={ACTIVE_PERSONA_TABS}
								selectedTab={activePersonaMode}
								onTabChange={(mode) => {
									void handleModeChange(mode);
								}}
								ariaLabel="Active persona mode"
								data-flx="persona.settings.persona-settings-tab.segmented-tabs"
							/>
							<div className={styles.modeHelperText} data-flx="persona.settings.persona-settings-tab.mode-helper-text">
								<Info
									size={16}
									weight="bold"
									className={styles.modeHelperIcon}
									data-flx="persona.settings.persona-settings-tab.mode-helper-icon"
								/>
								<span data-flx="persona.settings.persona-settings-tab.span">
									{ACTIVE_PERSONA_DESCRIPTIONS[activePersonaMode]}
								</span>
							</div>
						</div>
					</SettingsSection>

					{/* Editor Form */}
					{isEditing && (
						<div className={styles.editorCard} data-flx="persona.settings.persona-settings-tab.editor-card">
							<div className={styles.editorTitle} data-flx="persona.settings.persona-settings-tab.editor-title">
								{formData.id ? 'Edit Persona' : 'New Persona'}
							</div>
							<div className={styles.formGrid} data-flx="persona.settings.persona-settings-tab.form-grid">
								<div className={styles.formField} data-flx="persona.settings.persona-settings-tab.form-field">
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label">
										Name *
									</div>
									<input
										type="text"
										className={styles.textInput}
										placeholder="e.g. Alice"
										maxLength={100}
										value={formData.name}
										onChange={(e) => setFormData({...formData, name: e.target.value})}
										data-flx="persona.settings.persona-settings-tab.text-input.set-form-data"
									/>
								</div>
								<div className={styles.formField} data-flx="persona.settings.persona-settings-tab.form-field--2">
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--2">
										System Tag
									</div>
									<input
										type="text"
										className={styles.textInput}
										placeholder="e.g. Wonderland System"
										maxLength={100}
										value={formData.systemName}
										onChange={(e) => setFormData({...formData, systemName: e.target.value})}
										data-flx="persona.settings.persona-settings-tab.text-input.set-form-data--2"
									/>
								</div>
								<div className={styles.formField} data-flx="persona.settings.persona-settings-tab.form-field--3">
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--3">
										Pronouns
									</div>
									<input
										type="text"
										className={styles.textInput}
										placeholder="e.g. she/her"
										maxLength={100}
										value={formData.pronouns}
										onChange={(e) => setFormData({...formData, pronouns: e.target.value})}
										data-flx="persona.settings.persona-settings-tab.text-input.set-form-data--3"
									/>
								</div>
								<div className={styles.formField} data-flx="persona.settings.persona-settings-tab.form-field--4">
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--4">
										Color (Hex)
									</div>
									<div
										style={{display: 'flex', gap: 8, alignItems: 'center'}}
										data-flx="persona.settings.persona-settings-tab.div--2"
									>
										<input
											type="text"
											className={styles.textInput}
											placeholder="#4641D9"
											maxLength={7}
											value={formData.color}
											onChange={(e) => setFormData({...formData, color: e.target.value})}
											style={{flex: 1}}
											data-flx="persona.settings.persona-settings-tab.text-input.set-form-data--4"
										/>
										{formData.color && (
											<div
												className={styles.colorPreview}
												style={{backgroundColor: formData.color}}
												data-flx="persona.settings.persona-settings-tab.color-preview"
											/>
										)}
									</div>
								</div>
								<div
									className={styles.formField}
									style={{gridColumn: '1 / -1'}}
									data-flx="persona.settings.persona-settings-tab.form-field--5"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--5">
										Avatar
									</div>
									<div
										style={{display: 'flex', gap: 16, alignItems: 'center'}}
										data-flx="persona.settings.persona-settings-tab.div--3"
									>
										{currentUser && (
											<Avatar
												user={currentUser}
												avatarUrl={formData.avatarUrl || undefined}
												size={64}
												data-flx="persona.settings.persona-settings-tab.avatar"
											/>
										)}
										<div style={{flex: 1}} data-flx="persona.settings.persona-settings-tab.div--4">
											<AvatarUploader
												hasAvatar={Boolean(formData.avatarUrl)}
												onAvatarChange={handleAvatarUpload}
												onAvatarClear={handleAvatarClear}
												isPerGuildProfile={false}
												disabled={isUploadingAvatar}
												data-flx="persona.settings.persona-settings-tab.avatar-uploader"
											/>
										</div>
									</div>
								</div>
								<div
									className={styles.formField}
									style={{gridColumn: '1 / -1'}}
									data-flx="persona.settings.persona-settings-tab.form-field--6"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--6">
										Bio
									</div>
									<input
										type="text"
										className={styles.textInput}
										placeholder="Short description..."
										maxLength={2048}
										value={formData.bio}
										onChange={(e) => setFormData({...formData, bio: e.target.value})}
										data-flx="persona.settings.persona-settings-tab.text-input.set-form-data--5"
									/>
								</div>
								<div
									className={styles.formField}
									style={{gridColumn: '1 / -1'}}
									data-flx="persona.settings.persona-settings-tab.form-field--7"
								>
									<div
										style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}
										data-flx="persona.settings.persona-settings-tab.div--5"
									>
										<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--7">
											Persona Tags (Prefix & Suffix)
										</div>
										<Button
											variant="secondary"
											small
											leftIcon={<Plus size={14} data-flx="persona.settings.persona-settings-tab.plus" />}
											onClick={handleAddTagRow}
											data-flx="persona.settings.persona-settings-tab.button.add-tag-row"
										>
											Add Tag Pair
										</Button>
									</div>
									{formData.tags.map((tag, idx) => (
										<div key={idx} className={styles.tagRow} data-flx="persona.settings.persona-settings-tab.tag-row">
											<input
												type="text"
												className={styles.tagInput}
												placeholder="Prefix (e.g. [)"
												value={tag.prefix}
												onChange={(e) => handleTagChange(idx, 'prefix', e.target.value)}
												data-flx="persona.settings.persona-settings-tab.tag-input.tag-change.text"
											/>
											<span
												style={{color: 'var(--text-primary-muted)'}}
												data-flx="persona.settings.persona-settings-tab.span--2"
											>
												text
											</span>
											<input
												type="text"
												className={styles.tagInput}
												placeholder="Suffix (e.g. ])"
												value={tag.suffix}
												onChange={(e) => handleTagChange(idx, 'suffix', e.target.value)}
												data-flx="persona.settings.persona-settings-tab.tag-input.tag-change.text--2"
											/>
											{formData.tags.length > 1 && (
												<Button
													variant="danger"
													small
													square
													icon={<Trash size={14} data-flx="persona.settings.persona-settings-tab.trash" />}
													onClick={() => handleRemoveTagRow(idx)}
													aria-label="Remove tag pair"
													data-flx="persona.settings.persona-settings-tab.remove-tag-pair.remove-tag-row"
												/>
											)}
										</div>
									))}
								</div>
							</div>
							<div className={styles.editorActions} data-flx="persona.settings.persona-settings-tab.editor-actions">
								<Button
									variant="secondary"
									onClick={handleCancelEdit}
									data-flx="persona.settings.persona-settings-tab.button.cancel-edit"
								>
									Cancel
								</Button>
								<Button
									variant="primary"
									disabled={!formData.name.trim() || isUploadingAvatar}
									onClick={handleSaveForm}
									data-flx="persona.settings.persona-settings-tab.button.save-form"
								>
									{isUploadingAvatar ? 'Uploading avatar...' : 'Save Persona'}
								</Button>
							</div>
						</div>
					)}

					{/* Personas List */}
					<SettingsSection
						id="personas_list"
						title={`Configured Personas (${personas.length})`}
						linkable={false}
						actions={
							!isEditing && (
								<div style={{display: 'flex', gap: 8}} data-flx="persona.settings.persona-settings-tab.div--6">
									<Button
										variant="secondary"
										leftIcon={<UploadSimple size={16} data-flx="persona.settings.persona-settings-tab.upload-simple" />}
										onClick={openPluralKitImportModal}
										data-flx="persona.settings.persona-settings-tab.button.open-plural-kit-import-modal"
									>
										Import from PluralKit
									</Button>
									<Button
										variant="primary"
										leftIcon={<Plus size={16} data-flx="persona.settings.persona-settings-tab.plus--2" />}
										onClick={handleStartAdd}
										data-flx="persona.settings.persona-settings-tab.button.start-add"
									>
										Add Persona
									</Button>
								</div>
							)
						}
						data-flx="persona.settings.persona-settings-tab.personas-list"
					>
						{personas.length === 0 && !isEditing ? (
							<div className={styles.emptyState} data-flx="persona.settings.persona-settings-tab.empty-state">
								No personas created yet. Click "Add Persona" to create your first persona!
							</div>
						) : (
							<div className={styles.cardList} data-flx="persona.settings.persona-settings-tab.card-list">
								{personas.map((persona) => {
									const isThisActive = activePersonaId === persona.id && isLatched;
									return (
										<div
											key={persona.id}
											className={clsx(styles.personaCard, isThisActive && styles.activeCard)}
											data-flx="persona.settings.persona-settings-tab.persona-card"
										>
											{currentUser && (
												<Avatar
													user={currentUser}
													avatarUrl={persona.avatarUrl}
													size={40}
													data-flx="persona.settings.persona-settings-tab.avatar--2"
												/>
											)}
											<div className={styles.cardDetails} data-flx="persona.settings.persona-settings-tab.card-details">
												<div
													className={styles.cardPrimaryRow}
													data-flx="persona.settings.persona-settings-tab.card-primary-row"
												>
													<span className={styles.cardName} data-flx="persona.settings.persona-settings-tab.card-name">
														{persona.name}
													</span>
													{persona.systemName && (
														<span
															className={styles.cardSystemTag}
															data-flx="persona.settings.persona-settings-tab.card-system-tag"
														>
															[{persona.systemName}]
														</span>
													)}
													{persona.pronouns && (
														<span
															className={styles.cardPronouns}
															data-flx="persona.settings.persona-settings-tab.card-pronouns"
														>
															({persona.pronouns})
														</span>
													)}
													{persona.color != null && (
														<div
															className={styles.colorPreview}
															style={{
																width: 14,
																height: 14,
																backgroundColor: `#${persona.color.toString(16).padStart(6, '0')}`,
															}}
															data-flx="persona.settings.persona-settings-tab.color-preview--2"
														/>
													)}
												</div>
												<div
													className={styles.cardSecondaryRow}
													data-flx="persona.settings.persona-settings-tab.card-secondary-row"
												>
													{(persona.personaTags ?? []).map((t, idx) => (
														<span
															key={idx}
															className={styles.tagPill}
															data-flx="persona.settings.persona-settings-tab.tag-pill"
														>
															{`${t.prefix ?? ''}text${t.suffix ?? ''}`}
														</span>
													))}
													{persona.bio && (
														<span className={styles.cardBio} data-flx="persona.settings.persona-settings-tab.card-bio">
															{persona.bio}
														</span>
													)}
												</div>
											</div>
											<div className={styles.cardActions} data-flx="persona.settings.persona-settings-tab.card-actions">
												<Button
													variant="secondary"
													onClick={() => handleToggleActive(persona.id)}
													leftIcon={
														isThisActive ? (
															<LockSimple
																size={14}
																color="var(--brand-primary)"
																data-flx="persona.settings.persona-settings-tab.lock-simple"
															/>
														) : (
															<LockSimpleOpen
																size={14}
																data-flx="persona.settings.persona-settings-tab.lock-simple-open"
															/>
														)
													}
													aria-label={isThisActive ? 'Deactivate persona' : 'Set as active persona'}
													data-flx="persona.settings.persona-settings-tab.button.toggle-active"
												>
													{isThisActive ? 'Active' : 'Set Active'}
												</Button>
												<Button
													variant="secondary"
													leftIcon={
														<PencilSimple size={14} data-flx="persona.settings.persona-settings-tab.pencil-simple" />
													}
													onClick={() => handleStartEdit(persona)}
													aria-label="Edit persona"
													data-flx="persona.settings.persona-settings-tab.edit-persona.start-edit"
												>
													Edit
												</Button>
												<Button
													variant="danger"
													leftIcon={<Trash size={14} data-flx="persona.settings.persona-settings-tab.trash--2" />}
													onClick={() => handleDeletePersona(persona.id)}
													aria-label="Delete persona"
													data-flx="persona.settings.persona-settings-tab.delete-persona"
												>
													Delete
												</Button>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</SettingsSection>
				</div>
			</SettingsTabContent>
		</SettingsTabContainer>
	);
});
export default PersonaSettingsTab;
export const SubprofileSettingsTab = PersonaSettingsTab;
