// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: what the presence does with the envelope of a thread in a DM or group
// DM (tyne-chat/tyne#699). The API sends each person in the DM every event
// about such a thread as FORK_DM_THREAD_EVENT {t, d, push}, which apps that
// predate DM threads drop. For a new message, `push.message` is the copy to
// push to that person: a message in the parent DM, so older apps open the DM,
// with `fork_thread_id`, `fork_thread_name` and `fork_thread_context`
// (fork/dm_thread_push.gleam builds the push from it). The author and a
// follower who muted the thread get no `push`, so no push.
//
// Hooks: presence/rpc.gleam hands every event it does not know to
// `user_event` (an account with sessions) and to `offline_dispatch` (one
// without, or whose presence cannot be reached).

import fluxer_gateway/core/id.{type UserId}
import fluxer_gateway/core/json_tree.{type JsonTree}
import fluxer_gateway/core/raw_json.{type RawJson}
import fluxer_gateway/presence/protocol.{type UserEvent}
import fluxer_gateway/presence/push_buffer.{type DmMessage, DmMessage}
import gleam/option.{type Option, None}
import gleam/result

pub const event = "FORK_DM_THREAD_EVENT"

type Fields =
  Result(List(#(String, JsonTree)), Nil)

// For an account with sessions: a thread message with a push is a DM message
// for the presence, held back and read under the thread; a thread's ack is an
// ack of the thread, which drops what was held back for it.
pub fn user_event(
  name: String,
  data: RawJson,
  dm_message: fn(Fields, RawJson) -> Option(DmMessage),
) -> UserEvent {
  case name == event, inner(data) {
    True, Ok(#("MESSAGE_CREATE", _)) ->
      case push_message(data) {
        Ok(message) ->
          dm_message(fields(message), message)
          |> option.map(in_thread(_, message))
          |> protocol.MessageCreate
        Error(Nil) -> protocol.OtherEvent
      }
    True, Ok(#("MESSAGE_ACK", ack)) ->
      protocol.MessageAck(
        channel: snowflake(ack, "channel_id"),
        message: snowflake(ack, "message_id"),
      )
    _, _ -> protocol.OtherEvent
  }
}

// For an account without a session to hold it back: the thread message's push
// goes the way of a DM message's (`offline_dispatch` is upstream's, given the
// copy as a MESSAGE_CREATE).
pub fn offline_dispatch(
  user: UserId,
  name: String,
  data: RawJson,
  offline_dispatch: fn(UserId, String, Fields, RawJson) -> Nil,
) -> Nil {
  case name == event, inner(data), push_message(data) {
    True, Ok(#("MESSAGE_CREATE", _)), Ok(message) ->
      offline_dispatch(user, "MESSAGE_CREATE", fields(message), message)
    _, _, _ -> Nil
  }
}

fn inner(data: RawJson) -> Result(#(String, RawJson), Nil) {
  use kind <- result.try(
    raw_json.field(data, "t") |> result.try(raw_json.string),
  )
  use payload <- result.map(raw_json.field(data, "d"))
  #(kind, payload)
}

fn push_message(data: RawJson) -> Result(RawJson, Nil) {
  use push <- result.try(raw_json.field(data, "push"))
  use message <- result.try(raw_json.field(push, "message"))
  case raw_json.fields(message) {
    Ok(_) -> Ok(message)
    Error(Nil) -> Error(Nil)
  }
}

fn in_thread(found: DmMessage, message: RawJson) -> DmMessage {
  case snowflake(message, "fork_thread_id") {
    None -> found
    thread -> DmMessage(..found, channel: thread)
  }
}

fn fields(message: RawJson) -> Fields {
  json_tree.fields(json_tree.from_raw(message))
}

fn snowflake(data: RawJson, key: String) -> Option(Int) {
  raw_json.field(data, key)
  |> result.try(raw_json.snowflake)
  |> option.from_result
}
