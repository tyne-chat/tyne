// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: persona mentions (`<@user:persona>`) in the parser and the plaintext renderer.

use fluxer_markdown_parser::ParserFlags;
use fluxer_markdown_parser::ast::{MentionKind, Node};
use fluxer_markdown_parser::plaintext::{PlaintextOptions, parse_and_render_plaintext};
use fluxer_markdown_parser::{EmojiContext, MarkdownParser};
use std::collections::HashMap;

fn parse(input: &str) -> Vec<Node> {
    MarkdownParser::new(ParserFlags::ALL, EmojiContext::parse(""))
        .parse(input)
        .expect("parses")
}

fn user_mention(id: &str, persona_id: Option<&str>) -> Node {
    Node::Mention {
        kind: MentionKind::User {
            id: id.to_owned(),
            persona_id: persona_id.map(str::to_owned),
        },
    }
}

#[test]
fn parses_user_mention_without_persona_id() {
    assert_eq!(parse("<@123456>"), vec![user_mention("123456", None)]);
}

#[test]
fn parses_user_persona_mention_numeric_and_slugs() {
    for (input, persona_id) in [
        ("<@123456:789012>", "789012"),
        ("<@!123456:bob_the_fox>", "bob_the_fox"),
        ("<@!123456:alice-pk>", "alice-pk"),
    ] {
        assert_eq!(
            parse(input),
            vec![user_mention("123456", Some(persona_id))],
            "{input}"
        );
    }
}

#[test]
fn rejects_invalid_persona_mentions() {
    for input in [
        "<@123456:>",
        "<@:789012>",
        "<@123456:bad space>",
        "<@123456:inv@lid>",
    ] {
        assert!(
            !parse(input)
                .iter()
                .any(|node| matches!(node, Node::Mention { .. })),
            "{input}"
        );
    }
}

#[test]
fn plaintext_names_a_mentioned_persona() {
    let options = PlaintextOptions {
        preserve_markdown: true,
        users: HashMap::from([("1".to_owned(), "Alice".to_owned())]),
        personas: HashMap::from([("999".to_owned(), "Bob the Fox".to_owned())]),
        roles: HashMap::from([("2".to_owned(), "Ops".to_owned())]),
        channels: HashMap::from([("3".to_owned(), "alerts".to_owned())]),
        ..PlaintextOptions::default()
    };

    let result = parse_and_render_plaintext(
        "**hi** <@1> <@1:999> <@&2> <#3> [site](https://fluxer.app)",
        ParserFlags::ALL,
        "",
        &options,
    )
    .expect("plaintext");

    assert_eq!(
        result,
        "**hi** @Alice @Bob the Fox @Ops #alerts [site](https://fluxer.app)"
    );
}
