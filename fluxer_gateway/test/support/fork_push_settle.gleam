// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the test runner's reset between tests (support/isolation.gleam
// `restore`) waits for the push work the last test left running. A test that
// publishes community messages starts push jobs that ask the API for the
// recipients' settings. Upstream's session harness waits for them when its
// scope ends (15 s at most); the other API harnesses do not, so jobs can
// outlive their test and its API stub. Their requests then go to the default
// API address, where nothing listens, and the refusals open the API circuit
// breaker that the whole run shares: on 2026-11-24 they opened it just after
// the next test had reset it, and that test's communities waited 16 s to load
// (`session/scenario_move_rebind_test.gleam` failed in the nightly).
//
// `settle` waits until the push server is idle, for at most `settle_ms`, and
// closes the breaker on each look, so the leftover requests fail at once
// rather than sleeping until the breaker would retry. Without push work, or
// without a push server, it returns at once. The reset then closes the breaker
// for the next test as before.
//
// A stopgap for an upstream gap (tyne-chat/tyne#916): when upstream settles or
// stops leftover work between tests itself, or stops sharing the breaker
// across tests, delete this module, its hook and import in
// support/isolation.gleam, and fork/isolation_push_settle_test.gleam. The
// nightly rebase agent has this as a maintainer decision (tyne-tools
// rebase/profiles.py).

import fluxer_gateway/api/http
import fluxer_gateway/push/server as push_server
import gleam/erlang/process
import gleam/int
import gleam/io
import support/wait

const settle_ms = 20_000

const look_every_ms = 50

pub fn settle() -> Nil {
  case process.named(push_server.name()) {
    Error(Nil) -> Nil
    Ok(_) -> {
      let settled =
        wait.until_every(settle_ms, look_every_ms, fn() {
          http.reset_breaker()
          push_server.is_idle(push_server.name())
        })
      case settled {
        True -> Nil
        False ->
          io.println_error(
            "fork_push_settle: push work from the last test still runs after "
            <> int.to_string(settle_ms)
            <> " ms",
          )
      }
    }
  }
}
