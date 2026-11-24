// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a clustered node subscribes to the API's requests only once it has
// joined its cluster (fork/rpc_join_gate.gleam, tyne-chat/tyne#905).

import fluxer_gateway/cluster/topology.{type Topology}
import fluxer_gateway/config/settings
import fluxer_gateway/core/node
import fluxer_gateway/fork/rpc_join_gate
import gleam/option.{type Option, None, Some}

type Key {
  FluxerGatewayClusterTopology
}

type Stored

@external(erlang, "persistent_term", "put")
fn put_topology(key: Key, value: Option(Topology)) -> Stored

@external(erlang, "persistent_term", "erase")
fn erase_topology(key: Key) -> Bool

fn gate(clustered: Bool, published: Option(Topology)) -> String {
  gate_with(clustered, None, published)
}

fn gate_with(
  clustered: Bool,
  bouncer: Option(settings.BouncerSettings),
  published: Option(Topology),
) -> String {
  let before = settings.get()
  settings.store(
    settings.Settings(..before, cluster_enabled: clustered, bouncer: bouncer),
  )
  let _ = case published {
    Some(_) -> {
      let _ = put_topology(FluxerGatewayClusterTopology, published)
      True
    }
    None -> erase_topology(FluxerGatewayClusterTopology)
  }
  let answer =
    rpc_join_gate.once_joined(fn() { "waiting" }, fn() { "listening" })
  let _ = erase_topology(FluxerGatewayClusterTopology)
  settings.store(before)
  answer
}

fn joining() -> Topology {
  topology.new(node.self(), node.AllRoles, [])
}

pub fn a_node_without_clustering_listens_at_once_test() {
  assert gate(False, None) == "listening"
  assert gate(False, Some(joining())) == "listening"
}

pub fn a_clustered_node_without_a_topology_yet_waits_test() {
  assert gate(True, None) == "waiting"
}

pub fn a_clustered_node_still_joining_waits_test() {
  assert gate(True, Some(joining())) == "waiting"
}

pub fn a_clustered_node_that_has_joined_listens_test() {
  assert gate(True, Some(topology.mark_joined(joining()))) == "listening"
}

fn bouncer() -> settings.BouncerSettings {
  settings.BouncerSettings(
    dns_name: "bouncer",
    basename: "fluxer_bouncer",
    count: 1,
    pool: "test",
    template_hash: "test",
  )
}

// A bouncer worker waits for its bouncer links whatever `cluster_enabled`
// says: a bouncer is configured on its own, and the flag stays off by default.
pub fn a_bouncer_worker_that_has_not_joined_waits_test() {
  assert gate_with(False, Some(bouncer()), None) == "waiting"
  assert gate_with(True, Some(bouncer()), None) == "waiting"
}
