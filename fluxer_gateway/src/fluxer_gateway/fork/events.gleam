// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: how the gateway routes the fork's community events. Upstream's
// `guild/dispatch/event.gleam` (`is_channel_scoped`) and
// `guild/sessions/passive.gleam` (`bypasses`) hand every event name they do
// not know to these two functions.

// Signal events about one channel go only to the members who can see that
// channel, as upstream's message and typing events do. Without this, every
// member would receive the signals of private channels they cannot open
// (tyne-chat/tyne#905).
pub fn is_channel_scoped(event: String) -> Bool {
  case event {
    "CHANNEL_SIGNAL_UPDATE" | "CHANNEL_SIGNAL_BAR_UPDATE" -> True
    _ -> False
  }
}

// Community-wide fork events that passive sessions (communities above
// upstream's small-guild size) still need: the signal bar's settings and the
// community's server commands. The channel signals stay filtered for passive
// sessions, as upstream filters messages (tyne-chat/tyne#313).
pub fn bypasses_passive(event: String) -> Bool {
  case event {
    "SIGNAL_BAR_UPDATE" | "GUILD_COMMANDS_UPDATE" -> True
    _ -> False
  }
}
