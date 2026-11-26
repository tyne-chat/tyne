// SPDX-License-Identifier: AGPL-3.0-or-later

use fluxer_markdown_parser::plaintext::{PlaintextOptions, parse_and_render_plaintext};
use fluxer_markdown_parser::{EmojiContext, MarkdownParser, ParserFlags, parse_markdown_json};
use serde_json::{Value, json};

fn parse(input: &str) -> Value {
    parse_with(input, ParserFlags::ALL, "")
}

fn parse_with(input: &str, flags: u32, emoji_context: &str) -> Value {
    let mut parser = MarkdownParser::new(flags, EmojiContext::parse(emoji_context));
    let nodes = parser.parse(input).expect("parse succeeds");
    serde_json::to_value(&nodes).expect("serialize succeeds")
}

fn text(content: &str) -> Value {
    json!({"type": "Text", "content": content})
}

fn strong(children: Value) -> Value {
    json!({"type": "Strong", "children": children})
}

#[test]
fn bold_spans_blank_lines() {
    assert_eq!(
        parse("**Test sentence one\n\nTest sentence 2**"),
        json!([strong(json!([text(
            "Test sentence one\n\nTest sentence 2"
        )]))])
    );
    assert_eq!(
        parse("**line 1\n\nline 2\n\nline 3**"),
        json!([strong(json!([text("line 1\n\nline 2\n\nline 3")]))])
    );
    assert_eq!(
        parse("**line 1\n\n\nline 2**"),
        json!([strong(json!([text("line 1\n\n\nline 2")]))])
    );
    assert_eq!(
        parse("**line 1\nline 2\n\nline 3**"),
        json!([strong(json!([text("line 1\nline 2\n\nline 3")]))])
    );
    assert_eq!(
        parse("before **line 1\n\nline 2** after"),
        json!([
            text("before "),
            strong(json!([text("line 1\n\nline 2")])),
            text(" after")
        ])
    );
    assert_eq!(
        parse("**Test sentence one\r\n\r\nTest sentence 2**"),
        parse("**Test sentence one\n\nTest sentence 2**")
    );
}

#[test]
fn whitespace_only_blank_lines_normalize_inside_formatting() {
    let expected = json!([strong(json!([text("line 1\n\nline 2")]))]);
    assert_eq!(parse("**line 1\n   \nline 2**"), expected);
    assert_eq!(parse("**line 1\n\t \nline 2**"), expected);
    assert_eq!(
        parse("**line 1\n   \n\t\nline 2**"),
        json!([strong(json!([text("line 1\n\n\nline 2")]))])
    );
    assert_eq!(parse("a\n   \nb"), json!([text("a\n\nb")]));
}

#[test]
fn other_inline_formatting_spans_blank_lines_except_inline_code() {
    assert_eq!(
        parse("*line 1\n\nline 2*"),
        json!([{"type": "Emphasis", "children": [text("line 1\n\nline 2")]}])
    );
    assert_eq!(
        parse("_line 1\n\nline 2_"),
        json!([{"type": "Emphasis", "children": [text("line 1\n\nline 2")]}])
    );
    assert_eq!(
        parse("***line 1\n\nline 2***"),
        json!([{"type": "Emphasis", "children": [strong(json!([text("line 1\n\nline 2")]))]}])
    );
    assert_eq!(
        parse("__line 1\n\nline 2__"),
        json!([{"type": "Underline", "children": [text("line 1\n\nline 2")]}])
    );
    assert_eq!(
        parse("~~line 1\n\nline 2~~"),
        json!([{"type": "Strikethrough", "children": [text("line 1\n\nline 2")]}])
    );
    assert_eq!(
        parse("note ||line 1\n\nline 2||"),
        json!([
            text("note "),
            {"type": "Spoiler", "children": [text("line 1\n\nline 2")], "isBlock": false}
        ])
    );
    assert_eq!(
        parse("`line 1\n\nline 2`"),
        json!([text("`line 1\n\nline 2`")])
    );
}

