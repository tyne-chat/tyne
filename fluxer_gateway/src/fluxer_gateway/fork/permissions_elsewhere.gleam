// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: `guild.get_user_permissions_batch` while a community moves between
// gateway nodes (tyne-chat/tyne#905). The batch asks each community's owner
// (`one` in `guild/rpc/permissions.gleam`) and leaves out a community the
// owner cannot answer for. During a handover the owner changes before the
// community moves (fork/guild_elsewhere.gleam), so the batch left out every
// community still on its way, and `GET /users/@me/guilds` listed them without
// permissions. (The batch reads the read model directly, so the batch does not
// pass through fork/guild_elsewhere.gleam.) `one` hands every answer here; a
// community left out is asked again where it runs now: here, when it runs
// here (it may have arrived since), else on the peer that runs it, and here
// once more if that fails (its move may have ended in between)
// (fork/guild_whereabouts.gleam), through upstream's `owned_bits`, which every
// gateway version has, within `ask_timeout_ms`, which leaves the batch (5 s)
// time to answer. A community that runs nowhere keeps upstream's answer, and
// one that was answered costs nothing more; a member who lacks permissions is
// answered too (with 0), so it never comes here. In bouncer mode, where
// upstream's leases decide who may serve a community, nothing changes.

import fluxer_gateway/cluster/router
import fluxer_gateway/core/id.{type ChannelId, type GuildId, type UserId}
import fluxer_gateway/core/node.{type Node}
import fluxer_gateway/fork/guild_whereabouts
import fluxer_gateway/guild/manager/registry
import fluxer_gateway/guild/remote
import gleam/dynamic/decode
import gleam/option.{type Option}
import gleam/result

const ask_timeout_ms = 3000

pub fn bits(
  found: Result(Int, Nil),
  guild: GuildId,
  user: UserId,
  channel: Option(ChannelId),
  owned: fn(GuildId, UserId, Option(ChannelId)) -> #(Bool, Int),
) -> Result(Int, Nil) {
  case found, router.bouncer_mode() {
    Ok(_), _ | Error(Nil), True -> found
    Error(Nil), False -> {
      let here = fn() {
        case registry.lookup(guild) {
          Ok(_) -> answered(owned(guild, user, channel))
          Error(Nil) -> Error(Nil)
        }
      }
      use <- result.lazy_or(here())
      guild_whereabouts.peer_running(guild)
      |> result.try(ask(_, guild, user, channel))
      // The move may have ended while it was asked: then it is here now.
      |> result.lazy_or(here)
    }
  }
}

fn ask(
  peer: Node,
  guild: GuildId,
  user: UserId,
  channel: Option(ChannelId),
) -> Result(Int, Nil) {
  remote.call(
    peer,
    "fluxer_gateway@guild@rpc@permissions",
    "owned_bits",
    [remote.arg(guild), remote.arg(user), remote.arg(channel)],
    ask_timeout_ms,
    expecting: {
      use found <- decode.field(0, decode.bool)
      use bits <- decode.field(1, decode.int)
      decode.success(#(found, bits))
    },
  )
  |> result.try(answered)
}

fn answered(reply: #(Bool, Int)) -> Result(Int, Nil) {
  case reply {
    #(True, bits) -> Ok(bits)
    #(False, _) -> Error(Nil)
  }
}
