// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's signal events and server commands through a running
// community (fork/events.gleam): a channel's signals reach only the members
// who can see the channel, and passive sessions (a community above the small
// size) get the signal bar and the server commands but not the channel
// signals (tyne-chat/tyne#313).

import fluxer_gateway/guild/scenario/passive_test
import gleam/erlang/process
import gleam/json.{type Json}
import gleam/list
import gleam/option.{type Option, None, Some}
import support/guild_api
import support/guild_fixture.{RoleAllow, RoleDeny} as fixture
import support/guild_session as fake

const role = 50

const open_channel = 10

const secret_channel = 20

const fork_events = [
  "SIGNAL_BAR_UPDATE", "CHANNEL_SIGNAL_UPDATE", "CHANNEL_SIGNAL_BAR_UPDATE",
  "GUILD_COMMANDS_UPDATE",
]

fn secret_guild() -> fixture.Guild {
  let found = fixture.new(1)
  found
  |> fixture.with_role(role, 0, 1)
  |> fixture.with_text(open_channel)
  |> fixture.with_channel(secret_channel, 0, None, [
    RoleDeny(found.id, fixture.view_channel),
    RoleAllow(role, fixture.view_channel),
  ])
  |> fixture.with_member(2, [])
}

fn int_text(value: Int) -> String {
  json.to_string(json.int(value))
}

fn payload(found: fixture.Guild, channel: Option(Int)) -> Json {
  let channel_field = case channel {
    Some(id) -> [#("channel_id", json.string(int_text(id)))]
    None -> []
  }
  json.object([#("guild_id", json.string(int_text(found.id))), ..channel_field])
}

// The fork's events a session received, with their channel, in order, up to
// and including the first `last`. Events are delivered in the order they
// were dispatched, so an event dispatched before `last` and not in the list
// was not sent.
fn fork_events_until(
  session: fake.FakeSession,
  last: String,
) -> List(#(String, Option(String))) {
  collect(session, last, [])
}

fn collect(
  session: fake.FakeSession,
  last: String,
  acc: List(#(String, Option(String))),
) -> List(#(String, Option(String))) {
  case process.receive(session.seen, 5000) {
    Error(Nil) -> list.reverse(acc)
    Ok(item) ->
      case fake.only_dispatches([item]) {
        [#(name, data)] ->
          case list.contains(fork_events, name) {
            False -> collect(session, last, acc)
            True -> {
              let acc = [#(name, fake.text_at(data, ["channel_id"])), ..acc]
              case name == last {
                True -> list.reverse(acc)
                False -> collect(session, last, acc)
              }
            }
          }
        _ -> collect(session, last, acc)
      }
  }
}

pub fn channel_signals_reach_only_members_who_see_the_channel_test() {
  use api <- guild_api.with_api
  let found = secret_guild()
  let handle = fixture.started(api, found)
  let owner = fake.start(1)
  let member = fake.start(2)
  assert fake.is_joined(fake.join(owner, handle))
  assert fake.is_joined(fake.join(member, handle))
  fixture.dispatch(
    handle,
    "CHANNEL_SIGNAL_UPDATE",
    payload(found, Some(secret_channel)),
  )
  fixture.dispatch(
    handle,
    "CHANNEL_SIGNAL_BAR_UPDATE",
    payload(found, Some(secret_channel)),
  )
  fixture.dispatch(handle, "SIGNAL_BAR_UPDATE", payload(found, None))
  fixture.dispatch(
    handle,
    "CHANNEL_SIGNAL_BAR_UPDATE",
    payload(found, Some(open_channel)),
  )
  let secret = Some(int_text(secret_channel))
  let open = Some(int_text(open_channel))
  assert fork_events_until(owner, "SIGNAL_BAR_UPDATE")
    == [
      #("CHANNEL_SIGNAL_UPDATE", secret),
      #("CHANNEL_SIGNAL_BAR_UPDATE", secret),
      #("SIGNAL_BAR_UPDATE", None),
    ]
  assert fork_events_until(owner, "CHANNEL_SIGNAL_BAR_UPDATE")
    == [#("CHANNEL_SIGNAL_BAR_UPDATE", open)]
  assert fork_events_until(member, "CHANNEL_SIGNAL_BAR_UPDATE")
    == [#("SIGNAL_BAR_UPDATE", None), #("CHANNEL_SIGNAL_BAR_UPDATE", open)]
  fixture.stop(found)
}

pub fn passive_sessions_get_the_signal_bar_and_server_commands_test() {
  use api <- guild_api.with_api
  let found = passive_test.big_guild()
  let handle = fixture.started(api, found)
  let member = fake.start(2)
  assert fake.is_joined(passive_test.passive_join(member, handle))
  let open = payload(found, Some(open_channel))
  fixture.dispatch(handle, "CHANNEL_SIGNAL_UPDATE", open)
  fixture.dispatch(handle, "CHANNEL_SIGNAL_BAR_UPDATE", open)
  fixture.dispatch(handle, "SIGNAL_BAR_UPDATE", payload(found, None))
  fixture.dispatch(handle, "GUILD_COMMANDS_UPDATE", payload(found, None))
  assert fork_events_until(member, "GUILD_COMMANDS_UPDATE")
    == [#("SIGNAL_BAR_UPDATE", None), #("GUILD_COMMANDS_UPDATE", None)]
  fixture.stop(found)
}
