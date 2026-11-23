// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: persona mentions (`<@user:persona>`) in the push preview. The gateway passes the names of
//! the personas a message mentions (push/fork_push_personas.gleam); a persona it does not name is
//! shown as its account, as the apps show it.

use md_plaintext::{MAX_CONTEXT_NAME_ENTRIES, PreviewContext, PreviewError, render_push_preview};

fn context() -> PreviewContext {
    PreviewContext {
        users: vec![(1, "alice".to_owned())],
        personas: vec![(999, "Bob the Fox".to_owned())],
        ..PreviewContext::default()
    }
}

#[test]
fn names_a_mentioned_persona() {
    let rendered = render_push_preview(b"hi <@1:999> and <@1>", context()).unwrap();
    assert_eq!(rendered, "hi @Bob the Fox and @alice");
}

#[test]
fn a_persona_it_was_not_given_falls_back_to_the_account() {
    let rendered = render_push_preview(b"hi <@1:998>", context()).unwrap();
    assert_eq!(rendered, "hi @alice");
    let without = PreviewContext {
        users: vec![(1, "alice".to_owned())],
        ..PreviewContext::default()
    };
    assert_eq!(
        render_push_preview(b"hi <@1:999>", without).unwrap(),
        "hi @alice"
    );
}

#[test]
fn a_persona_name_does_not_name_the_account() {
    let rendered = render_push_preview(b"<@999>", context()).unwrap();
    assert_eq!(rendered, "@999");
}

#[test]
fn rejects_too_many_persona_names() {
    let personas = (0..=MAX_CONTEXT_NAME_ENTRIES as u64)
        .map(|id| (id, "x".to_owned()))
        .collect();
    let context = PreviewContext {
        personas,
        ..PreviewContext::default()
    };
    assert_eq!(
        render_push_preview(b"x", context),
        Err(PreviewError::TooManyNames)
    );
}
