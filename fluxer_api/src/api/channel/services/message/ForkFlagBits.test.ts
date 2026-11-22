// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fork: the fork's attachment and embed media flag bits must never be one upstream uses, documented
 * or internal (tyne-chat/tyne#873). Upstream's internal `EMBED_MEDIA_OWNED_ATTACHMENT_FLAG` decides
 * whether deleting a message deletes an embed's file, so a fork bit equal to it on a link embed
 * would delete the linked file with the link. This fails the day upstream takes one of the fork's
 * bits: move the fork's to another free bit in the middle of the range.
 */
import {EMBED_MEDIA_OWNED_ATTACHMENT_FLAG} from '@app/api/channel/services/message/MessageHelpers';
import {EmbedMediaFlags, MessageAttachmentFlags} from '@fluxer/constants/src/ChannelConstants';
import {ForkMessageAttachmentFlags} from '@fluxer/constants/src/ForkAttachmentConstants';
import {describe, expect, it} from 'vitest';

const upstreamBits = [
	...Object.values(MessageAttachmentFlags),
	...Object.values(EmbedMediaFlags),
	EMBED_MEDIA_OWNED_ATTACHMENT_FLAG,
].reduce((all, bit) => all | bit, 0);

describe("the fork's media flag bits", () => {
	it.each(Object.entries(ForkMessageAttachmentFlags))('%s is one bit upstream does not use', (_name, bit) => {
		expect(bit).toBeGreaterThan(0);
		expect(bit & (bit - 1)).toBe(0);
		expect(bit & upstreamBits).toBe(0);
	});

	it('are distinct', () => {
		const bits = Object.values(ForkMessageAttachmentFlags);
		expect(new Set(bits).size).toBe(bits.length);
	});
});
