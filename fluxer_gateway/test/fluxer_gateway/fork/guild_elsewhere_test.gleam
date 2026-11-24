// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the owner runs a request about a community that still runs on a peer
// on that peer (fork/guild_elsewhere.gleam, tyne-chat/tyne#905). On one node
// nothing changes: a community that runs here, one that runs nowhere, a
// request without a `guild_id` and a voice request all run here, and the
// requests answer as upstream's do. The case of a community still on the old
// node while a new node owns it is in fork/handover_scenario_test.gleam.

import fluxer_gateway/core/error.{type RpcError}
import fluxer_gateway/core/raw_json
import fluxer_gateway/fork/guild_elsewhere
import fluxer_gateway/guild/rpc as guild_rpc
import fluxer_gateway/guild/rpc/params.{type Params} as rpc_params
import gleam/dynamic/decode
import gleam/int
import gleam/json.{type Json}
import gleam/result
import support/guild_api
import support/guild_fixture as fixture

fn params(fields: List(#(String, Json))) -> Params {
  let assert Ok(found) =
    rpc_params.of_object(
      raw_json.wrap(<<json.to_string(json.object(fields)):utf8>>),
    )
  found
}

fn of_guild(guild: Int) -> Params {
  params([
    #("guild_id", json.string(int.to_string(guild))),
    #("user_id", json.null()),
  ])
}

fn here() -> Result(Json, RpcError) {
  Ok(json.string("here"))
}

fn ran_here(answer: Result(Json, RpcError)) -> Bool {
  case answer {
    Ok(found) -> json.to_string(found) == json.to_string(json.string("here"))
    Error(_) -> False
  }
}

fn name(answer: Result(Json, RpcError)) -> Result(String, Nil) {
  case answer {
    Ok(found) ->
      json.parse(json.to_string(found), decode.at(["name"], decode.string))
      |> result.replace_error(Nil)
    Error(_) -> Error(Nil)
  }
}

pub fn a_community_that_runs_here_runs_here_test() {
  use api <- guild_api.with_api
  let found = fixture.new(1) |> fixture.with_text(10)
  let _ = fixture.started(api, found)
  assert ran_here(guild_elsewhere.where_it_runs(
    "guild.get_data",
    of_guild(found.id),
    here,
  ))
  assert name(guild_rpc.handle_local("guild.get_data", of_guild(found.id)))
    == Ok("Scenario")
  fixture.stop(found)
}

pub fn a_community_that_runs_nowhere_runs_here_test() {
  use _api <- guild_api.with_api
  let missing = fixture.unique_guild_id()
  assert ran_here(guild_elsewhere.where_it_runs(
    "guild.get_data",
    of_guild(missing),
    here,
  ))
}

pub fn a_request_without_a_community_runs_here_test() {
  assert ran_here(guild_elsewhere.where_it_runs(
    "guild.get_user_permissions_batch",
    params([#("guild_ids", json.array(["1"], json.string))]),
    here,
  ))
}