#[test]
fn nested_formatting_mentions_and_shorthands_work_across_blank_lines() {
    assert_eq!(
        parse("**line 1\n\n*italic*\n\nline 3**"),
        json!([strong(json!([
            text("line 1\n\n"),
            {"type": "Emphasis", "children": [text("italic")]},
            text("\n\nline 3")
        ]))])
    );
    assert_eq!(
        parse("*line 1 **bold\n\nstill bold** line 2*"),
        json!([{"type": "Emphasis", "children": [
            text("line 1 "),
            strong(json!([text("bold\n\nstill bold")])),
            text(" line 2")
        ]}])
    );

    let json_out = parse_markdown_json("**line 1\n\n<@123:456> tyne/641**", ParserFlags::ALL, "")
        .expect("json parse succeeds");
    let parsed: Value = serde_json::from_str(&json_out).expect("valid json");
    assert_eq!(
        parsed["nodes"],
        json!([strong(json!([
            text("line 1\n\n"),
            {"type": "Mention", "kind": {"kind": "User", "id": "123", "personaId": "456"}},
            text(" "),
            {
                "type": "Link",
                "text": text("tyne/641"),
                "url": "https://github.com/tyne-chat/tyne/issues/641",
                "escaped": false,
                "rawUrl": "https://github.com/tyne-chat/tyne/issues/641",
                "source": "tyne/641"
            }
        ]))])
    );
}

#[test]
fn separate_bold_blocks_and_unclosed_markers_behave_normally() {
    assert_eq!(
        parse("**para 1**\n\n**para 2**"),
        json!([
            strong(json!([text("para 1")])),
            text("\n\n"),
            strong(json!([text("para 2")]))
        ])
    );
    assert_eq!(
        parse("**unclosed\n\npara 2"),
        json!([text("**unclosed\n\npara 2")])
    );
    assert_eq!(parse("**\n\n**"), json!([text("**\n\n**")]));
}

#[test]
fn multiline_bold_works_inside_containers() {
    let bold_pair = json!([strong(json!([text("line 1\n\nline 2")]))]);
    assert_eq!(
        parse("> **line 1\n> \n> line 2**"),
        json!([{"type": "Blockquote", "children": bold_pair}])
    );
    assert_eq!(
        parse("> **line 1\n>   \n> line 2**"),
        json!([{"type": "Blockquote", "children": bold_pair}])
    );
    assert_eq!(
        parse(">>> **line 1\n\nline 2**"),
        json!([{"type": "Blockquote", "children": bold_pair}])
    );
    assert_eq!(
        parse("> [!NOTE]\n> **line 1\n> \n> line 2**"),
        json!([{"type": "Alert", "alertType": "Note", "children": bold_pair}])
    );
    assert_eq!(
        parse("||\n**line 1\n\nline 2**\n||"),
        json!([{"type": "Spoiler", "children": bold_pair, "isBlock": true}])
    );
}

#[test]
fn block_elements_and_eof_still_bound_inline_runs() {
    assert_eq!(
        parse("**line 1\n\n# Heading\n\nline 2**"),
        json!([
            text("**line 1\n"),
            {"type": "Heading", "level": 1, "children": [text("Heading")]},
            text("line 2**")
        ])
    );
    assert_eq!(
        parse("**line 1\n\n- item 1\n- item 2**"),
        json!([
            text("**line 1\n\n"),
            {
                "type": "List",
                "ordered": false,
                "items": [
                    {"children": [text("item 1")]},
                    {"children": [text("item 2**")]}
                ]
            }
        ])
    );
    assert_eq!(
        parse("**line 1\n\n> quote\n\nline 2**"),
        json!([
            text("**line 1\n\n"),
            {"type": "Blockquote", "children": [text("quote")]},
            text("\nline 2**")
        ])
    );
    assert_eq!(
        parse("**line 1\n\n```\ncode\n```\n\nline 2**"),
        json!([
            text("**line 1\n\n"),
            {"type": "CodeBlock", "content": "code\n"},
            text("\nline 2**")
        ])
    );
    assert_eq!(
        parse("**line 1\n\nmid ```code```**"),
        json!([
            text("**line 1\n\nmid "),
            {"type": "CodeBlock", "content": "code"},
            text("**")
        ])
    );
    assert_eq!(
        parse("**line 1\n\n-# subtext\n\nline 2**"),
        json!([
            text("**line 1\n\n"),
            {"type": "Subtext", "children": [text("subtext")]},
            text("\nline 2**")
        ])
    );
    assert_eq!(
        parse("**line 1\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nline 2**")[1]["type"],
        json!("Table")
    );
    assert_eq!(
        parse("intro\n\n||block\nspoiler||"),
        json!([
            text("intro\n\n"),
            {"type": "Spoiler", "children": [text("block\nspoiler")], "isBlock": true}
        ])
    );
    assert_eq!(
        parse("**line 1\n\n||inline||**"),
        json!([strong(json!([
            text("line 1\n\n"),
            {"type": "Spoiler", "children": [text("inline")], "isBlock": false}
        ]))])
    );
    assert_eq!(
        parse_with(
            "**line 1\n\n||line 2**",
            ParserFlags::ALL & !ParserFlags::ALLOW_SPOILERS,
            ""
        ),
        json!([strong(json!([text("line 1\n\n||line 2")]))])
    );
    assert_eq!(
        parse("**a\n\nb**\n\n- item"),
        json!([
            strong(json!([text("a\n\nb")])),
            text("\n\n"),
            {"type": "List", "ordered": false, "items": [{"children": [text("item")]}]}
        ])
    );
    assert_eq!(
        parse("**a\n\nb**\n\n# Heading"),
        json!([
            strong(json!([text("a\n\nb")])),
            text("\n"),
            {"type": "Heading", "level": 1, "children": [text("Heading")]}
        ])
    );
    assert_eq!(
        parse("**a\n\nb**\n\n"),
        json!([strong(json!([text("a\n\nb")])), text("\n")])
    );
}

