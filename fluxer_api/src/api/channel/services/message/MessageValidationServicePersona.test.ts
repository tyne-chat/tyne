// SPDX-License-Identifier: AGPL-3.0-or-later

import {MessageValidationService} from '@app/api/channel/services/message/MessageValidationService';
import {createDefaultLimitConfig} from '@app/api/constants/LimitConfig';
import {CannotSendEmptyMessageError} from '@fluxer/errors/src/domains/channel/CannotSendEmptyMessageError';
import {describe, expect, it} from 'vitest';

function createValidationService(): MessageValidationService {
	return new MessageValidationService(
		{} as never,
		{
			getConfigSnapshot: () => createDefaultLimitConfig({selfHosted: false}),
		} as never,
	);
}

describe("MessageValidationService.validateMessageContent when changing a message's persona", () => {
	it('allows empty content when updating a message with existing attachments', () => {
		const service = createValidationService();
		const existingMessage = {attachments: [{filename: 'image.png'}]} as never;
		expect(() =>
			service.validateMessageContent({content: ''} as never, null, {
				isUpdate: true,
				existingMessage,
			}),
		).not.toThrow();
	});

	it('allows updating subprofile on existing message with content', () => {
		const service = createValidationService();
		expect(() =>
			service.validateMessageContent(
				{
					subprofile: {id: 'p1', name: 'Alice'},
				} as never,
				null,
				{
					isUpdate: true,
					existingMessage: {content: 'Hello world', attachments: [], embeds: []} as never,
				},
			),
		).not.toThrow();
	});

	it('allows updating subprofile on existing message with attachments but no text', () => {
		const service = createValidationService();
		expect(() =>
			service.validateMessageContent(
				{
					subprofile: {id: 'p1', name: 'Alice'},
				} as never,
				null,
				{
					isUpdate: true,
					existingMessage: {content: '', attachments: [{filename: 'pic.png'}], embeds: []} as never,
				},
			),
		).not.toThrow();
	});

	it('rejects clearing content when updating subprofile without remaining attachments or embeds', () => {
		const service = createValidationService();
		expect(() =>
			service.validateMessageContent(
				{
					content: '',
					subprofile: {id: 'p1', name: 'Alice'},
				} as never,
				null,
				{
					isUpdate: true,
					existingMessage: {content: 'Original content', attachments: [], embeds: []} as never,
				},
			),
		).toThrow(CannotSendEmptyMessageError);
	});

	it('still rejects empty content when updating a message without attachments, embeds, or flags', () => {
		const service = createValidationService();
		expect(() =>
			service.validateMessageContent({content: ''} as never, null, {
				isUpdate: true,
				existingMessage: {attachments: [], embeds: []} as never,
			}),
		).toThrow(CannotSendEmptyMessageError);
	});
});
