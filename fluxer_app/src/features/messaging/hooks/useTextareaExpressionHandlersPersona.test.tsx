// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {act, useRef} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// Whether the typed text was used up is decided by isDraftUsedUpByExpression (tested on its own);
// here it is stubbed, to check that each auto-send handler asks before sending and clears the
// composer only when told to (tyne-chat/tyne#122).
const draftCheck = vi.hoisted(() => vi.fn<(channelId: string | null, draft: string) => boolean>());
vi.mock('@app/features/persona/state/PersonaStore', () => ({PersonaStore: {}}));
vi.mock('@app/features/messaging/utils/ExpressionDraftPersona', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/messaging/utils/ExpressionDraftPersona')>()),
	isDraftUsedUpByExpression: draftCheck,
}));
vi.mock('@app/features/threads/state/ActiveComposer', () => ({default: {accepts: () => true}}));
vi.mock('@app/features/user/state/Users', () => ({default: {getUser: () => null}}));
vi.mock('@app/features/user/utils/NicknameUtils', () => ({formatUserTagForStreamerMode: () => ''}));

const {useTextareaExpressionHandlers} = await import('@app/features/messaging/hooks/useTextareaExpressionHandlers');
const {TextareaSegmentManager} = await import('@app/features/messaging/utils/TextareaSegmentManager');
const {ComponentBus} = await import('@app/features/platform/utils/ComponentBus');

const CHANNEL_ID = '1555752678099779590';
const TYPED = 'hello there';

type Send = Parameters<typeof useTextareaExpressionHandlers>[0]['sendOptimisticMessage'];

let root: Root | null = null;
let container: HTMLElement | null = null;
const send = vi.fn<Send>();
const clearComposer = vi.fn();
const setValue = vi.fn();

function Composer() {
	const previousValueRef = useRef(TYPED);
	const segmentManagerRef = useRef(new TextareaSegmentManager());
	useTextareaExpressionHandlers({
		setValue,
		clearComposer,
		previousValueRef,
		segmentManagerRef,
		sendOptimisticMessage: send,
		channelId: CHANNEL_ID,
	});
	return null;
}

const EVENTS = [
	{
		name: 'a sticker',
		dispatch: () =>
			ComponentBus.dispatch('STICKER_SELECT', {
				sticker: {toJSON: () => ({id: '1555752678099779591', name: 'wave', format_type: 1})},
			}),
	},
	{
		name: 'an auto-send GIF',
		dispatch: () =>
			ComponentBus.dispatch('GIF_SELECT', {
				gif: {provider: 'tenor', url: 'https://media.example/cat.gif', slug: 'cat'},
				autoSend: true,
			}),
	},
	{
		name: 'an auto-send favourite meme',
		dispatch: () =>
			ComponentBus.dispatch('FAVORITE_MEME_SELECT', {
				meme: {
					id: '1555752678099779592',
					url: 'https://media.example/meme.png',
					filename: 'meme.png',
					name: 'meme',
					size: 10,
					contentType: 'image/png',
					gifProvider: null,
					gifSlug: null,
				},
				autoSend: true,
			}),
	},
] as const;

beforeEach(async () => {
	vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
	send.mockReset();
	clearComposer.mockReset();
	setValue.mockReset();
	draftCheck.mockReset();
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(<Composer data-flx="messaging.use-textarea-expression-handlers-persona-test.composer" />);
	});
});

afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	container?.remove();
	root = null;
	container = null;
	vi.unstubAllGlobals();
});

describe.each(EVENTS)('picking $name', ({dispatch}) => {
	it('keeps the typed text when the send did not use it', () => {
		draftCheck.mockReturnValue(false);
		dispatch();
		expect(draftCheck).toHaveBeenCalledWith(CHANNEL_ID, TYPED);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][1].draftOverride).toBe(TYPED);
		expect(draftCheck.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
		expect(clearComposer).not.toHaveBeenCalled();
		expect(setValue).not.toHaveBeenCalled();
	});

	it('clears the composer when the text was only a persona tag', () => {
		draftCheck.mockReturnValue(true);
		dispatch();
		expect(send).toHaveBeenCalledTimes(1);
		expect(clearComposer).toHaveBeenCalledTimes(1);
	});
});
