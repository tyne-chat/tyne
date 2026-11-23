// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: pushes for messages in threads in DMs (tyne-chat/tyne#699):
// fork/dm_thread_presence.gleam (the envelope at the presence) and
// fork/dm_thread_push.gleam (the push). The E2E spec
// e2e/web/gateway/fork-gateway-dm-threads.spec.ts runs the same paths on a
// stack.

import fluxer_gateway/core/clock
import fluxer_gateway/core/id
import fluxer_gateway/core/json_tree.{type JsonTree}
import fluxer_gateway/core/raw_json.{type RawJson}
import fluxer_gateway/fork/dm_thread_presence
import fluxer_gateway/fork/dm_thread_push
import fluxer_gateway/presence/protocol
import fluxer_gateway/presence/push_buffer.{type DmMessage, DmMessage}
import fluxer_gateway/push/format
import fluxer_gateway/push/job
import fluxer_gateway/push/message.{type MessageCreate}
import fluxer_gateway/push/read_state
import fluxer_gateway/push/rule
import fluxer_gateway/push/throttle
import gleam/bit_array
import gleam/dynamic/decode
import gleam/erlang/process
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import support/push_api_stub as stub
import support/push_throttle

const dm = 1_400_000_000_000_000_100

const thread = 1_400_000_000_000_000_700

const message_id = 1_400_000_000_000_000_701

const author = 1_400_000_000_000_000_007

const follower = 1_400_000_000_000_000_001

// The job a 1:1 DM thread's message is pushed as. fluxer_push's
// fork_dm_thread_push.rs decodes this same body with the push service's types,
// which refuse a key given twice.
const thread_message_body =
  "{\"channel_id\":\"1400000000000000100\",\"config_version\":0,\"guild_id\":\"0\",\"message_id\":\"1400000000000000701\",\"notification\":{\"author_name\":\"Wren\",\"badge\":\"http://localhost:8088/marketing/branding/symbol-white.svg\",\"body\":\"hi\",\"conversation_kind\":\"dm\",\"fork_thread_id\":\"1400000000000000700\",\"fork_thread_name\":\"Trip planning\",\"icon\":\"http://localhost:8088/avatars/3.png\",\"image_url\":null,\"notification_tag\":\"channel:1400000000000000700\",\"tag\":\"channel:1400000000000000700:1400000000000000701\",\"title\":\"Wren (Trip planning)\",\"url\":\"/channels/@me/1400000000000000100/1400000000000000701\"},\"user_ids\":[\"1400000000000000001\"],\"v\":1}"

// The copy of a thread message the API puts in the envelope's `push`: a
// message in the parent DM, with the thread.
fn pushed(extra: String) -> String {
  "{\"id\":\"1400000000000000701\",\"channel_id\":\"1400000000000000100\","
  <> "\"channel_type\":1,\"type\":0,\"content\":\"hi\","
  <> "\"author\":{\"id\":\"1400000000000000007\",\"username\":\"Wren\"},"
  <> "\"fork_thread_id\":\"1400000000000000700\""
  <> extra
  <> "}"
}

fn named(name: String) -> String {
  pushed(",\"fork_thread_name\":" <> json.to_string(json.string(name)))
}

// A message in the parent DM itself.
fn in_dm(id_text: String) -> String {
  "{\"id\":\""
  <> id_text
  <> "\",\"channel_id\":\"1400000000000000100\","
  <> "\"channel_type\":1,\"type\":0,\"content\":\"hi\","
  <> "\"author\":{\"id\":\"1400000000000000007\",\"username\":\"Wren\"}}"
}

fn envelope(kind: String, push: Option(String)) -> RawJson {
  let push_field = case push {
    Some(message) -> ",\"push\":{\"message\":" <> message <> "}"
    None -> ""
  }
  raw_json.wrap_string(
    "{\"t\":\""
    <> kind
    <> "\",\"d\":{\"id\":\"1400000000000000701\","
    <> "\"channel_id\":\"1400000000000000700\","
    <> "\"message_id\":\"1400000000000000701\"}"
    <> push_field
    <> "}",
  )
}

