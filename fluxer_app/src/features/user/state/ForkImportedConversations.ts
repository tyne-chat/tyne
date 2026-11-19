// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: your DM with a Discord import placeholder that holds the imported history (tyne-chat/tyne#696). Once
// closed it can be opened again, so the placeholder's profile offers Open DM, but only when there is one.

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import Authentication from '@app/features/auth/state/Authentication';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {isImportedPlaceholder} from '@app/features/user/utils/ForkImportedUser';
import type {ImportedConversationResponse} from '@fluxer/schema/src/domains/user/ForkImportedConversationSchemas';
import {action, makeObservable, observable} from 'mobx';
import {useEffect} from 'react';

const logger = new Logger('ImportedConversations');

/** How long a failed request is left alone, so that renders and reopened profiles don't repeat it. */
export const IMPORTED_CONVERSATION_FAILURE_COOLDOWN_MS = 60_000;

export interface ImportedConversationsDeps {
	/** The DM's id, or null when there is none; throws when the request fails. */
	fetchChannelId: (userId: string) => Promise<string | null>;
	now: () => number;
	viewerId: () => string | null;
}

async function fetchChannelIdOverHttp(userId: string): Promise<string | null> {
	const res = await http.get<ImportedConversationResponse>(ForkEndpoints.USER_IMPORTED_CONVERSATION(userId));
	if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
	return res.body.channel_id;
}

/**
 * One request per placeholder answers every profile that shows it: a request in flight is shared, and the
 * answer is kept until the app reloads, since only an import changes it. A failure is not asked again for a
 * minute. Keyed by viewer as well, as a desktop account switch changes whose DMs they are.
 */
export class ImportedConversationsStore {
	private readonly answers = observable.map<string, string | null>(undefined, {deep: false});
	private readonly failedAt = new Map<string, number>();
	private readonly inFlight = new Set<string>();
	private readonly deps: ImportedConversationsDeps;

	constructor(deps?: Partial<ImportedConversationsDeps>) {
		this.deps = {
			fetchChannelId: deps?.fetchChannelId ?? fetchChannelIdOverHttp,
			now: deps?.now ?? Date.now,
			viewerId: deps?.viewerId ?? (() => Authentication.currentUserId ?? null),
		};
		makeObservable<this, 'settle'>(this, {settle: action});
	}

	private key(userId: string): string {
		return `${this.deps.viewerId() ?? ''}:${userId}`;
	}

	/** The DM's id once known, else null; null while signed out. */
	channelId(userId: string): string | null {
		if (!this.deps.viewerId()) return null;
		return this.answers.get(this.key(userId)) ?? null;
	}

	/** Asks unless signed out, the answer is known, a request is in flight, or one failed less than a minute ago. */
	ensure(userId: string): void {
		if (!this.deps.viewerId()) return;
		const key = this.key(userId);
		if (this.answers.has(key) || this.inFlight.has(key)) return;
		const failedAt = this.failedAt.get(key);
		if (failedAt !== undefined && this.deps.now() < failedAt + IMPORTED_CONVERSATION_FAILURE_COOLDOWN_MS) return;
		this.inFlight.add(key);
		this.deps
			.fetchChannelId(userId)
			.then(
				(channelId) => this.settle(key, channelId),
				(err) => {
					logger.warn(`Failed to ask for the imported conversation with user ${userId}`, err);
					this.failedAt.set(key, this.deps.now());
				},
			)
			.finally(() => this.inFlight.delete(key));
	}

	private settle(key: string, channelId: string | null): void {
		this.failedAt.delete(key);
		this.answers.set(key, channelId);
	}
}

export const ImportedConversations = new ImportedConversationsStore();

/** Your imported conversation with this user when they are a placeholder and it exists; use in observers. */
export function useImportedConversation(user: {id: string; flags: number} | null | undefined): string | null {
	// None where the instance has DMs off, and nothing asked (Gemini Carbon's review).
	const placeholderId = user && isImportedPlaceholder(user) && !RuntimeConfig.directMessagesDisabled ? user.id : null;
	const viewerId = Authentication.currentUserId;
	useEffect(() => {
		if (placeholderId && viewerId) ImportedConversations.ensure(placeholderId);
	}, [placeholderId, viewerId]);
	return placeholderId ? ImportedConversations.channelId(placeholderId) : null;
}
