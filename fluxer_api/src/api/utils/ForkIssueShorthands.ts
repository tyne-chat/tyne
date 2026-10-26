// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: issue shorthands. The apps show `tyne/101` as a link to the issue
// (packages/markdown_parser/rust/src/fork_issue_links.rs); this turns it into that URL so it unfurls
// like a pasted link. Both follow packages/markdown_parser/rust/tests/fork_issue_shorthand_cases.json.
// `tyne-tools/N` is not expanded: its issues are private, so there is nothing to unfurl.

import {URL_REGEX} from '@fluxer/constants/src/Core';

const ISSUE_URL_PREFIX = 'https://github.com/tyne-chat/tyne/issues/';

// A word of its own: not after a letter, digit, `-`, `/`, `.` or `@` (`/opt/tyne/1`), and not before
// one of those or `#`, nor before a full stop that continues the word (`tyne/1.5`). ASCII only, like
// the parser, so `tyne/101を見て` counts.
const ISSUE_SHORTHAND = String.raw`(?<![A-Za-z0-9\-/.@])tyne\/([1-9][0-9]{0,6})(?![A-Za-z0-9\-/@#]|\.[A-Za-z0-9])`;

// URLs are matched first and kept, so a shorthand inside one (`https://example.com/?q=tyne/1`) stays put.
const URL_OR_ISSUE_SHORTHAND = new RegExp(`${URL_REGEX.source}|${ISSUE_SHORTHAND}`, 'g');

// The URL is padded with spaces so that the punctuation after a shorthand (`tyne/101.`) does not
// become part of it.
export function expandForkIssueShorthands(text: string): string {
	return text.replace(URL_OR_ISSUE_SHORTHAND, (match, issueNumber: string | undefined) =>
		issueNumber ? ` ${ISSUE_URL_PREFIX}${issueNumber} ` : match,
	);
}
