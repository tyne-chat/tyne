// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/messaging/state/ChatInputSettings', () => ({default: {convertEmoticons: false}}));
vi.mock('@app/features/messaging/utils/UrlSanitizationUtils', () => ({
	maybeSanitizeOutgoingMessage: (content: string) => content,
}));

const {buildMessageCreateRequest, buildMessageEditRequest} = await import(
	'@app/features/messaging/utils/MessageRequestUtils'
);

// The copy of the persona the app carries along to draw the pending message with.
const FOX: MessageSubprofileResponse = {
	id: '1546500000000000003',
	name: 'Fox',
	avatar: 'fox_avatar_hash',
	display_tag_text: 'The Den',
	pronouns: 'they/them',
};

describe('how a message request names its persona', () => {
	it('sends the persona’s id on a new message, and nothing else of the persona', () => {
		const body = buildMessageCreateRequest({content: 'hello', nonce: '1', subprofile: FOX});
		expect(body).toEqual({content: 'hello', nonce: '1', persona_id: FOX.id});
	});

	it('says nothing about a persona on a new message sent as the account', () => {
		expect(buildMessageCreateRequest({content: 'hello', nonce: '1'})).toEqual({content: 'hello', nonce: '1'});
		expect(buildMessageCreateRequest({content: 'hello', nonce: '1', subprofile: null})).toEqual({
			content: 'hello',
			nonce: '1',
		});
	});

	it('on an edit sends the id to change the persona, null to remove it, and nothing to leave it alone', () => {
		expect(buildMessageEditRequest({content: 'edited', subprofile: FOX})).toEqual({
			content: 'edited',
			persona_id: FOX.id,
		});
		expect(buildMessageEditRequest({content: 'edited', subprofile: null})).toEqual({
			content: 'edited',
			persona_id: null,
		});
		expect(buildMessageEditRequest({content: 'edited'})).toEqual({content: 'edited'});
		expect(buildMessageEditRequest({subprofile: FOX})).toEqual({persona_id: FOX.id});
	});
});
