// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a gateway node that is leaving owns no presences (tyne-chat/tyne#905),
// as it owns no communities (`topology.serving`). Upstream's presence route
// counts every member that runs presences, a draining one included, so a
// drained node kept the presences it owned until it stopped: they died with
// it, the sessions (already moved to the new node) started them again there,
// and account events sent in between were lost. `presence/route.gleam`
// (`presence_nodes`) leaves out the nodes that are leaving, unless that would
// leave none: a lone node that drains for a restart keeps its presences.

import fluxer_gateway/cluster/router
import fluxer_gateway/cluster/topology
import fluxer_gateway/core/node
import gleam/erlang/atom.{type Atom}
import gleam/list
import gleam/option.{None, Some}
import gleam/set

pub fn without_leaving(nodes: List(Atom)) -> List(Atom) {
  case router.bouncer_mode(), router.published() {
    False, Some(published) -> {
      let leaving = topology.leaving(published)
      case
        list.filter(nodes, fn(found) {
          !set.contains(leaving, node.from_atom(found))
        })
      {
        [] -> nodes
        staying -> staying
      }
    }
    _, None | True, _ -> nodes
  }
}
