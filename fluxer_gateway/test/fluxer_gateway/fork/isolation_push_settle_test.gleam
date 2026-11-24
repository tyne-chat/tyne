// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the runner's reset between tests waits for the push work the last test
// left running, so that work cannot open the shared API circuit breaker while
// the next test runs (support/fork_push_settle.gleam). The push work here asks
// a slow API for the recipients' settings, as a test whose scope ends before
// its push jobs do leaves them running; the reset must return only once the
// push server is idle, with the breaker closed.

import fluxer_gateway/api/http
import fluxer_gateway/push/message
import fluxer_gateway/push/server as push_server
import fluxer_gateway/push/throttle
import gleam/dynamic.{type Dynamic}
import gleam/erlang/process
import gleam/string
import support/isolation
import support/push_job_fixture as job
import support/push_throttle
import support/session_harness as h

fn slow_user_lookups(kind: String, body: Dynamic) -> h.Reply {
  case string.starts_with(kind, "get_user") {
    True -> process.sleep(500)
    False -> Nil
  }
  h.empty_ok(kind, body)
}

pub fn the_reset_between_tests_waits_for_push_work_left_running_test() {
  push_throttle.calm(throttle.UserGuildSettings)
  push_throttle.calm(throttle.BlockedIds)
  let base = job.guild_message()
  let create =
    message.MessageCreate(..base, recipients: [h.unique_user(), h.unique_user()])
  use <- h.with_api(slow_user_lookups)
  push_server.handle_message_create(create)
  assert !push_server.is_idle(push_server.name())
  isolation.reset()
  assert push_server.is_idle(push_server.name())
  assert http.is_closed()
}
