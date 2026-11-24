// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a draining node hands its presences over before it stops
// (tyne-chat/tyne#905). Once the node is leaving it owns no presences
// (`fork/presence_route.gleam`), but upstream moves a presence only on the
// presence manager's next check, and the deploy stops the old node as soon as
// its sessions and communities have moved, which in the maintainers'
// rehearsals came before that check: every presence was still here at the
// stop. So `app/drain.gleam` calls `begin` when the node announces its drain
// (the drain endpoint, or a stop without one), which starts one loop (one at a
// time, however often the drain starts) that asks every presence here whose
// owner is now another node to move, spread over at most a second as
// upstream's manager spreads its moves, every `early_every_ms`, until none is
// left, the drain is undone or `early_for_ms` has passed. At the stop
// (`run_membership`) `await_moved` asks the ones still here every
// `nudge_every_ms` and waits until none is left, none has anywhere to go (once
// the route table has had `table_settle_ms` to follow the drain, so a node
// whose peers are all leaving or gone does not wait), or `wait_ms` has passed.
// Each request is upstream's `MoveTo` and `MoveRetry`: a presence that is
// settled moves on the first, one in backoff after a refused move (say, because
// the new node's route table was a moment behind) on the second, without
// waiting out its backoff. With no other node to move to, or in bouncer mode,
// nothing happens.

import fluxer_gateway/cluster/router
import fluxer_gateway/config/draining
import fluxer_gateway/config/durations
import fluxer_gateway/core/clock
import fluxer_gateway/presence/pids
import fluxer_gateway/presence/protocol
import fluxer_gateway/presence/remote
import fluxer_gateway/presence/route
import gleam/erlang/atom.{type Atom}
import gleam/erlang/process
import gleam/int
import gleam/list
import gleam/option.{None}
import logging

const wait_ms = 5000

const poll_ms = 50

const nudge_every_ms = 500

const early_every_ms = 1000

const early_for_ms = 120_000

// The route table follows a drain within `route_rebuild_interval_ms` (1 s):
// until then a presence whose owner is about to change still looks settled.
const table_settle_ms = 1500

// One loop at a time, however often the drain is started.
fn early_name() -> process.Name(Nil) {
  route.local_name("fork_presence_drain_early")
}

pub fn begin() -> Nil {
  case elsewhere(), process.named(early_name()) {
    True, Error(Nil) -> {
      let deadline = clock.monotonic_ms() + early_for_ms
      let _ =
        process.spawn_unlinked(fn() {
          case process.register(process.self(), early_name()) {
            Ok(Nil) -> early(deadline)
            Error(Nil) -> Nil
          }
        })
      Nil
    }
    _, _ -> Nil
  }
}

fn early(deadline: Int) -> Nil {
  let stop =
    pids.count() == 0
    || clock.monotonic_ms() >= deadline
    || !draining.is_draining()
  case stop {
    True -> Nil
    False -> {
      let _ = nudge(int.min(durations.presence().manager_move_spread_ms, 1000))
      process.sleep(early_every_ms)
      early(deadline)
    }
  }
}

pub fn await_moved() -> Nil {
  case elsewhere() {
    False -> Nil
    True -> {
      let started = clock.monotonic_ms()
      let left = wait(started, started - nudge_every_ms)
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

fn elsewhere() -> Bool {
  let self = remote.self_atom()
  !router.bouncer_mode()
  && list.any(route.presence_nodes(), fn(found) { found != self })
}

// Asks the presences that have another owner to move, every `nudge_every_ms`,
// until none is left here, none has anywhere to go (once the route table has
// had time to follow the drain), or `wait_ms` has passed.
fn wait(started: Int, nudged_at: Int) -> Int {
  let now = clock.monotonic_ms()
  case pids.count() {
    0 -> 0
    left if now >= started + wait_ms -> left
    left -> {
      let #(nudged_at, movable) = case now - nudged_at >= nudge_every_ms {
        True -> #(now, nudge(0))
        False -> #(nudged_at, -1)
      }
      case movable == 0 && now - started >= table_settle_ms {
        True -> left
        False -> {
          process.sleep(poll_ms)
          wait(started, nudged_at)
        }
      }
    }
  }
}

// Asks every presence here whose owner is another node to move, and returns
// how many it asked.
fn nudge(spread_ms: Int) -> Int {
  let self = remote.self_atom()
  list.fold(route.shards(), 0, fn(asked, shard) {
    list.fold(pids.shard_entries(shard), asked, fn(asked, entry) {
      let #(user, inbox) = entry
      case route.owner(user) {
        Ok(target) if target != self -> {
          ask(inbox, target, spread_ms)
          asked + 1
        }
        _ -> asked
      }
    })
  })
}

fn ask(inbox: pids.Inbox, target: Atom, spread_ms: Int) -> Nil {
  case spread_ms > 0 {
    False -> {
      process.send(inbox, protocol.MoveTo(target))
      process.send(inbox, protocol.MoveRetry(None))
    }
    True -> {
      let after = int.random(spread_ms)
      let _ = process.send_after(inbox, after, protocol.MoveTo(target))
      let _ = process.send_after(inbox, after, protocol.MoveRetry(None))
      Nil
    }
  }
}
