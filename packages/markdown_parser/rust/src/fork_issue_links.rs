// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: issue shorthands. `tyne/101` and `tyne-tools/14` become links to
//! `https://github.com/tyne-chat/<repository>/issues/<number>`, shown as typed.
//!
//! Applied only to the trees the apps display (`parse_markdown_json`, `fluxer_md_parse_binary`),
//! not inside `MarkdownParser::parse`: push previews keep markdown (`preserve_markdown`), which
//! would turn the link into `[tyne/101](https://...)`. The API finds the same `tyne/` shorthands for
//! unfurling (`fluxer_api/src/api/utils/ForkIssueShorthands.ts`); both follow the cases in
//! `tests/fork_issue_shorthand_cases.json`.

use crate::ast::{Node, ParserFlags};
use crate::constants::MAX_AST_NODES;
use crate::parser::MarkdownParser;

/// Longest first, so `tyne-tools/` is not read as `tyne` followed by text.
const REPOSITORIES: [&str; 2] = ["tyne-tools", "tyne"];
const ISSUE_URL_PREFIX: &str = "https://github.com/tyne-chat/";
const SHARED_PREFIX: &str = "tyne";
const MAX_ISSUE_DIGITS: usize = 7;
/// Nodes one shorthand can add: the link, its text, and the text after it.
const NODES_PER_LINK: usize = 3;

/// Turns issue shorthands in `nodes` into links, under the same `ALLOW_AUTOLINKS` flag as URLs and
/// within the parser's node limit. Code, existing links, mentions and emoji are left alone.
pub fn link_issue_shorthands(mut nodes: Vec<Node>, parser: &MarkdownParser) -> Vec<Node> {
    if ParserFlags::has(parser.flags(), ParserFlags::ALLOW_AUTOLINKS) {
        let mut budget = MAX_AST_NODES.saturating_sub(parser.node_count);
        link_nodes(&mut nodes, &mut budget);
    }
    nodes
}

fn link_nodes(nodes: &mut Vec<Node>, budget: &mut usize) {
    for node in nodes.iter_mut() {
        link_children(node, budget);
    }
    if !nodes
        .iter()
        .any(|node| matches!(node, Node::Text { content } if content.contains(SHARED_PREFIX)))
    {
        return;
    }
    let mut linked = Vec::with_capacity(nodes.len() + NODES_PER_LINK);
    for node in std::mem::take(nodes) {
        match node {
            Node::Text { content } => split_text(content, budget, &mut linked),
            node => linked.push(node),
        }
    }
    *nodes = linked;
}

fn link_children(node: &mut Node, budget: &mut usize) {
    match node {
        Node::Blockquote { children, .. }
        | Node::Strong { children }
        | Node::Emphasis { children }
        | Node::Underline { children }
        | Node::Strikethrough { children }
        | Node::Spoiler { children, .. }
        | Node::Heading { children, .. }
        | Node::Subtext { children }
        | Node::Sequence { children }
        | Node::TableCell { children }
        | Node::Alert { children, .. } => link_nodes(children, budget),
        Node::List { items, .. } => {
            for item in items {
                link_nodes(&mut item.children, budget);
            }
        }
        Node::Table { header, rows, .. } => {
            link_children(header, budget);
            for row in rows {
                link_children(row, budget);
            }
        }
        Node::TableRow { cells } => {
            for cell in cells {
                link_children(cell, budget);
            }
        }
        // Code keeps its text, a link never holds another, and a node type upstream adds later is
        // left alone until someone decides otherwise.
        _ => {}
    }
}

fn split_text(content: String, budget: &mut usize, out: &mut Vec<Node>) {
    let mut start = 0;
    let mut search = 0;
    while *budget >= NODES_PER_LINK
        && let Some(found) = content[search..].find(SHARED_PREFIX)
    {
        let position = search + found;
        search = position + SHARED_PREFIX.len();
        let Some((repository, end)) = shorthand_at(&content, position) else {
            continue;
        };
        if start < position {
            out.push(Node::Text {
                content: content[start..position].to_owned(),
            });
        }
        let source = &content[position..end];
        let number = &source[repository.len() + 1..];
        let url = format!("{ISSUE_URL_PREFIX}{repository}/issues/{number}");
        out.push(Node::Link {
            text: Some(Box::new(Node::Text {
                content: source.to_owned(),
            })),
            url: url.clone(),
            raw_url: url,
            source: source.to_owned(),
            escaped: false,
        });
        *budget -= NODES_PER_LINK;
        start = end;
        search = end;
    }
    if start == 0 {
        out.push(Node::Text { content });
    } else if start < content.len() {
        out.push(Node::Text {
            content: content[start..].to_owned(),
        });
    }
}

/// The repository and end of a shorthand that starts at `position`, if one does: a repository, a
/// slash and an issue number, standing as a word of its own (not `/opt/tyne/1`, `tyne/1abc`,
/// `tyne/1/files` or `tyne/1.5`). A full stop or comma after it ends the sentence, not the link.
/// Only ASCII letters and digits join a word, so `tyne/101を見て` links: CJK text has no spaces.
fn shorthand_at(text: &str, position: usize) -> Option<(&'static str, usize)> {
    let before = text[..position].chars().next_back();
    if before.is_some_and(joins_before) {
        return None;
    }
    let rest = &text[position..];
    let repository = REPOSITORIES.into_iter().find(|repository| {
        rest.strip_prefix(repository)
            .is_some_and(|after| after.starts_with('/'))
    })?;
    let number_start = position + repository.len() + 1;
    let digits = text.as_bytes()[number_start..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    if digits == 0 || digits > MAX_ISSUE_DIGITS || text.as_bytes()[number_start] == b'0' {
        return None;
    }
    let end = number_start + digits;
    let mut after = text[end..].chars();
    let continues_word = match after.next() {
        Some('.') => after
            .next()
            .is_some_and(|next| next.is_ascii_alphanumeric()),
        next => next.is_some_and(joins_after),
    };
    (!continues_word).then_some((repository, end))
}

fn joins_before(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '/' | '.' | '@')
}

fn joins_after(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '/' | '@' | '#')
}
