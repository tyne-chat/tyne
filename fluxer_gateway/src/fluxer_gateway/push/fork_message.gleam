// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: what the fork's push code reads from a message beyond upstream's
// `MessageData` (push/message.gleam). It is one field of that record (`fork`),
// decoded with it, so upstream's record, decoder and `empty_data` change by a
// line or two each.
//
// - `persona`: the persona the message was sent as (`subprofile`), for the
//   push's title, author name and icon (push/fork_push_personas.gleam).
// - `mention_personas`: the personas it mentions (`mention_personas`, each a
//   persona as the API returns it), by id, for the preview.

import fluxer_gateway/util/decode as edge
import gleam/dynamic/decode.{type Decoder}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string

// As upstream caps the accounts a push preview names (push/format.gleam).
const max_mention_personas = 50

pub type ForkMessage {
  ForkMessage(persona: Option(Persona), mention_personas: List(#(Int, String)))
}

pub type Persona {
  Persona(name: String, avatar: Option(String))
}

pub fn empty() -> ForkMessage {
  ForkMessage(persona: None, mention_personas: [])
}

pub fn decoder() -> Decoder(ForkMessage) {
  use persona <- decode.then(lenient("subprofile", persona_decoder(), None))
  use mention_personas <- decode.then(
    lenient(
      "mention_personas",
      decode.list(
        decode.one_of(decode.map(mention_decoder(), Some), [
          decode.success(None),
        ]),
      ),
      [],
    ),
  )
  decode.success(ForkMessage(
    persona:,
    mention_personas: mention_personas
      |> option.values
      |> list.take(max_mention_personas),
  ))
}

// A message sent as the account has no `subprofile`, or null; a persona
// without a name is treated as the account, as the apps do.
fn persona_decoder() -> Decoder(Option(Persona)) {
  use name <- decode.then(lenient("name", decode.string, ""))
  use avatar <- decode.then(lenient(
    "avatar",
    decode.map(decode.string, Some),
    None,
  ))
  case name {
    "" -> decode.success(None)
    _ -> decode.success(Some(Persona(name:, avatar: nonempty(avatar))))
  }
}

fn mention_decoder() -> Decoder(#(Int, String)) {
  use id <- decode.field("id", edge.snowflake())
  use name <- decode.field("name", decode.string)
  case name {
    "" -> decode.failure(#(id, name), "persona name")
    _ -> decode.success(#(id, name))
  }
}

fn nonempty(value: Option(String)) -> Option(String) {
  option.then(value, fn(text) {
    case string.is_empty(text) {
      True -> None
      False -> Some(text)
    }
  })
}

fn lenient(name: String, inner: Decoder(a), default: a) -> Decoder(a) {
  decode.optional_field(
    name,
    default,
    decode.one_of(inner, [decode.success(default)]),
    decode.success,
  )
}
