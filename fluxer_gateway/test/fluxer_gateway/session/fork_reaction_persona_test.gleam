// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: personas in the session's reaction buffer (tyne-chat/tyne#120):
// adds sent together as MESSAGE_REACTION_ADD_MANY keep their persona, and a
// remove cancels only the buffered add of the same persona
// (session/fork_reaction_persona.gleam, `reactions.fork_cancel`).

import fluxer_gateway/core/dispatch_facts
import fluxer_gateway/core/raw_json.{type RawJson}
import fluxer_gateway/core/session.{Dispatch}
import fluxer_gateway/session/reactions.{Buffered}
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/list
import gleam/option.{type Option, None, Some}
import support/session_harness.{Frame} as h

const persona_b = "1001"

const persona_a = "1002"

fn add(persona: Option(String)) -> RawJson {
  let persona_fields = case persona {
    Some(id) ->
      ",\"persona_id\":\""
      <> id
      <> "\",\"subprofile\":{\"id\":\""
      <> id
      <> "\",\"name\":\"Fox "
      <> id
      <> "\"}"
    None -> ""
  }
  raw_json.wrap_string(
    "{\"channel_id\":\"10\",\"message_id\":\"20\",\"user_id\":\"30\","
    <> "\"emoji\":{\"id\":null,\"name\":\"fox\"}"
    <> persona_fields
    <> "}",
  )
}

fn remove(persona: Option(String)) -> RawJson {
  let persona_field = case persona {
    Some(id) -> ",\"persona_id\":\"" <> id <> "\""
    None -> ",\"persona_id\":null"
  }
  raw_json.wrap_string(
    "{\"channel_id\":\"10\",\"message_id\":\"20\",\"user_id\":\"30\","
    <> "\"emoji\":{\"id\":null,\"name\":\"fox\"}"
    <> persona_field
    <> "}",
  )
}

fn facts(event: String, raw: RawJson) -> dispatch_facts.ReactionFacts {
  let assert dispatch_facts.Reaction(found) =
    dispatch_facts.scan(event, raw).detail
  found
}

fn held(adds: List(RawJson)) -> reactions.Reactions {
  list.fold(adds, reactions.new(), fn(acc, raw) {
    let Buffered(next, _) =
      reactions.hold(acc, facts("MESSAGE_REACTION_ADD", raw), raw)
    next
  })
}

fn cancel(
  buffer: reactions.Reactions,
  raw: RawJson,
) -> Result(reactions.Reactions, Nil) {
  reactions.fork_cancel(buffer, facts("MESSAGE_REACTION_REMOVE", raw), raw)
}

fn parse(raw: RawJson) -> Dynamic {
  let assert Ok(value) = raw_json.read(raw, decode.dynamic)
  value
}

fn persona_of(entry: Dynamic) -> Option(String) {
  decode.run(entry, decode.at(["persona_id"], decode.string))
  |> option.from_result
}

fn subprofile_of(entry: Dynamic) -> Option(String) {
  decode.run(entry, decode.at(["subprofile", "id"], decode.string))
  |> option.from_result
}

// What a flush sends: each frame's event and the personas of its reactions.
fn flushed(
  buffer: reactions.Reactions,
) -> List(#(String, List(Option(String)))) {
  let #(_, frames) = reactions.flush(buffer)
  list.map(frames, fn(frame) {
    let data = parse(frame.1)
    case frame.0 {
      "MESSAGE_REACTION_ADD_MANY" -> {
        let assert Ok(entries) =
          decode.run(
            data,
            decode.at(["reactions"], decode.list(decode.dynamic)),
          )
        #(frame.0, list.map(entries, persona_of))
      }
      _ -> #(frame.0, [persona_of(data)])
    }
  })
}

