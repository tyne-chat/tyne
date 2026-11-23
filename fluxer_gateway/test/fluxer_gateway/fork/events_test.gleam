// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's community events in upstream's dispatch rules
// (fork/events.gleam). The routing through a running community is in
// guild/scenario/fork_signal_events_test.gleam.

import fluxer_gateway/core/json_tree
import fluxer_gateway/core/raw_json
import fluxer_gateway/fork/events as fork_events
import fluxer_gateway/guild/dispatch/event.{ChannelEvent, GuildWide}
import gleam/list
import gleam/option.{Some}

fn data(text: String) -> json_tree.JsonTree {
  json_tree.from_raw(raw_json.wrap_string(text))
}

pub fn channel_signals_are_scoped_to_their_channel_test() {
  let signal = data("{\"guild_id\":\"1\",\"channel_id\":\"20\"}")
  assert event.scope("CHANNEL_SIGNAL_UPDATE", signal) == ChannelEvent(Some(20))
  assert event.scope("CHANNEL_SIGNAL_BAR_UPDATE", signal)
    == ChannelEvent(Some(20))
}

pub fn community_wide_fork_events_stay_community_wide_test() {
  let community = data("{\"guild_id\":\"1\"}")
  assert event.scope("SIGNAL_BAR_UPDATE", community) == GuildWide
  assert event.scope("GUILD_COMMANDS_UPDATE", community) == GuildWide
  assert !fork_events.is_channel_scoped("SIGNAL_BAR_UPDATE")
  assert !fork_events.is_channel_scoped("GUILD_COMMANDS_UPDATE")
}

pub fn only_the_signal_bar_and_server_commands_bypass_the_passive_filter_test() {
  assert fork_events.bypasses_passive("SIGNAL_BAR_UPDATE")
  assert fork_events.bypasses_passive("GUILD_COMMANDS_UPDATE")
  // tyne-chat/tyne#313: passive sessions do not get the channel signals.
  assert !fork_events.bypasses_passive("CHANNEL_SIGNAL_UPDATE")
  assert !fork_events.bypasses_passive("CHANNEL_SIGNAL_BAR_UPDATE")
  assert !fork_events.bypasses_passive("GUILD_PERSONAS_DIRTY")
}

// A regression guard: the Erlang gateway refused event names it had no atom
// for. Upstream's Gleam gateway takes any name of capitals, digits and
// underscores; the fork's names must stay that way.
pub fn the_fork_event_names_are_accepted_test() {
  [
    "USER_PERSONA_CREATE", "USER_PERSONA_UPDATE", "USER_PERSONA_DELETE",
    "USER_PERSONAS_UPDATE", "USER_PERSONA_SETTINGS_UPDATE",
    "USER_PERSONA_CHANNEL_STATE_UPDATE", "USER_PERSONA_GROUPS_UPDATE",
    "GUILD_PERSONAS_DIRTY", "SIGNAL_BAR_UPDATE", "CHANNEL_SIGNAL_UPDATE",
    "CHANNEL_SIGNAL_BAR_UPDATE", "GUILD_COMMANDS_UPDATE", "FORK_DM_THREAD_EVENT",
  ]
  |> list.each(fn(name) {
    assert event.normalize(name) == Ok(name)
  })
}
