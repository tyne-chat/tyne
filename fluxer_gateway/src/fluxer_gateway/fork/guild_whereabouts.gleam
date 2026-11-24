// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: where a community runs while it moves between gateway nodes
// (tyne-chat/tyne#905). During a handover a community's owner changes before
// the community moves, so the owner is not always where it runs. Used by
// fork/guild_elsewhere.gleam and fork/permissions_elsewhere.gleam.
//
// `peer_running` asks the manager shard of every other node that serves or is
// expected to serve communities (a draining node serves none but still runs
// them until they move), all at once and within `lookup_timeout_ms`. Each ask
// is monitored, so a node whose shard is not running (still starting, or
// stopping) counts as an answer at once rather than holding the lookup until
// the timeout, and the round runs in a process of its own
// (fork/isolated.gleam). In bouncer mode, where upstream's leases decide who
// may serve a community, it finds nothing.

import fluxer_gateway/cluster/remote as cluster_remote
import fluxer_gateway/cluster/router
import fluxer_gateway/core/clock
import fluxer_gateway/core/id.{type GuildId}
import fluxer_gateway/core/node.{type Node}
import fluxer_gateway/fork/isolated
import fluxer_gateway/guild/inbox.{type Handle}
import fluxer_gateway/guild/manager/shard
import fluxer_gateway/guild/names
import gleam/erlang/atom.{type Atom}
import gleam/erlang/process.{type Pid, type Subject}
import gleam/int
import gleam/list
import gleam/result

const lookup_timeout_ms = 1000

// The peer, never this node, whose shard runs the community.
pub fn peer_running(guild: GuildId) -> Result(Node, Nil) {
  case router.bouncer_mode(), peers() {
    True, _ | False, [] -> Error(Nil)
    False, peers ->
      isolated.run(
        fn() {
          let deadline = clock.monotonic_ms() + lookup_timeout_ms
          let replies = process.new_subject()
          list.each(peers, fn(peer) {
            process.spawn_unlinked(fn() {
              process.send(replies, ask(peer, guild, remaining(deadline)))
            })
          })
          first_running(replies, list.length(peers), deadline)
        },
        Error(Nil),
      )
  }
}

fn peers() -> List(Node) {
  let self = node.self()
  router.reachable_with(node.Guilds)
  |> list.append(router.expected_with(node.Guilds))
  |> list.unique
  |> list.filter(fn(peer) { peer != self })
}

fn ask(peer: Node, guild: GuildId, timeout_ms: Int) -> Result(Node, Nil) {
  let reply = process.new_subject()
  let name = names.shard(names.shard_of(guild))
  use monitor <- result.try(
    cluster_remote.ask_named(peer, name, shard.Lookup(guild, reply))
    |> result.replace_error(Nil),
  )
  let selector =
    process.new_selector()
    |> process.select(reply)
    |> process.select_specific_monitor(monitor, fn(_) { Error(Nil) })
  let answer =
    process.selector_receive(selector, timeout_ms)
    |> result.flatten
  process.demonitor_process(monitor)
  use handle <- result.try(answer)
  running_node(handle)
}

fn running_node(handle: Handle) -> Result(Node, Nil) {
  let found = node.from_atom(pid_node(handle.pid))
  case found == node.self() {
    True -> Error(Nil)
    False -> Ok(found)
  }
}

fn first_running(
  replies: Subject(Result(Node, Nil)),
  left: Int,
  deadline: Int,
) -> Result(Node, Nil) {
  case left {
    0 -> Error(Nil)
    _ ->
      case process.receive(replies, remaining(deadline)) {
        Ok(Ok(found)) -> Ok(found)
        Ok(Error(Nil)) -> first_running(replies, left - 1, deadline)
        Error(Nil) -> Error(Nil)
      }
  }
}

fn remaining(deadline: Int) -> Int {
  int.max(0, deadline - clock.monotonic_ms())
}

@external(erlang, "erlang", "node")
fn pid_node(pid: Pid) -> Atom
