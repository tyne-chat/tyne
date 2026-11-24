// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: requests about a community that is moving between gateway nodes
// (tyne-chat/tyne#905). When a node joins or drains, a community's owner
// changes at once, but the community moves to its new owner only later, one
// after another (`guild/handoff.gleam`). Until it arrives, the new owner has
// no read model for it and upstream answers `guild_not_found`, which the API
// turns into 403 Access Denied on channel reads, message sends and reactions.
// `rpc/server.gleam` (`execute_joined`) hands every answer here; one that is
// `guild_not_found` is asked again on the node the community still runs on,
// this one or a peer, through upstream's `execute_owned`, which every gateway
// version has. Any other answer, a community that runs nowhere and a peer that
// cannot be asked keep upstream's answer.

import fluxer_gateway/cluster/router
import fluxer_gateway/core/id.{type GuildId}
import fluxer_gateway/core/node.{type Node}
import fluxer_gateway/core/raw_json
import fluxer_gateway/guild/manager/registry
import fluxer_gateway/guild/manager/shard
import fluxer_gateway/guild/remote
import fluxer_gateway/guild/rpc as guild_rpc
import fluxer_gateway/guild/rpc/infra
import fluxer_gateway/rpc/reply
import gleam/bit_array
import gleam/dynamic/decode
import gleam/erlang/atom.{type Atom}
import gleam/erlang/process.{type Pid}
import gleam/list
import gleam/result

const lookup_timeout_ms = 1000

pub fn answer(
  body: String,
  method: String,
  payload: BitArray,
  guild_route: fn(BitArray) -> Result(GuildId, Nil),
) -> String {
  case body == not_found() {
    False -> body
    True ->
      case guild_method(method), guild_route(payload) {
        True, Ok(guild) -> again(guild, method, payload, body)
        _, _ -> body
      }
  }
}

fn not_found() -> String {
  reply.failure("guild_not_found")
}

fn guild_method(method: String) -> Bool {
  case method {
    "guild." <> _ -> True
    _ -> False
  }
}

fn again(
  guild: GuildId,
  method: String,
  payload: BitArray,
  body: String,
) -> String {
  case registry.lookup(guild) {
    Ok(_) -> encode(guild_rpc.handle_owned(method, raw_json.wrap(payload)))
    Error(Nil) ->
      case running_on(guild) {
        Ok(peer) -> ask(peer, method, payload) |> result.unwrap(body)
        Error(Nil) -> body
      }
  }
}

fn running_on(guild: GuildId) -> Result(Node, Nil) {
  let self = node.self()
  let peers =
    router.reachable_with(node.Guilds)
    |> list.append(router.expected_with(node.Guilds))
    |> list.unique
    |> list.filter(fn(peer) { peer != self })
  case peers {
    [] -> Error(Nil)
    _ ->
      shard.running_on(guild, peers, lookup_timeout_ms)
      |> result.map(fn(handle) { node.from_atom(pid_node(handle.pid)) })
      |> result.try(fn(found) {
        case found == self {
          True -> Error(Nil)
          False -> Ok(found)
        }
      })
  }
}

@external(erlang, "erlang", "node")
fn pid_node(pid: Pid) -> Atom

fn ask(peer: Node, method: String, payload: BitArray) -> Result(String, Nil) {
  remote.call(
    peer,
    "fluxer_gateway@rpc@server",
    "execute_owned",
    [remote.arg(method), remote.arg(payload)],
    infra.forward_timeout_ms(),
    expecting: {
      use ok <- decode.field(0, decode.bool)
      use body <- decode.field(1, decode.bit_array)
      decode.success(#(ok, body))
    },
  )
  |> result.map(encode)
}

fn encode(answered: #(Bool, BitArray)) -> String {
  case answered {
    #(True, body) -> reply.ok(raw_json.wrap(body) |> raw_json.to_json)
    #(False, message) ->
      reply.failure(bit_array.to_string(message) |> result.unwrap(""))
  }
}
