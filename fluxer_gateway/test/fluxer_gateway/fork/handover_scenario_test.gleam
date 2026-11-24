// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a deploy's handover between two real gateway nodes loses nothing
// (tyne-chat/tyne#905). The old node runs alone with presences and a
// community, a new node joins and owns part of them before they have moved,
// then the old node drains and stops. Both nodes must find every presence
// (fork/presence_elsewhere.gleam) and answer for the community
// (fork/guild_elsewhere.gleam), its permissions in a batch included
// (fork/permissions_elsewhere.gleam), all along, and the old node must hand
// its presences over before it stops (fork/presence_route.gleam,
// fork/presence_drain.gleam). Helpers on the peers:
// support/fork_handover_peer.gleam, with upstream's support/presence_nodes
// and support/session_peer.

import fluxer_gateway/cluster/rendezvous
import fluxer_gateway/core/node
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/atom
import gleam/int
import gleam/json
import gleam/list
import gleam/string
import support/cluster_peers.{type Peer} as peers
import support/guild_api
import support/guild_fixture as fixture

fn env(names: List(String), api_url: String) -> List(#(String, String)) {
  [
    #("FLUXER_GATEWAY_PORT", "0"),
    #("FLUXER_GATEWAY_CLUSTER_ENABLED", "true"),
    #("FLUXER_GATEWAY_CLUSTER_STATIC_PEERS", string.join(names, ",")),
    #("FLUXER_GATEWAY_CLUSTER_DISCOVERY_POLL_INTERVAL_MS", "200"),
    #("FLUXER_NATS_URL", "nats://127.0.0.1:1"),
    #("FLUXER_INTERNAL_API_ENDPOINT", "http://127.0.0.1:1"),
    #("FLUXER_GATEWAY_API_RPC_ENDPOINT", api_url),
    #("FLUXER_GATEWAY_LOGGER_LEVEL", "critical"),
  ]
}

fn boot(name: String, names: List(String), api_url: String) -> Peer {
  let peer = peers.start(name, env(names, api_url))
  let started =
    peers.call(peer, "application", "ensure_all_started", [
      atom.to_dynamic(atom.create("fluxer_gateway")),
    ])
  let assert Ok("ok") =
    decode.run(
      started,
      decode.at([0], atom.decoder()) |> decode.map(atom.to_string),
    )
    as { "gateway failed to start on peer: " <> string.inspect(started) }
  peer
}

fn on(peer: Peer, module: String, function: String, args: List(Dynamic)) {
  peers.call(peer, module, function, args)
}

fn arg(value: a) -> Dynamic {
  peers.to_dynamic(value)
}

fn ints(found: Dynamic) -> List(Int) {
  let assert Ok(value) = decode.run(found, decode.list(decode.int))
    as string.inspect(found)
  value
}

fn strings(found: Dynamic) -> List(String) {
  let assert Ok(value) = decode.run(found, decode.list(decode.string))
    as string.inspect(found)
  value
}

fn hosted(peer: Peer, users: List(Int)) -> List(Int) {
  ints(on(peer, "support@presence_nodes", "hosted", [arg(users)]))
}

fn owners(peer: Peer, users: List(Int)) -> List(String) {
  strings(on(peer, "support@presence_nodes", "owners", [arg(users)]))
}

fn found(peer: Peer, users: List(Int)) -> List(Int) {
  ints(on(peer, "support@fork_handover_peer", "found", [arg(users)]))
}

fn runs(peer: Peer, guild: Int) -> Bool {
  let found = on(peer, "support@fork_handover_peer", "runs", [arg(guild)])
  let assert Ok(value) = decode.run(found, decode.bool) as string.inspect(found)
  value
}

fn serving(peer: Peer) -> List(String) {
  strings(on(peer, "support@session_peer", "serving", []))
}

