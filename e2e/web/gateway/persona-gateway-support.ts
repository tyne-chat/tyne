// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: shared set-up for the persona gateway contract specs (tyne-chat/tyne#905, T1 to T3): accounts,
// a community they share (so DMs between them are allowed), personas and a few REST calls. Built on the
// same calls as gateway-contract-helpers.spec.ts. Not a spec itself: Playwright only runs `*.spec.ts`.

import {FluxerApiClient} from '../../api-helpers/client.js';

export const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

/** Two different 2x2 PNGs (red and blue), so a persona's picture and its account's get different hashes. */
export const PERSONA_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mM4IScHRAwQCgAfJgQRSo6NIAAAAABJRU5ErkJggg==';
export const ACCOUNT_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mOQkzsBRAwQCgAZ1gQRohH9kwAAAABJRU5ErkJggg==';

export interface Account {
	readonly client: FluxerApiClient;
	readonly id: string;
	readonly token: string;
	readonly name: string;
}

let counter = 0;

/** A short stamp unique to this run, for names that must not collide with earlier runs. */
export function stamp(): string {
	counter += 1;
	return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}${counter}`;
}

/**
 * A new account. `global_name` is unique, so a push title or a preview that names the account can be
 * told apart from one that names anyone else.
 */
export async function account(label: string): Promise<Account> {
	const id = stamp();
	const client = new FluxerApiClient(baseURL);
	const name = `GW ${label} ${id}`.slice(0, 32);
	const auth = await client.register({
		username: `gwp_${label}_${id}`.slice(0, 32),
		email: `gwp_${label}_${id}@test.local`,
		password: 'TestPassword123!',
		global_name: name,
	});
	client.setToken(auth.token);
	const me = await client.getMe();
	return {client, id: me.id, token: auth.token, name};
}

export async function api(token: string, method: string, path: string, body?: unknown): Promise<any> {
	const response = await fetch(`${baseURL}/api/v1${path}`, {
		method,
		headers: {Authorization: token, 'Content-Type': 'application/json'},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
	return text ? JSON.parse(text) : null;
}

export interface Community {
	readonly guildId: string;
	readonly guildName: string;
	readonly channelId: string;
	readonly channelName: string;
}

/** A community owned by `owner`, joined by every member, with its first text channel. */
export async function community(owner: Account, members: ReadonlyArray<Account>): Promise<Community> {
	const guildName = `GW personas ${stamp()}`.slice(0, 40);
	const guild = await owner.client.createGuild(guildName);
	const channels = await owner.client.getGuildChannels(guild.id);
	const channel = channels.find((c) => c.type === 0) ?? channels[0];
	const invite = await owner.client.createInvite(channel.id);
	for (const member of members) await member.client.acceptInvite(invite.code);
	return {guildId: guild.id, guildName, channelId: channel.id, channelName: channel.name};
}

/** The DM between `from` and `to`, opened by `from` (they must share a community). */
export async function openDm(from: Account, to: Account): Promise<string> {
	const dm = await api(from.token, 'POST', '/users/@me/channels', {recipient_id: to.id});
	return dm.id;
}

export interface Persona {
	readonly id: string;
	readonly name: string;
	readonly avatar_hash?: string | null;
}

export async function createPersona(owner: Account, body: Record<string, unknown>): Promise<Persona> {
	return api(owner.token, 'POST', '/users/@me/personas', body);
}

/** Uploads a picture for a persona and returns its hash (stored under the owner's account). */
export async function uploadPersonaAvatar(owner: Account, image = PERSONA_PNG): Promise<string> {
	const uploaded = await api(owner.token, 'POST', '/users/@me/personas/avatar', {avatar: image});
	return uploaded.avatar_hash;
}

/**
 * Sends a message through REST. The API refuses messages and reactions from an account that never
 * opened a gateway session, so the sender must have connected once before (any recorder counts).
 */
export async function send(sender: Account, channelId: string, body: Record<string, unknown>): Promise<any> {
	return api(sender.token, 'POST', `/channels/${channelId}/messages`, body);
}

export async function react(
	reactor: Account,
	channelId: string,
	messageId: string,
	emoji: string,
	personaId?: string,
): Promise<void> {
	await api(
		reactor.token,
		'PUT',
		`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
		personaId ? {persona_id: personaId} : {},
	);
}

export async function unreact(
	reactor: Account,
	channelId: string,
	messageId: string,
	emoji: string,
	personaId?: string,
): Promise<void> {
	const query = personaId ? `?persona_id=${personaId}` : '';
	await api(
		reactor.token,
		'DELETE',
		`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me${query}`,
	);
}

/** Who reacted with `emoji`, as the API lists it: one entry per account or persona. */
export async function reactionsOf(
	viewer: Account,
	channelId: string,
	messageId: string,
	emoji: string,
): Promise<Array<{id: string; persona_id: string | null}>> {
	return api(
		viewer.token,
		'GET',
		`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}?limit=100`,
	);
}
