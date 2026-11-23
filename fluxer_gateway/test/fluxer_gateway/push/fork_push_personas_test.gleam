// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: personas in push notifications (push/fork_push_personas.gleam,
// push/fork_message.gleam): the title and author name are the persona's, the
// icon its picture, and the preview names the personas a message mentions.
// What a persona lacks comes from its account.

import fluxer_gateway/core/id
import fluxer_gateway/core/raw_json
import fluxer_gateway/push/fork_push_personas
import fluxer_gateway/push/format
import fluxer_gateway/push/job
import fluxer_gateway/push/message.{type MessageCreate, type MessageData}
import fluxer_gateway/push/rule
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{Some}
import gleam/string

const author = 1_400_000_000_000_000_007

const recipient = 1_400_000_000_000_000_001

const author_json =
  "{\"id\":\"1400000000000000007\",\"username\":\"alice\",\"avatar\":\"acc0\"}"

// A DM message as the API sends it, with `extra` fields added.
fn data(content: String, extra: String) -> MessageData {
  let text =
    "{\"id\":\"1400000000000000500\",\"channel_id\":\"1400000000000000100\","
    <> "\"channel_type\":1,\"type\":0,\"content\":"
    <> json.to_string(json.string(content))
    <> ",\"author\":"
    <> author_json
    <> ",\"mentions\":[{\"id\":\"1400000000000000007\",\"username\":\"alice\"}]"
    <> extra
    <> "}"
  let assert Ok(raw) = raw_json.read(raw_json.wrap_string(text), decode.dynamic)
  let assert Ok(decoded) = message.decode_data(raw)
  decoded
}

fn sent_as(persona: String) -> MessageData {
  data("hello", ",\"subprofile\":" <> persona)
}

fn preview(found: MessageData) -> String {
  format.preview(found, format.private_markdown_context(found)).body
}

fn author_name(found: MessageData) -> String {
  format.author_name(found, format.private_markdown_context(found))
}

fn create(found: MessageData) -> MessageCreate {
  let assert Ok(recipient) = id.user_id(recipient)
  let assert Ok(author) = id.user_id(author)
  let assert Ok(created) =
    message.private_message(
      found,
      recipient,
      author,
      format.private_markdown_context(found),
    )
  created
}

// The notification of the push job the gateway would publish.
fn notification(found: MessageData) -> Dynamic {
  let assert Ok(built) =
    job.for_users(job.message_template(create(found)), rule.Direct, [recipient])
  let assert Ok(body) =
    raw_json.read(raw_json.wrap(job.body(built)), decode.dynamic)
  let assert Ok(notification) =
    decode.run(body, decode.at(["notification"], decode.dynamic))
  notification
}

fn field(notification: Dynamic, name: String) -> String {
  let assert Ok(value) =
    decode.run(notification, decode.at([name], decode.string))
  value
}

fn account_icon() -> String {
  format.avatar_url("1400000000000000007", "acc0")
}

pub fn a_mentioned_persona_is_named_in_the_preview_test() {
  let found =
    data(
      "hi <@1400000000000000007:999>",
      ",\"mention_personas\":[{\"id\":\"999\",\"name\":\"Bob the Fox\"}]",
    )
  assert preview(found) == "hi @Bob the Fox"
  assert field(notification(found), "body") == "hi @Bob the Fox"
}

pub fn a_persona_the_message_does_not_name_falls_back_to_the_account_test() {
  assert preview(data("hi <@1400000000000000007:999>", "")) == "hi @alice"
}

pub fn the_account_keeps_its_name_in_the_preview_test() {
  let found =
    data(
      "hi <@1400000000000000007>",
      ",\"mention_personas\":[{\"id\":\"999\",\"name\":\"Bob the Fox\"}]",
    )
  assert preview(found) == "hi @alice"
}

