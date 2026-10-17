// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: when the global rate limit ends a user's session (upstream's
// revokeAuthenticatedSessionOnGlobalRateLimit), log what that user had been
// requesting, so a client that floods the API can be found and fixed.
// Requests are kept in memory per user for a few seconds and only for
// session-authenticated users, the only ones the revocation applies to.

import {Logger} from '@app/api/Logger';
import type {HonoEnv} from '@app/api/types/HonoEnv';
import {resolveRoutePattern} from '@fluxer/errors/src/error_handling/RoutePattern';
import type {RateLimitResult} from '@pkgs/rate_limit/src/IRateLimitService';
import type {Context} from 'hono';

/** Where the client says the request was made, e.g. the Tyne app's Dart caller. */
export const FORK_CALL_SITE_HEADER = 'x-tyne-call-site';

const HISTORY_MS = 10_000;
const MAX_ENTRIES_PER_USER = 300;
const MAX_TRACKED_USERS = 5_000;
const MAX_CALL_SITE_LENGTH = 512;
const MAX_PATH_LENGTH = 200;
const TIMELINE_ENTRIES = 120;
const TOP_ROUTES = 20;
const TOP_CALL_SITES_PER_ROUTE = 5;
const REPEAT_LOG_SUPPRESS_MS = 60_000;

interface RecordedRequest {
	at: number;
	method: string;
	route: string;
	path: string;
	session: string;
	callSite: string | null;
	userAgent: string | null;
	exemptFromGlobal: boolean;
}

interface RouteSummary {
	route: string;
	count: number;
	callSites: Record<string, number>;
}

export interface ForkGlobalRateLimitReport {
	userId: string;
	session: string;
	userAgent: string | null;
	callSite: string | null;
	route: string;
	limit: number;
	retryAfterDecimal: number | undefined;
	requestsLast1s: number;
	requestsLast5s: number;
	requestsInHistory: number;
	sessions: Record<string, {count: number; userAgent: string | null}>;
	byRoute: Array<RouteSummary>;
	timeline: Array<string>;
}

const historyByUser = new Map<string, Array<RecordedRequest>>();
const lastLoggedBySession = new Map<string, number>();

function sanitizeHeader(value: string | undefined, maxLength: number): string | null {
	if (!value) return null;
	const printable = value.replace(/[^\x20-\x7e]/g, '?').trim();
	if (!printable) return null;
	return printable.length > maxLength ? `${printable.slice(0, maxLength)}…` : printable;
}

function describeSession(ctx: Context<HonoEnv>): string {
	const authSession = ctx.get('authSession');
	if (!authSession) return 'unknown';
	// The first characters of the hash stored in auth_sessions and
	// auth_session_tombstones, enough to match a log line to a row.
	return Buffer.from(authSession.sessionIdHash).toString('base64').slice(0, 12);
}

function describePath(ctx: Context<HonoEnv>): string {
	const url = new URL(ctx.req.url);
	const path = `${url.pathname}${url.search}`;
	return path.length > MAX_PATH_LENGTH ? `${path.slice(0, MAX_PATH_LENGTH)}…` : path;
}

function trackedUserId(ctx: Context<HonoEnv>): string | null {
	if (ctx.get('authTokenType') !== 'session') return null;
	const user = ctx.get('user');
	if (!user || user.isBot) return null;
	return user.id.toString();
}

function prune(entries: Array<RecordedRequest>, now: number): void {
	let drop = 0;
	while (drop < entries.length && now - entries[drop].at > HISTORY_MS) drop++;
	if (entries.length - drop > MAX_ENTRIES_PER_USER) drop = entries.length - MAX_ENTRIES_PER_USER;
	if (drop > 0) entries.splice(0, drop);
}

/** Notes a request that went through the rate limit middleware. */
export function forkRecordRateLimitedRequest(
	ctx: Context<HonoEnv>,
	options: {exemptFromGlobal: boolean; now?: number},
): void {
	const userId = trackedUserId(ctx);
	if (!userId) return;
	const now = options.now ?? Date.now();
	let entries = historyByUser.get(userId);
	if (entries) {
		// Move the user to the end of the map, so the oldest idle users are evicted first.
		historyByUser.delete(userId);
	} else {
		entries = [];
		if (historyByUser.size >= MAX_TRACKED_USERS) {
			const oldest = historyByUser.keys().next().value;
			if (oldest !== undefined) historyByUser.delete(oldest);
		}
	}
	historyByUser.set(userId, entries);
	entries.push({
		at: now,
		method: ctx.req.method,
		route: resolveRoutePattern(ctx),
		path: describePath(ctx),
		session: describeSession(ctx),
		callSite: sanitizeHeader(ctx.req.header(FORK_CALL_SITE_HEADER), MAX_CALL_SITE_LENGTH),
		userAgent: sanitizeHeader(ctx.req.header('user-agent'), 200),
		exemptFromGlobal: options.exemptFromGlobal,
	});
	prune(entries, now);
}