fn execute(peer: Peer, method: String, body: json.Json) -> String {
  let found =
    on(peer, "support@fork_handover_peer", "execute", [
      arg(method),
      arg(json.to_string(body)),
    ])
  let assert Ok(text) = decode.run(found, decode.string)
    as string.inspect(found)
  text
}

fn community_name(peer: Peer, guild: Int) -> Result(String, String) {
  let body =
    execute(
      peer,
      "guild.get_data",
      json.object([
        #("guild_id", json.string(int.to_string(guild))),
        #("user_id", json.null()),
      ]),
    )
  case json.parse(body, decode.at(["result", "name"], decode.string)) {
    Ok(name) -> Ok(name)
    Error(_) -> Error(body)
  }
}

// `guild.get_user_permissions`, one community: `guild_elsewhere` covers it.
fn permissions(peer: Peer, guild: Int, user: Int) -> Result(String, String) {
  let body =
    execute(
      peer,
      "guild.get_user_permissions",
      json.object([
        #("guild_id", json.string(int.to_string(guild))),
        #("user_id", json.string(int.to_string(user))),
        #("channel_id", json.string("0")),
      ]),
    )
  case json.parse(body, decode.at(["result", "permissions"], decode.string)) {
    Ok(bits) -> Ok(bits)
    Error(_) -> Error(body)
  }
}