pub fn mention_names_ignore_malformed_entries_test() {
  let found =
    data(
      "",
      ",\"mention_personas\":[{\"id\":\"7\",\"name\":\"Ada\"},"
        <> "{\"id\":\"8\",\"name\":\"\"},{\"id\":\"x\",\"name\":\"Bad\"},"
        <> "{\"name\":\"No id\"},\"not a persona\",null]",
    )
  assert fork_push_personas.mention_names(found)
    == dict.from_list([#(7, "Ada")])
  assert dict.is_empty(
    fork_push_personas.mention_names(data("", ",\"mention_personas\":null")),
  )
  assert dict.is_empty(fork_push_personas.mention_names(data("", "")))
}

// As upstream names at most 50 mentioned accounts in a preview.
pub fn at_most_50_mentioned_personas_are_named_test() {
  let entries =
    int.range(1, 61, [], fn(acc, n) {
      ["{\"id\":\"" <> int.to_string(n) <> "\",\"name\":\"P\"}", ..acc]
    })
    |> list.reverse
    |> string.join(",")
  let found = data("", ",\"mention_personas\":[" <> entries <> "]")
  let names = fork_push_personas.mention_names(found)
  assert dict.size(names) == 50
  assert dict.has_key(names, 50)
  assert !dict.has_key(names, 51)
}

pub fn the_title_names_the_persona_a_message_was_sent_as_test() {
  let found = sent_as("{\"id\":\"999\",\"name\":\"Bob the Fox\"}")
  assert author_name(found) == "Bob the Fox"
  let pushed = notification(found)
  assert field(pushed, "title") == "Bob the Fox"
  assert field(pushed, "author_name") == "Bob the Fox"
  assert author_name(sent_as("null")) == "alice"
  assert author_name(sent_as("{\"id\":\"999\",\"name\":\"\"}")) == "alice"
  assert author_name(data("hello", "")) == "alice"
}

// The persona's name comes before a nickname the account has in the DM.
pub fn the_persona_comes_before_the_nickname_test() {
  let found =
    data(
      "hello",
      ",\"nicks\":{\"1400000000000000007\":\"Ali\"},"
        <> "\"subprofile\":{\"id\":\"999\",\"name\":\"Bob the Fox\"}",
    )
  assert author_name(found) == "Bob the Fox"
  assert author_name(data(
      "hello",
      ",\"nicks\":{\"1400000000000000007\":\"Ali\"}",
    ))
    == "Ali"
}

pub fn the_icon_is_the_persona_picture_test() {
  let found = sent_as("{\"id\":\"999\",\"name\":\"Bob\",\"avatar\":\"b0b\"}")
  let icon = field(notification(found), "icon")
  assert icon == format.avatar_url("1400000000000000007", "b0b")
  assert icon != account_icon()
}

// The API sends a persona's picture as a hash. A URL or a data URI is never
// fetched (tyne-chat/tyne#905, decision 8): the account's picture is used.
pub fn a_persona_picture_that_is_not_a_hash_shows_the_account_picture_test() {
  [
    "https://images.example.test/bob.png", "http://images.example.test/b.png",
    "data:image/png;base64,AA==",
  ]
  |> list.each(fn(avatar) {
    let found =
      sent_as(
        "{\"id\":\"999\",\"name\":\"Bob\",\"avatar\":"
        <> json.to_string(json.string(avatar))
        <> "}",
      )
    assert field(notification(found), "icon") == account_icon()
  })
}

pub fn a_persona_without_a_picture_shows_the_account_picture_test() {
  assert field(
      notification(sent_as("{\"id\":\"999\",\"name\":\"Bob\"}")),
      "icon",
    )
    == account_icon()
  assert field(
      notification(sent_as("{\"id\":\"999\",\"name\":\"Bob\",\"avatar\":null}")),
      "icon",
    )
    == account_icon()
}

pub fn a_message_sent_as_the_account_keeps_the_account_picture_test() {
  let found = data("hello", "")
  assert fork_push_personas.icon_author(found) == found.author
  assert field(notification(found), "icon") == account_icon()
  assert found.author.avatar == Some("acc0")
}
