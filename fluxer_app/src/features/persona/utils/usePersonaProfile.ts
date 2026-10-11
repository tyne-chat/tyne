// SPDX-License-Identifier: AGPL-3.0-or-later

import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import type {PublicPersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {useEffect, useMemo, useState} from 'react';

export interface PersonaProfileView {
	/** The profile, once there is one to show. */
	profile: PublicPersonaResponse | null;
	isLoading: boolean;
	/** Its owner keeps this persona's profile to themselves. */
	isPrivate: boolean;
}

/**
 * The profile behind a persona's name, for the card that opens from it: the viewer's own persona
 * as they have it, or what the server gives this viewer for someone else's. A bio or banner is
 * never taken from anywhere else, so what a persona's visibility withholds is not shown.
 */
export function usePersonaProfile(
	userId: string,
	personaId: string,
	ownPersona: ClientPersona | null,
): PersonaProfileView {
	const [fetched, setFetched] = useState<PersonaCommands.PersonaProfileResult | null>(null);
	const isOwn = ownPersona !== null;

	useEffect(() => {
		if (isOwn) return;
		let isMounted = true;
		setFetched(null);
		void PersonaCommands.fetchPersonaProfile(userId, personaId).then((result) => {
			if (isMounted) setFetched(result);
		});
		return () => {
			isMounted = false;
		};
	}, [userId, personaId, isOwn]);

	const ownProfile = useMemo<PublicPersonaResponse | null>(() => {
		if (!ownPersona) return null;
		return {
			id: ownPersona.id,
			name: ownPersona.name,
			avatar_hash: ownPersona.avatar_hash ?? null,
			banner_hash: ownPersona.banner_hash ?? null,
			pronouns: ownPersona.pronouns ?? null,
			color: ownPersona.color ?? null,
			avatar_color: ownPersona.avatar_color ?? null,
			bio: ownPersona.bio ?? null,
			visibility: ownPersona.visibility ?? 'unlisted',
		};
	}, [ownPersona]);

	if (ownProfile) {
		return {profile: ownProfile, isLoading: false, isPrivate: false};
	}
	return {
		profile: fetched?.status === 'ready' ? fetched.profile : null,
		isLoading: fetched === null,
		isPrivate: fetched?.status === 'private',
	};
}
