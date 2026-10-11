// SPDX-License-Identifier: AGPL-3.0-or-later

use fluxer_markdown_parser::binary::write_ast_binary;
use fluxer_markdown_parser::{EmojiContext, MarkdownParser, ParserFlags};

fn encode(input: &str) -> Vec<u8> {
    let mut parser = MarkdownParser::new(ParserFlags::ALL, EmojiContext::parse(""));
    let nodes = parser.parse(input).expect("parse should succeed");
    write_ast_binary(&nodes)
}

#[test]
fn user_mention_golden_bytes() {
    // Tag 0 for standard user mention: [FORMAT_VERSION, count=1, tag=14 (Mention), kind=0, len=3, '1', '2', '3']
    assert_eq!(encode("<@123>"), [1, 1, 14, 0, 3, b'1', b'2', b'3']);
}

#[test]
fn user_persona_mention_golden_bytes() {
    // Tag 7 for persona user mention: [FORMAT_VERSION, count=1, tag=14 (Mention), kind=7, user_len=3, '1', '2', '3', persona_len=3, '4', '5', '6']
    assert_eq!(
        encode("<@123:456>"),
        [1, 1, 14, 7, 3, b'1', b'2', b'3', 3, b'4', b'5', b'6']
    );
}
