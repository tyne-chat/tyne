// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: runs a community's request on this node for the community's owner
// (fork/guild_elsewhere.gleam, tyne-chat/tyne#905), which calls `run` or
// `voice` here when the community still runs on this node. If it no longer
// does, before or after the request ran (its move ended in between), the
// answer is `fork_guild_not_here` and the owner runs the request itself:
// upstream's handlers would turn the miss into their own error or an empty
// answer. A stop or shutdown is checked only before it runs, as its success
// removes the community. A module of its own, as `guild/rpc.gleam` hands requests to
// fork/guild_elsewhere.gleam, which cannot import it back.

import fluxer_gateway/core/id.{type GuildId}
import fluxer_gateway/guild/manager/registry
import fluxer_gateway/guild/read_model
import fluxer_gateway/guild/rpc as guild_rpc
import fluxer_gateway/guild/rpc/params.{type Params} as rpc_params
import fluxer_gateway/voice/guild_state.{type RpcCall}
import gleam/result

pub fn run(method: String, params: Params) -> #(Bool, BitArray) {
  let work = fn() { guild_rpc.encoded(guild_rpc.handle_local(method, params)) }
  case rpc_params.guild(params), ends_the_community(method) {
    Ok(guild), True -> if_here(guild, work)
    Ok(guild), False -> while_here(guild, work)
    Error(_), _ -> work()
  }
}

pub fn voice(guild: GuildId, call: RpcCall) -> #(Bool, BitArray) {
  while_here(guild, fn() { guild_rpc.voice_owned_encoded(guild, call) })
}

// Requests whose success stops the community here: it is gone afterwards on
// purpose, so only whether it ran here first counts.
fn ends_the_community(method: String) -> Bool {
  method == "guild.stop" || method == "guild.shutdown"
}

fn if_here(
  guild: GuildId,
  work: fn() -> #(Bool, BitArray),
) -> #(Bool, BitArray) {
  case here(guild) {
    False -> not_here()
    True -> work()
  }
}

fn while_here(
  guild: GuildId,
  work: fn() -> #(Bool, BitArray),
) -> #(Bool, BitArray) {
  case here(guild) {
    False -> not_here()
    True -> {
      let answer = work()
      case here(guild) {
        True -> answer
        False -> not_here()
      }
    }
  }
}

// Registered and with its read model: a community that is stopping (at the end
// of its move) deletes its read model first, while its process still runs.
fn here(guild: GuildId) -> Bool {
  result.is_ok(registry.lookup(guild)) && result.is_ok(read_model.get(guild))
}

fn not_here() -> #(Bool, BitArray) {
  #(False, <<"fork_guild_not_here":utf8>>)
}
