// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: stands in for the push service in the fork's gateway contract specs (tyne-chat/tyne#905). The
// gateway sends each push job as a NATS request on `push.job.*` and expects `{"ok":true}`; this answers
// every job that way and keeps it, so a spec can check what a push would have said. It speaks NATS's text
// protocol over `node:net`, so the suite needs no NATS package. The E2E stack publishes NATS on
// 127.0.0.1:9122 (docker-compose.e2e.yml).

import net from 'node:net';

export interface PushJob {
	readonly subject: string;
	readonly body: any;
}

export class PushSink {
	readonly jobs: Array<PushJob> = [];
	private buffer = Buffer.alloc(0);
	private waiters: Array<{matches: (job: PushJob) => boolean; resolve: (job: PushJob) => void}> = [];

	private constructor(private readonly socket: net.Socket) {}

	static async start(
		subjects: Array<string> = ['push.job.message'],
		address = process.env.E2E_NATS_ADDRESS ?? '127.0.0.1:9122',
	): Promise<PushSink> {
		const [host, port] = address.split(':');
		const socket = net.connect({host, port: Number(port)});
		const sink = new PushSink(socket);
		socket.on('data', (chunk) => sink.receive(chunk));
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', () => resolve());
			socket.once('error', reject);
		});
		socket.write(`CONNECT ${JSON.stringify({verbose: false, pedantic: false, headers: true, protocol: 1})}\r\n`);
		subjects.forEach((subject, index) => socket.write(`SUB ${subject} ${index + 1}\r\n`));
		await sink.ping();
		return sink;
	}

	/** The first job (already received or still to come) that `matches`. */
	waitFor(matches: (job: PushJob) => boolean, timeoutMs = 10_000): Promise<PushJob> {
		const found = this.jobs.find(matches);
		if (found) return Promise.resolve(found);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiters = this.waiters.filter((w) => w.resolve !== done);
				reject(new Error(`No matching push job within ${timeoutMs} ms (${this.jobs.length} received)`));
			}, timeoutMs);
			const done = (job: PushJob) => {
				clearTimeout(timer);
				resolve(job);
			};
			this.waiters.push({matches, resolve: done});
		});
	}

	stop(): void {
		this.socket.end();
		this.socket.destroy();
	}

	/** Resolves once the server has answered a PING, so the subscriptions are in place. */
	private ping(): Promise<void> {
		return new Promise((resolve) => {
			this.pongs.push(resolve);
			this.socket.write('PING\r\n');
		});
	}

	private pongs: Array<() => void> = [];

	private receive(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const end = this.buffer.indexOf('\r\n');
			if (end === -1) return;
			const line = this.buffer.subarray(0, end).toString();
			const parts = line.split(' ');
			const verb = parts[0];
			if (verb === 'MSG' || verb === 'HMSG') {
				// MSG <subject> <sid> [reply-to] <#bytes>; HMSG <subject> <sid> [reply-to] <#header bytes> <#total bytes>
				const total = Number(parts[parts.length - 1]);
				const headerBytes = verb === 'HMSG' ? Number(parts[parts.length - 2]) : 0;
				const fixed = verb === 'HMSG' ? 5 : 4;
				const replyTo = parts.length > fixed ? parts[3] : null;
				const start = end + 2;
				if (this.buffer.length < start + total + 2) return;
				const payload = this.buffer.subarray(start + headerBytes, start + total).toString();
				this.buffer = this.buffer.subarray(start + total + 2);
				this.deliver(parts[1], payload, replyTo);
				continue;
			}
			this.buffer = this.buffer.subarray(end + 2);
			if (verb === 'PING') this.socket.write('PONG\r\n');
			else if (verb === 'PONG') this.pongs.shift()?.();
			else if (verb === '-ERR') throw new Error(`NATS error: ${line}`);
		}
	}

	private deliver(subject: string, payload: string, replyTo: string | null): void {
		if (replyTo) {
			const ok = '{"ok":true}';
			this.socket.write(`PUB ${replyTo} ${Buffer.byteLength(ok)}\r\n${ok}\r\n`);
		}
		let body: any = payload;
		try {
			body = JSON.parse(payload);
		} catch {}
		const job = {subject, body};
		this.jobs.push(job);
		const ready = this.waiters.filter((w) => w.matches(job));
		this.waiters = this.waiters.filter((w) => !ready.includes(w));
		for (const waiter of ready) waiter.resolve(job);
	}
}
