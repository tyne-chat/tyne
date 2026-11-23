// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: personas in the session's reaction buffer (`session/reactions.gleam`,
// tyne-chat/tyne#120). A reaction can come from one of the account's personas:
// the API puts `persona_id` and the persona's `subprofile` on
// MESSAGE_REACTION_ADD, and `persona_id` on MESSAGE_REACTION_REMOVE. Upstream's
// buffer knows only the user. Without these helpers, adds sent together as
// MESSAGE_REACTION_ADD_MANY lose their persona, and removing one persona's
// reaction can cancel the buffered add of another persona of the same account.

import fluxer_gateway/core/raw_json.{type RawJson}
import gleam/int
import gleam/json.{type Json}
import gleam/list
import gleam/option.{type Option, None, Some}

const persona_fields = ["persona_id", "subprofile"]

// The persona of a buffered MESSAGE_REACTION_ADD, for its entry in
// MESSAGE_REACTION_ADD_MANY. The account's own reaction has none.
pub fn fields(payload: RawJson) -> List(#(String, Json)) {
  list.filter_map(persona_fields, fn(key) {
    case raw_json.field(payload, key) {
      Ok(value) ->
        case raw_json.to_bits(value) {
          <<"null">> -> Error(Nil)
          _ -> Ok(#(key, raw_json.to_json(value)))
        }
      Error(Nil) -> Error(Nil)
    }
  })
}

// The persona that reacted, or None for the account itself: the API leaves
// `persona_id` out for it, or sends null or "0".
pub fn persona(payload: RawJson) -> Option(String) {
  case raw_json.field(payload, "persona_id") {
    Error(Nil) -> None
    Ok(value) ->
      case raw_json.string(value), raw_json.snowflake(value) {
        Ok(""), _ | Ok("0"), _ | Error(Nil), Error(Nil) -> None
        Ok(text), _ -> Some(text)
        Error(Nil), Ok(found) -> Some(int.to_string(found))
      }
  }
}
