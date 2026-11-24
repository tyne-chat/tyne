// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: what `fluxer_gateway/fork/handover_scenario_test.gleam` runs on its
// peer nodes (tyne-chat/tyne#905).

import fluxer_gateway/config/settings
import fluxer_gateway/presence/manager
import fluxer_gateway/rpc/server
import gleam/list

// Presences stay where they are unless the test drains their node: the
// presence manager's own checks come only after a minute.
pub fn hold_presence_moves() -> Nil {
  let current = settings.get()
  let d = current.durations
  let _ =
    settings.store(
      settings.Settings(
        ..current,
        durations: settings.Durations(
          ..d,
          presence: settings.PresenceDurations(
            ..d.presence,
            manager_topology_settle_ms: 60_000,
            manager_check_interval_ms: 60_000,
          ),
        ),
      ),
    )
  Nil
}

pub fn execute(method: String, payload: String) -> String {
  server.execute(method, <<payload:utf8>>)
}

// The users an account event sent through this node reaches.
pub fn found(users: List(Int)) -> List(Int) {
  list.filter(users, fn(user) {
    case manager.lookup_all(user, 2000) {
      Ok([_, ..]) -> True
      _ -> False
    }
  })
}
