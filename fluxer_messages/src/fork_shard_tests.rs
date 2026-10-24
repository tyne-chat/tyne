// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: tests of what the fork adds to the message responses this shard builds.

use super::*;
use fluxer_svc::transport::InMemoryTransport;
use serde_json::json;

fn shard() -> MessagesShard<InMemoryTransport> {
    MessagesShard {
        storage: MessagesStorage::Deletions(DeletedMessageKeys::default()),
        transport: InMemoryTransport::new(),
    }
}

fn options() -> ResponseBuildOptions {
    ResponseBuildOptions {
        viewer_user_id: 1,
        source_guild_id: None,
        message_history_cutoff_ms: None,
        can_read_message_history: true,
        media_endpoint: "https://media.example.com".to_owned(),
        media_proxy_secret_key: "secret".to_owned(),
        attachment_url_secret: Vec::new(),
        include_reactions: false,
        nonce: None,
        tts: false,
        include_hidden: false,
        threads_mask: false,
        excluded_types: Vec::new(),
        attachment_decay: true,
        instance_name: "test".to_owned(),
    }
}

fn message(fields: serde_json::Value) -> Message {
    let mut row = json!({
        "message_id": "10",
        "channel_id": "20",
        "bucket": 1,
        "author_id": "30",
        "type": 0,
        "version": 0,
    });
    row.as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    serde_json::from_value(row).unwrap()
}

fn persona_mentions_of(message: &Message) -> serde_json::Value {
    let response =
        shard().map_message_response(message, &options(), &ResponseContext::default(), true);
    serde_json::to_value(response).unwrap()["persona_mentions"].clone()
}

fn pair(user_id: &str, persona_id: &str) -> serde_json::Value {
    json!({"user_id": user_id, "persona_id": persona_id})
}

#[test]
fn a_response_names_the_personas_its_content_mentions() {
    let message = message(json!({
        "content": "hi <@40:41> and <@!50:51>, again <@40:41>, and <@60>",
        "mention_users": ["40", "50", "60"],
    }));

    assert_eq!(
        persona_mentions_of(&message),
        json!([pair("40", "41"), pair("50", "51")])
    );
}

#[test]
fn a_response_names_the_personas_its_embeds_and_forwards_mention() {
    let message = message(json!({
        "content": "",
        "embeds": [{
            "title": "title <@50:51>",
            "author": {"name": "author <@52:53>"},
            "image": {"description": "image <@54:55>"},
            "fields": [{"name": "field <@60:61>", "value": "value <@70:71>"}],
            "children": [{"description": "child <@72:73>"}]
        }],
        "message_snapshots": [{
            "content": "snapshot <@80:81>",
            "embeds": [{"footer": {"text": "snapshot embed <@90:91>"}}]
        }]
    }));

    assert_eq!(
        persona_mentions_of(&message),
        json!([
            pair("50", "51"),
            pair("52", "53"),
            pair("54", "55"),
            pair("60", "61"),
            pair("70", "71"),
            pair("72", "73"),
            pair("80", "81"),
            pair("90", "91"),
        ])
    );
}

#[test]
fn mentions_the_parser_does_not_read_as_mentions_name_no_persona() {
    let message = message(json!({
        "content": "`<@40:41>`\n```\n<@42:43>\n```\nhttps://example.com/<@44:45> \\<@46:47> \
                    <@48:0> <@49:bob_the_fox>",
    }));

    assert_eq!(persona_mentions_of(&message), serde_json::Value::Null);
}

#[test]
fn a_reply_names_the_personas_of_the_message_it_answers_on_that_message() {
    let parent = message(json!({
        "message_id": "9",
        "content": "parent <@40:41>",
    }));
    let reply = message(json!({
        "content": "reply <@50:51>",
        "message_reference": {"channel_id": "20", "message_id": "9", "type": 0},
    }));
    let context = ResponseContext {
        referenced_messages: [((20, 9), parent)].into_iter().collect(),
        ..ResponseContext::default()
    };

    let response =
        serde_json::to_value(shard().map_message_response(&reply, &options(), &context, true))
            .unwrap();

    assert_eq!(response["persona_mentions"], json!([pair("50", "51")]));
    assert_eq!(
        response["referenced_message"]["persona_mentions"],
        json!([pair("40", "41")])
    );
}

fn reaction(
    user_id: i64,
    emoji_id: i64,
    emoji_name: &str,
    created_at_ms: i64,
    persona_id: Option<i64>,
) -> MessageReactionDbRow {
    MessageReactionDbRow {
        user_id,
        emoji_id,
        emoji_name: emoji_name.to_owned(),
        emoji_animated: Some(false),
        created_at: DateTime::<Utc>::from_timestamp_millis(created_at_ms),
        persona_id,
    }
}

#[test]
fn reactions_include_persona_breakdowns() {
    let r1 = reaction(10, 0, "heart", 100, Some(101));
    let r2 = reaction(11, 0, "heart", 200, Some(102));
    let r3 = reaction(10, 0, "heart", 300, Some(103));
    let r4 = reaction(12, 0, "heart", 400, None);

    let mapped = map_reactions(vec![r1.clone(), r2.clone(), r3.clone(), r4.clone()], 10);
    assert_eq!(mapped.len(), 1);
    assert_eq!(mapped[0].count, 4);
    assert_eq!(mapped[0].me, Some(true));
    assert_eq!(mapped[0].me_root, None);
    let personas = mapped[0].persona_reactions.as_ref().unwrap();
    assert_eq!(personas.len(), 3);
    let p101 = personas.iter().find(|p| p.persona_id == "101").unwrap();
    assert_eq!(p101.count, 1);
    assert_eq!(p101.me, Some(true));
    let p102 = personas.iter().find(|p| p.persona_id == "102").unwrap();
    assert_eq!(p102.count, 1);
    assert_eq!(p102.me, None);
    let p103 = personas.iter().find(|p| p.persona_id == "103").unwrap();
    assert_eq!(p103.count, 1);
    assert_eq!(p103.me, Some(true));

    let r5 = reaction(10, 0, "heart", 500, None);
    let mapped = map_reactions(vec![r1, r2, r3, r4, r5], 10);
    assert_eq!(mapped[0].me_root, Some(true));
}
