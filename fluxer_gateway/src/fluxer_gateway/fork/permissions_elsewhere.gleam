// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: `guild.get_user_permissions_batch` while a community moves between
// gateway nodes (tyne-chat/tyne#905). The batch asks each community's owner
// (`one` in `guild/rpc/permissions.gleam`) and leaves out a community the
// owner cannot answer for. During a handover the owner changes before the
// community moves (fork/guild_elsewhere.gleam), so the batch left out every
// community still on its way, and `GET /users/@me/guilds` listed them without
// permissions. `one` hands every answer here; a community left out is asked
// again where it runs, this node or a peer (fork/guild_whereabouts.gleam),
// through upstream's `owned_bits`, which every gateway version has. A node
// that was already asked is not asked again, and a community that runs nowhere
// keeps upstream's answer.

import fluxer_gateway/cluster/router
import fluxer_gateway/core/id.{type ChannelId, type GuildId, type UserId}
import fluxer_gateway/core/node.{type Node}
import fluxer_gateway/fork/guild_whereabouts
import fluxer_gateway/guild/manager/registry
import fluxer_gateway/guild/remote
import fluxer_gateway/guild/rpc/infra
import gleam/dynamic/decode
import gleam/option.{type Option}
import gleam/result

pub fn bits(
  found: Result(Int, Nil),
  guild: GuildId,
  user: UserId,
  channel: Option(ChannelId),
  owned: fn(GuildId, UserId, Option(ChannelId)) -> #(Bool, Int),
) -> Result(Int, Nil) {
  case found {
    Ok(_) -> found
    Error(Nil) -> elsewhere(guild, user, channel, owned)
  }
}

fn elsewhere(
  guild: GuildId,
  user: UserId,
  channel: Option(ChannelId),
  owned: fn(GuildId, UserId, Option(ChannelId)) -> #(Bool, Int),
) -> Result(Int, Nil) {
  let asked = router.owner(router.GuildKey(guild), node.Guilds)
  case registry.lookup(guild), asked {
    Ok(_), router.Local -> Error(Nil)
    Ok(_), _ -> answered(owned(guild, user, channel))
    Error(Nil), _ ->
      guild_whereabouts.peer_running(guild)
      |> result.try(fn(peer) {
        case asked == router.Remote(peer) {
          True -> Error(Nil)
          False -> ask(peer, guild, user, channel)
        }
      })
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
    infra.forward_timeout_ms(),
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
