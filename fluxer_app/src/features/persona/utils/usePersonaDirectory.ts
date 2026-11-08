// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import {PersonaDirectory, type PersonaDirectoryStatus} from '@app/features/persona/state/PersonaDirectory';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {
	type GalleryPersona,
	galleryItemsFromOwn,
	galleryItemsFromPublic,
} from '@app/features/persona/utils/PersonaGalleryItems';
import {useEffect} from 'react';

export interface PersonaDirectoryView {
	status: PersonaDirectoryStatus;
	/** Someone else's public personas; for one's own account, all of them. */
	items: ReadonlyArray<GalleryPersona>;
	/** How many personas others see in the list. */
	publicCount: number;
	displayTagText: string | null;
	displayTagIcon: string | null;
	isOwn: boolean;
	retry: () => void;
}

const noop = () => {};

/**
 * An account's personas for the Personas tab, sheet and pill, and its display tag. For someone else
 * this asks `PersonaDirectory`, which sends at most one request per account a minute however many
 * components ask; one's own come from `PersonaStore` and cost no request. Use it in observer
 * components. Pass `null` to ask nothing (bots, webhooks).
 */
export function usePersonaDirectory(userId: string | null): PersonaDirectoryView {
	const isOwn = userId !== null && userId === Authentication.currentUserId;
	const entry = userId && !isOwn ? PersonaDirectory.get(userId) : undefined;
	const isMissing = entry === undefined;
	const revision = userId && !isOwn ? PersonaDirectory.revision(userId) : 0;

	useEffect(() => {
		if (!userId || isOwn) return;
		PersonaDirectory.ensure(userId);
	}, [userId, isOwn, isMissing, revision]);

	if (!userId) {
		return {
			status: 'forbidden',
			items: [],
			publicCount: 0,
			displayTagText: null,
			displayTagIcon: null,
			isOwn: false,
			retry: noop,
		};
	}
	if (isOwn) {
		const items = galleryItemsFromOwn(PersonaStore.personas);
		return {
			status: 'ready',
			items,
			publicCount: items.filter((p) => p.visibility === 'public').length,
			displayTagText: PersonaStore.displayTagText.trim() || null,
			displayTagIcon: PersonaStore.displayTagIcon?.trim() || null,
			isOwn: true,
			retry: noop,
		};
	}
	const list = entry?.list ?? null;
	const items = list ? galleryItemsFromPublic(list.personas) : [];
	return {
		status: entry?.status ?? 'loading',
		items,
		publicCount: items.length,
		displayTagText: list?.display_tag_text?.trim() || null,
		displayTagIcon: list?.display_tag_icon?.trim() || null,
		isOwn: false,
		retry: () => PersonaDirectory.retry(userId),
	};
}
