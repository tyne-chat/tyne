// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaGalleryNav} from '@app/features/persona/state/PersonaGalleryNav';
import * as M from '@app/features/persona/utils/PersonaGalleryMessages';
import {usePersonaDirectory} from '@app/features/persona/utils/usePersonaDirectory';
import type {User} from '@app/features/user/models/User';
import {useLingui} from '@lingui/react/macro';
import {useEffect, useMemo, useState} from 'react';

/** The fork's tab in the full profile's tab list (`ProfileTab`). */
export type PersonaProfileTab = 'personas';

export interface PersonaProfileTabItem {
	key: PersonaProfileTab;
	label: string;
}

/**
 * The full profile's "Personas (N)" tab (tyne-chat/tyne#189): the tab, or null when it has nothing
 * to show (a bot, or someone with no public persona; one's own profile always has it). It also
 * switches to the tab when a Personas pill asked for it, once the tab is there.
 */
export function usePersonaProfileTab(
	user: User,
	setActiveTab: (tab: PersonaProfileTab) => void,
): PersonaProfileTabItem | null {
	const {i18n} = useLingui();
	const isAccount = !user.bot && !user.system;
	const directory = usePersonaDirectory(isAccount ? user.id : null);
	// A persona opened from its popout shows in the tab even when the list has none to show (an
	// unlisted persona of an account without public ones), for as long as this profile is open.
	const pendingPersona = PersonaGalleryNav.pendingPersona(user.id);
	const [keepForPersona, setKeepForPersona] = useState(false);
	const show = isAccount && (directory.isOwn || directory.publicCount > 0 || keepForPersona || Boolean(pendingPersona));
	const hasRequest = PersonaGalleryNav.hasTabRequest(user.id);
	useEffect(() => {
		if (pendingPersona) setKeepForPersona(true);
	}, [pendingPersona]);
	useEffect(() => {
		if (show && hasRequest && PersonaGalleryNav.takeTabRequest(user.id)) setActiveTab('personas');
	}, [show, hasRequest, user.id, setActiveTab]);
	return useMemo(
		() => (show ? {key: 'personas', label: i18n._(M.PERSONAS_COUNT_DESCRIPTOR, {count: directory.publicCount})} : null),
		[show, directory.publicCount, i18n],
	);
}

/**
 * Puts the Personas tab second, after Overview. One's own profile, which upstream shows without
 * tabs, gets Overview and Personas only: the mutual tabs mean nothing there.
 */
export function addPersonaProfileTab<T extends {key: string}>(
	items: Array<T>,
	tab: T | null,
	isCurrentUser: boolean,
): void {
	if (!tab) return;
	if (isCurrentUser) {
		items.splice(1, items.length - 1, tab);
	} else {
		items.splice(1, 0, tab);
	}
}
