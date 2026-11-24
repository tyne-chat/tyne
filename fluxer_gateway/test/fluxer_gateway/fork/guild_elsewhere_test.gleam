// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a `guild_not_found` answer is asked again where the community runs
// (fork/guild_elsewhere.gleam, tyne-chat/tyne#905). On one node: a community
// that runs here is answered here, every other answer is kept. The case of a
// community still on the old node while a new node owns it is in
// fork/handover_scenario_test.gleam.

import fluxer_gateway/fork/guild_elsewhere
import fluxer_gateway/rpc/reply
import fluxer_gateway/rpc/server
import gleam/dynamic/decode
import gleam/int
import gleam/json
import support/guild_api
import support/guild_fixture as fixture

fn payload(guild: Int) -> BitArray {
  let body =
    json.object([
      #("guild_id", json.string(int.to_string(guild))),
      #("user_id", json.null()),
    ])
  <<json.to_string(body):utf8>>
}

fn not_found() -> String {
  reply.failure("guild_not_found")
}

fn answered(body: String) -> Result(String, Nil) {
  let decoder = {
    use ok <- decode.field("ok", decode.bool)
    use name <- decode.optional_field(
      "result",
      "",
      decode.at(["name"], decode.string),
    )
    decode.success(#(ok, name))
  }
  case json.parse(body, decoder) {
    Ok(#(True, name)) -> Ok(name)
    _ -> Error(Nil)
  }
}

pub fn a_community_that_runs_here_is_answered_here_test() {
  use api <- guild_api.with_api
  let found = fixture.new(1) |> fixture.with_text(10)
  let _ = fixture.started(api, found)
  let body =
    guild_elsewhere.answer(
      not_found(),
      "guild.get_data",
      payload(found.id),
      server.guild_route,
    )
  assert answered(body) == Ok("Scenario")
  fixture.stop(found)
}

pub fn other_answers_are_kept_test() {
  use api <- guild_api.with_api
  let found = fixture.new(1) |> fixture.with_text(10)
  let _ = fixture.started(api, found)
  let ok = reply.ok(json.bool(True))
  let refused = reply.failure("forbidden")
  assert guild_elsewhere.answer(
      ok,
      "guild.get_data",
      payload(found.id),
      server.guild_route,
    )
    == ok
  assert guild_elsewhere.answer(
      refused,
      "guild.get_data",
      payload(found.id),
      server.guild_route,
    )
    == refused
  assert guild_elsewhere.answer(
      not_found(),
      "presence.has_active",
      payload(found.id),
      server.guild_route,
    )
    == not_found()
  fixture.stop(found)
}

pub fn a_community_that_runs_nowhere_stays_not_found_test() {
  use _api <- guild_api.with_api
  let missing = fixture.unique_guild_id()
  assert guild_elsewhere.answer(
      not_found(),
      "guild.get_data",
      payload(missing),
      server.guild_route,
    )
    == not_found()
}
