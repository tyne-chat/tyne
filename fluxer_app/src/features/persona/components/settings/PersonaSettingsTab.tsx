// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {SettingsSection} from '@app/features/app/components/dialogs/shared/SettingsSection';
import {SettingsTabContainer, SettingsTabContent} from '@app/features/app/components/dialogs/shared/SettingsTabLayout';
import {
	AVATAR_RECOMMENDED_SIZE_LABEL,
	IMAGE_MAX_SIZE_BYTES,
	STATIC_IMAGE_FORMATS,
} from '@app/features/app/config/I18nDisplayConstants';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import {AssetCropModal, AssetType} from '@app/features/expressions/components/modals/AssetCropModal';
import {openAssetSourceModal} from '@app/features/expressions/components/modals/AssetSourceModal';
import {isAnimatedFile} from '@app/features/expressions/utils/AnimatedImageUtils';
import {getAcceptString} from '@app/features/expressions/utils/AssetFormatCopy';
import {formatImageUploadRecommendedHint} from '@app/features/expressions/utils/AssetUploadHintCopy';
import {downloadGifAsImageFile} from '@app/features/expressions/utils/GifFileDownload';
import {isSvgFile, readImageFileAsUploadDataUrl} from '@app/features/expressions/utils/ImageUploadFileUtils';
import {CLEAR_SEARCH_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {openFilePicker} from '@app/features/messaging/utils/FilePickerUtils';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import {http} from '@app/features/platform/transport/RestTransport';
import * as ColorUtils from '@app/features/theme/utils/ColorUtils';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import * as UnsavedChangesCommands from '@app/features/ui/commands/UnsavedChangesCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {ColorPickerField} from '@app/features/ui/components/form/ColorPickerField';
import {Input} from '@app/features/ui/components/form/FormInput';
import {type SegmentedTab, SegmentedTabs} from '@app/features/ui/segmented_tabs/SegmentedTabs';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {AvatarUploader} from '@app/features/user/components/modals/tabs/my_profile_tab/AvatarUploader';
import {BannerUploader} from '@app/features/user/components/modals/tabs/my_profile_tab/BannerUploader';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import type {PersonaVisibility} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {
	GlobeSimple,
	Info,
	LockSimple,
	LockSimpleOpen,
	MagnifyingGlass,
	PencilSimple,
	Plus,
	Trash,
	UploadSimple,
	X,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as PersonaCommands from '../../commands/PersonaCommands';
import {type ActivePersonaMode, type Persona, PersonaStore} from '../../state/PersonaStore';
import {openPluralKitImportModal} from '../modals/PluralKitImportModal';
import {SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR} from '../PersonaPickerSheet';
import {PersonaTag} from '../PersonaTag';
import styles from './PersonaSettingsTab.module.css';

const MODE_OFF_DESCRIPTOR = msg({
	message: 'Off',
	comment: 'Active persona mode off',
});
const MODE_MANUAL_DESCRIPTOR = msg({
	message: 'Manual',
	comment: 'Active persona mode manual',
});
const MODE_LAST_DESCRIPTOR = msg({
	message: 'Last Used',
	comment: 'Active persona mode last used',
});

const ACTIVE_PERSONA_MODE_OFF_DESC = msg({
	message:
		'Untagged messages always send from your root account. Personas only speak when you type their tags (e.g. [text]).',
	comment: 'Helper description for Off persona mode',
});
const ACTIVE_PERSONA_MODE_MANUAL_DESC = msg({
	message:
		'Untagged messages send as your chosen persona. Typing another persona’s tags will only send that single message and won’t switch who is active.',
	comment: 'Helper description for Manual persona mode',
});
const ACTIVE_PERSONA_MODE_LAST_DESC = msg({
	message:
		'Untagged messages send as the persona that spoke most recently. Whenever anyone uses a persona tag, they automatically become the active persona.',
	comment: 'Helper description for Last Used persona mode',
});

const VISIBILITY_UNLISTED_DESCRIPTOR = msg({
	message: 'Unlisted',
	comment: 'Persona visibility unlisted',
});
const VISIBILITY_PUBLIC_DESCRIPTOR = msg({
	message: 'Public',
	comment: 'Persona visibility public',
});
const VISIBILITY_PRIVATE_DESCRIPTOR = msg({
	message: 'Private',
	comment: 'Persona visibility private',
});

const VISIBILITY_UNLISTED_DESC = msg({
	message:
		'Profile cards are accessible only when clicking on messages sent by this persona. Not listed in your public persona list.',
	comment: 'Helper description for unlisted persona visibility',
});
const VISIBILITY_PUBLIC_DESC = msg({
	message:
		'Profile cards are accessible when clicking on messages and visible in your public personas list to friends and mutual servers.',
	comment: 'Helper description for public persona visibility',
});
const VISIBILITY_PRIVATE_DESC = msg({
	message: 'Only visible to you. Others cannot view this persona’s full bio or profile details.',
	comment: 'Helper description for private persona visibility',
});

const PERSONAS_SECTION_TITLE_DESCRIPTOR = msg({
	message: 'Personas',
	comment: 'Title of personas settings section',
});
const PERSONAS_SECTION_DESC_DESCRIPTOR = msg({
	message:
		'Send messages with distinct names and avatars. Personas can represent plural system members, roleplay characters, or any other identity.',
	comment: 'Description of personas settings section',
});
const ACTIVE_PERSONA_MODE_ARIA_DESCRIPTOR = msg({
	message: 'Active persona mode',
	comment: 'Aria label for active persona mode tabs',
});
const PERSONA_VISIBILITY_ARIA_DESCRIPTOR = msg({
	message: 'Persona visibility',
	comment: 'Aria label for persona visibility tabs',
});

const DUPLICATE_TAG_PAIR_DESCRIPTOR = msg({
	message: 'Duplicate tag pair on this persona',
	comment: 'Validation error when tag pair is duplicated within the same persona',
});
const TAG_PAIR_IN_USE_DESCRIPTOR = msg({
	message: 'Tag pair already in use by persona "{name}"',
	comment: 'Validation error when tag pair is already used by another persona',
});
const DISPLAY_TAG_ICON_UPDATED_DESCRIPTOR = msg({
	message: 'Display tag icon updated',
	comment: 'Toast when display tag icon is updated',
});
const DISPLAY_TAG_ICON_REMOVED_DESCRIPTOR = msg({
	message: 'Display tag icon removed',
	comment: 'Toast when display tag icon is removed',
});
const FAILED_TO_UPLOAD_ICON_DESCRIPTOR = msg({
	message: 'Failed to upload icon to server',
	comment: 'Toast when icon upload fails',
});
const ICON_FILE_TOO_LARGE_DESCRIPTOR = msg({
	message: 'Icon file is too large. Choose an image smaller than 10MB.',
	comment: 'Toast when icon file exceeds size limit',
});
const PERSONA_UPDATED_DESCRIPTOR = msg({
	message: 'Persona updated',
	comment: 'Toast when persona is updated',
});
const PERSONA_CREATED_DESCRIPTOR = msg({
	message: 'Persona created',
	comment: 'Toast when persona is created',
});
const FAILED_TO_SAVE_PERSONA_DESCRIPTOR = msg({
	message: 'Failed to save persona',
	comment: 'Toast when persona save fails',
});
const PERSONA_DELETED_DESCRIPTOR = msg({
	message: 'Persona deleted',
	comment: 'Toast when persona is deleted',
});
const FAILED_TO_DELETE_PERSONA_DESCRIPTOR = msg({
	message: 'Failed to delete persona',
	comment: 'Toast when persona deletion fails',
});
const PUBLIC_PERSONA_TOOLTIP_DESCRIPTOR = msg({
	message: 'Public persona',
	comment: 'Tooltip on public persona badge',
});
const PRIVATE_PERSONA_TOOLTIP_DESCRIPTOR = msg({
	message: 'Private persona',
	comment: 'Tooltip on private persona badge',
});
const ACCENT_COLOR_DESCRIPTION_DESCRIPTOR = msg({
	message: "Customizes the border and banner color on this persona's profile",
	comment: 'Description for persona accent color picker',
});
const NAME_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'e.g. Alice',
	comment: 'Placeholder for persona name',
});
const PRONOUNS_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'e.g. she/her',
	comment: 'Placeholder for persona pronouns',
});
const BIO_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Tell us about this persona...',
	comment: 'Placeholder for persona bio',
});
const PREFIX_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Prefix (e.g. [)',
	comment: 'Placeholder for persona tag prefix',
});
const SUFFIX_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Suffix (e.g. ])',
	comment: 'Placeholder for persona tag suffix',
});
const REMOVE_TAG_PAIR_ARIA_DESCRIPTOR = msg({
	message: 'Remove tag pair',
	comment: 'Aria label for removing a tag pair',
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
const DELETE_PERSONA_ARIA_DESCRIPTOR = msg({
	message: 'Delete persona',
	comment: 'Aria label for deleting persona',
});
const CONFIG_PERSONAS_COUNT_DESCRIPTOR = msg({
	message: 'Configured Personas ({count})',
	comment: 'Header for configured personas list with count',
});

const getActivePersonaTabs = (i18n: I18n): Array<SegmentedTab<ActivePersonaMode>> => [
	{id: 'off', label: i18n._(MODE_OFF_DESCRIPTOR)},
	{id: 'manual', label: i18n._(MODE_MANUAL_DESCRIPTOR)},
	{id: 'last', label: i18n._(MODE_LAST_DESCRIPTOR)},
];

const getActivePersonaDescriptions = (i18n: I18n): Record<ActivePersonaMode, string> => ({
	off: i18n._(ACTIVE_PERSONA_MODE_OFF_DESC),
	manual: i18n._(ACTIVE_PERSONA_MODE_MANUAL_DESC),
	last: i18n._(ACTIVE_PERSONA_MODE_LAST_DESC),
});

const getVisibilityTabs = (i18n: I18n): Array<SegmentedTab<PersonaVisibility>> => [
	{id: 'unlisted', label: i18n._(VISIBILITY_UNLISTED_DESCRIPTOR)},
	{id: 'public', label: i18n._(VISIBILITY_PUBLIC_DESCRIPTOR)},
	{id: 'private', label: i18n._(VISIBILITY_PRIVATE_DESCRIPTOR)},
];

const getVisibilityDescriptions = (i18n: I18n): Record<PersonaVisibility, string> => ({
	unlisted: i18n._(VISIBILITY_UNLISTED_DESC),
	public: i18n._(VISIBILITY_PUBLIC_DESC),
	private: i18n._(VISIBILITY_PRIVATE_DESC),
});

interface PersonaFormState {
	id?: string;
	name: string;
	pronouns: string;
	avatarUrl: string;
	bannerUrl: string;
	accentColor: number | null;
	bio: string;
	visibility: PersonaVisibility;
	tags: Array<{prefix: string; suffix: string}>;
}

const emptyFormState = (): PersonaFormState => ({
	name: '',
	pronouns: '',
	avatarUrl: '',
	bannerUrl: '',
	accentColor: null,
	bio: '',
	visibility: 'unlisted',
	tags: [{prefix: '', suffix: ''}],
});

function normalizeTag(tag: {prefix?: string | null; suffix?: string | null}) {
	return {
		prefix: (tag.prefix ?? '').trim(),
		suffix: (tag.suffix ?? '').trim(),
	};
}

function getTagKey(tag: {prefix: string; suffix: string}) {
	return `${tag.prefix}:::${tag.suffix}`;
}

function formatTagDisplay(tag: {prefix: string; suffix: string}) {
	return `${tag.prefix || ''}text${tag.suffix || ''}`;
}

export interface PersonaSettingsTabProps {
	initialSubtab?: string;
}

export const PersonaSettingsTab: React.FC<PersonaSettingsTabProps> = observer(({initialSubtab}) => {
	const {i18n} = useLingui();
	const activePersonaTabs = useMemo(() => getActivePersonaTabs(i18n), [i18n]);
	const activePersonaDescriptions = useMemo(() => getActivePersonaDescriptions(i18n), [i18n]);
	const visibilityTabs = useMemo(() => getVisibilityTabs(i18n), [i18n]);
	const visibilityDescriptions = useMemo(() => getVisibilityDescriptions(i18n), [i18n]);

	const currentUser = Users.getCurrentUser();
	const personas = PersonaStore.personas;
	const activePersonaId = PersonaStore.activePersonaId;
	const isLatched = PersonaStore.isPersonaLatched;

	useEffect(() => {
		void PersonaCommands.fetchPersonas();
		void PersonaCommands.fetchPersonaSettings();
	}, []);

	const [isEditing, setIsEditing] = useState(false);
	const [formData, setFormData] = useState<PersonaFormState>(emptyFormState());
	const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
	const [isUploadingBanner, setIsUploadingBanner] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');

	const filteredPersonas = useMemo(() => {
		const trimmed = searchQuery.trim().toLowerCase();
		if (!trimmed) return personas;
		return personas.filter((p) => {
			if (p.name.toLowerCase().includes(trimmed)) return true;
			if (p.system_name?.toLowerCase().includes(trimmed) || p.systemName?.toLowerCase().includes(trimmed)) return true;
			if (p.pronouns?.toLowerCase().includes(trimmed)) return true;
			if (p.bio?.toLowerCase().includes(trimmed)) return true;
			const tags = p.persona_tags ?? p.personaTags ?? [];
			return tags.some(
				(tag) => tag.prefix?.toLowerCase().includes(trimmed) || tag.suffix?.toLowerCase().includes(trimmed),
			);
		});
	}, [personas, searchQuery]);

	const getTagRowError = (idx: number): string | null => {
		const currentTag = normalizeTag(formData.tags[idx]);
		if (!currentTag.prefix && !currentTag.suffix) {
			return null;
		}
		const currentKey = getTagKey(currentTag);

		// 1. Check duplicates within current form tags
		for (let i = 0; i < formData.tags.length; i++) {
			if (i === idx) continue;
			const other = normalizeTag(formData.tags[i]);
			if ((other.prefix || other.suffix) && getTagKey(other) === currentKey) {
				return i18n._(DUPLICATE_TAG_PAIR_DESCRIPTOR);
			}
		}

		// 2. Check collisions across other personas
		for (const p of personas) {
			if (formData.id && p.id === formData.id) continue;
			const otherTags = p.persona_tags ?? p.personaTags ?? [];
			for (const ot of otherTags) {
				const normOther = normalizeTag(ot);
				if ((normOther.prefix || normOther.suffix) && getTagKey(normOther) === currentKey) {
					return i18n._(TAG_PAIR_IN_USE_DESCRIPTOR, {name: p.name});
				}
			}
		}

		return null;
	};

	const hasTagErrors = formData.tags.some((_, idx) => Boolean(getTagRowError(idx)));

	const [tagText, setTagText] = useState(PersonaStore.displayTagText);
	const [tagIcon, setTagIcon] = useState(PersonaStore.displayTagIcon);
	const [isUploadingTagIcon, setIsUploadingTagIcon] = useState(false);

	useEffect(() => {
		setTagText(PersonaStore.displayTagText);
	}, [PersonaStore.displayTagText]);

	useEffect(() => {
		setTagIcon(PersonaStore.displayTagIcon);
	}, [PersonaStore.displayTagIcon]);

	const handleTagTextChange = (value: string) => {
		setTagText(value);
		void PersonaStore.setDisplayTag(value, tagIcon);
	};

	const handleTagIconUpload = useCallback(
		async (base64: string) => {
			setIsUploadingTagIcon(true);
			try {
				const res = await http.post<{avatar_url: string}>(Endpoints.USER_PERSONA_AVATAR, {
					body: {avatar: base64},
				});
				if (res.ok && res.body?.avatar_url) {
					const newIcon = res.body.avatar_url;
					setTagIcon(newIcon);
					await PersonaStore.setDisplayTag(tagText, newIcon);
					ToastCommands.createToast({
						type: 'success',
						children: i18n._(DISPLAY_TAG_ICON_UPDATED_DESCRIPTOR),
					});
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
		[tagText, i18n],
	);

	const handleClearTagIcon = useCallback(async () => {
		setTagIcon(null);
		await PersonaStore.setDisplayTag(tagText, null);
		ToastCommands.createToast({
			type: 'success',
			children: i18n._(DISPLAY_TAG_ICON_REMOVED_DESCRIPTOR),
		});
	}, [tagText, i18n]);

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
			const base64 = svg ? await readImageFileAsUploadDataUrl(file) : await AvatarUtils.fileToBase64(file);
			if (animated || svg) {
				await handleTagIconUpload(base64);
				return;
			}
			ModalCommands.push(
				modal(() => (
					<AssetCropModal
						assetType={AssetType.AVATAR}
						imageUrl={base64}
						sourceMimeType={file.type}
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
		[handleTagIconUpload],
	);

	const handleOpenTagIconUpload = useCallback(() => {
		openAssetSourceModal({
			title: 'Tag Icon',
			uploadHint: formatImageUploadRecommendedHint(i18n, {
				formats: STATIC_IMAGE_FORMATS,
				maxSize: formatFileSize(i18n.locale, IMAGE_MAX_SIZE_BYTES),
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

	const handleBannerUpload = async (base64: string) => {
		setFormData((prev) => ({...prev, bannerUrl: base64}));
		setIsUploadingBanner(true);
		try {
			const res = await http.post<{banner_url: string}>(Endpoints.USER_PERSONA_BANNER, {
				body: {banner: base64},
			});
			if (res.ok && res.body?.banner_url) {
				setFormData((prev) => ({...prev, bannerUrl: res.body.banner_url}));
			} else {
				ToastCommands.createToast({
					type: 'error',
					children: 'Failed to upload banner image to server',
				});
			}
		} catch {
			ToastCommands.createToast({
				type: 'error',
				children: 'Failed to upload banner image to server',
			});
		} finally {
			setIsUploadingBanner(false);
		}
	};

	const handleBannerClear = () => {
		setFormData((prev) => ({...prev, bannerUrl: ''}));
	};

	const initialFormStateRef = useRef<PersonaFormState>(emptyFormState());

	const handleStartAdd = () => {
		const initial = emptyFormState();
		initialFormStateRef.current = initial;
		setFormData(initial);
		setIsEditing(true);
	};

	const handleStartEdit = (persona: Persona) => {
		const initial: PersonaFormState = {
			id: persona.id,
			name: persona.name,
			pronouns: persona.pronouns ?? '',
			avatarUrl: persona.avatar_url ?? persona.avatarUrl ?? '',
			bannerUrl: persona.banner_url ?? persona.bannerUrl ?? '',
			accentColor: persona.color ?? null,
			bio: persona.bio ?? '',
			visibility: persona.visibility ?? 'unlisted',
			tags:
				(persona.persona_tags ?? persona.personaTags ?? []).length > 0
					? (persona.persona_tags ?? persona.personaTags ?? []).map((t) => ({
							prefix: t.prefix ?? '',
							suffix: t.suffix ?? '',
						}))
					: [{prefix: '', suffix: ''}],
		};
		initialFormStateRef.current = initial;
		setFormData(initial);
		setIsEditing(true);
	};

	const editorCardRef = useRef<HTMLDivElement | null>(null);
	const lastHandledSubtabRef = useRef<string | null>(null);

	const handleCancelEdit = useCallback(() => {
		setIsEditing(false);
		setFormData(emptyFormState());
		initialFormStateRef.current = emptyFormState();
	}, []);

	useEffect(() => {
		if (initialSubtab && lastHandledSubtabRef.current !== initialSubtab) {
			const target = personas.find((p) => p.id === initialSubtab);
			if (target) {
				lastHandledSubtabRef.current = initialSubtab;
				handleStartEdit(target);
				requestAnimationFrame(() => {
					editorCardRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
				});
			}
		}
	}, [initialSubtab, personas]);

	const handleSaveForm = useCallback(async () => {
		if (isUploadingAvatar || isUploadingBanner) {
			ToastCommands.createToast({
				type: 'info',
				children: 'Please wait for images to finish uploading',
			});
			return;
		}

		const trimmedName = formData.name.trim();
		if (!trimmedName) return;

		const parsedColor = formData.accentColor;

		const validTags = formData.tags
			.map((t) => ({prefix: t.prefix.trim() || undefined, suffix: t.suffix.trim() || undefined}))
			.filter((t) => t.prefix || t.suffix);

		if (validTags.length > 5) {
			ToastCommands.createToast({
				type: 'error',
				children: 'A persona can have at most 5 tags',
			});
			return;
		}

		// Check duplicates within this persona
		const seenTags = new Set<string>();
		for (const tag of validTags) {
			const norm = {prefix: tag.prefix ?? '', suffix: tag.suffix ?? ''};
			const key = getTagKey(norm);
			if (seenTags.has(key)) {
				ToastCommands.createToast({
					type: 'error',
					children: `Duplicate tag pair '${formatTagDisplay(norm)}' cannot be listed multiple times on the same persona`,
				});
				return;
			}
			seenTags.add(key);
		}

		// Check collisions across other personas
		for (const tag of validTags) {
			const norm = {prefix: tag.prefix ?? '', suffix: tag.suffix ?? ''};
			const key = getTagKey(norm);
			for (const p of personas) {
				if (formData.id && p.id === formData.id) continue;
				const otherTags = p.persona_tags ?? p.personaTags ?? [];
				for (const ot of otherTags) {
					const otherNorm = normalizeTag(ot);
					if ((otherNorm.prefix || otherNorm.suffix) && getTagKey(otherNorm) === key) {
						ToastCommands.createToast({
							type: 'error',
							children: `Tag pair '${formatTagDisplay(otherNorm)}' is already in use by persona '${p.name}'`,
						});
						return;
					}
				}
			}
		}

		try {
			if (formData.id) {
				await PersonaCommands.updatePersona(formData.id, {
					name: trimmedName,
					pronouns: formData.pronouns.trim() || null,
					avatar_url: formData.avatarUrl.trim() || null,
					banner_url: formData.bannerUrl.trim() || null,
					color: parsedColor,
					bio: formData.bio.trim() || null,
					visibility: formData.visibility,
					persona_tags: validTags,
				});
				ToastCommands.createToast({
					type: 'success',
					children: i18n._(PERSONA_UPDATED_DESCRIPTOR),
				});
			} else {
				await PersonaCommands.createPersona({
					name: trimmedName,
					pronouns: formData.pronouns.trim() || null,
					avatar_url: formData.avatarUrl.trim() || null,
					banner_url: formData.bannerUrl.trim() || null,
					color: parsedColor,
					bio: formData.bio.trim() || null,
					visibility: formData.visibility,
					persona_tags: validTags,
				});
				ToastCommands.createToast({
					type: 'success',
					children: i18n._(PERSONA_CREATED_DESCRIPTOR),
				});
			}

			setIsEditing(false);
			setFormData(emptyFormState());
			initialFormStateRef.current = emptyFormState();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : i18n._(FAILED_TO_SAVE_PERSONA_DESCRIPTOR);
			ToastCommands.createToast({
				type: 'error',
				children: message,
			});
		}
	}, [formData, isUploadingAvatar, isUploadingBanner, personas, i18n]);

	const hasUnsavedChanges = useMemo(() => {
		if (!isEditing) return false;
		const initial = initialFormStateRef.current;
		if (!formData.id) {
			const hasNonEmptyTag = formData.tags.some((t) => t.prefix.trim() !== '' || t.suffix.trim() !== '');
			return (
				formData.name.trim() !== '' ||
				formData.pronouns.trim() !== '' ||
				formData.avatarUrl !== '' ||
				formData.bannerUrl !== '' ||
				formData.accentColor !== null ||
				formData.bio.trim() !== '' ||
				formData.visibility !== 'unlisted' ||
				hasNonEmptyTag
			);
		}
		if (formData.name.trim() !== initial.name.trim()) return true;
		if (formData.pronouns.trim() !== initial.pronouns.trim()) return true;
		if (formData.avatarUrl !== initial.avatarUrl) return true;
		if (formData.bannerUrl !== initial.bannerUrl) return true;
		if (formData.accentColor !== initial.accentColor) return true;
		if (formData.bio.trim() !== initial.bio.trim()) return true;
		if (formData.visibility !== initial.visibility) return true;

		const formTags = formData.tags.map(normalizeTag).filter((t) => t.prefix || t.suffix);
		const initTags = initial.tags.map(normalizeTag).filter((t) => t.prefix || t.suffix);
		if (formTags.length !== initTags.length) return true;
		for (let i = 0; i < formTags.length; i++) {
			if (formTags[i].prefix !== initTags[i].prefix || formTags[i].suffix !== initTags[i].suffix) {
				return true;
			}
		}
		return false;
	}, [isEditing, formData]);

	useEffect(() => {
		UnsavedChangesCommands.setUnsavedChanges('personas', hasUnsavedChanges);
		UnsavedChangesCommands.setUnsavedChanges('subprofiles', hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		const tabData = {
			onReset: handleCancelEdit,
			onSave: handleSaveForm,
			isSubmitting: isUploadingAvatar || isUploadingBanner,
		};
		UnsavedChangesCommands.setTabData('personas', tabData);
		UnsavedChangesCommands.setTabData('subprofiles', tabData);
	}, [handleCancelEdit, handleSaveForm, isUploadingAvatar, isUploadingBanner]);

	useEffect(() => {
		return () => {
			UnsavedChangesCommands.clearUnsavedChanges('personas');
			UnsavedChangesCommands.clearUnsavedChanges('subprofiles');
		};
	}, []);

	const handleDeletePersona = (persona: Persona) => {
		ModalCommands.push(
			modal(() => (
				<ConfirmModal
					title={<Trans>Delete Persona</Trans>}
					description={
						<Trans>
							Are you sure you want to delete{' '}
							<strong data-flx="persona.settings.persona-settings-tab.handle-delete-persona.strong">
								{persona.name}
							</strong>
							? This action cannot be undone.
						</Trans>
					}
					primaryText={<Trans>Delete</Trans>}
					primaryVariant="danger"
					onPrimary={async () => {
						try {
							await PersonaCommands.deletePersona(persona.id);
							if (formData.id === persona.id) {
								setIsEditing(false);
								setFormData(emptyFormState());
							}
							ToastCommands.createToast({
								type: 'success',
								children: i18n._(PERSONA_DELETED_DESCRIPTOR),
							});
						} catch {
							ToastCommands.createToast({
								type: 'error',
								children: i18n._(FAILED_TO_DELETE_PERSONA_DESCRIPTOR),
							});
						}
					}}
					data-flx="persona.settings.persona-settings-tab.handle-delete-persona.confirm-modal"
				/>
			)),
		);
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
		if (formData.tags.length >= 5) return;
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
						title={i18n._(PERSONAS_SECTION_TITLE_DESCRIPTOR)}
						description={i18n._(PERSONAS_SECTION_DESC_DESCRIPTOR)}
						linkable={false}
						data-flx="persona.settings.persona-settings-tab.personas-general"
					>
						<div className={styles.sectionHeader} data-flx="persona.settings.persona-settings-tab.section-header">
							<div data-flx="persona.settings.persona-settings-tab.div">
								<h4 className={styles.sectionTitle} data-flx="persona.settings.persona-settings-tab.section-title">
									<Trans>Active Persona Mode</Trans>
								</h4>
								<p
									className={styles.sectionDescription}
									data-flx="persona.settings.persona-settings-tab.section-description"
								>
									<Trans>Choose how untagged messages and persona tags interact with your active persona.</Trans>
								</p>
							</div>
						</div>
						<div
							className={styles.modeControlWrapper}
							data-flx="persona.settings.persona-settings-tab.mode-control-wrapper"
						>
							<SegmentedTabs<ActivePersonaMode>
								tabs={activePersonaTabs}
								selectedTab={activePersonaMode}
								onTabChange={(mode) => {
									void handleModeChange(mode);
								}}
								ariaLabel={i18n._(ACTIVE_PERSONA_MODE_ARIA_DESCRIPTOR)}
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
									{activePersonaDescriptions[activePersonaMode]}
								</span>
							</div>
						</div>

						{/* Display Tag section */}
						<div
							className={styles.sectionHeader}
							style={{marginTop: 24}}
							data-flx="persona.settings.persona-settings-tab.section-header--2"
						>
							<div data-flx="persona.settings.persona-settings-tab.div--2">
								<h4 className={styles.sectionTitle} data-flx="persona.settings.persona-settings-tab.section-title--2">
									<Trans>Display Tag</Trans>
								</h4>
								<p
									className={styles.sectionDescription}
									data-flx="persona.settings.persona-settings-tab.section-description--2"
								>
									<Trans>
										Display tag will appear next to all persona names in messages. If no display tag is set, your
										account profile picture will be shown.
									</Trans>
								</p>
							</div>
						</div>

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
													src={tagIcon}
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
								<div className={styles.previewCard} data-flx="persona.settings.persona-settings-tab.preview-card">
									{currentUser && (
										<Avatar
											user={currentUser}
											size={40}
											className={styles.previewAvatar}
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

					{/* Editor Form */}
					{isEditing && (
						<div
							ref={editorCardRef}
							className={styles.editorCard}
							data-flx="persona.settings.persona-settings-tab.editor-card"
						>
							<div className={styles.editorTitle} data-flx="persona.settings.persona-settings-tab.editor-title">
								{formData.id ? <Trans>Edit Persona</Trans> : <Trans>New Persona</Trans>}
							</div>
							<div className={styles.formGrid} data-flx="persona.settings.persona-settings-tab.form-grid">
								<div className={styles.formField} data-flx="persona.settings.persona-settings-tab.form-field">
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--3">
										<Trans>Name *</Trans>
									</div>
									<input
										type="text"
										className={styles.textInput}
										placeholder={i18n._(NAME_PLACEHOLDER_DESCRIPTOR)}
										maxLength={100}
										value={formData.name}
										onChange={(e) => setFormData({...formData, name: e.target.value})}
										data-flx="persona.settings.persona-settings-tab.text-input.set-form-data"
									/>
								</div>
								<div className={styles.formField} data-flx="persona.settings.persona-settings-tab.form-field--2">
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--4">
										<Trans>Pronouns</Trans>
									</div>
									<input
										type="text"
										className={styles.textInput}
										placeholder={i18n._(PRONOUNS_PLACEHOLDER_DESCRIPTOR)}
										maxLength={100}
										value={formData.pronouns}
										onChange={(e) => setFormData({...formData, pronouns: e.target.value})}
										data-flx="persona.settings.persona-settings-tab.text-input.set-form-data--2"
									/>
								</div>
								<div className={styles.formField} data-flx="persona.settings.persona-settings-tab.form-field--3">
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--5">
										<Trans>Accent color</Trans>
									</div>
									<ColorPickerField
										description={i18n._(ACCENT_COLOR_DESCRIPTION_DESCRIPTOR)}
										value={formData.accentColor ?? 0}
										onChange={(accentColor) =>
											setFormData((prev) => ({...prev, accentColor: accentColor === 0 ? null : accentColor}))
										}
										onReset={() => setFormData((prev) => ({...prev, accentColor: null}))}
										data-flx="user.persona-settings-tab.accent-color-picker-field"
									/>
								</div>
								<div
									className={styles.formField}
									style={{gridColumn: '1 / -1'}}
									data-flx="persona.settings.persona-settings-tab.form-field--4"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--6">
										<Trans>Avatar</Trans>
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
									data-flx="persona.settings.persona-settings-tab.form-field--5"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--7">
										<Trans>Banner</Trans>
									</div>
									<div
										style={{display: 'flex', flexDirection: 'column', gap: 12}}
										data-flx="persona.settings.persona-settings-tab.div--5"
									>
										<div
											style={{
												height: '6rem',
												width: '100%',
												borderRadius: '0.5rem',
												overflow: 'hidden',
												backgroundColor:
													formData.accentColor != null
														? ColorUtils.int2hex(formData.accentColor)
														: 'var(--background-secondary)',
												backgroundImage: formData.bannerUrl ? `url(${formData.bannerUrl})` : undefined,
												backgroundSize: 'cover',
												backgroundPosition: 'center',
												border: '1px solid var(--border-subtle)',
											}}
											data-flx="persona.settings.persona-settings-tab.div--6"
										/>
										<BannerUploader
											hasBanner={Boolean(formData.bannerUrl)}
											onBannerChange={handleBannerUpload}
											onBannerClear={handleBannerClear}
											disabled={isUploadingBanner}
											disableModeSelection={true}
											requireBannerEntitlement={false}
											isPerGuildProfile={false}
											data-flx="user.persona-settings-tab.banner-uploader"
										/>
									</div>
								</div>
								<div
									className={styles.formField}
									style={{gridColumn: '1 / -1'}}
									data-flx="persona.settings.persona-settings-tab.form-field--6"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--8">
										<Trans>Bio</Trans>
									</div>
									<textarea
										className={styles.textareaInput}
										placeholder={i18n._(BIO_PLACEHOLDER_DESCRIPTOR)}
										maxLength={4096}
										rows={4}
										value={formData.bio}
										onChange={(e) => setFormData({...formData, bio: e.target.value})}
										data-flx="persona.settings.persona-settings-tab.textarea-input.set-form-data"
									/>
								</div>
								<div
									className={styles.formField}
									style={{gridColumn: '1 / -1'}}
									data-flx="persona.settings.persona-settings-tab.form-field--7"
								>
									<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--9">
										<Trans>Visibility</Trans>
									</div>
									<SegmentedTabs<PersonaVisibility>
										tabs={visibilityTabs}
										selectedTab={formData.visibility}
										onTabChange={(vis) => setFormData((prev) => ({...prev, visibility: vis}))}
										ariaLabel={i18n._(PERSONA_VISIBILITY_ARIA_DESCRIPTOR)}
										data-flx="persona.settings.persona-settings-tab.segmented-tabs--2"
									/>
									<div
										className={styles.modeHelperText}
										style={{marginTop: 6}}
										data-flx="persona.settings.persona-settings-tab.mode-helper-text--2"
									>
										<Info
											size={16}
											weight="bold"
											className={styles.modeHelperIcon}
											data-flx="persona.settings.persona-settings-tab.mode-helper-icon--2"
										/>
										<span data-flx="persona.settings.persona-settings-tab.span--2">
											{visibilityDescriptions[formData.visibility]}
										</span>
									</div>
								</div>
								<div
									className={styles.formField}
									style={{gridColumn: '1 / -1'}}
									data-flx="persona.settings.persona-settings-tab.form-field--8"
								>
									<div
										style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}
										data-flx="persona.settings.persona-settings-tab.div--7"
									>
										<div className={styles.formLabel} data-flx="persona.settings.persona-settings-tab.form-label--10">
											<Trans>Persona Tags (Prefix & Suffix)</Trans>
										</div>
										<Button
											variant="secondary"
											small
											leftIcon={<Plus size={14} data-flx="persona.settings.persona-settings-tab.plus" />}
											onClick={handleAddTagRow}
											disabled={formData.tags.length >= 5}
											data-flx="persona.settings.persona-settings-tab.button.add-tag-row"
										>
											<Trans>Add Tag Pair ({formData.tags.length}/5)</Trans>
										</Button>
									</div>
									{formData.tags.map((tag, idx) => {
										const tagError = getTagRowError(idx);
										return (
											<div key={idx} style={{marginBottom: 6}} data-flx="persona.settings.persona-settings-tab.div--8">
												<div
													className={styles.tagRow}
													style={{marginBottom: tagError ? 2 : 0}}
													data-flx="persona.settings.persona-settings-tab.tag-row"
												>
													<input
														type="text"
														className={`${styles.tagInput} ${tagError ? styles.tagInputError : ''}`}
														placeholder={i18n._(PREFIX_PLACEHOLDER_DESCRIPTOR)}
														value={tag.prefix}
														onChange={(e) => handleTagChange(idx, 'prefix', e.target.value)}
														data-flx="persona.settings.persona-settings-tab.tag-input.tag-change.text"
													/>
													<span
														style={{color: 'var(--text-primary-muted)'}}
														data-flx="persona.settings.persona-settings-tab.span--3"
													>
														text
													</span>
													<input
														type="text"
														className={`${styles.tagInput} ${tagError ? styles.tagInputError : ''}`}
														placeholder={i18n._(SUFFIX_PLACEHOLDER_DESCRIPTOR)}
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
															aria-label={i18n._(REMOVE_TAG_PAIR_ARIA_DESCRIPTOR)}
															data-flx="persona.settings.persona-settings-tab.button.remove-tag-row"
														/>
													)}
												</div>
												{tagError && (
													<div
														className={styles.tagErrorText}
														data-flx="persona.settings.persona-settings-tab.tag-error-text"
													>
														{tagError}
													</div>
												)}
											</div>
										);
									})}
								</div>
							</div>
							<div className={styles.editorActions} data-flx="persona.settings.persona-settings-tab.editor-actions">
								<Button
									variant="secondary"
									onClick={handleCancelEdit}
									data-flx="persona.settings.persona-settings-tab.button.cancel-edit"
								>
									<Trans>Cancel</Trans>
								</Button>
								<Button
									variant="primary"
									disabled={!formData.name.trim() || isUploadingAvatar || isUploadingBanner || hasTagErrors}
									submitting={isUploadingAvatar || isUploadingBanner}
									onClick={handleSaveForm}
									data-flx="persona.settings.persona-settings-tab.button.save-form"
								>
									{isUploadingAvatar ? <Trans>Uploading avatar...</Trans> : <Trans>Save Persona</Trans>}
								</Button>
							</div>
						</div>
					)}

					{/* Personas List */}
					<SettingsSection
						id="personas_list"
						title={i18n._(CONFIG_PERSONAS_COUNT_DESCRIPTOR, {
							count: searchQuery.trim() ? filteredPersonas.length : personas.length,
						})}
						linkable={false}
						actions={
							!isEditing && (
								<div style={{display: 'flex', gap: 8}} data-flx="persona.settings.persona-settings-tab.div--9">
									<Button
										variant="secondary"
										leftIcon={<UploadSimple size={16} data-flx="persona.settings.persona-settings-tab.upload-simple" />}
										onClick={openPluralKitImportModal}
										data-flx="persona.settings.persona-settings-tab.button.open-plural-kit-import-modal"
									>
										<Trans>Import from PluralKit</Trans>
									</Button>
									<Button
										variant="primary"
										leftIcon={<Plus size={16} data-flx="persona.settings.persona-settings-tab.plus--2" />}
										onClick={handleStartAdd}
										data-flx="persona.settings.persona-settings-tab.button.start-add"
									>
										<Trans>Add Persona</Trans>
									</Button>
								</div>
							)
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

						{personas.length === 0 && !isEditing ? (
							<div className={styles.emptyState} data-flx="persona.settings.persona-settings-tab.empty-state">
								<Trans>No personas created yet. Click "Add Persona" to create your first persona!</Trans>
							</div>
						) : filteredPersonas.length === 0 ? (
							<div className={styles.emptyState} data-flx="persona.settings.persona-settings-tab.empty-state--2">
								<Trans>No matching personas found.</Trans>
							</div>
						) : (
							<div className={styles.cardList} data-flx="persona.settings.persona-settings-tab.card-list">
								{filteredPersonas.map((persona) => {
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
																width: 14,
																height: 14,
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
													aria-label={
														isThisActive
															? i18n._(DEACTIVATE_PERSONA_ARIA_DESCRIPTOR)
															: i18n._(SET_ACTIVE_PERSONA_ARIA_DESCRIPTOR)
													}
													data-flx="persona.settings.persona-settings-tab.button.toggle-active"
												>
													{isThisActive ? <Trans>Active</Trans> : <Trans>Set Active</Trans>}
												</Button>
												<Button
													variant="secondary"
													leftIcon={
														<PencilSimple size={14} data-flx="persona.settings.persona-settings-tab.pencil-simple" />
													}
													onClick={() => handleStartEdit(persona)}
													aria-label={i18n._(EDIT_PERSONA_ARIA_DESCRIPTOR)}
													data-flx="persona.settings.persona-settings-tab.button.start-edit"
												>
													<Trans>Edit</Trans>
												</Button>
												<Button
													variant="danger"
													leftIcon={<Trash size={14} data-flx="persona.settings.persona-settings-tab.trash--2" />}
													onClick={() => handleDeletePersona(persona)}
													aria-label={i18n._(DELETE_PERSONA_ARIA_DESCRIPTOR)}
													data-flx="persona.settings.persona-settings-tab.button.delete-persona"
												>
													<Trans>Delete</Trans>
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
