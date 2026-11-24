// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a gateway node that is leaving owns no presences (tyne-chat/tyne#905),
// as it owns no communities (`topology.serving`). Upstream's presence route
// counts every member that runs presences, a draining one included, so a
// drained node kept the presences it owned until it stopped: they died with
// it, the sessions (already moved to the new node) started them again there,
// and account events sent in between were lost. `presence/route.gleam`
// (`rebuild`) leaves out the nodes that are leaving when it builds the route
// table, unless that would leave none: a lone node that drains for a restart
// keeps its presences. Only the table: `presence_nodes` still lists a leaving
// node, which runs presences until it stops, so the presence registry does not
// count it as lost (and its users as offline) while it drains, and lookups
// (fork/presence_elsewhere.gleam) still ask it. In bouncer mode nothing
// changes.

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
