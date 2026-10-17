// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the persona pairs the mention parser records alongside their accounts.

use fluxer_messages::mention_extractor::{
    MessageMentions, extend_mentions_from_markdown, extract_mentions_from_markdown,
};
use std::collections::HashSet;

#[test]
fn a_persona_mention_records_the_pair_and_its_account() {
    let mentions = extract_mentions_from_markdown(Some("hi <@40:41> <@!50:51> <@60>"));

    assert_eq!(mentions.users, HashSet::from([40, 50, 60]));
    assert_eq!(mentions.personas, HashSet::from([(40, 41), (50, 51)]));
}

#[test]
fn a_persona_id_that_is_not_a_number_or_is_zero_records_only_the_account() {
    let mentions = extract_mentions_from_markdown(Some("<@40:bob_the_fox> <@50:0>"));

    assert_eq!(mentions.users, HashSet::from([40, 50]));
    assert!(mentions.personas.is_empty());
}

#[test]
fn extending_keeps_the_pairs_of_every_text() {
    let mut mentions = MessageMentions::default();
    extend_mentions_from_markdown(Some("<@40:41>"), &mut mentions);
    extend_mentions_from_markdown(Some("`<@50:51>` <@60:61>"), &mut mentions);

    assert_eq!(mentions.personas, HashSet::from([(40, 41), (60, 61)]));
}

#[test]
fn the_extraction_response_lists_the_pairs_in_order() {
    let response = fluxer_messages::types::ExtractedMentionsResponse::from(
        extract_mentions_from_markdown(Some("<@50:51> <@40:42> <@40:41> <@60>")),
    );

    let json = serde_json::to_value(&response).unwrap();
    assert_eq!(
        json["personas"],
        serde_json::json!([
            {"user_id": "40", "persona_id": "41"},
            {"user_id": "40", "persona_id": "42"},
            {"user_id": "50", "persona_id": "51"},
        ])
    );
}

#[test]
fn an_extraction_without_persona_mentions_sends_no_pairs() {
    let response = fluxer_messages::types::ExtractedMentionsResponse::from(
        extract_mentions_from_markdown(Some("<@60>")),
    );

    assert!(
        serde_json::to_value(&response)
            .unwrap()
            .get("personas")
            .is_none()
    );
}
