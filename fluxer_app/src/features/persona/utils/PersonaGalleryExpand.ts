// SPDX-License-Identifier: AGPL-3.0-or-later

// Expanding the Personas tab to the whole profile window (tyne-chat/tyne#189, tyne-chat/tyne#825):
// the gallery marks upstream's profile window with attributes, and PersonaGallery.module.css hides
// upstream's banner, name block and tab row and, on the list view, grows the window to fill the
// client viewport by their data-flx attributes, so no upstream file changes.
// PersonaGalleryExpand.test.ts fails if upstream renames one of them.

export const PROFILE_MODAL_ROOT_SELECTOR = '[data-flx="user.user-profile-modal.modal-root"]';
export const PERSONA_GALLERY_EXPANDED_ATTRIBUTE = 'data-persona-gallery-expanded';
export const PERSONA_GALLERY_FULL_WINDOW_ATTRIBUTE = 'data-persona-gallery-full-window';

/** What expanding hides, as PersonaGallery.module.css names it: [file it is in, data-flx]. */
export const HIDDEN_WHEN_EXPANDED: ReadonlyArray<readonly [string, string]> = [
	[
		'user/components/modals/user_profile_modal/ProfileMediaHeader.tsx',
		'user.user-profile-modal.profile-media-header.header',
	],
	['user/components/modals/user_profile_modal/UserProfileModalUserInfo.tsx', 'user.user-profile-modal.user-info.div'],
	['user/components/modals/user_profile_modal/ProfileBody.tsx', 'user.user-profile-modal.profile-body.div--2'],
];

/** Upstream containers whose layout PersonaGallery.module.css adjusts when expanded: [file, data-flx]. */
export const STYLED_WHEN_EXPANDED: ReadonlyArray<readonly [string, string]> = [
	['user/components/modals/user_profile_modal/ProfileBody.tsx', 'user.user-profile-modal.profile-body.div'],
	['user/components/modals/user_profile_modal/ProfileBody.tsx', 'user.user-profile-modal.profile-body.div--4'],
];
