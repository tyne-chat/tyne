// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: lets upstream's session/scenario_start_test.gleam
// `session_cap_is_freed_by_ended_and_crashed_sessions_test` wait until the
// killed session's manager shard has released its user-session lease, before
// starting the replacement session at the cap (tyne-chat/tyne#931).
//
// The test crowds `user` to 99 sessions, starts `second` (bringing the count
// to 100), kills `second`, and waits only for `h.await_exit` (its own monitor)
// and `registry.lookup(...) == Error(Nil)` (which checks `process.is_alive`).
// Unlike a clean terminate, a killed session does not call `leases.release`
// itself: its shard releases the lease only when it handles its own DOWN in
// `on_down`. A new session gets a fresh session_id (usually a different shard),
// so if `third` reaches `reserve` before `second`'s shard processes DOWN, it
// gets `StartTooManySessions` and `h.ready_session` fails.
//
// A stopgap: when upstream makes that test wait for the user-session count
// itself (as `scenario_quota_recovery_test.gleam` already does), drop this
// module and the test's two fork lines.

import support/session_harness as h

pub fn wait(user: Int, expected: Int) -> Nil {
  assert h.wait_until(fn() { h.user_sessions(user) == expected }, 2000)
}
