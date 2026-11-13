// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: TEMPORARY workaround for an upstream import cycle (tyne-chat/tyne#632). Once upstream fixes
// the cycle on its side, remove this file and its test, and give `renderers/index.tsx` back its
// `LinkRenderer` import and its `[NodeType.Link]: LinkRenderer` entry (or take upstream's file).
//
// Upstream #4050 and #4051 made several modules import `LinkRenderer.tsx` directly. Through
// `ConfirmModal` and `InviteCommands`, `LinkRenderer.tsx` leads back to `renderers/index.tsx`, which
// reads `LinkRenderer` when it builds its renderer map. When `LinkRenderer.tsx` is entered first,
// that read happens before `LinkRenderer` is defined, and the app fails to start with "Cannot access
// '…' before initialization". Depending on which lazily loaded chunk runs first, this happened on
// some loads and not others.
//
// This component reads `LinkRenderer` only when it renders, long after every module has loaded. It
// is a function declaration, so it exists as soon as its module is linked and the map can hold it
// whichever module comes first.

import {LinkRenderer} from '@app/features/messaging/components/markdown/renderers/LinkRenderer';
import type {RendererProps} from '@app/features/messaging/components/markdown/renderers/RendererTypes';
import type {LinkNode} from '@app/features/messaging/utils/markdown/parser/Nodes';
import type React from 'react';

export function ForkDeferredLinkRenderer(props: RendererProps<LinkNode>): React.ReactElement {
	return <LinkRenderer {...props} />;
}
