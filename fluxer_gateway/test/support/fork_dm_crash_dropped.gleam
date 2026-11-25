// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: lets upstream's voice/crash_scenario_test.gleam
// `dm_call_crash_frees_the_per_channel_connection_limit_test` wait until the
// DM server has dropped the crashed call's voice states, before its sixth join
// (tyne-chat/tyne#926).
//
// The test kills the call and waits only until the call manager stops finding
// it. The manager's lookup asks `process.is_alive`, which turns false when the
// call leaves the process table; the call sends the DM server its DOWN later in
// its exit (OTP's erl_process.c removes the process, "Time of death!", before
// it handles links and monitors, and may yield in between). On a busy machine
// the sixth join then reaches the DM server ahead of the DOWN, while the five
// connections still fill the DM server's limit of five (`connection_limit`),
// so the join is refused without a reply and the test waits in vain for its
// VOICE_SERVER_UPDATE (crash_scenario_test.gleam:113). The test's two
// neighbours already wait for the DM states to be dropped after `call_gone`;
// this is the same wait, read the same way as their `dm_entries`.
//
// A stopgap: when upstream makes that test wait itself, drop this module and
// the test's two fork lines.

import fluxer_gateway/voice/dm/server as dm_server
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process
import support/voice_api as api
import support/voice_session as fake

@external(erlang, "sys", "get_state")
fn get_state(pid: process.Pid) -> Dynamic

pub fn wait(session: fake.Fake) -> Nil {
  assert api.eventually(fn() { dropped(session) })
}

fn dropped(session: fake.Fake) -> Bool {
  let assert Ok(subject) = dm_server.lookup(session.ref)
  let assert Ok(pid) = process.subject_owner(subject)
  let assert Ok(states) =
    decode.run(
      get_state(pid),
      decode.at([5, 1], decode.dict(decode.dynamic, decode.dynamic)),
    )
  dict.is_empty(states)
}