pub fn adds_sent_together_keep_their_personas_test() {
  let #(_, frames) =
    reactions.flush(
      held([add(Some(persona_b)), add(Some(persona_a)), add(None)]),
    )
  let assert [#("MESSAGE_REACTION_ADD_MANY", payload)] = frames
  let assert Ok([fox, bao, account]) =
    decode.run(
      parse(payload),
      decode.at(["reactions"], decode.list(decode.dynamic)),
    )
  assert persona_of(fox) == Some(persona_b)
  assert subprofile_of(fox) == Some(persona_b)
  assert persona_of(bao) == Some(persona_a)
  assert subprofile_of(bao) == Some(persona_a)
  assert decode.run(account, decode.at(["user_id"], decode.string)) == Ok("30")
  assert persona_of(account) == None
  assert subprofile_of(account) == None
}

pub fn a_remove_cancels_the_add_of_the_same_persona_test() {
  let assert Ok(remaining) =
    cancel(held([add(Some(persona_a))]), remove(Some(persona_a)))
  assert reactions.is_empty(remaining)
}

pub fn a_remove_leaves_the_add_of_another_persona_test() {
  assert cancel(held([add(Some(persona_a))]), remove(Some(persona_b)))
    == Error(Nil)
}

pub fn the_account_and_its_personas_do_not_cancel_each_other_test() {
  assert cancel(held([add(Some(persona_a))]), remove(None)) == Error(Nil)
  assert cancel(held([add(None)]), remove(Some(persona_a))) == Error(Nil)
  let assert Ok(remaining) = cancel(held([add(None)]), remove(None))
  assert reactions.is_empty(remaining)
}

// Upstream's matcher removes the oldest add of the user, which here is B's.
pub fn a_remove_cancels_its_own_add_not_an_older_one_test() {
  let assert Ok(remaining) =
    cancel(
      held([add(Some(persona_b)), add(Some(persona_a))]),
      remove(Some(persona_a)),
    )
  assert flushed(remaining) == [#("MESSAGE_REACTION_ADD", [Some(persona_b)])]
  let assert Ok(remaining) =
    cancel(
      held([add(Some(persona_b)), add(Some(persona_a)), add(None)]),
      remove(Some(persona_a)),
    )
  assert flushed(remaining)
    == [#("MESSAGE_REACTION_ADD_MANY", [Some(persona_b), None])]
}

pub fn persona_zero_and_null_are_the_account_test() {
  let zero =
    raw_json.wrap_string(
      "{\"channel_id\":\"10\",\"message_id\":\"20\",\"user_id\":\"30\","
      <> "\"emoji\":{\"id\":null,\"name\":\"fox\"},\"persona_id\":\"0\"}",
    )
  let assert Ok(remaining) = cancel(held([add(None)]), zero)
  assert reactions.is_empty(remaining)
  let assert Ok(remaining) = cancel(held([zero]), remove(None))
  assert reactions.is_empty(remaining)
}

// Through a session that debounces reactions: the remove of A's reaction
// cancels A's buffered add, and B's add goes out alone, with its persona.
pub fn a_session_flushes_the_persona_that_was_not_removed_test() {
  use <- h.with_api(h.session_api(h.session_data(h.unique_user(), False, [])))
  let identify =
    session.Identify(
      ..h.identify("tok-fork-reactions"),
      flags: session.IdentifyFlags(
        ..session.no_flags(),
        debounce_message_reactions: True,
      ),
    )
  let socket = h.fake_socket()
  let assert Ok(ref) = h.start_session(identify, socket)
  let assert Ok(Frame(_, "READY", _)) = h.await_event(socket, "READY", 8000)
  session.send(ref, Dispatch("MESSAGE_REACTION_ADD", add(Some(persona_b))))
  session.send(ref, Dispatch("MESSAGE_REACTION_ADD", add(Some(persona_a))))
  session.send(
    ref,
    Dispatch("MESSAGE_REACTION_REMOVE", remove(Some(persona_a))),
  )
  let assert Ok(Frame(_, event, data)) =
    h.await_frame(socket, 5000, fn(frame) {
      case frame {
        Frame(_, "MESSAGE_REACTION_ADD", _)
        | Frame(_, "MESSAGE_REACTION_ADD_MANY", _)
        | Frame(_, "MESSAGE_REACTION_REMOVE", _) -> True
        _ -> False
      }
    })
  assert event == "MESSAGE_REACTION_ADD"
  assert persona_of(data) == Some(persona_b)
  h.terminate(ref)
}
