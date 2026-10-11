// SPDX-License-Identifier: AGPL-3.0-or-later

import Accessibility from '@app/features/accessibility/state/Accessibility';
import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import {Endpoints} from '@app/features/app/constants/Endpoints';
import {EmojiPickerPopout} from '@app/features/emoji/components/popouts/EmojiPickerPopout';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import {CLOSE_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {SafeMarkdown} from '@app/features/messaging/components/markdown';
import {MarkdownContext} from '@app/features/messaging/components/markdown/renderers/RendererTypes';
import {toReactionEmoji, useEmojiURL} from '@app/features/messaging/utils/ReactionUtils';
import {http} from '@app/features/platform/transport/RestTransport';
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import markupStyles from '@app/features/theme/styles/Markup.module.css';
import * as ColorUtils from '@app/features/theme/utils/ColorUtils';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Input, Textarea} from '@app/features/ui/components/form/FormInput';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {type SegmentedTab, SegmentedTabs} from '@app/features/ui/segmented_tabs/SegmentedTabs';
import {AccentColorPicker} from '@app/features/user/components/modals/tabs/my_profile_tab/AccentColorPicker';
import {AvatarUploader} from '@app/features/user/components/modals/tabs/my_profile_tab/AvatarUploader';
import {BannerUploader} from '@app/features/user/components/modals/tabs/my_profile_tab/BannerUploader';
import popoutStyles from '@app/features/user/components/popouts/UserProfilePopout.module.css';
import sharedStyles from '@app/features/user/components/popouts/UserProfileShared.module.css';
import {ProfileCardBanner} from '@app/features/user/components/profile/profile_card/ProfileCardBanner';
import {ProfileCardContent} from '@app/features/user/components/profile/profile_card/ProfileCardContent';
import {ProfileCardLayout} from '@app/features/user/components/profile/profile_card/ProfileCardLayout';
import {ProfileCardUserInfo} from '@app/features/user/components/profile/profile_card/ProfileCardUserInfo';
import {PROFILE_POPOUT_GEOMETRY_STYLE} from '@app/features/user/constants/UserProfileSurfaceGeometry';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {
	MAX_SIGNATURE_EMOJIS_PER_PERSONA,
	type PersonaVisibility,
	type SignatureEmoji,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {Info, Plus, Trash, X} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {AnimatePresence, motion} from 'framer-motion';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useMemo, useRef, useState} from 'react';
import * as PersonaCommands from '../../commands/PersonaCommands';
import {type Persona, PersonaStore} from '../../state/PersonaStore';
import {PersonaTag} from '../PersonaTag';
import styles from './PersonaEditModal.module.css';

