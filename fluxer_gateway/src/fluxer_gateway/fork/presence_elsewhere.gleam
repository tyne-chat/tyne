// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: finds a user's presence on any gateway node while presences move
// between nodes (tyne-chat/tyne#905). Upstream asks the node its route table
// names as the owner, the owner in the table before it, and this node. A node
// that has just joined built its first table from itself alone, so it names
// itself the owner of presences that still run on the old node, first until
// its table is rebuilt and then, for the presences it now owns, until they
// have moved; its previous table names only itself. Two things then went
// wrong on it:
//
// - An account event (a DM message, a reaction in a DM, a persona update to a
//   DM partner) found no presence and was handled as for an offline user, a
//   push at most. `presence/manager.gleam` (`lookup_everywhere`) hands such a
//   miss to `find`.
// - A session that started there (a new connection, or one the old node handed
//   over) started a second presence beside the one on the old node, and until
//   the two met, account events reached only one of them.
//   `start_or_lookup_timed` asks `first` before it starts one.
//
// Both ask every other node that runs presences, at once and within the one
// timeout, in a process of their own (fork/isolated.gleam). `find` then asks
// the owner once more, as upstream asked it first and the presence may have
// finished moving to it in between. A node that is slow or busy fails the
// lookup (upstream's `LookupFailed`) rather than make the user offline; one
// whose presence manager is not running (stopping, or not connected) holds
// none and counts as an answer. With one node there is nobody else to ask; in
// bouncer mode, where upstream's leases decide, nothing changes.

import fluxer_gateway/cluster/router
import fluxer_gateway/core/clock
import fluxer_gateway/core/node
import fluxer_gateway/fork/isolated
import fluxer_gateway/presence/pids.{type Inbox}
import fluxer_gateway/presence/protocol
import fluxer_gateway/presence/remote
import fluxer_gateway/presence/route
import gleam/erlang/atom.{type Atom}
import gleam/erlang/process.{type Subject}
import gleam/int
import gleam/list
import gleam/option.{None, Some}

type Probe {
  Found(Inbox)
  Missing
  Failed(remote.CallError)
}

pub fn find(
  user: Int,
  asked: Atom,
  timeout_ms: Int,
  not_found: error,
  failed: fn(remote.CallError) -> error,
) -> Result(List(Inbox), error) {
  case alone() {
    True -> Error(not_found)
    False ->
      isolated.run(fn() { find_round(user, asked, timeout_ms) }, [
        Failed(remote.CallUnavailable),
      ])
      |> outcome(not_found, failed)
  }
}

pub fn first(user: Int, asked: Atom, timeout_ms: Int) -> Result(Inbox, Nil) {
  case alone() {
    True -> Error(Nil)
    False -> {
      let probes =
        isolated.run(
          fn() {
            let deadline = clock.monotonic_ms() + timeout_ms
            probe_all(peers(user, asked), user, deadline)
          },
          [],
        )
      case found(probes) {
        [inbox, ..] -> Ok(inbox)
        [] -> Error(Nil)
      }
    }
  }
}

// The peers at once, then, if none has the presence, the owner once more.
fn find_round(user: Int, asked: Atom, timeout_ms: Int) -> List(Probe) {
  let deadline = clock.monotonic_ms() + timeout_ms
  let probes = probe_all(peers(user, asked), user, deadline)
  case found(probes) {
    [_, ..] -> probes
    [] -> [probe(asked, user, remaining(deadline)), ..probes]
  }
}

fn outcome(
  probes: List(Probe),
  not_found: error,
  failed: fn(remote.CallError) -> error,
) -> Result(List(Inbox), error) {
  case found(probes), first_failure(probes) {
    [_, ..] as inboxes, _ -> Ok(inboxes)
    [], Some(failure) -> Error(failed(failure))
    [], None -> Error(not_found)
  }
}

// No other node runs presences, or bouncer mode: nobody else to ask.
fn alone() -> Bool {
  let self = remote.self_atom()
  router.bouncer_mode()
  || !list.any(presence_nodes(), fn(found) { found != self })
}

fn presence_nodes() -> List(Atom) {
  router.reachable_with(node.Presence)
  |> list.map(node.to_atom)
  |> list.append(route.presence_nodes())
  |> list.unique
}

fn peers(user: Int, asked: Atom) -> List(Atom) {
  case alone() {
    True -> []
    False -> {
      let self = remote.self_atom()
      let skipped = case route.previous_owner(user) {
        Some(previous) -> [self, asked, previous]
        None -> [self, asked]
      }
      list.filter(presence_nodes(), fn(peer) { !list.contains(skipped, peer) })
    }
  }
}

fn probe_all(peers: List(Atom), user: Int, deadline: Int) -> List(Probe) {
  let replies = process.new_subject()
  list.each(peers, fn(peer) {
    process.spawn_unlinked(fn() {
      process.send(replies, probe(peer, user, remaining(deadline)))
    })
  })
  collect(replies, list.length(peers), deadline, [])
}

fn probe(peer: Atom, user: Int, timeout_ms: Int) -> Probe {
  case
    remote.call_from_disposable(
      peer,
      route.name(route.Manager, route.shard(user)),
      timeout_ms,
      fn(reply) { protocol.Lookup(user, reply) },
    )
  {
    Ok(Ok(inbox)) -> Found(inbox)
    Ok(Error(Nil)) -> Missing
    // A node whose presence manager is not running (it is stopping, or not
    // connected) holds no presence; only one that is slow or busy fails.
    Error(remote.CallUnavailable) -> Missing
    Error(failure) -> Failed(failure)
  }
}

fn collect(
  replies: Subject(Probe),
  left: Int,
  deadline: Int,
  acc: List(Probe),
) -> List(Probe) {
  case left {
    0 -> acc
    _ ->
      case process.receive(replies, remaining(deadline)) {
        Ok(probe) -> collect(replies, left - 1, deadline, [probe, ..acc])
        Error(Nil) -> [Failed(remote.CallTimeout), ..acc]
      }
  }
}

fn remaining(deadline: Int) -> Int {
  int.max(0, deadline - clock.monotonic_ms())
}

fn found(probes: List(Probe)) -> List(Inbox) {
  probes
  |> list.filter_map(fn(probe) {
    case probe {
      Found(inbox) -> Ok(inbox)
      Missing | Failed(_) -> Error(Nil)
    }
  })
  |> list.unique
}

fn first_failure(probes: List(Probe)) -> option.Option(remote.CallError) {
  list.find_map(probes, fn(probe) {
    case probe {
      Failed(failure) -> Ok(failure)
      Found(_) | Missing -> Error(Nil)
    }
  })
  |> option.from_result
}
