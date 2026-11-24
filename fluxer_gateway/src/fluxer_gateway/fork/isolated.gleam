// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: runs a round of lookups on other gateway nodes in a process of its own
// (tyne-chat/tyne#905), for fork/presence_elsewhere.gleam and
// fork/guild_whereabouts.gleam. A round spawns a prober per peer and stops
// waiting at its deadline; a prober that answers later would leave its message
// in the caller's mailbox, and the callers include long-lived processes
// (sessions, voice and DM servers). Here the probers answer the helper, which
// sends its caller one result and ends, so a late answer goes to a process
// that is gone. As upstream's `isolated` in `presence/remote.gleam`.

import fluxer_gateway/util/spawn
import gleam/erlang/process

pub fn run(work: fn() -> a, crashed: a) -> a {
  let outcome = process.new_subject()
  let #(_, monitor) = spawn.monitored(fn() { process.send(outcome, work()) })
  let received =
    process.new_selector()
    |> process.select(outcome)
    |> process.select_specific_monitor(monitor, fn(_) { crashed })
    |> process.selector_receive_forever
  process.demonitor_process(monitor)
  received
}