const NEW_PERSONA_DESCRIPTOR = msg({
	message: 'New Persona',
	comment: 'Title for new persona modal',
});
const EDIT_PERSONA_DESCRIPTOR = msg({
	message: 'Edit Persona',
	comment: 'Title for edit persona modal',
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
const DELETE_PERSONA_ARIA_DESCRIPTOR = msg({
	message: 'Delete persona',
	comment: 'Aria label for deleting persona',
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
const SIGNATURE_EMOJI_IN_USE_DESCRIPTOR = msg({
	message: 'Signature emoji already in use by persona "{name}"',
	comment: 'Validation error when signature emoji is already used by another persona',
});
const DUPLICATE_SIGNATURE_EMOJI_DESCRIPTOR = msg({
	message: 'This emoji is already added as a signature emoji',
	comment: 'Validation error when signature emoji is duplicated within the same persona',
});
const SIGNATURE_EMOJIS_LIMIT_DESCRIPTOR = msg({
	message: 'Maximum {max} signature emojis allowed per persona',
	comment: 'Validation error when signature emoji limit is reached',
});
const REMOVE_SIGNATURE_EMOJI_ARIA = msg({
	message: 'Remove signature emoji',
	comment: 'Aria label for removing signature emoji',
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

const SignatureEmojiChip: React.FC<{
	emoji: SignatureEmoji;
	onRemove: () => void;
}> = ({emoji, onRemove}) => {
	const {i18n} = useLingui();
	const emojiUrl = useEmojiURL({
		emoji: {
			id: emoji.id ?? null,
			name: emoji.name,
			animated: Boolean(emoji.animated),
		},
	});

	return (
		<div
			className={styles.signatureEmojiChip}
			title={emoji.name}
			data-flx="persona.persona-edit-modal.signature-emoji-chip.signature-emoji-chip"
		>
			{emojiUrl ? (
				<img
					src={emojiUrl}
					alt={emoji.name}
					className={styles.signatureEmojiImg}
					data-flx="persona.persona-edit-modal.signature-emoji-chip.signature-emoji-img"
				/>
			) : (
				<span data-flx="persona.persona-edit-modal.signature-emoji-chip.span">{emoji.name}</span>
			)}
			<span data-flx="persona.persona-edit-modal.signature-emoji-chip.span--2">{emoji.name}</span>
			<button
				type="button"
				className={styles.signatureEmojiRemove}
				onClick={onRemove}
				aria-label={i18n._(REMOVE_SIGNATURE_EMOJI_ARIA)}
				data-flx="persona.persona-edit-modal.signature-emoji-chip.signature-emoji-remove.button"
			>
				<X size={12} weight="bold" data-flx="persona.persona-edit-modal.signature-emoji-chip.x" />
			</button>
		</div>
	);
};

function signatureEmojisEqual(a: ReadonlyArray<SignatureEmoji>, b: ReadonlyArray<SignatureEmoji>): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const left = a[i];
		const right = b[i];
		if (left.id !== right.id || left.name !== right.name) return false;
	}
	return true;
}

interface PersonaFormState {
	id?: string;
	name: string;
	pronouns: string;
	avatarHash: string;
	avatarColor?: number | null;
	bannerHash: string;
	accentColor: number | null;
	bio: string;
	visibility: PersonaVisibility;
	tags: Array<{prefix: string; suffix: string}>;
	signatureEmojis: Array<SignatureEmoji>;
}

const emptyFormState = (): PersonaFormState => ({
	name: '',
	pronouns: '',
	avatarHash: '',
	avatarColor: null,
	bannerHash: '',
	accentColor: null,
	bio: '',
	visibility: 'unlisted',
	tags: [{prefix: '', suffix: ''}],
	signatureEmojis: [],
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

function formatTagDisplay(tag: {prefix: string; suffix: string}): string {
	if (tag.prefix && tag.suffix) return `${tag.prefix}text${tag.suffix}`;
	if (tag.prefix) return `${tag.prefix}text`;
	if (tag.suffix) return `text${tag.suffix}`;
	return '';
}

export interface PersonaEditModalProps {
	persona?: Persona | null;
	onClose: () => void;
}

export const PersonaEditModal: React.FC<PersonaEditModalProps> = observer(({persona, onClose}) => {
	const {i18n} = useLingui();
	const currentUser = Users.currentUser;
	const prefersReducedMotion = Accessibility.useReducedMotion;
	const personas = PersonaStore.personas;

	const tagText = PersonaStore.displayTagText;
	const tagIcon = PersonaStore.displayTagIcon;

	const initialFormState = useMemo<PersonaFormState>(() => {
		if (!persona) return emptyFormState();
		return {
			id: persona.id,
			name: persona.name,
			pronouns: persona.pronouns ?? '',
			avatarHash: persona.avatar_hash ?? '',
			avatarColor: persona.avatar_color ?? null,
			bannerHash: persona.banner_hash ?? '',
			accentColor: persona.color ?? null,
			bio: persona.bio ?? '',
			visibility: persona.visibility ?? 'unlisted',
			tags:
				(persona.persona_tags ?? []).length > 0
					? (persona.persona_tags ?? []).map((t) => ({
							prefix: t.prefix ?? '',
							suffix: t.suffix ?? '',
						}))
					: [{prefix: '', suffix: ''}],
			signatureEmojis: (persona.signature_emojis ?? []).map((e) => ({
				id: e.id ?? null,
				name: e.name,
				animated: e.animated ?? null,
			})),
		};
	}, [persona]);

	const [formData, setFormData] = useState<PersonaFormState>(initialFormState);
	const initialFormStateRef = useRef<PersonaFormState>(initialFormState);
	const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
	const [isUploadingBanner, setIsUploadingBanner] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [flashBanner, setFlashBanner] = useState(false);

	const triggerFlash = useCallback(() => {
		setFlashBanner(true);
		window.setTimeout(() => {
			setFlashBanner(false);
		}, 300);
	}, []);

	const effectiveDefaultColor = useMemo<number | null>(() => {
		if (formData.avatarHash.trim()) {
			return formData.avatarColor ?? null;
		}
		// Persona has no avatar, inherits root user's avatar and avatar color
		if (currentUser && typeof currentUser.avatarColor === 'number') {
			return currentUser.avatarColor;
		}
		if (currentUser && !currentUser.avatar) {
			return AvatarUtils.getDefaultAvatarPrimaryColor(currentUser.id);
		}
		return null;
	}, [formData.avatarHash, formData.avatarColor, currentUser]);

	const hasUnsavedChanges = useMemo(() => {
		const initial = initialFormStateRef.current;
		if (!formData.id) {
			const hasNonEmptyTag = formData.tags.some((t) => t.prefix.trim() !== '' || t.suffix.trim() !== '');
			return (
				formData.name.trim() !== '' ||
				formData.pronouns.trim() !== '' ||
				formData.avatarHash !== '' ||
				formData.bannerHash !== '' ||
				formData.accentColor !== null ||
				formData.bio.trim() !== '' ||
				formData.visibility !== 'unlisted' ||
				hasNonEmptyTag ||
				formData.signatureEmojis.length > 0
			);
		}
		if (formData.name.trim() !== initial.name.trim()) return true;
		if (formData.pronouns.trim() !== initial.pronouns.trim()) return true;
		if (formData.avatarHash !== initial.avatarHash) return true;
		if (formData.bannerHash !== initial.bannerHash) return true;
		if (formData.accentColor !== initial.accentColor) return true;
		if (formData.bio.trim() !== initial.bio.trim()) return true;
		if (formData.visibility !== initial.visibility) return true;
		if (!signatureEmojisEqual(formData.signatureEmojis, initial.signatureEmojis)) return true;

		const formTags = formData.tags.map(normalizeTag).filter((t) => t.prefix || t.suffix);
		const initTags = initial.tags.map(normalizeTag).filter((t) => t.prefix || t.suffix);
		if (formTags.length !== initTags.length) return true;
		for (let i = 0; i < formTags.length; i++) {
			if (formTags[i].prefix !== initTags[i].prefix || formTags[i].suffix !== initTags[i].suffix) {
				return true;
			}
		}
		return false;
	}, [formData]);

	const handleAttemptClose = useCallback(() => {
		if (hasUnsavedChanges) {
			triggerFlash();
			return;
		}
		onClose();
	}, [hasUnsavedChanges, triggerFlash, onClose]);

	const handleResetForm = useCallback(() => {
		setFormData(initialFormStateRef.current);
	}, []);

	const getTagRowError = useCallback(
		(idx: number): string | null => {
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
				const otherTags = p.persona_tags ?? [];
				for (const ot of otherTags) {
					const normOther = normalizeTag(ot);
					if ((normOther.prefix || normOther.suffix) && getTagKey(normOther) === currentKey) {
						return i18n._(TAG_PAIR_IN_USE_DESCRIPTOR, {name: p.name});
					}
				}
			}

			return null;
		},
		[formData.tags, formData.id, personas, i18n],
	);

	const hasTagErrors = formData.tags.some((_, idx) => Boolean(getTagRowError(idx)));

	const signatureEmojisRef = useRef(formData.signatureEmojis);
	signatureEmojisRef.current = formData.signatureEmojis;

	const handleAddSignatureEmoji = useCallback(
		(selectedEmoji: FlatEmoji) => {
			const reactionEmoji = toReactionEmoji(selectedEmoji as any);
			const newSig: SignatureEmoji = {
				id: reactionEmoji.id ?? null,
				name: reactionEmoji.name,
				animated: reactionEmoji.animated ?? null,
			};

			const currentSigs = signatureEmojisRef.current;

			const isDuplicate = currentSigs.some(
				(s) => (s.id && s.id === newSig.id) || (!s.id && !newSig.id && s.name === newSig.name),
			);
			if (isDuplicate) {
				ToastCommands.createToast({
					type: 'info',
					children: i18n._(DUPLICATE_SIGNATURE_EMOJI_DESCRIPTOR),
				});
				return;
			}

			for (const p of personas) {
				if (formData.id && p.id === formData.id) continue;
				const otherSigs = p.signature_emojis ?? [];
				const collision = otherSigs.some(
					(s) => (s.id && s.id === newSig.id) || (!s.id && !newSig.id && s.name === newSig.name),
				);
				if (collision) {
					ToastCommands.createToast({
						type: 'error',
						children: i18n._(SIGNATURE_EMOJI_IN_USE_DESCRIPTOR, {name: p.name}),
					});
					return;
				}
			}

			if (currentSigs.length >= MAX_SIGNATURE_EMOJIS_PER_PERSONA) {
				ToastCommands.createToast({
					type: 'error',
					children: i18n._(SIGNATURE_EMOJIS_LIMIT_DESCRIPTOR, {max: MAX_SIGNATURE_EMOJIS_PER_PERSONA}),
				});
				return;
			}

			const nextSigs = [...currentSigs, newSig];
			signatureEmojisRef.current = nextSigs;
			setFormData((prev) => ({
				...prev,
				signatureEmojis: nextSigs,
			}));
			ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
		},
		[formData.id, personas, i18n],
	);

	const filterEmoji = useCallback((emoji: FlatEmoji) => {
		const reaction = toReactionEmoji(emoji as any);
		return !signatureEmojisRef.current.some((sig) =>
			sig.id ? sig.id === reaction.id : !reaction.id && sig.name === reaction.name,
		);
	}, []);

	const handleRemoveSignatureEmoji = useCallback((idx: number) => {
		setFormData((prev) => {
			const nextSigs = prev.signatureEmojis.filter((_, i) => i !== idx);
			signatureEmojisRef.current = nextSigs;
			return {
				...prev,
				signatureEmojis: nextSigs,
			};
		});
		ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
	}, []);

	const handleAvatarUpload = async (base64: string) => {
		setFormData((prev) => ({...prev, avatarHash: base64}));
		setIsUploadingAvatar(true);
		try {
			const res = await http.post<{avatar_hash?: string; avatar_color?: number | null}>(Endpoints.USER_PERSONA_AVATAR, {
				body: {avatar: base64},
			});
			const newHash = res.body?.avatar_hash;
			if (res.ok && newHash) {
				setFormData((prev) => ({
					...prev,
					avatarHash: newHash,
					...(res.body?.avatar_color !== undefined ? {avatarColor: res.body.avatar_color} : {}),
				}));
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
		setFormData((prev) => ({...prev, avatarHash: '', avatarColor: null}));
	};

	const handleBannerUpload = async (base64: string) => {
		setFormData((prev) => ({...prev, bannerHash: base64}));
		setIsUploadingBanner(true);
		try {
			const res = await http.post<{banner_hash?: string}>(Endpoints.USER_PERSONA_BANNER, {
				body: {banner: base64},
			});
			const newHash = res.body?.banner_hash;
			if (res.ok && newHash) {
				setFormData((prev) => ({...prev, bannerHash: newHash}));
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
		setFormData((prev) => ({...prev, bannerHash: ''}));
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

	const handleSaveForm = async () => {
		if (isUploadingAvatar || isUploadingBanner) {
			ToastCommands.createToast({
				type: 'info',
				children: 'Please wait for images to finish uploading',
			});
			return;
		}

		const trimmedName = formData.name.trim();
		if (!trimmedName) {
			ToastCommands.createToast({
				type: 'error',
				children: 'Persona name cannot be empty',
			});
			return;
		}

		if (hasTagErrors) {
			ToastCommands.createToast({
				type: 'error',
				children: 'Please fix tag errors before saving',
			});
			return;
		}

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
				const otherTags = p.persona_tags ?? [];
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

		setIsSubmitting(true);
		try {
			if (formData.id) {
				await PersonaCommands.updatePersona(formData.id, {
					name: trimmedName,
					pronouns: formData.pronouns.trim() || null,
					avatar_hash: formData.avatarHash.trim() || null,
					avatar_color: formData.avatarColor ?? null,
					banner_hash: formData.bannerHash.trim() || null,
					color: parsedColor,
					bio: formData.bio.trim() || null,
					visibility: formData.visibility,
					persona_tags: validTags,
					signature_emojis: formData.signatureEmojis,
				});
				ToastCommands.createToast({
					type: 'success',
					children: i18n._(PERSONA_UPDATED_DESCRIPTOR),
				});
			} else {
				await PersonaCommands.createPersona({
					name: trimmedName,
					pronouns: formData.pronouns.trim() || null,
					avatar_hash: formData.avatarHash.trim() || null,
					avatar_color: formData.avatarColor ?? null,
					banner_hash: formData.bannerHash.trim() || null,
					color: parsedColor,
					bio: formData.bio.trim() || null,
					visibility: formData.visibility,
					persona_tags: validTags,
					signature_emojis: formData.signatureEmojis,
				});
				ToastCommands.createToast({
					type: 'success',
					children: i18n._(PERSONA_CREATED_DESCRIPTOR),
				});
			}

			onClose();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : i18n._(FAILED_TO_SAVE_PERSONA_DESCRIPTOR);
			ToastCommands.createToast({
				type: 'error',
				children: message,
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDeletePersona = () => {
		if (!formData.id) return;
		const personaId = formData.id;

		ModalCommands.push(
			modal(() => (
				<ConfirmModal
					title={<Trans>Delete Persona</Trans>}
					description={
						<Trans>
							Are you sure you want to delete{' '}
							<strong data-flx="persona.persona-edit-modal.handle-delete-persona.strong">{formData.name}</strong>? This
							action cannot be undone.
						</Trans>
					}
					primaryText={<Trans>Delete</Trans>}
					primaryVariant="danger"
					onPrimary={async () => {
						try {
							await PersonaCommands.deletePersona(personaId);
							ToastCommands.createToast({
								type: 'success',
								children: i18n._(PERSONA_DELETED_DESCRIPTOR),
							});
							ModalCommands.popWithKey(PERSONA_EDIT_MODAL_KEY);
						} catch {
							ToastCommands.createToast({
								type: 'error',
								children: i18n._(FAILED_TO_DELETE_PERSONA_DESCRIPTOR),
							});
						}
					}}
					data-flx="persona.persona-edit-modal.handle-delete-persona.confirm-modal"
				/>
			)),
		);
	};

	const modalTitle = formData.id
		? formData.name
			? formData.name
			: i18n._(EDIT_PERSONA_DESCRIPTOR)
		: i18n._(NEW_PERSONA_DESCRIPTOR);

	const visibilityTabs = useMemo(() => getVisibilityTabs(i18n), [i18n]);
	const visibilityDescriptions = useMemo(() => getVisibilityDescriptions(i18n), [i18n]);

	return (
		<Modal.Root
			size="large"
			onClose={handleAttemptClose}
			className={styles.modalRoot}
			data-flx="persona.persona-edit-modal.modal-root"
		>
			<Modal.ScreenReaderLabel text={modalTitle} data-flx="persona.persona-edit-modal.modal-screen-reader-label" />

			{/* Top Header / Unsaved Changes Banner */}
			<div
				className={clsx(
					styles.header,
					hasUnsavedChanges && styles.headerBannerActive,
					hasUnsavedChanges && flashBanner && styles.headerBannerFlash,
				)}
				data-flx="persona.persona-edit-modal.header"
			>
				<AnimatePresence mode="wait" data-flx="persona.persona-edit-modal.animate-presence">
					{hasUnsavedChanges ? (
						<motion.div
							key="unsaved-banner"
							initial={prefersReducedMotion ? {opacity: 1} : {opacity: 0}}
							animate={{opacity: 1}}
							exit={prefersReducedMotion ? {opacity: 1} : {opacity: 0}}
							transition={prefersReducedMotion ? {duration: 0} : {duration: 0.2, ease: 'easeOut'}}
							className={styles.bannerContent}
							data-flx="persona.persona-edit-modal.banner-content"
						>
							<div className={styles.bannerTextContainer} data-flx="persona.persona-edit-modal.banner-text-container">
								<div
									className={clsx(styles.bannerText, flashBanner && styles.bannerTextFlash)}
									data-flx="persona.persona-edit-modal.banner-text"
								>
									<Trans>You have unsaved changes.</Trans>
								</div>
							</div>
							<div className={styles.bannerActions} data-flx="persona.persona-edit-modal.banner-actions">
								<Button
									variant="secondary"
									small
									onClick={handleResetForm}
									disabled={isSubmitting}
									data-flx="persona.persona-edit-modal.button.reset"
								>
									<Trans>Reset</Trans>
								</Button>
								<Button
									variant="primary"
									small
									onClick={handleSaveForm}
									submitting={isSubmitting || isUploadingAvatar || isUploadingBanner}
									data-flx="persona.persona-edit-modal.button.save"
								>
									<Trans>Save changes</Trans>
								</Button>
							</div>
						</motion.div>
					) : (
						<motion.div
							key="normal-header"
							initial={prefersReducedMotion ? {opacity: 1} : {opacity: 0}}
							animate={{opacity: 1}}
							exit={prefersReducedMotion ? {opacity: 1} : {opacity: 0}}
							transition={prefersReducedMotion ? {duration: 0} : {duration: 0.2, ease: 'easeOut'}}
							className={styles.titleContent}
							data-flx="persona.persona-edit-modal.title-content"
						>
							<div className={styles.titleWrapper} data-flx="persona.persona-edit-modal.title-wrapper">
								<h3 className={styles.title} data-flx="persona.persona-edit-modal.title">
									{modalTitle}
								</h3>
							</div>
							<button
								type="button"
								aria-label={i18n._(CLOSE_DESCRIPTOR)}
								onClick={handleAttemptClose}
								className={styles.closeButton}
								data-flx="persona.persona-edit-modal.button.close"
							>
								<X weight="bold" width={20} height={20} data-flx="persona.persona-edit-modal.x" />
							</button>
						</motion.div>
					)}
				</AnimatePresence>
			</div>

			{/* Modal Body */}
			<Modal.Content padding="none" data-flx="persona.persona-edit-modal.modal-content">
				<div className={styles.contentContainer} data-flx="persona.persona-edit-modal.content-container">
					<div className={styles.layout} data-flx="persona.persona-edit-modal.layout">
						{/* Left column: Form */}
						<div className={styles.formColumn} data-flx="persona.persona-edit-modal.form-column">
							{/* 1. Display name */}
							<Input
								label={<Trans>Display name</Trans>}
								placeholder={i18n._(NAME_PLACEHOLDER_DESCRIPTOR)}
								maxLength={100}
								value={formData.name}
								onChange={(e) => setFormData((prev) => ({...prev, name: e.target.value}))}
								data-flx="persona.persona-edit-modal.input.name"
							/>

							{/* 2. Pronouns */}
							<Input
								label={<Trans>Pronouns</Trans>}
								placeholder={i18n._(PRONOUNS_PLACEHOLDER_DESCRIPTOR)}
								maxLength={100}
								value={formData.pronouns}
								onChange={(e) => setFormData((prev) => ({...prev, pronouns: e.target.value}))}
								data-flx="persona.persona-edit-modal.input.pronouns"
							/>

							{/* 3. Avatar */}
							<AvatarUploader
								hasAvatar={Boolean(formData.avatarHash)}
								onAvatarChange={handleAvatarUpload}
								onAvatarClear={handleAvatarClear}
								isPerGuildProfile={false}
								disabled={isUploadingAvatar}
								data-flx="persona.persona-edit-modal.avatar-uploader"
							/>

							{/* 4. Banner */}
							<BannerUploader
								hasBanner={Boolean(formData.bannerHash)}
								onBannerChange={handleBannerUpload}
								onBannerClear={handleBannerClear}
								disabled={isUploadingBanner}
								disableModeSelection={true}
								requireBannerEntitlement={false}
								isPerGuildProfile={false}
								data-flx="persona.persona-edit-modal.banner-uploader"
							/>

							{/* 5. Accent color */}
							<AccentColorPicker
								value={formData.accentColor}
								defaultColor={effectiveDefaultColor}
								onChange={(accentColor) => setFormData((prev) => ({...prev, accentColor}))}
								disabled={isSubmitting}
								data-flx="persona.persona-edit-modal.accent-color-picker"
							/>

							{/* 6. About me */}
							<Textarea
								label={<Trans>About me</Trans>}
								placeholder={i18n._(BIO_PLACEHOLDER_DESCRIPTOR)}
								maxLength={4096}
								minRows={3}
								maxRows={8}
								showCharacterCount={true}
								footer={
									<div className={styles.inputFooter} data-flx="persona.persona-edit-modal.input-footer">
										<Trans>You can use links, emoji, and Markdown.</Trans>
									</div>
								}
								value={formData.bio}
								onChange={(e) => setFormData((prev) => ({...prev, bio: e.target.value}))}
								data-flx="persona.persona-edit-modal.textarea.bio"
							/>

							{/* 7. Persona Tags (Prefix & Suffix) */}
							<div className={styles.sectionBlock} data-flx="persona.persona-edit-modal.section-block">
								<div className={styles.tagsHeader} data-flx="persona.persona-edit-modal.tags-header">
									<span className={styles.fieldLabel} data-flx="persona.persona-edit-modal.field-label">
										<Trans>Persona Tags (Prefix & Suffix)</Trans>
									</span>
									<Button
										variant="secondary"
										small
										leftIcon={<Plus size={14} data-flx="persona.persona-edit-modal.plus" />}
										onClick={handleAddTagRow}
										disabled={formData.tags.length >= 5}
										data-flx="persona.persona-edit-modal.button.add-tag-row"
									>
										<Trans>Add Tag Pair ({formData.tags.length}/5)</Trans>
									</Button>
								</div>
								{formData.tags.map((tag, idx) => {
									const tagError = getTagRowError(idx);
									return (
										<div key={idx} style={{marginBottom: 6}} data-flx="persona.persona-edit-modal.div">
											<div
												className={styles.tagRow}
												style={{marginBottom: tagError ? 2 : 0}}
												data-flx="persona.persona-edit-modal.tag-row"
											>
												<input
													type="text"
													className={`${styles.tagInput} ${tagError ? styles.tagInputError : ''}`}
													placeholder={i18n._(PREFIX_PLACEHOLDER_DESCRIPTOR)}
													value={tag.prefix}
													onChange={(e) => handleTagChange(idx, 'prefix', e.target.value)}
													data-flx="persona.persona-edit-modal.tag-input.tag-change.text"
												/>
												<span style={{color: 'var(--text-primary-muted)'}} data-flx="persona.persona-edit-modal.span">
													text
												</span>
												<input
													type="text"
													className={`${styles.tagInput} ${tagError ? styles.tagInputError : ''}`}
													placeholder={i18n._(SUFFIX_PLACEHOLDER_DESCRIPTOR)}
													value={tag.suffix}
													onChange={(e) => handleTagChange(idx, 'suffix', e.target.value)}
													data-flx="persona.persona-edit-modal.tag-input.tag-change.text--2"
												/>
												{formData.tags.length > 1 && (
													<Button
														variant="danger"
														small
														square
														icon={<Trash size={14} data-flx="persona.persona-edit-modal.trash" />}
														onClick={() => handleRemoveTagRow(idx)}
														aria-label={i18n._(REMOVE_TAG_PAIR_ARIA_DESCRIPTOR)}
														data-flx="persona.persona-edit-modal.button.remove-tag-row"
													/>
												)}
											</div>
											{tagError && (
												<div className={styles.tagErrorText} data-flx="persona.persona-edit-modal.tag-error-text">
													{tagError}
												</div>
											)}
										</div>
									);
								})}
							</div>

							{/* 7b. Signature Emojis */}
							<div className={styles.sectionBlock} data-flx="persona.persona-edit-modal.section-block--2">
								<div className={styles.tagsHeader} data-flx="persona.persona-edit-modal.tags-header--2">
									<span
										className={styles.fieldLabel}
										style={{margin: 0}}
										data-flx="persona.persona-edit-modal.field-label--2"
									>
										<Trans>Signature Emojis</Trans>
									</span>
									<Popout
										render={({onClose}) => (
											<EmojiPickerPopout
												channelId={null}
												handleSelect={(selectedEmoji) => {
													handleAddSignatureEmoji(selectedEmoji);
												}}
												filterEmoji={filterEmoji}
												onClose={onClose}
												data-flx="persona.persona-edit-modal.signature-emoji-picker"
											/>
										)}
										position="top-start"
										uniqueId={`persona-signature-emoji-picker-${formData.id ?? 'new'}`}
										data-flx="persona.persona-edit-modal.popout"
									>
										<Button
											variant="secondary"
											small
											leftIcon={<Plus size={14} data-flx="persona.persona-edit-modal.plus--2" />}
											disabled={formData.signatureEmojis.length >= MAX_SIGNATURE_EMOJIS_PER_PERSONA}
											data-flx="persona.persona-edit-modal.add-signature-emoji-button"
										>
											<Trans>Add Emoji ({formData.signatureEmojis.length})</Trans>
										</Button>
									</Popout>
								</div>
								<div
									className={styles.modeHelperText}
									style={{marginTop: 4, marginBottom: 8}}
									data-flx="persona.persona-edit-modal.mode-helper-text"
								>
									<Info
										size={16}
										weight="bold"
										className={styles.modeHelperIcon}
										data-flx="persona.persona-edit-modal.mode-helper-icon"
									/>
									<span data-flx="persona.persona-edit-modal.span--2">
										<Trans>
											Reacting with a signature emoji will always react as this persona, regardless of active persona.
										</Trans>
									</span>
								</div>
								{formData.signatureEmojis.length > 0 && (
									<div className={styles.signatureEmojiGrid} data-flx="persona.persona-edit-modal.signature-emoji-grid">
										{formData.signatureEmojis.map((sigEmoji, idx) => (
											<SignatureEmojiChip
												key={sigEmoji.id ? `custom_${sigEmoji.id}` : `unicode_${sigEmoji.name}`}
												emoji={sigEmoji}
												onRemove={() => handleRemoveSignatureEmoji(idx)}
												data-flx="persona.persona-edit-modal.signature-emoji-chip"
											/>
										))}
									</div>
								)}
							</div>

							{/* 8. Visibility */}
							<div className={styles.sectionBlock} data-flx="persona.persona-edit-modal.section-block--3">
								<div
									className={styles.fieldLabel}
									style={{marginBottom: '0.5rem'}}
									data-flx="persona.persona-edit-modal.field-label--3"
								>
									<Trans>Visibility</Trans>
								</div>
								<SegmentedTabs<PersonaVisibility>
									tabs={visibilityTabs}
									selectedTab={formData.visibility}
									onTabChange={(vis) => setFormData((prev) => ({...prev, visibility: vis}))}
									ariaLabel={i18n._(PERSONA_VISIBILITY_ARIA_DESCRIPTOR)}
									data-flx="persona.persona-edit-modal.segmented-tabs"
								/>
								<div
									className={styles.modeHelperText}
									style={{marginTop: 6}}
									data-flx="persona.persona-edit-modal.mode-helper-text--2"
								>
									<Info
										size={16}
										weight="bold"
										className={styles.modeHelperIcon}
										data-flx="persona.persona-edit-modal.mode-helper-icon--2"
									/>
									<span data-flx="persona.persona-edit-modal.span--3">
										{visibilityDescriptions[formData.visibility]}
									</span>
								</div>
							</div>

							{/* 9. Bottom actions: Delete button only when editing existing persona */}
							{formData.id && (
								<div className={styles.detailBottomActions} data-flx="persona.persona-edit-modal.detail-bottom-actions">
									<Button
										variant="danger"
										leftIcon={<Trash size={14} data-flx="persona.persona-edit-modal.trash--2" />}
										onClick={handleDeletePersona}
										aria-label={i18n._(DELETE_PERSONA_ARIA_DESCRIPTOR)}
										data-flx="persona.persona-edit-modal.button.delete-persona"
									>
										<Trans>Delete Persona</Trans>
									</Button>
								</div>
							)}
						</div>

						{/* Right column: Live Profile Preview */}
						{currentUser && (
							<div className={styles.previewColumn} data-flx="persona.persona-edit-modal.preview-column">
								<div className={styles.liveCardWrapper} data-flx="persona.persona-edit-modal.live-card-wrapper">
									<ProfileCardLayout
										borderColor={
											formData.accentColor != null
												? ColorUtils.int2hex(formData.accentColor)
												: effectiveDefaultColor != null
													? ColorUtils.int2hex(effectiveDefaultColor)
													: 'var(--border-color)'
										}
										showPreviewLabel={true}
										className={popoutStyles.profilePopoutCard}
										style={PROFILE_POPOUT_GEOMETRY_STYLE}
										data-flx="persona.persona-edit-modal.profile-card-layout"
									>
										<ProfileCardBanner
											bannerUrl={
												formData.bannerHash
													? AvatarUtils.getPersonaBannerURL({
															userId: currentUser?.id ?? '',
															banner: formData.bannerHash,
														})
													: null
											}
											hoverBannerUrl={null}
											bannerColor={
												formData.accentColor != null
													? ColorUtils.int2hex(formData.accentColor)
													: effectiveDefaultColor != null
														? ColorUtils.int2hex(effectiveDefaultColor)
														: 'var(--bg-secondary)'
											}
											user={currentUser}
											avatarUrl={
												formData.avatarHash.trim()
													? AvatarUtils.getPersonaAvatarURL({
															userId: currentUser?.id ?? '',
															avatar: formData.avatarHash.trim(),
														})
													: AvatarUtils.getUserAvatarURL(currentUser, false)
											}
											hoverAvatarUrl={null}
											disablePresence={true}
											isClickable={false}
											data-flx="persona.persona-edit-modal.profile-card-banner"
										/>
										<ProfileCardContent data-flx="persona.persona-edit-modal.profile-card-content">
											<ProfileCardUserInfo
												displayName={formData.name.trim() || 'Persona'}
												displayNameClassName={popoutStyles.profileDisplayName}
												user={currentUser}
												pronouns={formData.pronouns.trim() || null}
												showUsername={false}
												isClickable={false}
												actions={
													tagText.trim() || tagIcon ? (
														<PersonaTag
															subprofile={{
																id: 'preview',
																name: formData.name.trim() || 'Persona',
																display_tag_text: tagText.trim() || null,
																display_tag_icon: tagIcon || null,
															}}
															rootUser={currentUser}
															data-flx="persona.persona-edit-modal.persona-tag"
														/>
													) : undefined
												}
												data-flx="persona.persona-edit-modal.profile-card-user-info"
											/>
											{formData.bio.trim() ? (
												<section className={sharedStyles.bioContainer} data-flx="persona.persona-edit-modal.section">
													<div
														className={clsx(
															markupStyles.markup,
															markupStyles.bio,
															markupStyles.mutedSpoilerContext,
															styles.previewBioContent,
														)}
														data-flx="persona.persona-edit-modal.preview-bio-content"
													>
														<SafeMarkdown
															content={formData.bio.trim()}
															options={{context: MarkdownContext.RESTRICTED_USER_BIO}}
															data-flx="persona.persona-edit-modal.safe-markdown"
														/>
													</div>
												</section>
											) : null}
											<div
												className={sharedStyles.connectionsCompactSeparator}
												data-flx="persona.persona-edit-modal.div--2"
											/>
											<div className={sharedStyles.connectionsContainer} data-flx="persona.persona-edit-modal.div--3">
												<div className={sharedStyles.connectionsTitle} data-flx="persona.persona-edit-modal.div--4">
													<Trans>Main account</Trans>
												</div>
												<div
													className={clsx(sharedStyles.connectionCard, styles.rootAccountCard)}
													data-flx="persona.persona-edit-modal.root-account-card"
												>
													<Avatar
														user={currentUser}
														size={32}
														className={styles.rootAccountAvatar}
														data-flx="persona.persona-edit-modal.root-account-avatar"
													/>
													<div
														className={styles.rootAccountInfo}
														data-flx="persona.persona-edit-modal.root-account-info"
													>
														<span
															className={sharedStyles.connectionCardName}
															data-flx="persona.persona-edit-modal.span--4"
														>
															{currentUser.globalName || currentUser.username}
														</span>
														<span
															className={styles.rootAccountUsername}
															data-flx="persona.persona-edit-modal.root-account-username"
														>
															@{currentUser.username}
														</span>
													</div>
												</div>
											</div>
										</ProfileCardContent>
									</ProfileCardLayout>
								</div>
							</div>
						)}
					</div>
				</div>
			</Modal.Content>
		</Modal.Root>
	);
});

PersonaEditModal.displayName = 'PersonaEditModal';

export const PERSONA_EDIT_MODAL_KEY = 'persona-edit-modal';

export function openPersonaEditModal(persona?: Persona | null): void {
	ModalCommands.pushWithKey(
		ModalCommands.modal(() => (
			<PersonaEditModal
				persona={persona}
				onClose={() => ModalCommands.popWithKey(PERSONA_EDIT_MODAL_KEY)}
				data-flx="persona.persona-edit-modal.open-persona-edit-modal.persona-edit-modal"
			/>
		)),
		PERSONA_EDIT_MODAL_KEY,
	);
}
