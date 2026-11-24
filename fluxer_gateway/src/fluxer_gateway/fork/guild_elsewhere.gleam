// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: requests about a community that is moving between gateway nodes
// (tyne-chat/tyne#905). When a node joins or drains, a community's owner
// changes at once, but the community moves to its new owner only later, one
// after another (`guild/handoff.gleam`). Until it arrives, the new owner has
// no read model for it. Upstream's handlers that read the read model
// (`infra.view`, `infra.answer`) or the local registry then fail or answer
// nothing: `guild_not_found` (403 Access Denied at the API on channel reads,
// message sends and reactions), `viewable_channels_error`,
// `members_with_role_error`, no channel mentions, no visitors to evict. Those
// that message the community's process (`infra.ask`, dispatches, voice) reach
// it on the old node through the handle the new owner's cold start finds
// there, unless that start is refused.
//
// So the owner sends such a request to the node the community runs on before
// it runs it: `guild/rpc.gleam` asks `where_it_runs` first in `handle_local`,
// where requests end on the owner whichever node took them from the API, and
// `voice_where_it_runs` in `voice_owned`, where voice requests end. When this
// node owns the community, does not run it, and a peer does
// (fork/guild_whereabouts.gleam), the request runs on that peer: through
// fork/guild_here.gleam, which runs upstream's `handle_local` or
// `voice_owned_encoded` there. Only the owner forwards: the peer does not own
// the community, so the request runs there and is never passed back. When the
// community has left the peer by the time it runs there (the move ended in
// between), the peer says so and the owner runs the request itself. Dispatches
// and starts are never forwarded (`runs_its_own_way`). Everything else runs
// here as upstream has it: a community that runs here or nowhere, a request
// without a `guild_id`, a peer that cannot be asked, one node, bouncer mode.

import fluxer_gateway/cluster/router
import fluxer_gateway/core/error.{type RpcError, RpcFailed, RpcTimeout}
import fluxer_gateway/core/id.{type GuildId}
import fluxer_gateway/core/node.{type Node}
import fluxer_gateway/core/raw_json
import fluxer_gateway/fork/guild_whereabouts
import fluxer_gateway/guild/manager/registry
import fluxer_gateway/guild/remote
import fluxer_gateway/guild/rpc/infra
import fluxer_gateway/guild/rpc/params.{type Params} as rpc_params
import fluxer_gateway/voice/guild_state.{type RpcCall}
import fluxer_gateway/voice/rpc_params as voice_params
import gleam/bool
import gleam/dynamic/decode
import gleam/json.{type Json}
import gleam/result

pub fn where_it_runs(
  method: String,
  params: Params,
  here: fn() -> Result(Json, RpcError),
) -> Result(Json, RpcError) {
  let elsewhere = {
    use <- bool.guard(runs_its_own_way(method, params), Error(Nil))
    use guild <- result.try(
      rpc_params.guild(params) |> result.replace_error(Nil),
    )
    moved_to(guild)
  }
  case elsewhere {
    Error(Nil) -> here()
    Ok(peer) ->
      forward(peer, "fluxer_gateway@fork@guild_here", "run", [
        remote.arg(method),
        remote.arg(params),
      ])
      |> or_here(here)
  }
}

// Requests that reach the community's process through upstream's handle,
// which waits for a community that is arriving here and reaches one that runs
// on the old node, in step with the move's freeze and replay (a dispatch
// forwarded to the old node as the move ends would be lost). Voice requests
// end in `voice_owned`, which asks `voice_where_it_runs`.
fn runs_its_own_way(method: String, params: Params) -> Bool {
  case method {
    "guild.dispatch" | "guild.dispatch_many" | "guild.start" -> True
    _ -> result.is_ok(voice_params.guild_call(method, params))
  }
}

pub fn voice_where_it_runs(
  guild: GuildId,
  call: RpcCall,
  here: fn() -> Result(Json, RpcError),
) -> Result(Json, RpcError) {
  case moved_to(guild) {
    Error(Nil) -> here()
    Ok(peer) ->
      forward(peer, "fluxer_gateway@fork@guild_here", "voice", [
        remote.arg(guild),
        remote.arg(call),
      ])
      |> or_here(here)
  }
}

// The peer the community runs on, when this node owns it and does not run it.
fn moved_to(guild: GuildId) -> Result(Node, Nil) {
  let owner = router.owner_node(router.GuildKey(guild), node.Guilds)
  case router.bouncer_mode(), owner == Ok(node.self()) {
    False, True ->
      case registry.lookup(guild) {
        Ok(_) -> Error(Nil)
        Error(Nil) -> guild_whereabouts.peer_running(guild)
      }
    _, _ -> Error(Nil)
  }
}

type Failure {
  Unreachable
  Answered(RpcError)
}

fn or_here(
  forwarded: Result(Json, Failure),
  here: fn() -> Result(Json, RpcError),
) -> Result(Json, RpcError) {
  case forwarded {
    Ok(answer) -> Ok(answer)
    Error(Answered(error)) -> Error(error)
    Error(Unreachable) -> here()
  }
}

fn forward(
  peer: Node,
  module: String,
  function: String,
  args: List(remote.Arg),
) -> Result(Json, Failure) {
  let reply =
    remote.call(
      peer,
      module,
      function,
      args,
      infra.forward_timeout_ms(),
      expecting: {
        use ok <- decode.field(0, decode.bool)
        use body <- decode.field(1, decode.string)
        decode.success(#(ok, body))
      },
    )
  case reply {
    Ok(#(True, body)) -> Ok(raw_json.wrap_string(body) |> raw_json.to_json)
    Ok(#(False, "fork_guild_not_here")) -> Error(Unreachable)
    Ok(#(False, "invalid_params")) -> Error(Answered(error.InvalidParams))
    Ok(#(False, "timeout")) -> Error(Answered(RpcTimeout))
    Ok(#(False, "internal_error")) -> Error(Answered(error.RpcInternalError))
    Ok(#(False, message)) -> Error(Answered(RpcFailed(message)))
    Error(Nil) -> Error(Unreachable)
  }
}
