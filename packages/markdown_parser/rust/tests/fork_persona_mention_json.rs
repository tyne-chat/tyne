// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the JSON the web and native parsers hand to the apps names a mention's persona.

use fluxer_markdown_parser::ParserFlags;

fn json(input: &str) -> String {
    fluxer_markdown_parser::parse_markdown_json(input, ParserFlags::ALL, "").expect("parses")
}

#[test]
fn a_persona_mention_carries_its_persona_id() {
    let out = json("hi <@123456:789012>");
    assert!(
        out.contains(r#"{"kind":"User","id":"123456","personaId":"789012"}"#),
        "{out}"
    );
}

#[test]
fn a_plain_user_mention_has_no_persona_id() {
    let out = json("hi <@123456>");
    assert!(out.contains(r#"{"kind":"User","id":"123456"}"#), "{out}");
    assert!(!out.contains("personaId"), "{out}");
}
