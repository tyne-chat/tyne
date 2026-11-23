// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the push records that cross gateway nodes and carry the fork's fields
// (tyne-chat/tyne#905). `push/server.gleam` casts a `MessageCreate` (and
// requeues a job) to the push owner's node with its `MessageData`, whose first
// field is the fork's `ForkMessage`, and its `PreviewContext`, whose first
// field is the fork's `personas`. During a deploy's handover old and new nodes
// exchange them, so both must lay them out alike. Upstream's wire-epoch test
// (`docs/wire_epoch_test.gleam`) fingerprints only the top-level message types,
// not the records inside them, so this test fingerprints `Waiting` (what
// `Requeue` carries), `MessageCreate` and every record they carry (upstream's
// and the fork's), with that test's helper,
// and fails when one changes, whoever changed it. Other cross-node records
// nested in upstream's message types are upstream's concern and not covered.
//
// When it fails: a deploy that changes one of these layouts must restart the
// gateway rather than hand it over (the old and the new node would misread
// each other's pushes), unless the change keeps old casts readable. Note that
// on the deploy, then record the new fingerprints below (the failure prints
// them) in `test/fixtures/fork_wire_records.txt`. Do not bump upstream's
// `wire_epoch` for a fork change: upstream hands those numbers out.

import fluxer_gateway/docs/wire_epoch_test
import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/int
import gleam/list
import gleam/string

const fixture = "test/fixtures/fork_wire_records.txt"

const records = [
  #("src/fluxer_gateway/push/server.gleam", "Waiting"),
  #("src/fluxer_gateway/push/message.gleam", "MessageCreate"),
  #("src/fluxer_gateway/push/message.gleam", "MessageData"),
  #("src/fluxer_gateway/push/message.gleam", "Author"),
  #("src/fluxer_gateway/push/message.gleam", "Mention"),
  #("src/fluxer_gateway/push/message.gleam", "Media"),
  #("src/fluxer_gateway/push/message.gleam", "EmbedField"),
  #("src/fluxer_gateway/push/message.gleam", "Embed"),
  #("src/fluxer_gateway/push/message.gleam", "Snapshot"),
  #("src/fluxer_gateway/push/message.gleam", "MentionChannel"),
  #("src/fluxer_gateway/push/message.gleam", "ThreadPush"),
  #("src/fluxer_gateway/push/settings.gleam", "ThreadMember"),
  #("src/fluxer_gateway/push/settings.gleam", "Mute"),
  #("src/fluxer_gateway/push/message.gleam", "Prefilter"),
  #("src/fluxer_gateway/push/message.gleam", "LargeGuild"),
  #("src/fluxer_gateway/push/fork_message.gleam", "ForkMessage"),
  #("src/fluxer_gateway/push/fork_message.gleam", "Persona"),
  #("src/fluxer_gateway/push/fork_message.gleam", "Thread"),
  #("src/fluxer_gateway/push/markdown.gleam", "PreviewContext"),
]

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn line(entry: #(String, String)) -> String {
  entry.0
  <> " "
  <> entry.1
  <> " "
  <> int.to_string(wire_epoch_test.type_fingerprint(entry))
}

pub fn the_fork_s_cross_node_push_records_are_unchanged_test() {
  let assert Ok(bytes) = read_file(fixture)
  let assert Ok(text) = bit_array.to_string(bytes)
  let recorded =
    string.split(text, "\n")
    |> list.map(string.trim)
    |> list.filter(fn(found) { found != "" && !string.starts_with(found, "#") })
  let current = list.map(records, line)
  assert recorded == current
    as {
      "A push record that crosses gateway nodes changed (see this test's "
      <> "comment: such a deploy restarts the gateway). Record:\n"
      <> string.join(current, "\n")
    }
}