#[test]
fn emoji_offsets_stay_aligned_across_blank_and_whitespace_lines() {
    let emoji = |raw: &str, name: &str, codepoints: &str| {
        json!({
            "type": "Emoji",
            "kind": {"kind": "Standard", "raw": raw, "codepoints": codepoints, "name": name}
        })
    };

    // `**a\n   \n😀**`: `😀` is at byte offset 8.
    let ctx_after = "S\t8\t4\t\u{1f600}\tgrinning\t1f600\n";
    assert_eq!(
        parse_with("**a\n   \n\u{1f600}**", ParserFlags::ALL, ctx_after),
        json!([strong(json!([
            text("a\n\n"),
            emoji("\u{1f600}", "grinning", "1f600")
        ]))])
    );

    // `**a\r\n   \r\n😀**`: `😀` is at byte offset 10 before CRLF normalization.
    let ctx_crlf = "S\t10\t4\t\u{1f600}\tgrinning\t1f600\n";
    assert_eq!(
        parse_with("**a\r\n   \r\n\u{1f600}**", ParserFlags::ALL, ctx_crlf),
        json!([strong(json!([
            text("a\n\n"),
            emoji("\u{1f600}", "grinning", "1f600")
        ]))])
    );

    // `# H\n\n**a\n   \n😀**`: `# H\n\n` is 5 bytes, so `😀` is at offset 13.
    let ctx_after_block = "S\t13\t4\t\u{1f600}\tgrinning\t1f600\n";
    assert_eq!(
        parse_with(
            "# H\n\n**a\n   \n\u{1f600}**",
            ParserFlags::ALL,
            ctx_after_block
        ),
        json!([
            {"type": "Heading", "level": 1, "children": [text("H")]},
            strong(json!([
                text("a\n\n"),
                emoji("\u{1f600}", "grinning", "1f600")
            ]))
        ])
    );

    // `**😀\n   \n😄**`: `😀` at offset 2 (len 4), `\n` at 6, `   ` at 7..10, `\n` at 10, `😄` at 11.
    let ctx_both = "S\t2\t4\t\u{1f600}\tgrinning\t1f600\nS\t11\t4\t\u{1f604}\tsmile\t1f604\n";
    assert_eq!(
        parse_with("**\u{1f600}\n   \n\u{1f604}**", ParserFlags::ALL, ctx_both),
        json!([strong(json!([
            emoji("\u{1f600}", "grinning", "1f600"),
            text("\n\n"),
            emoji("\u{1f604}", "smile", "1f604")
        ]))])
    );
}

#[test]
fn plaintext_renders_multiline_bold_with_and_without_markdown() {
    let input = "**Test sentence one\n\nTest sentence 2**";
    let plain =
        parse_and_render_plaintext(input, ParserFlags::ALL, "", &PlaintextOptions::default())
            .expect("plaintext succeeds");
    assert_eq!(plain, "Test sentence one\n\nTest sentence 2");

    let preserved = parse_and_render_plaintext(
        input,
        ParserFlags::ALL,
        "",
        &PlaintextOptions {
            preserve_markdown: true,
            ..PlaintextOptions::default()
        },
    )
    .expect("plaintext succeeds");
    assert_eq!(preserved, input);
}

#[test]
fn many_consecutive_blank_lines_stay_linear() {
    let blanks = "\n".repeat(2000);
    let input = format!("a{blanks}b");
    assert_eq!(parse(&input), json!([text(&input)]));
}
