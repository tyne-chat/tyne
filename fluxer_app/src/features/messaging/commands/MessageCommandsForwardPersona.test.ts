// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a forward goes out through its own command, not the composer's send, so it has to work out
// its persona itself (tyne-chat/tyne#209). Each send is one request; the persona adds none.

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

interface SentPayload {
	channelId: string;
	content?: string;
	messageReference?: {message_id: string};
	subprofile?: {id: string} | null;
}

const sent = vi.hoisted(() => [] as Array<SentPayload>);
const failNext = vi.hoisted(() => ({value: false}));

vi.mock('@app/app/I18n', () => ({default: {_: (descriptor: {message?: string}) => descriptor.message ?? ''}}));
vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {
		getSanitizeUrls: () => false,
		getSubPreference: () => undefined,
		setSubPreference: () => Promise.resolve(),
	},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {
		get: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		post: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		patch: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		delete: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		configure: vi.fn(),
	},
}));
vi.mock('@app/features/messaging/state/MessageQueue', () => ({
	default: {
		consumeLocalSendReservation: () => true,
		enqueue: (payload: SentPayload, done: (result: {body: unknown} | null) => void) => {
			sent.push(payload);
			if (failNext.value) {
				done(null);
				return;
			}
			done({body: {id: String(sent.length), timestamp: '2026-10-31T00:00:00.000Z'}});
		},
	},
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({default: {handleIncomingMessage: vi.fn()}}));

installVoiceMenuTestBootstrap();

const {PersonaStore} = await import('@app/features/persona/state/PersonaStore');
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
const {forward} = await import('@app/features/messaging/commands/MessageCommands');

const ROOM = '1500000000000000001';
const OTHER_ROOM = '1500000000000000002';
const SOURCE = {message_id: '1500000000000000010', channel_id: '1500000000000000011', guild_id: null};

describe('forwarding as a persona', () => {
	let foxId: string;
	let baoId: string;

	beforeEach(() => {
		sent.length = 0;
		failNext.value = false;
		PersonaStore.reset();
		foxId = addTestPersona(PersonaStore, {name: 'Fox'}).id;
		baoId = addTestPersona(PersonaStore, {name: 'Bao', persona_tags: [{prefix: 'B:', suffix: ''}]}).id;
	});

	afterEach(() => {
		PersonaStore.reset();
	});

	it('sends the forward as the selected persona', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		await expect(forward([ROOM], SOURCE)).resolves.toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({channelId: ROOM, content: ''});
		expect(sent[0].subprofile?.id).toBe(foxId);
	});

	it('sends as the account with nothing selected', async () => {
		await expect(forward([ROOM], SOURCE)).resolves.toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0].subprofile).toBeUndefined();
	});

	it("sends every destination as the source channel's selection, one request each", async () => {
		await PersonaStore.setActivePersonaScope('channel');
		PersonaStore.handleChannelStateUpdate({channel_id: SOURCE.channel_id, persona_id: foxId});
		PersonaStore.handleChannelStateUpdate({channel_id: OTHER_ROOM, persona_id: baoId});
		await expect(forward([ROOM, OTHER_ROOM], SOURCE)).resolves.toBe(true);
		expect(sent.map((payload) => [payload.channelId, payload.subprofile?.id])).toEqual([
			[ROOM, foxId],
			[OTHER_ROOM, foxId],
		]);
	});

	it("falls back to each destination's selection when the source has none", async () => {
		await PersonaStore.setActivePersonaScope('channel');
		PersonaStore.handleChannelStateUpdate({channel_id: OTHER_ROOM, persona_id: baoId});
		await expect(forward([ROOM, OTHER_ROOM], SOURCE)).resolves.toBe(true);
		expect(sent.map((payload) => [payload.channelId, payload.subprofile?.id])).toEqual([
			[ROOM, undefined],
			[OTHER_ROOM, baoId],
		]);
	});

	it('sends the forward and its comment as the persona the comment names, without the tag', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		await expect(forward([ROOM], SOURCE, 'B: look at this')).resolves.toBe(true);
		expect(sent).toHaveLength(2);
		expect(sent[0].subprofile?.id).toBe(baoId);
		expect(sent[1]).toMatchObject({content: 'look at this'});
		expect(sent[1].subprofile?.id).toBe(baoId);
	});

	it('sends no comment when the comment was only a tag', async () => {
		await expect(forward([ROOM], SOURCE, 'B:')).resolves.toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0].subprofile?.id).toBe(baoId);
	});

	it('stops at a failed send, as before', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		failNext.value = true;
		await expect(forward([ROOM, OTHER_ROOM], SOURCE, 'look')).resolves.toBe(false);
		expect(sent).toHaveLength(1);
	});
});
