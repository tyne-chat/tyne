// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a raw gateway client for the fork's gateway contract specs (tyne-chat/tyne#905). It speaks the
// protocol a client speaks (IDENTIFY, heartbeats, Lazy Request, RESUME) and records every dispatch, so a
// spec can say which events a session got without depending on the gateway's code or language.
//
// Waits are on events, never on time: to show that an event did NOT arrive, wait for a later event the
// same stream always carries (a sentinel) and check what came before it (`absentBefore`).

export interface GatewayEvent {
	readonly t: string;
	readonly s: number | null;
	readonly d: any;
}

export interface IdentifyOptions {
	/** Session flags, e.g. 2 for DEBOUNCE_MESSAGE_REACTIONS. */
	readonly flags?: number;
	/** The guild the session starts active in. Without it, the session is passive in large guilds. */
	readonly initialGuildId?: string;
	readonly status?: 'online' | 'idle' | 'dnd' | 'invisible';
	readonly afk?: boolean;
	readonly timeoutMs?: number;
}

export function gatewayUrl(baseUrl: string): string {
	return `${baseUrl.replace(/^http/, 'ws')}/gateway?v=1&encoding=json&compress=none`;
}

type Waiter = {
	readonly from: number;
	readonly matches: (event: GatewayEvent) => boolean;
	readonly resolve: (event: GatewayEvent) => void;
};

export class GatewayRecorder {
	/** Every dispatch, in order, plus `INVALID_SESSION` and `RECONNECT` as pseudo-events. */
	readonly events: Array<GatewayEvent> = [];
	sessionId: string | null = null;
	seq: number | null = null;
	lastClose: {code: number; reason: string} | null = null;

	private socket: WebSocket | null = null;
	private heartbeat: ReturnType<typeof setInterval> | null = null;
	private waiters: Array<Waiter> = [];

	private constructor(
		private readonly url: string,
		private readonly token: string,
	) {}

	/** Opens a session and resolves once READY has arrived. */
	static async connect(baseUrl: string, token: string, options: IdentifyOptions = {}): Promise<GatewayRecorder> {
		const recorder = new GatewayRecorder(gatewayUrl(baseUrl), token);
		const d: Record<string, unknown> = {
			token,
			properties: {os: 'linux', browser: 'TyneGatewayContract', device: 'TyneGatewayContract'},
			presence: {status: options.status ?? 'online', afk: options.afk ?? false, since: 0, activities: []},
		};
		if (options.flags !== undefined) d.flags = options.flags;
		if (options.initialGuildId !== undefined) d.initial_guild_id = options.initialGuildId;
		await recorder.open({op: 2, d}, (event) => event.t === 'READY', options.timeoutMs ?? 15_000);
		return recorder;
	}

	/** The index the next event will get; pass it to `waitFor` to look only at later events. */
	mark(): number {
		return this.events.length;
	}

