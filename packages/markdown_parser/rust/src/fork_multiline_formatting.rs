// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: bridge blank lines between consecutive inline lines so inline formatting such as
//! `**...**`, `*...*`, `***...***`, `__...__`, `~~...~~` and mid-line `||...||` spans paragraphs
//! as on Discord (tyne-chat/tyne#641).
//!
//! Blank lines immediately before EOF or before any block start (heading, list, blockquote,
//! alert, code block, table, subtext or block spoiler) are left to `RuntimeState::parse`, so
//! upstream's block- and heading-spacing rules stay untouched. Whitespace on bridged blank lines
//! is dropped just as the outer loop drops it, and the dropped byte offsets are recorded so
//! `EmojiContext` stays aligned.

use crate::ast::ParserFlags;
use crate::parser::RuntimeState;
use crate::text::trim_start;

/// When the next unconsumed line is blank and the next non-blank line is another inline line
/// (not EOF and not a block start), appends the blank line breaks and that inline line to `text`,
/// advances `consumed` past them and returns `true`.
pub(crate) fn consume_blank_lines_before_inline(
    state: &mut RuntimeState<'_>,
    text: &mut String,
    consumed: &mut usize,
    dropped_bytes: &mut Vec<usize>,
) -> bool {
    let blank_start = state.current_line + *consumed;
    if !trim_start(&state.lines[blank_start].text).is_empty() {
        return false;
    }
    let mut next = blank_start + 1;
    while next < state.lines.len() && trim_start(&state.lines[next].text).is_empty() {
        next += 1;
    }
    if next >= state.lines.len() {
        return false;
    }
    let flags = state.parser.flags();
    let trimmed_after = trim_start(&state.lines[next].text);
    if crate::block::is_block_start(trimmed_after, flags)
        || crate::block::is_table_start(&state.lines, next, flags)
        || crate::block::opens_code_block_midline(&state.lines, next, flags, &mut state.fences)
        || is_block_spoiler_start(trimmed_after, flags)
    {
        return false;
    }
    let track_dropped = state
        .parser
        .emoji_context()
        .standard_cursor()
        .next_offset(0)
        .is_some();
    for index in blank_start..next {
        text.push('\n');
        let line = &state.lines[index];
        if track_dropped && !line.text.is_empty() {
            dropped_bytes.extend(line.offset..line.offset + line.text.len());
        }
    }
    text.push('\n');
    text.push_str(&state.lines[next].text);
    *consumed = next + 1 - state.current_line;
    true
}

fn is_block_spoiler_start(trimmed: &str, flags: u32) -> bool {
    ParserFlags::has(flags, ParserFlags::ALLOW_SPOILERS)
        && trimmed
            .strip_prefix("||")
            .is_some_and(|rest| !rest.contains("||"))
}
