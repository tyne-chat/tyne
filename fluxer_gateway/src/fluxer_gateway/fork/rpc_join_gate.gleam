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
// new node turns ready at most that long after it has joined. Without
// clustering nothing changes.

import fluxer_gateway/cluster/router
import fluxer_gateway/config/settings
import gleam/option.{None, Some}

pub fn once_joined(waiting: fn() -> a, joined: fn() -> a) -> a {
  case has_joined() {
    True -> joined()
    False -> waiting()
  }
}

fn has_joined() -> Bool {
  case settings.get().cluster_enabled, router.bouncer_mode() {
    False, _ -> True
    True, True -> router.joined()
    True, False ->
      case router.published() {
        Some(_) -> router.joined()
        None -> False
      }
  }
}