	/** The first event named `t` (from `from` on) that `matches`, waiting up to `timeoutMs`. */
	waitFor(
		t: string,
		matches: (d: any) => boolean = () => true,
		options: {from?: number; timeoutMs?: number} = {},
	): Promise<GatewayEvent> {
		const from = options.from ?? 0;
		const test = (event: GatewayEvent) => event.t === t && matches(event.d);
		const found = this.events.slice(from).find(test);
		if (found) return Promise.resolve(found);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiters = this.waiters.filter((w) => w.resolve !== done);
				reject(new Error(`No ${t} within ${options.timeoutMs ?? 10_000} ms (got: ${this.summary(from)})`));
			}, options.timeoutMs ?? 10_000);
			const done = (event: GatewayEvent) => {
				clearTimeout(timer);
				resolve(event);
			};
			this.waiters.push({from, matches: test, resolve: done});
		});
	}

	/** Every recorded event named `t` that `matches`. */
	all(t: string, matches: (d: any) => boolean = () => true, from = 0): Array<GatewayEvent> {
		return this.events.slice(from).filter((event) => event.t === t && matches(event.d));
	}

	/**
	 * Waits for the sentinel, then returns the events named `t` that `matches` and arrived between `from`
	 * and the sentinel. A spec expects this to be empty to show an event was not delivered.
	 */
	async absentBefore(
		t: string,
		matches: (d: any) => boolean,
		sentinel: {t: string; matches?: (d: any) => boolean},
		options: {from?: number; timeoutMs?: number} = {},
	): Promise<Array<GatewayEvent>> {
		const from = options.from ?? 0;
		const marker = await this.waitFor(sentinel.t, sentinel.matches, {from, timeoutMs: options.timeoutMs});
		const end = this.events.indexOf(marker);
		return this.events.slice(from, end).filter((event) => event.t === t && matches(event.d));
	}

	/** Lazy Request (op 14): makes the session active (or passive) in a guild. */
	setActive(guildId: string, active: boolean): void {
		this.send(14, {subscriptions: {[guildId]: {active}}});
	}

	send(op: number, d: unknown): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			throw new Error(`Gateway socket is not open (op ${op})`);
		}
		this.socket.send(JSON.stringify({op, d}));
	}

	/**
	 * Drops the connection the way a network failure does: a close code other than 1000/1001, which keep
	 * the session for RESUME. 1000 and 1001 end the session at once.
	 */
	async drop(code = 4000): Promise<void> {
		await this.closeSocket(code);
	}

	/** Ends the session for good (close 1000). */
	async end(): Promise<void> {
		await this.closeSocket(1000);
	}

	/** RESUMEs the session on a new socket: 'RESUMED', or 'INVALID_SESSION' when the session is gone. */
	async resume(timeoutMs = 15_000): Promise<'RESUMED' | 'INVALID_SESSION'> {
		if (!this.sessionId || this.seq === null) {
			throw new Error('Nothing to resume: no session id or sequence yet');
		}
		const event = await this.open(
			{op: 6, d: {token: this.token, session_id: this.sessionId, seq: this.seq}},
			(e) => e.t === 'RESUMED' || e.t === 'INVALID_SESSION',
			timeoutMs,
		);
		return event.t === 'RESUMED' ? 'RESUMED' : 'INVALID_SESSION';
	}

	private summary(from: number): string {
		const names = this.events.slice(from).map((event) => event.t);
		return names.length === 0 ? 'nothing' : names.slice(-15).join(', ');
	}

	private record(event: GatewayEvent): void {
		this.events.push(event);
		const index = this.events.length - 1;
		const ready = this.waiters.filter((w) => index >= w.from && w.matches(event));
		this.waiters = this.waiters.filter((w) => !ready.includes(w));
		for (const waiter of ready) waiter.resolve(event);
	}

	private open(first: {op: number; d: unknown}, until: (event: GatewayEvent) => boolean, timeoutMs: number) {
		const from = this.mark();
		return new Promise<GatewayEvent>((resolve, reject) => {
			const socket = new WebSocket(this.url);
			this.socket = socket;
			const timer = setTimeout(() => {
				reject(new Error(`Gateway did not answer op ${first.op} within ${timeoutMs} ms (got: ${this.summary(from)})`));
			}, timeoutMs);
			const finish = (event: GatewayEvent) => {
				clearTimeout(timer);
				resolve(event);
			};
			this.waiters.push({from, matches: until, resolve: finish});
			socket.onmessage = (message: MessageEvent) => {
				const frame = JSON.parse(String(message.data)) as {op: number; t?: string; s?: number | null; d?: any};
				switch (frame.op) {
					case 10: {
						this.startHeartbeat(socket, frame.d.heartbeat_interval);
						socket.send(JSON.stringify(first));
						break;
					}
					case 0: {
						if (typeof frame.s === 'number') this.seq = frame.s;
						if (frame.t === 'READY') this.sessionId = frame.d?.session_id ?? null;
						this.record({t: frame.t ?? '', s: frame.s ?? null, d: frame.d});
						break;
					}
					case 1: {
						socket.send(JSON.stringify({op: 1, d: this.seq}));
						break;
					}
					case 7: {
						this.record({t: 'RECONNECT', s: null, d: null});
						break;
					}
					case 9: {
						this.record({t: 'INVALID_SESSION', s: null, d: frame.d ?? null});
						break;
					}
					default:
						break;
				}
			};
			socket.onclose = (event: CloseEvent) => {
				this.lastClose = {code: event.code, reason: event.reason};
				this.stopHeartbeat();
			};
			socket.onerror = () => {
				clearTimeout(timer);
				reject(new Error('Gateway WebSocket error'));
			};
		});
	}

	private startHeartbeat(socket: WebSocket, intervalMs: number): void {
		this.stopHeartbeat();
		this.heartbeat = setInterval(() => {
			if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({op: 1, d: this.seq}));
		}, intervalMs);
	}

	private stopHeartbeat(): void {
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = null;
	}

	private closeSocket(code: number): Promise<void> {
		const socket = this.socket;
		this.stopHeartbeat();
		if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();
		return new Promise((resolve) => {
			socket.addEventListener('close', () => resolve(), {once: true});
			socket.close(code);
		});
	}
}
