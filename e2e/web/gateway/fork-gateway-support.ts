// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: shared set-up for the gateway contract specs on signals, passive sessions, resume and DM threads
// (tyne-chat/tyne#905, T4 to T7): accounts, communities, the instance's signal bar and a few REST calls. Built on
// the same calls as gateway-contract-helpers.spec.ts. Not a spec itself: Playwright only runs `*.spec.ts`.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';

export const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

/** Permission bits used here (packages/constants/src/ChannelConstants.ts). */
export const VIEW_CHANNEL = 1n << 10n;
export const SEND_MESSAGES = 1n << 11n;

/** Thread routes answer only apps that announce threads; DM-thread chips need the fork's feature too. */
export const THREAD_FEATURES = {'X-Fluxer-Features': 'channel_threads,fork_dm_threads'};

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

/** A new account with a unique `global_name`, so a push title that names it is told apart from any other. */
export async function account(label: string): Promise<Account> {
	const id = stamp();
	const client = new FluxerApiClient(baseURL);
	const name = `GW ${label} ${id}`.slice(0, 32);
	const auth = await client.register({
		username: `gwf_${label}_${id}`.slice(0, 32),
		email: `gwf_${label}_${id}@test.local`,
		password: 'TestPassword123!',
		global_name: name,
	});
	client.setToken(auth.token);
	const me = await client.getMe();
	return {client, id: me.id, token: auth.token, name};
}

/**
 * The API refuses messages from an account that never opened a gateway session. This opens one and ends it
 * with close 1000, which ends the session at once, so it holds back no push afterwards.
 */
export async function touchGateway(who: Account): Promise<void> {
	const session = await GatewayRecorder.connect(baseURL, who.token);
	await session.end();
}

export async function api(
	token: string,
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
): Promise<any> {
	const response = await fetch(`${baseURL}/api/v1${path}`, {
		method,
		headers: {Authorization: token, 'Content-Type': 'application/json', ...headers},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
	return text ? JSON.parse(text) : null;
}

/** Runs `task` over `items`, at most `limit` at a time. */
export async function mapLimit<T, R>(
	items: ReadonlyArray<T>,
	limit: number,
	task: (item: T, index: number) => Promise<R>,
): Promise<Array<R>> {
	const results: Array<R> = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await task(items[index], index);
		}
	};
	await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
	return results;
}

export interface Community {
	readonly guildId: string;
	readonly channelId: string;
	readonly inviteCode: string;
}

/** A community owned by `owner`, joined by every member, with its first text channel and an open invite. */
export async function community(owner: Account, members: ReadonlyArray<Account>, label: string): Promise<Community> {
	const guild = await owner.client.createGuild(`GW ${label} ${stamp()}`.slice(0, 40));
	const channels = await owner.client.getGuildChannels(guild.id);
	const channel = channels.find((c) => c.type === 0) ?? channels[0];
	const invite = await owner.client.createInvite(channel.id);
	for (const member of members) await member.client.acceptInvite(invite.code);
	return {guildId: guild.id, channelId: channel.id, inviteCode: invite.code};
}

/** Renames a community: GUILD_UPDATE reaches every session in it, passive ones too, so it serves as a sentinel. */
export async function renameCommunity(owner: Account, guildId: string, label: string): Promise<string> {
	const name = `GW ${label} ${stamp()}`.slice(0, 40);
	await api(owner.token, 'PATCH', `/guilds/${guildId}`, {name});
	return name;
}

/** Makes `a` and `b` friends, which a group DM needs. */
export async function befriend(a: Account, b: Account): Promise<void> {
	await api(a.token, 'POST', `/users/@me/relationships/${b.id}`, {});
	await api(b.token, 'PUT', `/users/@me/relationships/${a.id}`, {type: 1});
}

function readSeed(): Record<string, string> {
	const content = readFileSync(resolve(process.cwd(), '.env.test'), 'utf-8');
	const seed: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) seed[match[1]] = match[2];
	}
	return seed;
}

interface BarSignal {
	readonly id: string;
	readonly emoji_id: string | null;
	readonly emoji_name: string;
	readonly label: string | null;
	readonly everywhere: boolean;
}

export interface SignalBarHandle {
	/** A signal on the bar, which members may light where the bar is switched on. */
	readonly signalId: string;
	/** Writes the bar unchanged: its version goes up and SIGNAL_BAR_UPDATE goes to every community. */
	touch(): Promise<void>;
	/** Puts the bar and its home community back as they were. */
	restore(): Promise<void>;
}

/**
 * The signal bar is one per instance and its home community's managers edit it. The seed's Alice is the
 * instance admin (the first registration) and owns the seed community, so she makes that the home community if
 * there is none she manages, and adds a signal if the bar has none. `restore` undoes both. Every bar write sends
 * SIGNAL_BAR_UPDATE to every community on the instance.
 */
export async function ensureSignalBar(): Promise<SignalBarHandle> {
	const seed = readSeed();
	const admin = seed.E2E_ALICE_TOKEN;
	const before = await api(admin, 'GET', '/instance/signal-bar');
	const previousHome: string | null = before.guild_id ?? null;
	let homeChanged = false;
	if (!before.guild_id || !before.can_manage) {
		await api(admin, 'PATCH', '/admin/instance/config', {policy: {signal_bar_guild_id: seed.E2E_GUILD_ID}});
		homeChanged = true;
	}
	const current = await api(admin, 'GET', '/instance/signal-bar');
	const asRequest = (signals: ReadonlyArray<BarSignal>) =>
		signals.map((s) => ({
			id: s.id,
			emoji_id: s.emoji_id,
			emoji_name: s.emoji_name,
			label: s.label,
			everywhere: s.everywhere,
		}));
	const original: Array<BarSignal> = current.signals;
	let signals: Array<BarSignal> = original;
	if (signals.length === 0) {
		const written = await api(admin, 'PUT', '/instance/signal-bar', {
			signals: [{emoji_name: '📡', label: 'Gateway contract'}],
		});
		signals = written.signals;
	}
	return {
		signalId: signals[0].id,
		touch: async () => {
			await api(admin, 'PUT', '/instance/signal-bar', {signals: asRequest(signals)});
		},
		restore: async () => {
			if (signals !== original) await api(admin, 'PUT', '/instance/signal-bar', {signals: asRequest(original)});
			if (homeChanged) {
				await api(admin, 'PATCH', '/admin/instance/config', {policy: {signal_bar_guild_id: previousHome}});
			}
		},
	};
}

/** Switches the signal bar on in exactly these text channels of a community (GUILD_SIGNAL settings). */
export async function switchSignalBar(
	owner: Account,
	guildId: string,
	channelIds: ReadonlyArray<string>,
): Promise<void> {
	await api(owner.token, 'PUT', `/guilds/${guildId}/signal-bar/channels`, {
		default: false,
		categories: {},
		channels: Object.fromEntries(channelIds.map((id) => [id, true])),
	});
}

/** Lights a signal in a channel as the account (CHANNEL_SIGNAL_UPDATE). */
export async function lightSignal(who: Account, channelId: string, signalId: string): Promise<void> {
	await api(who.token, 'PUT', `/channels/${channelId}/signals/${signalId}/@me`, {});
}
