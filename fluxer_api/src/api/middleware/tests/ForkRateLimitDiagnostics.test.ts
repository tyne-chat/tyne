// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	FORK_CALL_SITE_HEADER,
	forkBuildGlobalRateLimitReport,
	forkRecordRateLimitedRequest,
	forkResetRateLimitDiagnostics,
} from '@app/api/middleware/ForkRateLimitDiagnostics';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import type {HonoEnv} from '@app/api/types/HonoEnv';
import type {
	BucketConfig,
	IRateLimitService,
	RateLimitConfig,
	RateLimitResult,
} from '@pkgs/rate_limit/src/IRateLimitService';
import {type Context, Hono} from 'hono';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock('@app/api/Logger', () => ({
	Logger: {warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn()},
}));

const USER_ID = 1557292976315564032n;
const SESSION_HASH = Buffer.from('phone-session-hash-0123456789abcdef');
const OTHER_SESSION_HASH = Buffer.from('desktop-session-hash-0123456789abc');

const REFUSED: RateLimitResult = {
	allowed: false,
	limit: 50,
	remaining: 0,
	resetTime: new Date(0),
	retryAfterDecimal: 0.02,
	resetAfterDecimal: 0.02,
};

interface Identity {
	tokenType?: 'session' | 'bearer';
	isBot?: boolean;
	sessionIdHash?: Buffer;
}

function setIdentity(ctx: Context<HonoEnv>, identity: Identity): void {
	ctx.set('user', {id: USER_ID, isBot: identity.isBot ?? false, flags: 0n} as never);
	ctx.set('authTokenType', identity.tokenType ?? 'session');
	ctx.set('authSession', {sessionIdHash: identity.sessionIdHash ?? SESSION_HASH} as never);
	ctx.set('authToken', 'token');
}

/** An app that records each request the way the middleware does, and keeps the last context. */
function buildRecordingApp(identity: Identity = {}) {
	let lastContext: Context<HonoEnv> | null = null;
	let now = 0;
	const app = new Hono<HonoEnv>({strict: true});
	app.use('*', async (ctx, next) => {
		setIdentity(ctx, identity);
		lastContext = ctx;
		await next();
	});
	const record = (ctx: Context<HonoEnv>) => {
		forkRecordRateLimitedRequest(ctx, {exemptFromGlobal: false, now});
		return ctx.text('ok');
	};
	app.get('/channels/:channel_id/messages', record);
	app.get('/users/:user_id/personas/:persona_id', record);
	return {
		async call(path: string, at: number, callSite?: string): Promise<void> {
			now = at;
			const headers: Record<string, string> = {'user-agent': 'Tyne Android/1.2.1 (canary)'};
			if (callSite) headers[FORK_CALL_SITE_HEADER] = callSite;
			await app.request(`http://localhost${path}`, {headers});
		},
		context(): Context<HonoEnv> {
			if (!lastContext) throw new Error('no request has run yet');
			return lastContext;
		},
	};
}

