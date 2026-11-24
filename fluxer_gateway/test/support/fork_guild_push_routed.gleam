// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: lets a test wait until a community's push routing has finished, before
// it stops the community. A small community routes a message's push in a worker
// of its own, at low priority (guild/push/dispatch.gleam `run_wide`), so
// `guild_fixture.sync` does not cover it. A community stopped before that worker
// has read its members skips the push by design ("guild push skipped because
// the members table was released before routing finished"). On a busy machine
// that happens to upstream's guild/push/grace_scenario_test.gleam
// `a_hold_released_on_the_rebuilt_guild_is_pushed_test`: the push it waits for
// is never held, and the test fails at its last check (line 135 on 2026-11-24;
// 4 of 4 runs at 0.3 CPU, and once in upstream's own CI). tyne-chat/tyne#917.
//
// `mark` before the dispatch, `wait` before the stop. A stopgap: when upstream
// makes that test wait for its routing itself, drop this module and the test's
// two fork lines.

import fluxer_gateway/telemetry/metrics
import support/wait

const completed = "fluxer_gateway_guild_push_counters_total"

const wait_ms = 10_000

pub opaque type Mark {
  Mark(completed: Int)
}

pub fn mark() -> Mark {
  Mark(completed: completed_workers())
}

/// Waits until a routing worker started after `mark` has finished, for at most
/// 10 s; the test's own checks then say whether the push went where it should.
pub fn wait(mark: Mark) -> Nil {
  let _ = wait.until(wait_ms, fn() { completed_workers() > mark.completed })
  Nil
}

fn completed_workers() -> Int {
  metrics.value(metrics.read_all(), completed, [#("key", "worker_completed")])
}