// What upstream's `presence/rpc.gleam` makes of a DM message, as far as the
// fork relies on it: its author, channel and id.
fn dm_message(
  fields: Result(List(#(String, JsonTree)), Nil),
  data: RawJson,
) -> Option(DmMessage) {
  let tree = case fields {
    Ok(found) -> json_tree.Object(found)
    Error(Nil) -> json_tree.Null
  }
  let snowflake = fn(key) {
    json_tree.snowflake_field(tree, key) |> option.from_result
  }
  case
    json_tree.field(tree, "author")
    |> result.try(json_tree.snowflake_field(_, "id"))
  {
    Ok(author) ->
      Some(DmMessage(
        author:,
        channel: snowflake("channel_id"),
        message: snowflake("id"),
        suppressed: False,
        data:,
      ))
    Error(Nil) -> None
  }
}

fn user_event(name: String, data: RawJson) -> protocol.UserEvent {
  dm_thread_presence.user_event(name, data, dm_message)
}

fn text(raw: RawJson) -> String {
  let assert Ok(found) = bit_array.to_string(raw_json.to_bits(raw))
  found
}

fn create(message_text: String) -> MessageCreate {
  let assert Ok(raw) =
    raw_json.read(raw_json.wrap_string(message_text), decode.dynamic)
  let assert Ok(data) = message.decode_data(raw)
  let assert Ok(recipient) = id.user_id(follower)
  let assert Ok(sender) = id.user_id(author)
  let assert Ok(created) =
    message.private_message(
      data,
      recipient,
      sender,
      format.private_markdown_context(data),
    )
  created
}

fn built(created: MessageCreate) -> job.Job {
  let assert Ok(found) =
    job.for_users(job.message_template(created), rule.Direct, [follower])
  found
}

fn body(created: MessageCreate) -> String {
  let assert Ok(found) = bit_array.to_string(job.body(built(created)))
  found
}

fn notification_field(created: MessageCreate, name: String) -> Option(String) {
  let assert Ok(parsed) = json.parse(body(created), decode.dynamic)
  decode.run(parsed, decode.at(["notification", name], decode.string))
  |> option.from_result
}

// The presence and the envelope.

pub fn a_thread_message_with_a_push_is_held_under_the_thread_test() {
  let assert protocol.MessageCreate(Some(found)) =
    user_event(
      "FORK_DM_THREAD_EVENT",
      envelope("MESSAGE_CREATE", Some(pushed(""))),
    )
  assert found.channel == Some(thread)
  assert found.message == Some(message_id)
  assert found.author == author
  // What is pushed is the copy in the parent DM.
  assert text(found.data) == pushed("")
}

// The author, and a follower who muted the thread, get no `push`.
pub fn an_envelope_without_a_push_makes_no_push_test() {
  assert user_event("FORK_DM_THREAD_EVENT", envelope("MESSAGE_CREATE", None))
    == protocol.OtherEvent
  assert user_event(
      "FORK_DM_THREAD_EVENT",
      envelope("TYPING_START", Some(pushed(""))),
    )
    == protocol.OtherEvent
  assert user_event(
      "TYPING_START",
      envelope("MESSAGE_CREATE", Some(pushed(""))),
    )
    == protocol.OtherEvent
}

pub fn a_thread_ack_is_an_ack_of_the_thread_test() {
  assert user_event("FORK_DM_THREAD_EVENT", envelope("MESSAGE_ACK", None))
    == protocol.MessageAck(channel: Some(thread), message: Some(message_id))
}

pub fn an_account_without_sessions_gets_the_push_copy_test() {
  let calls = process.new_subject()
  let assert Ok(user) = id.user_id(follower)
  let record = fn(to, name, _fields, message) {
    process.send(calls, #(to, name, text(message)))
  }
  dm_thread_presence.offline_dispatch(
    user,
    "FORK_DM_THREAD_EVENT",
    envelope("MESSAGE_CREATE", Some(pushed(""))),
    record,
  )
  assert process.receive(calls, 0) == Ok(#(user, "MESSAGE_CREATE", pushed("")))
  dm_thread_presence.offline_dispatch(
    user,
    "FORK_DM_THREAD_EVENT",
    envelope("MESSAGE_CREATE", None),
    record,
  )
  dm_thread_presence.offline_dispatch(
    user,
    "FORK_DM_THREAD_EVENT",
    envelope("MESSAGE_ACK", None),
    record,
  )
  dm_thread_presence.offline_dispatch(
    user,
    "MESSAGE_CREATE",
    envelope("MESSAGE_CREATE", Some(pushed(""))),
    record,
  )
  assert process.receive(calls, 0) == Error(Nil)
}

// A push held back for an online follower is dropped when the thread is read,
// not when the parent DM is (tyne-chat/tyne#907).
pub fn reading_the_thread_drops_its_held_push_and_reading_the_dm_does_not_test() {
  let assert protocol.MessageCreate(Some(found)) =
    user_event(
      "FORK_DM_THREAD_EVENT",
      envelope("MESSAGE_CREATE", Some(pushed(""))),
    )
  let #(held, action) =
    push_buffer.on_message(
      push_buffer.new(),
      found,
      follower,
      False,
      0,
      push_buffer.default_limits(),
    )
  assert action == push_buffer.Buffered(0)
  let #(_, after_dm) =
    push_buffer.flush(push_buffer.on_ack(held, dm, message_id + 1))
  assert list.map(after_dm, fn(pending) { text(pending.data) }) == [pushed("")]
  let #(_, after_thread) =
    push_buffer.flush(push_buffer.on_ack(held, thread, message_id))
  assert after_thread == []
}

// The push.

pub fn the_push_is_titled_with_the_thread_test() {
  assert notification_field(create(named("Trip planning")), "title")
    == Some("Wren (Trip planning)")
  let in_group =
    pushed(
      ",\"fork_thread_name\":\"Trip planning\","
      <> "\"fork_thread_context\":\"Trip planning, Book club\"",
    )
  assert notification_field(create(in_group), "title")
    == Some("Wren (Trip planning, Book club)")
  let empty_context =
    pushed(
      ",\"fork_thread_name\":\"Trip planning\",\"fork_thread_context\":\"\"",
    )
  assert notification_field(create(empty_context), "title")
    == Some("Wren (Trip planning)")
  // Without a name the title is upstream's.
  assert notification_field(create(pushed("")), "title") == Some("Wren")
}

// The thread's tags replace the DM's: the push service refuses a key given
// twice. The job's channel and url stay the DM, so older apps open the DM.
pub fn the_push_has_the_thread_fields_and_tags_test() {
  assert body(create(named("Trip planning"))) == thread_message_body
}

pub fn a_thread_without_a_name_has_no_name_field_test() {
  let created = create(named(""))
  assert notification_field(created, "fork_thread_id")
    == Some("1400000000000000700")
  assert notification_field(created, "fork_thread_name") == None
}

pub fn a_dm_message_keeps_upstreams_push_test() {
  let created = create(in_dm("1400000000000000701"))
  assert notification_field(created, "tag")
    == Some("channel:1400000000000000100:1400000000000000701")
  assert notification_field(created, "fork_thread_id") == None
  assert dm_thread_push.read_channel(created) == dm
  assert built(created).channel == dm
}

// The outbox files the job under the thread, so reading the thread truncates
// it and reading the DM does not (tyne-chat/tyne#907).
pub fn the_outbox_files_a_thread_push_under_the_thread_test() {
  let created = create(named("Trip planning"))
  assert dm_thread_push.read_channel(created) == thread
  assert built(created).channel == thread
  assert built(created).message == message_id
}

// A push buffered long enough to be checked against the API's read state is
// checked against the thread's. The API here has the thread read and the DM
// not; a later DM message, published after it, shows the check has run.
pub fn a_stale_buffered_push_checks_the_threads_read_state_test() {
  push_throttle.calm(throttle.ReadState)
  let api =
    stub.start(
      stub.only("get_read_state", fn(call) {
        let mark = case
          decode.run(call.body, decode.at(["channel_id"], decode.string))
        {
          Ok("1400000000000000700") -> "1400000000000000701"
          _ -> "0"
        }
        stub.data(json.object([#("last_message_id", json.string(mark))]))
      }),
    )
  let out = process.new_subject()
  let stale = fn(created) {
    read_state.Buffered(
      create: created,
      buffered_at_ms: clock.system_ms() - 301_000,
    )
  }
  read_state.handle_buffered(
    [
      stale(create(named("Trip planning"))),
      stale(create(in_dm("1400000000000000702"))),
    ],
    fn(created: MessageCreate) { process.send(out, created.message) },
  )
  assert process.receive(out, 5000) == Ok(1_400_000_000_000_000_702)
  stub.stop(api)
}

// The converse: the parent DM read past the thread message does not
// suppress its push.
pub fn a_read_of_the_dm_does_not_suppress_a_thread_push_test() {
  push_throttle.calm(throttle.ReadState)
  let api =
    stub.start(
      stub.only("get_read_state", fn(call) {
        let mark = case
          decode.run(call.body, decode.at(["channel_id"], decode.string))
        {
          Ok("1400000000000000100") -> "1400000000000000799"
          _ -> "0"
        }
        stub.data(json.object([#("last_message_id", json.string(mark))]))
      }),
    )
  let out = process.new_subject()
  read_state.handle_buffered(
    [
      read_state.Buffered(
        create: create(named("Trip planning")),
        buffered_at_ms: clock.system_ms() - 301_000,
      ),
    ],
    fn(created: MessageCreate) { process.send(out, created.message) },
  )
  assert process.receive(out, 5000) == Ok(message_id)
  stub.stop(api)
}