function summarizeRoutes(entries: ReadonlyArray<RecordedRequest>): Array<RouteSummary> {
	const byRoute = new Map<string, RouteSummary>();
	for (const entry of entries) {
		const key = `${entry.method} ${entry.route}`;
		let summary = byRoute.get(key);
		if (!summary) {
			summary = {route: key, count: 0, callSites: {}};
			byRoute.set(key, summary);
		}
		summary.count++;
		const site = entry.callSite ?? '(not sent)';
		summary.callSites[site] = (summary.callSites[site] ?? 0) + 1;
	}
	return [...byRoute.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, TOP_ROUTES)
		.map((summary) => ({
			...summary,
			callSites: Object.fromEntries(
				Object.entries(summary.callSites)
					.sort((a, b) => b[1] - a[1])
					.slice(0, TOP_CALL_SITES_PER_ROUTE),
			),
		}));
}

function describeTimeline(entries: ReadonlyArray<RecordedRequest>, now: number): Array<string> {
	return entries.slice(-TIMELINE_ENTRIES).map((entry) => {
		const parts = [`-${now - entry.at}ms`, entry.session, entry.method, entry.path];
		if (entry.exemptFromGlobal) parts.push('(exempt from global)');
		if (entry.callSite) parts.push(`<- ${entry.callSite}`);
		return parts.join(' ');
	});
}

/**
 * Builds the report for a request the global limit refused, or null when this
 * session was already reported within the last minute (every request in a
 * flood is refused, and one report per session is enough).
 */
export function forkBuildGlobalRateLimitReport(
	ctx: Context<HonoEnv>,
	result: RateLimitResult,
	now: number = Date.now(),
): ForkGlobalRateLimitReport | null {
	const userId = trackedUserId(ctx);
	if (!userId) return null;
	const session = describeSession(ctx);
	const sessionKey = `${userId}:${session}`;
	const lastLogged = lastLoggedBySession.get(sessionKey);
	if (lastLogged !== undefined && now - lastLogged < REPEAT_LOG_SUPPRESS_MS) return null;
	lastLoggedBySession.set(sessionKey, now);
	for (const [key, at] of lastLoggedBySession) {
		if (now - at >= REPEAT_LOG_SUPPRESS_MS) lastLoggedBySession.delete(key);
	}

	const entries = historyByUser.get(userId) ?? [];
	const sessions: Record<string, {count: number; userAgent: string | null}> = {};
	for (const entry of entries) {
		const known = sessions[entry.session];
		if (known) known.count++;
		else sessions[entry.session] = {count: 1, userAgent: entry.userAgent};
	}
	return {
		userId,
		session,
		userAgent: sanitizeHeader(ctx.req.header('user-agent'), 200),
		callSite: sanitizeHeader(ctx.req.header(FORK_CALL_SITE_HEADER), MAX_CALL_SITE_LENGTH),
		route: `${ctx.req.method} ${resolveRoutePattern(ctx)}`,
		limit: result.limit,
		retryAfterDecimal: result.retryAfterDecimal,
		requestsLast1s: entries.filter((entry) => now - entry.at <= 1_000).length,
		requestsLast5s: entries.filter((entry) => now - entry.at <= 5_000).length,
		requestsInHistory: entries.length,
		sessions,
		byRoute: summarizeRoutes(entries),
		timeline: describeTimeline(entries, now),
	};
}

/** Logs what the user had been requesting when the global limit ends their session. */
export function forkLogGlobalRateLimitRevocation(ctx: Context<HonoEnv>, result: RateLimitResult): void {
	try {
		const report = forkBuildGlobalRateLimitReport(ctx, result);
		if (!report) return;
		Logger.warn(report, 'Fork: global rate limit exceeded; revoking the session that sent the request');
	} catch (error) {
		Logger.warn({error}, 'Fork: failed to describe a global rate limit revocation');
	}
}

/** Test hook: forgets every recorded request and report. */
export function forkResetRateLimitDiagnostics(): void {
	historyByUser.clear();
	lastLoggedBySession.clear();
}
