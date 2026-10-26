// SPDX-License-Identifier: AGPL-3.0-or-later
#![cfg(not(target_arch = "wasm32"))]

//! Fork: issue shorthands (`tyne/101`) become links in the trees the apps display, and nowhere else.

use fluxer_markdown_parser::constants::MAX_AST_NODES;
use fluxer_markdown_parser::native::{
    FluxerMdBuffer, fluxer_md_buffer_free, fluxer_md_parse_binary,
};
use fluxer_markdown_parser::plaintext::{PlaintextOptions, parse_and_render_plaintext};
use fluxer_markdown_parser::{EmojiContext, MarkdownParser, ParserFlags};
use serde_json::{Value, json};

const CASES: &str = include_str!("fork_issue_shorthand_cases.json");

fn tree(input: &str, flags: u32) -> Value {
    let written = fluxer_markdown_parser::parse_markdown_json(input, flags, "").expect("parses");
    serde_json::from_str(&written).expect("written json parses")
}

/// Every link in the tree, in order, as (source, url).
fn links(value: &Value) -> Vec<(String, String)> {
    let mut found = Vec::new();
    collect_links(value, &mut found);
    found
}

fn collect_links(value: &Value, found: &mut Vec<(String, String)>) {
    match value {
        Value::Object(object) => {
            if object.get("type") == Some(&json!("Link")) {
                found.push((
                    object["source"].as_str().expect("source").to_owned(),
                    object["url"].as_str().expect("url").to_owned(),
                ));
            }
            for child in object.values() {
                collect_links(child, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_links(item, found);
            }
        }
        _ => {}
    }
}

fn issue_url(shorthand: &str) -> String {
    let (repository, number) = shorthand.split_once('/').expect("shorthand has a slash");
    format!("https://github.com/tyne-chat/{repository}/issues/{number}")
}

fn binary(input: &str) -> Vec<u8> {
    let mut out = FluxerMdBuffer {
        data: std::ptr::null_mut(),
        data_len: 0,
        error: std::ptr::null_mut(),
        error_len: 0,
    };
    let status = unsafe {
        fluxer_md_parse_binary(
            input.as_ptr(),
            input.len(),
            ParserFlags::ALL,
            "".as_ptr(),
            0,
            &raw mut out,
        )
    };
    assert_eq!(status, 0);
    let bytes = unsafe { std::slice::from_raw_parts(out.data, out.data_len) }.to_vec();
    unsafe { fluxer_md_buffer_free(&raw mut out) };
    bytes
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_bytes())
}

#[test]
fn shared_cases_link_exactly_the_listed_shorthands() {
    let cases: Value = serde_json::from_str(CASES).expect("cases parse");
    for case in cases["cases"].as_array().expect("cases") {
        let input = case["input"].as_str().expect("input");
        let expected: Vec<(String, String)> = case["links"]
            .as_array()
            .expect("links")
            .iter()
            .map(|link| {
                let shorthand = link.as_str().expect("link");
                (shorthand.to_owned(), issue_url(shorthand))
            })
            .collect();
        assert_eq!(links(&tree(input, ParserFlags::ALL)), expected, "{input}");
    }
}

#[test]
fn a_shorthand_is_a_link_shown_as_typed() {
    assert_eq!(
        tree("see tyne/101.", ParserFlags::ALL),
        json!({"nodes": [
            {"type": "Text", "content": "see "},
            {
                "type": "Link",
                "text": {"type": "Text", "content": "tyne/101"},
                "url": "https://github.com/tyne-chat/tyne/issues/101",
                "escaped": false,
                "rawUrl": "https://github.com/tyne-chat/tyne/issues/101",
                "source": "tyne/101"
            },
            {"type": "Text", "content": "."}
        ]})
    );
}

#[test]
fn code_is_left_alone() {
    for input in ["`tyne/101`", "```\ntyne/101\n```"] {
        assert_eq!(links(&tree(input, ParserFlags::ALL)), [], "{input}");
    }
}

#[test]
fn links_are_not_linked_again() {
    for (input, url) in [
        ("[tyne/101](https://example.com)", "https://example.com"),
        (
            "https://github.com/tyne-chat/tyne/issues/101",
            "https://github.com/tyne-chat/tyne/issues/101",
        ),
        ("<https://example.com/tyne/1>", "https://example.com/tyne/1"),
    ] {
        let found = links(&tree(input, ParserFlags::ALL));
        assert_eq!(found.len(), 1, "{input}: {found:?}");
        assert_eq!(found[0].1, url, "{input}");
    }
}

#[test]
fn shorthands_inside_blocks_and_formatting_link() {
    let input = "> tyne/1\n- tyne/2\n# tyne/3\n||tyne/4||\n-# tyne/5\n\n| a |\n| - |\n| tyne/6 |";
    let mut found: Vec<String> = links(&tree(input, ParserFlags::ALL))
        .into_iter()
        .map(|(source, _)| source)
        .collect();
    found.sort();
    assert_eq!(
        found,
        ["tyne/1", "tyne/2", "tyne/3", "tyne/4", "tyne/5", "tyne/6"]
    );
}

#[test]
fn shorthands_follow_the_autolink_flag() {
    let flags = ParserFlags::ALL & !ParserFlags::ALLOW_AUTOLINKS;
    assert_eq!(links(&tree("see tyne/101", flags)), []);
}

#[test]
fn the_binary_tree_links_shorthands_too() {
    let url = "https://github.com/tyne-chat/tyne/issues/101";
    assert!(contains(&binary("see tyne/101"), url));

    let mut parser = MarkdownParser::new(ParserFlags::ALL, EmojiContext::parse(""));
    let nodes = parser.parse("see tyne/101").expect("parses");
    assert!(!contains(
        &fluxer_markdown_parser::binary::write_ast_binary(&nodes),
        url
    ));
}

#[test]
fn push_previews_keep_the_shorthand_as_typed() {
    let options = PlaintextOptions {
        preserve_markdown: true,
        include_link_urls: true,
        ..PlaintextOptions::default()
    };
    let result = parse_and_render_plaintext("see tyne/101", ParserFlags::ALL, "", &options)
        .expect("plaintext");
    assert_eq!(result, "see tyne/101");
}

#[test]
fn linking_stays_within_the_node_limit() {
    let input = "tyne/1 tyne/2 tyne/3\n".repeat(4_000);
    let found = links(&tree(&input, ParserFlags::ALL)).len();
    assert!(found > 0);
    assert!(found * 3 <= MAX_AST_NODES, "{found} links");
}
