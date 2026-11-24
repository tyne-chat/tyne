// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a clustered gateway node takes the API's requests only once it has
// joined its cluster (tyne-chat/tyne#905). Upstream subscribes to the API's
// queue group (`rpc.gateway.>`) as the node starts. A node that starts beside
// a running one, as in a deploy, then got requests in its first second, before
// it knew its cluster or while it was still joining, and answered some of them
// `timeout`, which the API returns as 504. `rpc/server.gleam` (`subscribe`)
// asks `once_joined` first: until the node has joined, the subscription waits
// for the server's next retry (`server_subscribe_retry_ms`) and the running
// node keeps taking every request. Readiness needs the subscription, so the
// new node turns ready at most that long after it has joined. A bouncer worker
// waits for its bouncer links (`router.joined`), whatever `cluster_enabled`
// says; without clustering or a bouncer nothing changes. While it waits, the
// node says so in its log every `log_every_ms`.

import fluxer_gateway/cluster/router
import fluxer_gateway/config/settings
import fluxer_gateway/core/clock
import gleam/bool
import gleam/int
import gleam/option.{None, Some}
import logging

const log_every_ms = 30_000

type Key {
  ForkRpcJoinGateLogged
}

@external(erlang, "persistent_term", "get")
fn get_logged(key: Key, default: Int) -> Int

@external(erlang, "persistent_term", "put")
fn put_logged(key: Key, value: Int) -> Nil

pub fn once_joined(waiting: fn() -> a, joined: fn() -> a) -> a {
  case has_joined() {
    True -> joined()
    False -> {
      log_waiting()
      waiting()
    }
  }
}

fn has_joined() -> Bool {
  case router.bouncer_mode(), settings.get().cluster_enabled {
    True, _ -> router.joined()
    False, False -> True
    False, True ->
      case router.published() {
        Some(_) -> router.joined()
        None -> False
      }
  }
}

fn log_waiting() -> Nil {
  let now = clock.monotonic_ms()
  let last = get_logged(ForkRpcJoinGateLogged, now - log_every_ms)
  use <- bool.guard(now - last < log_every_ms, Nil)
  put_logged(ForkRpcJoinGateLogged, now)
  let state = case router.bouncer_mode(), router.published() {
    True, _ -> "bouncer links not joined"
    False, Some(_) -> "cluster topology published, not joined"
    False, None -> "no cluster topology yet"
  }
  logging.log(
    logging.Info,
    "Gateway NATS RPC: waiting to join the cluster before subscribing ("
      <> state
      <> "; retry every "
      <> int.to_string(settings.get().durations.rpc.server_subscribe_retry_ms)
      <> " ms)",
  )
}
