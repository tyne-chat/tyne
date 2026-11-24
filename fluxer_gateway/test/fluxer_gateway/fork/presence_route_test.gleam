// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a gateway node that is leaving owns no presences, unless no other node
// runs them (fork/presence_route.gleam, tyne-chat/tyne#905). The two-node drain
// is in fork/handover_scenario_test.gleam; these are the other branches, with a
// published topology as fork/rpc_join_gate_test.gleam builds it.

import fluxer_gateway/cluster/topology.{type Topology}
import fluxer_gateway/config/settings
import fluxer_gateway/core/node
import fluxer_gateway/fork/presence_route
import gleam/erlang/atom.{type Atom}
import gleam/option.{type Option, None, Some}

type Key {
  FluxerGatewayClusterTopology
}

type Stored

@external(erlang, "persistent_term", "put")
fn put_topology(key: Key, value: Option(Topology)) -> Stored

@external(erlang, "persistent_term", "erase")
fn erase_topology(key: Key) -> Bool

fn other() -> Atom {
  atom.create("fork_presence_route_other@127.0.0.1")
}

fn self() -> Atom {
  node.to_atom(node.self())
}

fn with(
  published: Option(Topology),
  bouncer: Option(settings.BouncerSettings),
  nodes: List(Atom),
) -> List(Atom) {
  let before = settings.get()
  settings.store(settings.Settings(..before, bouncer: bouncer))
  let _ = case published {
    Some(_) -> {
      let _ = put_topology(FluxerGatewayClusterTopology, published)
      True
    }
    None -> erase_topology(FluxerGatewayClusterTopology)
  }
  let kept = presence_route.without_leaving(nodes)
  let _ = erase_topology(FluxerGatewayClusterTopology)
  settings.store(before)
  kept
}

fn two_nodes() -> Topology {
  topology.new(node.self(), node.AllRoles, [])
  |> topology.place(node.from_atom(other()))
  |> topology.mark_joined
}

pub fn without_a_topology_every_node_stays_test() {
  assert with(None, None, [self(), other()]) == [self(), other()]
}

pub fn a_leaving_node_is_left_out_test() {
  let published = two_nodes() |> topology.leave(node.self())
  assert with(Some(published), None, [self(), other()]) == [other()]
}

pub fn a_lone_leaving_node_keeps_its_presences_test() {
  let published =
    topology.new(node.self(), node.AllRoles, [])
    |> topology.mark_joined
    |> topology.leave(node.self())
  assert with(Some(published), None, [self()]) == [self()]
}

pub fn when_every_node_leaves_they_all_stay_test() {
  let published =
    two_nodes()
    |> topology.leave(node.self())
    |> topology.leave(node.from_atom(other()))
  assert with(Some(published), None, [self(), other()]) == [self(), other()]
}

pub fn bouncer_mode_changes_nothing_test() {
  let published = two_nodes() |> topology.leave(node.self())
  let bouncer =
    settings.BouncerSettings(
      dns_name: "bouncer",
      basename: "fluxer_bouncer",
      count: 1,
      pool: "test",
      template_hash: "test",
    )
  assert with(Some(published), Some(bouncer), [self(), other()])
    == [self(), other()]
}
