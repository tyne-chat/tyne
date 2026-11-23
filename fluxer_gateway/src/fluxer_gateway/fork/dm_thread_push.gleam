// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the push of a message in a thread in a DM or group DM
// (tyne-chat/tyne#699). The presence gets it from the thread's envelope
// (fork/dm_thread_presence.gleam) as a message in the parent DM, with the
// thread in `fork_thread_id`, `fork_thread_name` and `fork_thread_context`
// (push/fork_message.gleam). Its push:
//
// - is titled "Author (Thread)", or "Author (Thread, Group)" in a named group
//   DM, as the API words `fork_thread_context`;
// - carries `fork_thread_id` and `fork_thread_name` for apps that know DM
//   threads, and the thread's `tag` and `notification_tag` in place of the
//   DM's (the push service refuses a key given twice), while its channel_id
//   and url stay the DM, so older apps open the DM;
// - is read under the thread: the outbox files the job under the thread, and
//   a buffered push checks the thread's read state, so reading the thread
//   drops it and reading the DM does not.
//
// Hooks: push/format.gleam (`title`), push/job.gleam (`notification`, the
// outbox key in `message_template`), push/read_state.gleam (the stale-read
// check).

import fluxer_gateway/push/fork_message.{Thread}
import fluxer_gateway/push/message.{type MessageCreate, type MessageData}
import gleam/json.{type Json}
import gleam/list
import gleam/option.{None, Some}

pub fn title(
  author_name: String,
  data: MessageData,
  guild: Int,
  upstream: fn() -> String,
) -> String {
  case guild, data.fork.thread {
    0, Some(Thread(context: Some(context), ..)) ->
      author_name <> " (" <> context <> ")"
    0, Some(Thread(name: Some(name), ..)) -> author_name <> " (" <> name <> ")"
    _, _ -> upstream()
  }
}

// The notification's tags and fields for a message in a DM thread; any other
// message's are upstream's.
pub fn notification(
  common: List(#(String, Json)),
  data: MessageData,
  message_text: String,
) -> List(#(String, Json)) {
  case data.fork.thread {
    None -> common
    Some(Thread(id_text:, name:, ..)) -> {
      let tagged =
        common
        |> list.key_set(
          "tag",
          json.string("channel:" <> id_text <> ":" <> message_text),
        )
        |> list.key_set("notification_tag", json.string("channel:" <> id_text))
      let thread_name = case name {
        Some(name) -> [#("fork_thread_name", json.string(name))]
        None -> []
      }
      [#("fork_thread_id", json.string(id_text)), ..thread_name]
      |> list.append(tagged)
    }
  }
}

// The channel a pushed message is read in: its DM thread when it has one,
// else its own channel.
pub fn read_channel(create: MessageCreate) -> Int {
  case create.guild, create.data.fork.thread {
    0, Some(Thread(id:, ..)) -> id
    _, _ -> create.channel
  }
}
