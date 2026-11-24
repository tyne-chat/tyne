// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a draining node stops only once its presences have moved
// (tyne-chat/tyne#905). Once the node is leaving it owns no presences
// (`fork/presence_route.gleam`), and each presence moves to its new owner on
// the presence manager's next check. The deploy stops the old node as soon as
// its sessions and communities have moved, which can be before that check:
// `app/drain.gleam` (`run_membership`, the stop) calls `await_moved`, which
// asks every presence still here to move now and waits, for at most
// `wait_ms` (within Docker's 10 s stop timeout), until none is left. With no
// other node to move to, it returns at once.

import fluxer_gateway/core/clock
import fluxer_gateway/presence/pids
import fluxer_gateway/presence/protocol
import fluxer_gateway/presence/remote
import fluxer_gateway/presence/route
import gleam/erlang/process
import gleam/int
import gleam/list
import logging

const wait_ms = 5000

const poll_ms = 50

const nudge_every_ms = 500

pub fn await_moved() -> Nil {
  let self = remote.self_atom()
  case list.any(route.presence_nodes(), fn(found) { found != self }) {
    False -> Nil
    True -> {
      let started = clock.monotonic_ms()
      let left = wait(started + wait_ms, started - nudge_every_ms)
      logging.log(
        logging.Info,
        "Gateway drain: presences left after the move: "
          <> int.to_string(left)
          <> " ("
          <> int.to_string(clock.monotonic_ms() - started)
          <> " ms)",
      )
    }
  }
}

fn wait(deadline: Int, nudged_at: Int) -> Int {
  let now = clock.monotonic_ms()
  case pids.count() {
    0 -> 0
    left if now >= deadline -> left
    _ -> {
      let nudged_at = case now - nudged_at >= nudge_every_ms {
        True -> {
          nudge()
          now
        }
        False -> nudged_at
      }
      process.sleep(poll_ms)
      wait(deadline, nudged_at)
    }
  }
}

fn nudge() -> Nil {
  let self = remote.self_atom()
  list.each(route.shards(), fn(shard) {
    list.each(pids.shard_entries(shard), fn(entry) {
      let #(user, inbox) = entry
      case route.owner(user) {
        Ok(target) if target != self ->
          process.send(inbox, protocol.MoveTo(target))
        _ -> Nil
      }
    })
  })
}
