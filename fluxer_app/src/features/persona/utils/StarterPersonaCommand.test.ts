// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageStickerItem} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const consumePersonaCommand = vi.hoisted(() => vi.fn(() => true));
vi.mock('@app/features/persona/utils/OutgoingPersona', () => ({consumePersonaCommand}));

const draftAttachments = vi.hoisted(() => ({count: 0}));
vi.mock('@app/features/messaging/upload/CloudUpload', () => ({
	CloudUpload: {getTextareaAttachments: () => Array.from({length: draftAttachments.count}, () => ({}))},
}));

// Only `resolveStarterArgs` is used, which needs none of these; loading them starts the app's stores.
vi.mock('@app/features/messaging/commands/MessageCommands', () => ({}));
vi.mock('@app/features/messaging/utils/MessageSubmitUtils', () => ({}));
vi.mock('@app/features/permissions/state/Permission', () => ({default: {}}));
vi.mock('@app/features/threads/state/ThreadPanel', () => ({default: {}}));
vi.mock('@app/features/user/state/Users', () => ({default: {}}));

const {consumeStarterPersonaCommand} = await import('./StarterPersonaCommand');

const sticker = {id: 's1'} as MessageStickerItem;

// tyne-chat/tyne#628: in the thread and forum post composers, a tag with media names who sends it.
describe('consumeStarterPersonaCommand', () => {
	beforeEach(() => {
		consumePersonaCommand.mockClear();
		draftAttachments.count = 0;
	});

	const hasMediaArg = () => (consumePersonaCommand.mock.calls.at(-1) as Array<unknown> | undefined)?.[2];

	it('passes a text-only starter on as a possible command', () => {
		expect(consumeStarterPersonaCommand('forum', 'draft', 'a:', false, [])).toBe(true);
		expect(consumePersonaCommand).toHaveBeenCalledWith('forum', 'a:', false);
	});

	it('counts attachments, from the composer or under the draft key', () => {
		consumeStarterPersonaCommand('forum', 'draft', 'a:', true, []);
		expect(hasMediaArg()).toBe(true);

		draftAttachments.count = 1;
		consumeStarterPersonaCommand('forum', 'draft', 'a:', false, []);
		expect(hasMediaArg()).toBe(true);
	});

	it('counts a sticker or a meme in either shape the composer sends them', () => {
		consumeStarterPersonaCommand('forum', 'draft', 'a:', false, [sticker]);
		expect(hasMediaArg()).toBe(true);

		consumeStarterPersonaCommand('forum', 'draft', 'a:', false, true, [sticker]);
		expect(hasMediaArg()).toBe(true);

		consumeStarterPersonaCommand('forum', 'draft', 'a:', false, [], 'meme');
		expect(hasMediaArg()).toBe(true);

		consumeStarterPersonaCommand('forum', 'draft', 'a:', false, false, [], 'meme');
		expect(hasMediaArg()).toBe(true);

		consumeStarterPersonaCommand('forum', 'draft', 'a:', false, false, []);
		expect(hasMediaArg()).toBe(false);
	});
});
