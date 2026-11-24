// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: which peer a community runs on while it moves between gateway nodes
// (tyne-chat/tyne#905). During a handover a community's owner changes before
// the community moves, so the owner is not always where it runs. Used by
// fork/guild_elsewhere.gleam and fork/permissions_elsewhere.gleam.

import fluxer_gateway/cluster/router
import fluxer_gateway/core/id.{type GuildId}
import fluxer_gateway/core/node.{type Node}
import fluxer_gateway/guild/manager/shard
import gleam/erlang/atom.{type Atom}
import gleam/erlang/process.{type Pid}
import gleam/list
import gleam/result

const lookup_timeout_ms = 1000

// The peer, never this node, whose shard runs the community.
pub fn peer_running(guild: GuildId) -> Result(Node, Nil) {
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
