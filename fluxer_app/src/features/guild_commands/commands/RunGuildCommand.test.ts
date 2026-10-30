// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	post: vi.fn(),
	resolve: vi.fn(),
	ensureLoaded: vi.fn(async () => {}),
	markStale: vi.fn(),
	createOptimistic: vi.fn(),
	deleteDraft: vi.fn(),
	handleIncomingMessage: vi.fn(),
}));

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({http: {post: mocks.post}}));
vi.mock('@app/features/guild_commands/state/GuildCommandsStore', () => ({
	default: {resolve: mocks.resolve, ensureLoaded: mocks.ensureLoaded, markStale: mocks.markStale},
}));
vi.mock('@app/features/channel/state/Channels', () => ({default: {getChannel: () => ({id: 'c', guildId: 'g'})}}));
vi.mock('@app/features/persona/state/PersonaStore', () => ({
	PersonaStore: {latchedPersonaFor: () => ({id: 'p1'})},
}));
vi.mock('@app/features/messaging/commands/MessageCommands', () => ({createOptimistic: mocks.createOptimistic}));
vi.mock('@app/features/messaging/commands/DraftCommands', () => ({deleteDraft: mocks.deleteDraft}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {handleIncomingMessage: mocks.handleIncomingMessage},
}));
vi.mock('@app/features/typing/rolling/RollingTypingSender', () => ({default: {stopTyping: () => {}}}));
vi.mock('@app/features/devtools/utils/CommandUtils', () => ({
	createSystemMessage: (_channelId: string, text: string) => ({toJSON: () => ({content: text})}),
}));
vi.mock('@app/lib/forms', () => ({extractErrorMessage: () => 'slowmode'}));

import {resetForkGuildCommandRuns, runForkGuildCommand} from '@app/features/guild_commands/commands/RunGuildCommand';
import type {I18n} from '@lingui/core';

const i18n = {
	_: (descriptor: {message?: string}, values?: Record<string, string>) =>
		(descriptor.message ?? '').replace(/\{(\w+)\}/g, (_match, key: string) => values?.[key] ?? ''),
} as unknown as I18n;
const TUCK = {id: '77', guild_id: 'g', name: 'tuck'};

function run(content: string, overrides: Partial<Parameters<typeof runForkGuildCommand>[0]> = {}) {
	return runForkGuildCommand({
		channelId: 'c',
		content,
		isSlowmodeActive: false,
		i18n,
		setValue: () => {},
		clearSegments: () => {},
		draftOwner: 'owner' as never,
		...overrides,
	});
}

describe('runForkGuildCommand', () => {
	beforeEach(() => {
		resetForkGuildCommandRuns();
		mocks.resolve.mockImplementation((_channel: unknown, name: string) => (name === 'tuck' ? TUCK : null));
		mocks.post.mockResolvedValue({ok: true, body: {id: 'm1'}});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('leaves ordinary text, built-ins and unknown commands to the normal send, without requests', async () => {
		expect(await run('hello there')).toBe(false);
		expect(await run('/shrug')).toBe(false);
		expect(await run('/nosuch hi')).toBe(false);
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it('runs a command with its input and persona, then clears the composer', async () => {
		const setValue = vi.fn();
		expect(await run('/tuck <@2:3> please', {setValue})).toBe(true);
		expect(mocks.post).toHaveBeenCalledTimes(1);
		expect(mocks.post.mock.calls[0]![0]).toBe('/channels/c/commands/77');
		expect(mocks.post.mock.calls[0]![1].body).toMatchObject({input: '<@2:3> please', persona_id: 'p1'});
		expect(setValue).toHaveBeenCalledWith('');
		expect(mocks.deleteDraft).toHaveBeenCalled();
	});

	it('sends once when Enter is pressed twice while the first run is out', async () => {
		let finish: (value: unknown) => void = () => {};
		mocks.post.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		const first = run('/tuck x');
		const second = await run('/tuck x');
		expect(second).toBe(true);
		finish({ok: true, body: {id: 'm1'}});
		await first;
		expect(mocks.post).toHaveBeenCalledTimes(1);
	});

	it('reuses the nonce when the same text is tried again after a failure', async () => {
		mocks.post.mockResolvedValueOnce({ok: false, body: null});
		await run('/tuck x');
		await run('/tuck x');
		expect(mocks.post).toHaveBeenCalledTimes(2);
		expect(mocks.post.mock.calls[1]![1].body.nonce).toBe(mocks.post.mock.calls[0]![1].body.nonce);
		expect(mocks.createOptimistic).toHaveBeenCalledTimes(1);
	});

	it('marks the community stale when the command is gone, and only then', async () => {
		mocks.post.mockResolvedValueOnce({ok: false, status: 429, body: null});
		await run('/tuck x');
		expect(mocks.markStale).not.toHaveBeenCalled();
		mocks.post.mockResolvedValueOnce({ok: false, status: 404, body: null});
		await run('/tuck x');
		expect(mocks.markStale).toHaveBeenCalledWith('g');
	});

	it("says a broken script is broken, in the app's words", async () => {
		mocks.post.mockRejectedValueOnce({status: 400, body: {code: 'GUILD_COMMAND_TEMPLATE_INVALID'}});
		await run('/tuck x');
		expect(JSON.stringify(mocks.createOptimistic.mock.calls[0])).toContain('Its script has a problem.');
	});

	it('leaves slowmode to the normal send path, and refuses input on two lines', async () => {
		expect(await run('/tuck x', {isSlowmodeActive: true})).toBe(false);
		expect(await run('/tuck one\ntwo')).toBe(true);
		expect(mocks.post).not.toHaveBeenCalled();
		expect(mocks.createOptimistic).toHaveBeenCalledTimes(1);
	});
});
