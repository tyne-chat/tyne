// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: tyne-chat/tyne#632. Remove together with ForkDeferredLinkRenderer.tsx once upstream fixes the
// import cycle itself.

import type React from 'react';
import {describe, expect, it, vi} from 'vitest';

const LINK_NODE = {type: 'Link', url: 'https://example.com/', escaped: false} as const;

async function linkElementAfterLoading(order: 'link-first' | 'renderers-first'): Promise<React.ReactElement | null> {
	vi.resetModules();
	if (order === 'link-first') {
		await import('@app/features/messaging/components/markdown/renderers/LinkRenderer');
	}
	const renderers = await import('@app/features/messaging/components/markdown/renderers');
	const {MarkdownContext} = await import('@app/features/messaging/components/markdown/renderers/RendererTypes');
	const rendered = renderers.render([LINK_NODE] as never, {context: MarkdownContext.STANDARD_WITHOUT_JUMBO});
	return (rendered as Array<React.ReactElement | null>)[0];
}

describe('the markdown renderers and LinkRenderer.tsx', () => {
	// The order that broke start-up: LinkRenderer.tsx first, as LinkChannelCommands.ts and the badge and
	// nagbar components now import it, so that the renderers' index is reached through the cycle while
	// LinkRenderer.tsx is still loading. In the browser that read threw; here it reads undefined, and
	// the link would render as nothing.
	it('have a renderer for links when LinkRenderer.tsx loads first', async () => {
		const element = await linkElementAfterLoading('link-first');
		expect(element).not.toBeNull();
		expect(element?.type).toBeTruthy();
	});

	it('have a renderer for links when the renderers load first', async () => {
		const element = await linkElementAfterLoading('renderers-first');
		expect(element).not.toBeNull();
		expect(element?.type).toBeTruthy();
	});
});