describe('ForkRateLimitDiagnostics', () => {
	beforeEach(() => {
		forkResetRateLimitDiagnostics();
	});

	test('reports the routes, call sites and timing of the requests before the refusal', async () => {
		const app = buildRecordingApp();
		for (let i = 0; i < 40; i++) {
			await app.call(`/users/123/personas/${i}`, 1_000 + i, 'UserMention.build < MessageItem.build');
		}
		for (let i = 0; i < 12; i++) {
			await app.call('/channels/9/messages?limit=50', 1_100 + i);
		}

		const report = forkBuildGlobalRateLimitReport(app.context(), REFUSED, 1_200);

		expect(report).not.toBeNull();
		expect(report?.userId).toBe(USER_ID.toString());
		expect(report?.session).toBe(SESSION_HASH.toString('base64').slice(0, 12));
		expect(report?.userAgent).toBe('Tyne Android/1.2.1 (canary)');
		expect(report?.route).toBe('GET /channels/:channel_id/messages');
		expect(report?.requestsLast1s).toBe(52);
		expect(report?.byRoute[0]).toEqual({
			route: 'GET /users/:user_id/personas/:persona_id',
			count: 40,
			callSites: {'UserMention.build < MessageItem.build': 40},
		});
		expect(report?.byRoute[1]).toEqual({
			route: 'GET /channels/:channel_id/messages',
			count: 12,
			callSites: {'(not sent)': 12},
		});
		expect(report?.timeline.at(-1)).toBe(`-89ms ${report?.session} GET /channels/9/messages?limit=50`);
		expect(report?.timeline[0]).toBe(
			`-200ms ${report?.session} GET /users/123/personas/0 <- UserMention.build < MessageItem.build`,
		);
	});

	test('keeps only the last ten seconds of a user', async () => {
		const app = buildRecordingApp();
		await app.call('/channels/9/messages', 0);
		await app.call('/channels/9/messages', 20_000);

		const report = forkBuildGlobalRateLimitReport(app.context(), REFUSED, 20_000);

		expect(report?.requestsInHistory).toBe(1);
	});

	test('reports a session once a minute, however many of its requests are refused', async () => {
		const app = buildRecordingApp();
		await app.call('/channels/9/messages', 0);

		expect(forkBuildGlobalRateLimitReport(app.context(), REFUSED, 0)).not.toBeNull();
		expect(forkBuildGlobalRateLimitReport(app.context(), REFUSED, 59_999)).toBeNull();
		expect(forkBuildGlobalRateLimitReport(app.context(), REFUSED, 60_000)).not.toBeNull();
	});

	test('counts the requests of every session of the user, as the global limit does', async () => {
		const desktop = buildRecordingApp({sessionIdHash: OTHER_SESSION_HASH});
		const phone = buildRecordingApp();
		await desktop.call('/channels/9/messages', 0);
		await phone.call('/channels/9/messages', 1);

		const report = forkBuildGlobalRateLimitReport(phone.context(), REFUSED, 2);

		expect(Object.values(report?.sessions ?? {}).map((s) => s.count)).toEqual([1, 1]);
	});

	test('ignores bots and OAuth tokens, whose sessions the limit does not end', async () => {
		const bot = buildRecordingApp({isBot: true});
		await bot.call('/channels/9/messages', 0);
		expect(forkBuildGlobalRateLimitReport(bot.context(), REFUSED, 0)).toBeNull();

		const bearer = buildRecordingApp({tokenType: 'bearer'});
		await bearer.call('/channels/9/messages', 0);
		expect(forkBuildGlobalRateLimitReport(bearer.context(), REFUSED, 0)).toBeNull();
	});

	test('cuts long or unprintable call sites', async () => {
		const app = buildRecordingApp();
		await app.call('/channels/9/messages', 0, `${'a'.repeat(600)}`);

		const report = forkBuildGlobalRateLimitReport(app.context(), REFUSED, 0);

		expect(report?.byRoute[0].callSites).toEqual({[`${'a'.repeat(512)}…`]: 1});
	});
});

class RefusingGlobalLimit implements IRateLimitService {
	async checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
		return {...REFUSED, allowed: true, limit: config.maxAttempts};
	}

	async peekLimit(config: RateLimitConfig): Promise<RateLimitResult> {
		return {...REFUSED, allowed: true, limit: config.maxAttempts};
	}

	async checkBucketLimit(_bucket: string, config: BucketConfig): Promise<RateLimitResult> {
		return {...REFUSED, allowed: true, limit: config.limit};
	}

	async checkGlobalLimit(): Promise<RateLimitResult> {
		return REFUSED;
	}

	async resetLimit(_identifier: string): Promise<void> {}

	async clearLimitsByIdentifierPrefix(_identifierPrefix: string): Promise<number> {
		return 0;
	}
}

describe('RateLimitMiddleware with the fork diagnostics', () => {
	beforeEach(() => {
		forkResetRateLimitDiagnostics();
	});

	afterEach(() => {
		loggerWarn.mockClear();
	});

	test('logs what the user requested when the global limit refuses a session request', async () => {
		const app = new Hono<HonoEnv>({strict: true});
		app.use('*', async (ctx, next) => {
			setIdentity(ctx, {});
			ctx.set('rateLimitService', new RefusingGlobalLimit());
			await next();
		});
		app.get(
			'/channels/:channel_id/messages',
			RateLimitMiddleware({bucket: 'channel:messages:read::channel_id', config: {limit: 100, windowMs: 1000}}),
			(ctx) => ctx.text('ok'),
		);
		const request = () =>
			app.request('http://localhost/channels/9/messages', {
				headers: {'x-fluxer-test-enable-rate-limits': 'true', [FORK_CALL_SITE_HEADER]: 'ChatViewModel.loadOlder'},
			});

		const first = await request();
		await request();

		expect(first.status).not.toBe(200);
		const reports = loggerWarn.mock.calls.filter(([, message]) =>
			String(message).startsWith('Fork: global rate limit'),
		);
		expect(reports).toHaveLength(1);
		expect(reports[0][0]).toMatchObject({
			userId: USER_ID.toString(),
			route: 'GET /channels/:channel_id/messages',
			callSite: 'ChatViewModel.loadOlder',
			requestsInHistory: 1,
		});
	});
});