// `guild.get_user_permissions_batch`, which `GET /users/@me/guilds` asks:
// the communities it answers for and their permissions.
fn permissions_batch(
  peer: Peer,
  guild: Int,
  user: Int,
) -> Result(List(#(String, String)), String) {
  let body =
    execute(
      peer,
      "guild.get_user_permissions_batch",
      json.object([
        #("guild_ids", json.array([int.to_string(guild)], json.string)),
        #("user_id", json.string(int.to_string(user))),
        #("channel_id", json.string("0")),
      ]),
    )
  let row = {
    use found <- decode.field("guild_id", decode.string)
    use bits <- decode.field("permissions", decode.string)
    decode.success(#(found, bits))
  }
  case
    json.parse(body, decode.at(["result", "permissions"], decode.list(row)))
  {
    Ok(rows) -> Ok(rows)
    Error(_) -> Error(body)
  }
}

// The body of a community request, which must answer, the same on both
// nodes while the community runs on the old one (fork/guild_elsewhere.gleam).
fn asked(
  peer: Peer,
  method: String,
  guild: Int,
  fields: List(#(String, json.Json)),
) -> String {
  execute(
    peer,
    method,
    json.object([#("guild_id", json.string(int.to_string(guild))), ..fields]),
  )
}

fn owned_by(wanted: String, among: List(String)) -> fixture.Guild {
  let found = fixture.new(1) |> fixture.with_text(10)
  let nodes = list.map(among, fn(name) { node.from_atom(atom.create(name)) })
  let target = node.from_atom(atom.create(wanted))
  case rendezvous.select(found.id, nodes) {
    Ok(owner) if owner == target -> found
    _ -> owned_by(wanted, among)
  }
}

fn users_from(base: Int, count: Int) -> List(Int) {
  int.range(1, count + 1, [], list.prepend)
  |> list.reverse
  |> list.map(fn(n) { base + n })
}

pub fn a_joining_node_and_the_old_nodes_drain_lose_nothing_test() {
  use api <- guild_api.with_api_for(120_000)
  let old = peers.unique_name("fork_hold")
  let new = peers.unique_name("fork_hnew")
  let both = list.sort([old, new], string.compare)
  let users = users_from(7_905_000_000_000_000, 24)

  // The old node alone, as production before a deploy: presences and a
  // community whose owner will be the new node.
  let peer_old = boot(old, [old], api.url)
  let _ = on(peer_old, "support@fork_handover_peer", "hold_presence_moves", [])
  let _ =
    on(peer_old, "support@session_peer", "slow_handoff_debounce", [
      arg(600_000),
    ])
  let assert Ok(24) =
    decode.run(
      on(peer_old, "support@presence_nodes", "start_sessions", [
        arg(users),
        arg(1),
      ]),
      decode.int,
    )
  let member = 7_905_100_000_000_001
  let community = owned_by(new, both) |> fixture.with_member(member, [])
  fixture.publish(api, community)
  assert community_name(peer_old, community.id) == Ok("Scenario")
  let other = owned_by(new, both)
  fixture.publish(api, other)
  assert community_name(peer_old, other.id) == Ok("Scenario")
  let assert Ok(bits) = permissions(peer_old, community.id, member)
  let listed = Ok([#(int.to_string(community.id), bits)])
  assert permissions_batch(peer_old, community.id, member) == listed

  // The new node joins. Until its presences and the community move, which the
  // test holds back, it owns some that still run on the old node.
  let peer_new = boot(new, [old, new], api.url)
  assert peers.wait_until(30_000, fn() {
    serving(peer_old) == both && serving(peer_new) == both
  })
  assert peers.wait_until(5000, fn() {
    list.contains(owners(peer_new, users), new)
    && list.contains(owners(peer_old, users), new)
  })
  assert hosted(peer_old, users) == users
  assert hosted(peer_new, users) == []
  assert found(peer_new, users) == users
  assert found(peer_old, users) == users
  assert community_name(peer_new, community.id) == Ok("Scenario")
  assert community_name(peer_old, community.id) == Ok("Scenario")
  assert permissions(peer_new, community.id, member) == Ok(bits)
  assert permissions_batch(peer_new, community.id, member) == listed
  assert permissions_batch(peer_old, community.id, member) == listed
  // Requests whose handlers read the read model and turn a miss into their
  // own answer, and a voice request, answer on the new owner as on the node
  // the community runs on.
  let user = [#("user_id", json.string(int.to_string(member)))]
  list.each(
    [
      #("guild.get_viewable_channels", user),
      #("guild.resolve_channel_mentions", [
        #("channel_ids", json.array(["10"], json.string)),
      ]),
      #("guild.get_member", user),
      #("guild.get_voice_state", user),
    ],
    fn(request) {
      let #(method, fields) = request
      let on_old = asked(peer_old, method, community.id, fields)
      assert string.starts_with(on_old, "{\"ok\":true") as on_old
      assert asked(peer_new, method, community.id, fields) == on_old as method
    },
  )
  // A stop sent to the new owner stops the community where it runs and
  // answers as a stop does (a second community, so the first keeps running).
  assert runs(peer_old, other.id)
  let stopped = asked(peer_new, "guild.stop", other.id, [])
  assert string.starts_with(stopped, "{\"ok\":true") as stopped
  assert !runs(peer_old, other.id)
  assert !runs(peer_new, other.id)
  // A second session of each user, started on the new node, joins the
  // presence on the old node instead of starting another one there.
  let assert Ok(24) =
    decode.run(
      on(peer_new, "support@presence_nodes", "start_sessions", [
        arg(users),
        arg(2),
      ]),
      decode.int,
    )
  assert hosted(peer_new, users) == []
  assert hosted(peer_old, users) == users
  assert found(peer_new, users) == users

  // The old node drains and stops: its presences move first. They move as the
  // drain starts (fork/presence_drain.gleam `begin`), before the stop, since
  // the test holds back upstream's presence manager (`hold_presence_moves`).
  let _ = on(peer_old, "support@session_peer", "drain_start", [])
  assert peers.wait_until(15_000, fn() { hosted(peer_old, users) == [] })
  assert found(peer_new, users) == users
  let _ = on(peer_old, "support@session_peer", "prep_stop", [])
  assert hosted(peer_old, users) == []
  assert hosted(peer_new, users) == users
  assert found(peer_new, users) == users
  peers.stop(peer_old)
  assert found(peer_new, users) == users
  assert community_name(peer_new, community.id) == Ok("Scenario")
  assert permissions_batch(peer_new, community.id, member) == listed
  peers.stop(peer_new)
}
