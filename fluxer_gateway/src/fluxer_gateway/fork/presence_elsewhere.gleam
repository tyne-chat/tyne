// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: finds a user's presence on any gateway node while presences move
// between nodes (tyne-chat/tyne#905). Upstream asks the node its route table
// names as the owner, the owner in the table before it, and this node. A node
// that has just joined built its first table from itself alone, so it names
// itself the owner of presences that still run on the old node, first until
// its table is rebuilt and then, for the presences it now owns, until they
// have moved; its previous table names only itself. An account event that
// reached it then (a DM message, a reaction in a DM, a persona update to a DM
// partner) found no presence and was handled as for an offline user, a push
// at most. `presence/manager.gleam` (`lookup_everywhere`) hands such a miss
// here, and the other nodes that run presences are asked too. With one node
// there is nobody else to ask.

import fluxer_gateway/cluster/router
import fluxer_gateway/core/node
import fluxer_gateway/presence/pids.{type Inbox}
import fluxer_gateway/presence/protocol
import fluxer_gateway/presence/remote
import fluxer_gateway/presence/route
import gleam/erlang/atom.{type Atom}
import gleam/list
import gleam/option.{None, Some}
import gleam/result

pub fn lookup(
  user: Int,
  asked: Atom,
  timeout_ms: Int,
) -> Result(List(Inbox), Nil) {
  let self = remote.self_atom()
  let skipped = case route.previous_owner(user) {
    Some(previous) -> [self, asked, previous]
    None -> [self, asked]
  }
  let found =
    router.reachable_with(node.Presence)
    |> list.map(node.to_atom)
    |> list.append(route.presence_nodes())
    |> list.unique
    |> list.filter(fn(peer) { !list.contains(skipped, peer) })
    |> list.filter_map(fn(peer) {
      remote.call(
        peer,
        route.name(route.Manager, route.shard(user)),
        timeout_ms,
        fn(reply) { protocol.Lookup(user, reply) },
      )
      |> result.replace_error(Nil)
      |> result.flatten
    })
  case found {
    [] -> Error(Nil)
    _ -> Ok(list.unique(found))
  }
}
