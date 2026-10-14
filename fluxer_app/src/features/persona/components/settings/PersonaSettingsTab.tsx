// SPDX-License-Identifier: AGPL-3.0-or-later

import {SettingsSection} from '@app/features/app/components/dialogs/shared/SettingsSection';
import {SettingsTabContainer, SettingsTabContent} from '@app/features/app/components/dialogs/shared/SettingsTabLayout';
import {AVATAR_RECOMMENDED_SIZE_LABEL, STATIC_IMAGE_FORMATS} from '@app/features/app/config/I18nDisplayConstants';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import {useHover} from '@app/features/app/hooks/useHover';
import {useShouldAnimate} from '@app/features/app/hooks/useShouldAnimate';
import {GlobalLimits} from '@app/features/app/utils/GlobalLimits';
import {AssetCropModal, AssetType} from '@app/features/expressions/components/modals/AssetCropModal';
import {openAssetSourceModal} from '@app/features/expressions/components/modals/AssetSourceModal';
import {isAnimatedFile} from '@app/features/expressions/utils/AnimatedImageUtils';
import {formatImageUploadRecommendedHint} from '@app/features/expressions/utils/AssetUploadHintCopy';
import {downloadGifAsImageFile} from '@app/features/expressions/utils/GifFileDownload';
import {isSvgFile, readImageFileAsUploadDataUrl} from '@app/features/expressions/utils/ImageUploadFileUtils';
import {CLEAR_SEARCH_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {openFilePicker} from '@app/features/messaging/utils/FilePickerUtils';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {http} from '@app/features/platform/transport/RestTransport';
import {readBlobAsDataUrl} from '@app/features/platform/utils/BlobDataUrl';
import {downloadBlob} from '@app/features/platform/utils/DownloadFile';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import * as UnsavedChangesCommands from '@app/features/ui/commands/UnsavedChangesCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Input} from '@app/features/ui/components/form/FormInput';
import {RadioGroup, type RadioOption} from '@app/features/ui/radio_group/RadioGroup';
import type {SegmentedTab} from '@app/features/ui/segmented_tabs/SegmentedTabs';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {getAcceptString} from '@fluxer/constants/src/AssetFormatPolicy';
import type {ActivePersonaScope} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {
	CaretRight,
	DownloadSimple,
	GlobeSimple,
	LockSimple,
	LockSimpleOpen,
	MagnifyingGlass,
	Plus,
	UploadSimple,
	X,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as PersonaCommands from '../../commands/PersonaCommands';
import {type ActivePersonaMode, type Persona, PersonaStore} from '../../state/PersonaStore';
import {openPersonaEditModal} from '../modals/PersonaEditModal';
import {openPluralKitImportModal} from '../modals/PluralKitImportModal';
import {SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR} from '../PersonaPickerSheet';
import {PersonaTag} from '../PersonaTag';
import styles from './PersonaSettingsTab.module.css';

const MODE_MANUAL_DESCRIPTOR = msg({
	message: 'Manual',
	comment: 'Active persona mode manual',
});
const MODE_LAST_DESCRIPTOR = msg({
	message: 'Last used',
	comment: 'Active persona mode last used',
});

const ACTIVE_PERSONA_MODE_MANUAL_DESC = msg({
	message: 'Untagged messages send as the persona you picked. A tag applies to that message only.',
	comment: 'Helper description for Manual persona mode',
});
const ACTIVE_PERSONA_MODE_LAST_DESC = msg({
	message: 'Untagged messages send as whoever spoke last. Using a tag switches to that persona.',
	comment: 'Helper description for Last Used persona mode',
});

const SCOPE_GLOBAL_DESCRIPTOR = msg({
	message: 'Everywhere',
	comment: 'Option for where the selected persona applies: one persona for every channel',
});
const SCOPE_CHANNEL_DESCRIPTOR = msg({
	message: 'In each channel',
	comment: 'Option for where the selected persona applies: each channel remembers its own persona',
});
const SCOPE_GLOBAL_DESC = msg({
	message: 'One persona for all channels.',
	comment: 'Helper description for the Everywhere option of the persona scope setting',
});
const SCOPE_CHANNEL_DESC = msg({
	message: 'Each channel keeps its own persona. New channels start as your account.',
	comment: 'Helper description for the In Each Channel option of the persona scope setting',
});
const SCOPE_ARIA_DESCRIPTOR = msg({
	message: 'Where your persona is remembered',
	comment: 'Aria label for the tabs that choose whether the selected persona applies everywhere or per channel',
});

const ACTIVE_PERSONA_MODE_ARIA_DESCRIPTOR = msg({
	message: 'Active persona mode',
	comment: 'Aria label for active persona mode tabs',
});

const EXPORT_FAILED_DESCRIPTOR = msg({
	message: 'Could not export your personas.',
	comment: 'Toast when downloading the persona export fails',
});
const FAILED_TO_UPLOAD_ICON_DESCRIPTOR = msg({
	message: 'Failed to upload icon to server',
	comment: 'Toast when icon upload fails',
});
const ICON_FILE_TOO_LARGE_DESCRIPTOR = msg({
	message: 'Icon file is too large. Choose an image smaller than 10MB.',
	comment: 'Toast when icon file exceeds size limit',
});
const PUBLIC_PERSONA_TOOLTIP_DESCRIPTOR = msg({
	message: 'Public persona',
	comment: 'Tooltip on public persona badge',
});
const PRIVATE_PERSONA_TOOLTIP_DESCRIPTOR = msg({
	message: 'Private persona',
	comment: 'Tooltip on private persona badge',
});
const SET_ACTIVE_PERSONA_ARIA_DESCRIPTOR = msg({
	message: 'Set as active persona',
	comment: 'Aria label for setting active persona',
});
const DEACTIVATE_PERSONA_ARIA_DESCRIPTOR = msg({
	message: 'Deactivate persona',
	comment: 'Aria label for deactivating active persona',
});
const EDIT_PERSONA_ARIA_DESCRIPTOR = msg({
	message: 'Edit persona',
	comment: 'Aria label for editing persona',
});
const CONFIG_PERSONAS_COUNT_DESCRIPTOR = msg({
	message: 'Configured Personas ({count})',
	comment: 'Header for configured personas list with count',
});

const getActivePersonaTabs = (i18n: I18n): Array<SegmentedTab<ActivePersonaMode>> => [
	{id: 'manual', label: i18n._(MODE_MANUAL_DESCRIPTOR)},
	{id: 'last', label: i18n._(MODE_LAST_DESCRIPTOR)},
];

const getActivePersonaDescriptions = (i18n: I18n): Record<ActivePersonaMode, string> => ({
	manual: i18n._(ACTIVE_PERSONA_MODE_MANUAL_DESC),
	last: i18n._(ACTIVE_PERSONA_MODE_LAST_DESC),
});

export interface PersonaSettingsTabProps {
	initialSubtab?: string;
}

export const PersonaSettingsTab: React.FC<PersonaSettingsTabProps> = observer(({initialSubtab}) => {
	const {i18n} = useLingui();
	const personas = PersonaStore.sortedPersonas;
	const activePersonaId = PersonaStore.activePersonaId;
	const isLatched = PersonaStore.isPersonaLatched;
	const activePersonaMode = PersonaStore.activePersonaMode;
	const activePersonaScope = PersonaStore.activePersonaScope;
	const currentUser = Users.currentUser;

	const [searchQuery, setSearchQuery] = useState('');

	// Display tag state
	const [tagText, setTagText] = useState(PersonaStore.displayTagText);
	const [tagIcon, setTagIcon] = useState(PersonaStore.displayTagIcon);
	const [isUploadingTagIcon, setIsUploadingTagIcon] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const staticTagIconUrl = useMemo(() => {
		if (!tagIcon) return null;
		if (tagIcon.startsWith('http://') || tagIcon.startsWith('https://') || tagIcon.startsWith('data:')) {
			return tagIcon;
		}
		const currentUserId = Users.currentUser?.id;
		return currentUserId ? AvatarUtils.getUserAvatarURL({id: currentUserId, avatar: tagIcon}, false, 32) : tagIcon;
	}, [tagIcon]);

	const hoverTagIconUrl = useMemo(() => {
		if (!tagIcon) return null;
		if (tagIcon.startsWith('http://') || tagIcon.startsWith('https://') || tagIcon.startsWith('data:')) {
			return tagIcon;
		}
		const currentUserId = Users.currentUser?.id;
		return currentUserId ? AvatarUtils.getUserAvatarURL({id: currentUserId, avatar: tagIcon}, true, 32) : tagIcon;
	}, [tagIcon]);

	const [tagIconHoverRef, isTagIconHovering] = useHover();
	const hasDistinctTagIconHover = Boolean(hoverTagIconUrl && hoverTagIconUrl !== staticTagIconUrl);
	const shouldAnimateTagIcon = useShouldAnimate({
		kind: 'avatar',
		isAnimated: hasDistinctTagIconHover,
		isHovering: hasDistinctTagIconHover && isTagIconHovering,
	});
	const resolvedTagIconUrl = shouldAnimateTagIcon ? hoverTagIconUrl : staticTagIconUrl;

	const [previewCardHoverRef, isPreviewCardHovering] = useHover();

	const syncedStoreTagTextRef = useRef(PersonaStore.displayTagText);
	const syncedStoreTagIconRef = useRef(PersonaStore.displayTagIcon);

	if (syncedStoreTagTextRef.current !== PersonaStore.displayTagText) {
		if (tagText === syncedStoreTagTextRef.current) {
			setTagText(PersonaStore.displayTagText);
		}
		syncedStoreTagTextRef.current = PersonaStore.displayTagText;
	}

	if (syncedStoreTagIconRef.current !== PersonaStore.displayTagIcon) {
		if (tagIcon === syncedStoreTagIconRef.current) {
			setTagIcon(PersonaStore.displayTagIcon);
		}
		syncedStoreTagIconRef.current = PersonaStore.displayTagIcon;
	}

	const isTagDirty =
		(tagText ?? '').trim() !== (PersonaStore.displayTagText ?? '').trim() ||
		(tagIcon ?? null) !== (PersonaStore.displayTagIcon ?? null);

	const handleReset = useCallback(() => {
		setTagText(PersonaStore.displayTagText);
		setTagIcon(PersonaStore.displayTagIcon);
		syncedStoreTagTextRef.current = PersonaStore.displayTagText;
		syncedStoreTagIconRef.current = PersonaStore.displayTagIcon;
	}, []);

	const handleSave = useCallback(async () => {
		setIsSubmitting(true);
		try {
			await PersonaStore.setDisplayTag(tagText, tagIcon);
			syncedStoreTagTextRef.current = tagText;
			syncedStoreTagIconRef.current = tagIcon;
		} finally {
			setIsSubmitting(false);
		}
	}, [tagText, tagIcon]);

	useEffect(() => {
		UnsavedChangesCommands.setUnsavedChanges('personas', isTagDirty);
		UnsavedChangesCommands.setUnsavedChanges('subprofiles', isTagDirty);
	}, [isTagDirty]);

	useEffect(() => {
		const data = {
			onReset: handleReset,
			onSave: handleSave,
			isSubmitting,
		};
		UnsavedChangesCommands.setTabData('personas', data);
		UnsavedChangesCommands.setTabData('subprofiles', data);
	}, [handleReset, handleSave, isSubmitting]);

	useEffect(() => {
		return () => {
			UnsavedChangesCommands.clearUnsavedChanges('personas');
			UnsavedChangesCommands.clearUnsavedChanges('subprofiles');
		};
	}, []);

	// Deep link subtab support
	const lastHandledSubtabRef = useRef<string | null>(null);
	useEffect(() => {
		if (!initialSubtab || lastHandledSubtabRef.current === initialSubtab) {
			return;
		}
		if (initialSubtab === 'new') {
			lastHandledSubtabRef.current = initialSubtab;
			openPersonaEditModal();
		} else {
			const target = personas.find((p) => p.id === initialSubtab);
			if (target) {
				lastHandledSubtabRef.current = initialSubtab;
				openPersonaEditModal(target);
			}
		}
	}, [initialSubtab, personas]);

	const activePersonaTabs = useMemo(() => getActivePersonaTabs(i18n), [i18n]);
	const activePersonaDescriptions = useMemo(() => getActivePersonaDescriptions(i18n), [i18n]);
	const modeOptions = useMemo<Array<RadioOption<ActivePersonaMode>>>(
		() => activePersonaTabs.map((tab) => ({value: tab.id, name: tab.label, desc: activePersonaDescriptions[tab.id]})),
		[activePersonaTabs, activePersonaDescriptions],
	);
	const scopeOptions = useMemo<Array<RadioOption<ActivePersonaScope>>>(
		() => [
			{value: 'global', name: i18n._(SCOPE_GLOBAL_DESCRIPTOR), desc: i18n._(SCOPE_GLOBAL_DESC)},
			{value: 'channel', name: i18n._(SCOPE_CHANNEL_DESCRIPTOR), desc: i18n._(SCOPE_CHANNEL_DESC)},
		],
		[i18n],
	);

	const query = searchQuery.trim().toLowerCase();
	const filteredPersonaIds = (
		query
			? personas.filter((p) => {
					const nameMatch = p.name.toLowerCase().includes(query);
					const pronounsMatch = (p.pronouns ?? '').toLowerCase().includes(query);
					const tags = p.persona_tags ?? [];
					const tagMatch = tags.some(
						(t) => (t.prefix ?? '').toLowerCase().includes(query) || (t.suffix ?? '').toLowerCase().includes(query),
					);
					return nameMatch || pronounsMatch || tagMatch;
				})
			: personas
	).map((p) => p.id);

	const handleTagTextChange = (value: string) => {
		setTagText(value);
	};

	const handleTagIconUpload = useCallback(
		async (base64: string) => {
			setIsUploadingTagIcon(true);
			try {
				const res = await http.post<{avatar_hash?: string}>(Endpoints.USER_PERSONA_AVATAR, {
					body: {avatar: base64},
				});
				if (res.ok && res.body?.avatar_hash) {
					setTagIcon(res.body.avatar_hash);
				} else {
					ToastCommands.createToast({
						type: 'error',
						children: i18n._(FAILED_TO_UPLOAD_ICON_DESCRIPTOR),
					});
				}
			} catch {
				ToastCommands.createToast({
					type: 'error',
					children: i18n._(FAILED_TO_UPLOAD_ICON_DESCRIPTOR),
				});
			} finally {
				setIsUploadingTagIcon(false);
			}
		},
		[i18n],
	);

	const handleClearTagIcon = useCallback(() => {
		setTagIcon(null);
	}, []);

	const processTagIconFile = useCallback(
		async (file: File) => {
			if (file.size > 10 * 1024 * 1024) {
				ToastCommands.createToast({
					type: 'error',
					children: i18n._(ICON_FILE_TOO_LARGE_DESCRIPTOR),
				});
				return;
			}
			const svg = isSvgFile(file);
			const animated = svg ? false : await isAnimatedFile(file);
			const base64 = svg ? await readImageFileAsUploadDataUrl(file) : await readBlobAsDataUrl(file);
			if (animated || svg) {
				await handleTagIconUpload(base64);
				return;
			}
			ModalCommands.push(
				modal(() => (
					<AssetCropModal
						assetType={AssetType.AVATAR}
						imageUrl={base64}
						onCropComplete={(croppedBlob) => {
							const reader = new FileReader();
							reader.onload = () => {
								const croppedBase64 = reader.result as string;
								void handleTagIconUpload(croppedBase64);
							};
							reader.readAsDataURL(croppedBlob);
						}}
						onSkip={() => {
							void handleTagIconUpload(base64);
						}}
						data-flx="user.persona-settings-tab.tag-icon.asset-crop-modal"
					/>
				)),
			);
		},
		[handleTagIconUpload, i18n],
	);

	const handleOpenTagIconUpload = useCallback(() => {
		openAssetSourceModal({
			title: 'Tag Icon',
			uploadHint: formatImageUploadRecommendedHint(i18n, {
				formats: STATIC_IMAGE_FORMATS,
				maxSize: formatFileSize(i18n.locale, GlobalLimits.getAvatarMaxSize()),
				recommendedSize: AVATAR_RECOMMENDED_SIZE_LABEL,
			}),
			onPickUpload: async () => {
				try {
					const [file] = await openFilePicker({accept: getAcceptString('avatar')});
					if (!file) return;
					await processTagIconFile(file);
				} catch {
					ToastCommands.createToast({
						type: 'error',
						children: 'Failed to select icon image',
					});
				}
			},
			onSelectGif: (gif) => {
				void (async () => {
					try {
						const file = await downloadGifAsImageFile(gif);
						await processTagIconFile(file);
					} catch {
						ToastCommands.createToast({
							type: 'error',
							children: 'Failed to select GIF icon',
						});
					}
				})();
			},
			showGifOption: true,
		});
	}, [i18n, processTagIconFile]);

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

	const [isExporting, setIsExporting] = useState(false);
	const handleExport = async () => {
		setIsExporting(true);
		try {
			const {blob, fileName} = await PersonaCommands.exportPersonas();
			downloadBlob(blob, fileName);
		} catch {
			ToastCommands.createToast({type: 'error', children: i18n._(EXPORT_FAILED_DESCRIPTOR)});
		} finally {
			setIsExporting(false);
		}
	};

	const handleStartAdd = () => {
		openPersonaEditModal();
	};

	const handleStartEdit = (persona: Persona) => {
		openPersonaEditModal(persona);
	};

	return (
		<SettingsTabContainer data-flx="user.personas-settings-tab.container">
			<SettingsTabContent data-flx="user.personas-settings-tab.content">
				<div className={styles.container} data-flx="persona.settings.persona-settings-tab.container">
					{/* One section per setting, as on the other settings pages. */}
					<SettingsSection
						id="personas_mode"
						title={
							<Trans comment="Title of the setting for how the active persona is chosen">Active persona mode</Trans>
						}
						linkable={false}
						data-flx="persona.settings.persona-settings-tab.personas-mode"
					>
						<RadioGroup
							options={modeOptions}
							value={activePersonaMode}
							onChange={(mode) => {
								void handleModeChange(mode);
							}}
							aria-label={i18n._(ACTIVE_PERSONA_MODE_ARIA_DESCRIPTOR)}
							data-flx="user.personas-settings-tab.mode.radio-group"
						/>
					</SettingsSection>

					<SettingsSection
						id="personas_scope"
						title={
							<Trans comment="Title of the setting that chooses whether the selected persona applies in every channel or is remembered per channel. Shown under the Active persona mode setting.">
								Persona applies to
							</Trans>
						}
						linkable={false}
						data-flx="persona.settings.persona-settings-tab.personas-scope"
					>
						<RadioGroup
							options={scopeOptions}
							value={activePersonaScope}
							onChange={(scope) => {
								void PersonaStore.setActivePersonaScope(scope);
							}}
							aria-label={i18n._(SCOPE_ARIA_DESCRIPTOR)}
							data-flx="user.personas-settings-tab.scope.radio-group"
						/>
					</SettingsSection>

					<SettingsSection
						id="personas_display_tag"
						title={<Trans comment="Title of the display tag setting on the personas settings page">Display tag</Trans>}
						description={
							<Trans>
								Display tag will appear next to all persona names in messages. If no display tag is set, your account
								profile picture will be shown.
							</Trans>
						}
						linkable={false}
						data-flx="persona.settings.persona-settings-tab.personas-display-tag"
					>
						<div
							className={styles.displayTagControlWrapper}
							data-flx="persona.settings.persona-settings-tab.display-tag-control-wrapper"
						>
							<div
								className={styles.displayTagInputs}
								data-flx="persona.settings.persona-settings-tab.display-tag-inputs"
							>
								<div
									className={styles.displayTagTextField}
									data-flx="persona.settings.persona-settings-tab.display-tag-text-field"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label">
										<Trans>Tag Text</Trans>
									</div>
									<input
										type="text"
										className={styles.textInput}
										placeholder="e.g. Wonderland"
										maxLength={32}
										value={tagText}
										onChange={(e) => handleTagTextChange(e.target.value)}
										data-flx="persona.settings.persona-settings-tab.text-input.tag-text-change"
									/>
								</div>
								<div
									className={styles.displayTagIconField}
									data-flx="persona.settings.persona-settings-tab.display-tag-icon-field"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--2">
										<Trans>Tag Icon</Trans>
									</div>
									<div className={styles.tagIconRow} data-flx="persona.settings.persona-settings-tab.tag-icon-row">
										{tagIcon ? (
											<>
												<img
													ref={tagIconHoverRef}
													src={resolvedTagIconUrl ?? tagIcon}
													alt="Tag Icon"
													className={styles.tagIconImage}
													data-flx="persona.settings.persona-settings-tab.tag-icon-image"
												/>
												<Button
													variant="secondary"
													small={true}
													onClick={handleOpenTagIconUpload}
													disabled={isUploadingTagIcon}
													data-flx="persona.settings.persona-settings-tab.button.open-tag-icon-upload"
												>
													<Trans>Change icon</Trans>
												</Button>
												<Button
													variant="secondary"
													small={true}
													onClick={handleClearTagIcon}
													disabled={isUploadingTagIcon}
													data-flx="persona.settings.persona-settings-tab.button.clear-tag-icon"
												>
													<Trans>Remove icon</Trans>
												</Button>
											</>
										) : (
											<Button
												variant="primary"
												small={true}
												onClick={handleOpenTagIconUpload}
												disabled={isUploadingTagIcon}
												data-flx="persona.settings.persona-settings-tab.button.open-tag-icon-upload--2"
											>
												<Trans>Upload icon</Trans>
											</Button>
										)}
									</div>
								</div>
							</div>
							{/* Live Preview Card */}
							<div
								className={styles.previewContainer}
								data-flx="persona.settings.persona-settings-tab.preview-container"
							>
								<div className={styles.previewLabel} data-flx="persona.settings.persona-settings-tab.preview-label">
									<Trans>Preview</Trans>
								</div>
								<div
									ref={previewCardHoverRef}
									className={styles.previewCard}
									data-flx="persona.settings.persona-settings-tab.preview-card"
								>
									{currentUser && (
										<Avatar
											user={currentUser}
											size={40}
											className={styles.previewAvatar}
											forceAnimate={isPreviewCardHovering}
											data-flx="persona.settings.persona-settings-tab.preview-avatar"
										/>
									)}
									<div
										className={styles.previewMessageContent}
										data-flx="persona.settings.persona-settings-tab.preview-message-content"
									>
										<div
											className={styles.previewHeader}
											data-flx="persona.settings.persona-settings-tab.preview-header"
										>
											<span
												className={styles.previewName}
												data-flx="persona.settings.persona-settings-tab.preview-name"
											>
												Alice
											</span>
											{currentUser && (
												<PersonaTag
													subprofile={{
														id: 'preview',
														name: 'Alice',
														display_tag_text: tagText.trim(),
														display_tag_icon: tagIcon,
													}}
													rootUser={currentUser}
													isHovering={isPreviewCardHovering}
													data-flx="persona.settings.persona-settings-tab.persona-tag"
												/>
											)}
											<span
												className={styles.previewTimestamp}
												data-flx="persona.settings.persona-settings-tab.preview-timestamp"
											>
												<Trans>— Today at 12:00 PM</Trans>
											</span>
										</div>
										<div className={styles.previewBody} data-flx="persona.settings.persona-settings-tab.preview-body">
											{tagText.trim() || tagIcon ? (
												<Trans>This is a preview of how your display tag will look in chat.</Trans>
											) : (
												<Trans>No display tag configured. Messages will show your account profile picture.</Trans>
											)}
										</div>
									</div>
								</div>
							</div>
						</div>
					</SettingsSection>

					{/* Personas List */}
					<SettingsSection
						id="personas_list"
						title={i18n._(CONFIG_PERSONAS_COUNT_DESCRIPTOR, {
							count: searchQuery.trim() ? filteredPersonaIds.length : personas.length,
						})}
						linkable={false}
						actions={
							<div style={{display: 'flex', gap: 8}} data-flx="persona.settings.persona-settings-tab.div">
								<Button
									variant="secondary"
									leftIcon={<UploadSimple size={16} data-flx="persona.settings.persona-settings-tab.upload-simple" />}
									onClick={openPluralKitImportModal}
									data-flx="persona.settings.persona-settings-tab.button.open-plural-kit-import-modal"
								>
									<Trans>Import from PluralKit</Trans>
								</Button>
								<Button
									variant="secondary"
									leftIcon={
										<DownloadSimple size={16} data-flx="persona.settings.persona-settings-tab.download-simple" />
									}
									onClick={() => void handleExport()}
									submitting={isExporting}
									data-flx="persona.settings.persona-settings-tab.button"
								>
									<Trans>Export</Trans>
								</Button>
								<Button
									variant="primary"
									leftIcon={<Plus size={16} data-flx="persona.settings.persona-settings-tab.plus" />}
									onClick={handleStartAdd}
									data-flx="persona.settings.persona-settings-tab.button.start-add"
								>
									<Trans>Add Persona</Trans>
								</Button>
							</div>
						}
						data-flx="persona.settings.persona-settings-tab.personas-list"
					>
						{personas.length > 0 && (
							<div className={styles.listControls} data-flx="persona.settings.persona-settings-tab.list-controls">
								<Input
									type="text"
									placeholder={i18n._(SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR)}
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									leftIcon={
										<MagnifyingGlass
											size={16}
											weight="bold"
											className={styles.searchIcon}
											data-flx="persona.settings.persona-settings-tab.search-icon"
										/>
									}
									rightElement={
										searchQuery ? (
											<button
												type="button"
												onClick={() => setSearchQuery('')}
												className={styles.clearSearchButton}
												aria-label={i18n._(CLEAR_SEARCH_DESCRIPTOR)}
												data-flx="persona.settings.persona-settings-tab.clear-search-button.set-search-query"
											>
												<X size={14} weight="bold" data-flx="persona.settings.persona-settings-tab.x" />
											</button>
										) : undefined
									}
									className={styles.searchInput}
									data-flx="user.persona-settings-tab.search-input"
								/>
							</div>
						)}

						{personas.length === 0 ? (
							<div className={styles.emptyState} data-flx="persona.settings.persona-settings-tab.empty-state">
								<Trans>No personas created yet. Click "Add Persona" to create your first persona!</Trans>
							</div>
						) : filteredPersonaIds.length === 0 ? (
							<div className={styles.emptyState} data-flx="persona.settings.persona-settings-tab.empty-state--2">
								<Trans>No matching personas found.</Trans>
							</div>
						) : (
							<div className={styles.cardList} data-flx="persona.settings.persona-settings-tab.card-list">
								{filteredPersonaIds.map((personaId) => {
									const persona = PersonaStore.getPersona(personaId);
									if (!persona) return null;
									// With a persona per channel there is no single active one to show or set from here.
									const isThisActive = activePersonaScope === 'global' && activePersonaId === persona.id && isLatched;
									return (
										// biome-ignore lint/a11y/noStaticElementInteractions: mouse convenience; the card's edit button is the keyboard affordance.
										// biome-ignore lint/a11y/useKeyWithClickEvents: mouse convenience; the card's edit button is the keyboard affordance.
										<div
											key={persona.id}
											className={clsx(styles.compactPersonaCard, isThisActive && styles.activeCard)}
											onClick={() => handleStartEdit(persona)}
											data-flx="persona.settings.persona-settings-tab.compact-persona-card.start-edit"
										>
											{currentUser && (
												<PersonaAvatar
													user={currentUser}
													persona={PersonaStore.getKnownPersona(persona.id)}
													size={36}
													data-flx="persona.settings.persona-settings-tab.persona-avatar"
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
													{persona.pronouns && (
														<span
															className={styles.cardPronouns}
															title={persona.pronouns}
															data-flx="persona.settings.persona-settings-tab.card-pronouns"
														>
															({persona.pronouns})
														</span>
													)}
													{persona.color != null && persona.color !== 0 && (
														<div
															className={styles.colorPreview}
															style={{
																width: 12,
																height: 12,
																backgroundColor: `#${persona.color.toString(16).padStart(6, '0')}`,
															}}
															data-flx="persona.settings.persona-settings-tab.color-preview"
														/>
													)}
													{persona.visibility === 'public' && (
														<Tooltip
															text={i18n._(PUBLIC_PERSONA_TOOLTIP_DESCRIPTOR)}
															position="top"
															data-flx="persona.settings.persona-settings-tab.tooltip"
														>
															<span
																className={styles.visibilityIcon}
																role="img"
																aria-label={i18n._(PUBLIC_PERSONA_TOOLTIP_DESCRIPTOR)}
																data-flx="persona.settings.persona-settings-tab.visibility-icon"
															>
																<GlobeSimple
																	size={14}
																	weight="bold"
																	className={styles.iconPublic}
																	data-flx="persona.settings.persona-settings-tab.icon-public"
																/>
															</span>
														</Tooltip>
													)}
													{persona.visibility === 'private' && (
														<Tooltip
															text={i18n._(PRIVATE_PERSONA_TOOLTIP_DESCRIPTOR)}
															position="top"
															data-flx="persona.settings.persona-settings-tab.tooltip--2"
														>
															<span
																className={styles.visibilityIcon}
																role="img"
																aria-label={i18n._(PRIVATE_PERSONA_TOOLTIP_DESCRIPTOR)}
																data-flx="persona.settings.persona-settings-tab.visibility-icon--2"
															>
																<LockSimple
																	size={14}
																	weight="bold"
																	className={styles.iconPrivate}
																	data-flx="persona.settings.persona-settings-tab.icon-private"
																/>
															</span>
														</Tooltip>
													)}
												</div>
												<div
													className={styles.cardSecondaryRow}
													data-flx="persona.settings.persona-settings-tab.card-secondary-row"
												>
													{(persona.persona_tags ?? []).map((t, idx) => (
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
											{/* biome-ignore lint/a11y/noStaticElementInteractions: only keeps clicks on the buttons inside from also opening the editor. */}
											{/* biome-ignore lint/a11y/useKeyWithClickEvents: only keeps clicks on the buttons inside from also opening the editor. */}
											<div
												className={styles.cardActions}
												onClick={(e) => e.stopPropagation()}
												data-flx="persona.settings.persona-settings-tab.card-actions.stop-propagation"
											>
												{activePersonaScope === 'global' && (
													<Button
														variant="secondary"
														small={true}
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
														aria-label={
															isThisActive
																? i18n._(DEACTIVATE_PERSONA_ARIA_DESCRIPTOR)
																: i18n._(SET_ACTIVE_PERSONA_ARIA_DESCRIPTOR)
														}
														data-flx="persona.settings.persona-settings-tab.button.toggle-active"
													>
														{isThisActive ? <Trans>Active</Trans> : <Trans>Set Active</Trans>}
													</Button>
												)}
												<button
													type="button"
													className={styles.chevronButton}
													onClick={() => handleStartEdit(persona)}
													aria-label={i18n._(EDIT_PERSONA_ARIA_DESCRIPTOR)}
													data-flx="persona.settings.persona-settings-tab.chevron-button.start-edit"
												>
													<CaretRight
														size={18}
														weight="bold"
														data-flx="persona.settings.persona-settings-tab.caret-right"
													/>
												</button>
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
