// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: issue shorthands. The parser links `tyne/101` to the issue on GitHub
// (packages/markdown_parser/rust/src/fork_issue_links.rs). In plaintext (notifications, copied text,
// the other accounts' inbox) it stays as typed, not `[tyne/101](https://...)`.

import {NodeType} from '@app/features/messaging/utils/markdown/parser/Enums';
import type {LinkNode} from '@app/features/messaging/utils/markdown/parser/Nodes';

const ISSUE_SHORTHAND = /^(tyne|tyne-tools)\/([1-9][0-9]{0,6})$/;

/** The shorthand as typed, if `node` is an issue shorthand's link. */
export function forkIssueShorthandText(node: LinkNode): string | null {
	if (node.text?.type !== NodeType.Text) return null;
	const match = ISSUE_SHORTHAND.exec(node.text.content);
	if (match == null || node.url !== `https://github.com/tyne-chat/${match[1]}/issues/${match[2]}`) return null;
	return node.text.content;
}
