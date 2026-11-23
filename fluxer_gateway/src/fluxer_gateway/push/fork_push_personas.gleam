// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: personas in push notifications. The API sends a message with the
// persona it was sent as (`subprofile`) and the personas it mentions
// (`mention_personas`), as upstream sends the author and the accounts it
// mentions (push/fork_message.gleam reads both). What a persona lacks comes
// from its account, as in the apps. Hooks: `push/format.gleam` (the author's
// name, the preview's names) and `push/job.gleam` (the icon).

import fluxer_gateway/push/fork_message.{Persona}
import fluxer_gateway/push/message.{type Author, type MessageData, Author}
import gleam/dict.{type Dict}
import gleam/option.{type Option, None, Some}
import gleam/string

// The name of the persona the message was sent as, ahead of the account's
// nickname and names; None when it was sent as the account.
pub fn author_name(data: MessageData) -> Option(String) {
  case data.fork.persona {
    Some(Persona(name:, ..)) -> Some(name)
    None -> None
  }
}

// Persona id => name, for the preview's `<@user:persona>` mentions. A persona
// the message does not name is shown as its account.
pub fn mention_names(data: MessageData) -> Dict(Int, String) {
  dict.from_list(data.fork.mention_personas)
}

// The author whose picture is the notification's icon: the persona's picture
// when the message was sent as one that has a picture, otherwise the
// account's. The API sends a persona's picture as a hash; anything else (a URL
// or a data URI) is not fetched, and the account's picture is used.
pub fn icon_author(data: MessageData) -> Author {
  case data.fork.persona {
    Some(Persona(avatar: Some(hash), ..)) ->
      case is_hash(hash) {
        True -> Author(..data.author, avatar: Some(hash))
        False -> data.author
      }
    _ -> data.author
  }
}

fn is_hash(text: String) -> Bool {
  text != "" && !string.contains(text, ":") && !string.contains(text, "/")
}
