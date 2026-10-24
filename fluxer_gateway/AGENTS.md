# The gateway

The Erlang/OTP service that holds the clients' WebSockets, with a process per socket, gateway
session, signed-in account (presence), loaded community (guild) and DM call. The API reaches it over
NATS (`rpc.gateway.*`) to fan out events and ask about permissions and members; it calls the API
over HTTP (`/internal/rpc`). The code is upstream's, and upstream changes it often. The fork adds
event names, signal-bar routing, a longer resume hold and persona names in push notifications; the
gateway stores no persona data. The protocol is documented in
`fluxer_docs/src/content/docs/gateway/`.

## Where things are

Paths in this folder are under `src/` unless they start with `native/` or `test/`; other paths are
from the repository root.

| Concern | Files |
|---|---|
| Start, roles, supervisor, settings (`FLUXER_*`, read once at boot) | `gateway/fluxer_gateway_app.erl`, `gateway/fluxer_gateway_sup.erl`, `gateway/fluxer_gateway_config.erl` |
| The socket: opcodes, IDENTIFY, RESUME, heartbeats, limits | `gateway/gateway_handler*.erl` |
| RPC from the API; requests to it | `gateway/gateway_nats_rpc_handler.erl`, `gateway/gateway_rpc_*.erl`; `gateway/rpc_client.erl` |
| Sessions, READY, replay, resume; passive rules | `session/`; `session/session_passive.erl` (run by guild processes) |
| Communities: state, fan-out, member list, voice | `guild/` |
| Presence, events sent to an account | `presence/` |
| DM calls; push notifications | `call/`; `push/` and the NIF `native/push_markdown_plaintext_nif` |
| Event names, protocol constants | `utils/event_atoms.erl`, `utils/constants.erl` |

## Processes

- `fluxer_gateway_sup` (`one_for_one`) starts shared children, then those of the node's role,
  `FLUXER_GATEWAY_ROLE`: `sessions`, `presence`, `guilds`, `calls`, `push` or `websocket`; unset
  means `all`. With `FLUXER_GATEWAY_CLUSTER_ENABLED` off (the default), one node does everything
  and is every key's "owner node".
- Each kind has a registered manager under the supervisor (`session_manager`, `presence_manager`,
  `guild_manager`, `call_manager`). The first three start and monitor their own `*_manager_shard`
  gen_servers (one per CPU unless configured); a key (session, user or guild id) picks its shard by
  rendezvous hashing, and in a cluster its node (`gateway/gateway_node_router.erl`).
- Shards start and monitor one gen_server per entity: `session`, `presence` (per account), `guild`
  (per loaded community); `call_manager` starts a `call` per active call.
- The guild process holds the community's state (roles, channels, members, permissions, voice,
  presence) and its connected sessions, and answers the API's permission queries. The session holds
  its seq, replay buffer and guild connections. The presence process holds the account's status and
  receives every event sent to the account.
- The API's requests arrive on `rpc.gateway.<method>` (queue group `gateway`, up to 512 at once).
  `gateway_rpc_router` routes them by prefix (`guild.`, `presence.`, `push.`, `call.`, `voice.`,
  `process.`) to the method tables in `gateway_rpc_*.erl`; the reply is `{"ok": true, "result": …}`
  or `{"ok": false, "error": …}`.

## How an event reaches a session

**Community events** (`guild.dispatch`, `guild.dispatch_many`):

1. `gateway_rpc_guild_lifecycle` turns the name into an atom (next section), finds the guild
   process, starting it if it is not loaded (`gateway_rpc_guild_infra:ensure_guild_pid/1`), casts
   the event and replies `true`. The API's call returns before delivery; later failures are not
   reported.
2. `guild_dispatch:handle_dispatch/3` drops unknown names, skips events while the community is
   unavailable, and applies the threads gate.
3. `process_regular_dispatch/3` adds `guild_id` (and `member` to message, typing and reaction
   events), updates the guild's state and picks sessions (`guild_dispatch_filter`): a channel-scoped
   event (`is_channel_scoped_event/1`) goes to those that can view its `channel_id`, most others to
   all.
4. `guild_dispatch_send` drops the sessions `session_passive:should_receive_event/5` refuses,
   encodes the payload to JSON once (`{pre_encoded, Binary}`) and casts it to the rest. Push
   candidates follow (`guild_dispatch_push`).

**Account events** (`presence.dispatch`, one request per account): the presence process casts the
map to each of the account's sessions (`presence_broadcast:dispatch_to_all_sessions/3`), with no
passive filter. With no session there is no presence process and the event is dropped (a DM
MESSAGE_CREATE becomes a push). A session with over 5,000 queued messages silently misses it
(`shard_utils:safe_cast/2`).

**In the session** (`session/session_dispatch.erl`): `ignored_events` and thread rules filter, the
event gets the next seq, enters the replay buffer and goes to the socket. The frame's `t` is the
atom in upper case.

## Event names

`event_atoms:normalize/1` (through `constants:dispatch_event_atom/1`) looks the name up in the maps
of `utils/event_atoms.erl`, else tries an existing atom for the lower-cased name, else keeps the
binary. Atoms are never freed, so nothing here may call `binary_to_atom` on outside data.

- An unknown name on the community path: the RPC succeeds and the guild logs "guild dispatch dropped
  unknown event"; the API sees no error. On the account path the RPC fails
  (`presence_dispatch_error`).
- The existing-atom fallback can make a missing entry work by accident. The map is the contract.

**Adding an event:** the name in `fluxer_api/src/api/constants/Gateway.ts` and a section in
`fluxer_docs/src/content/docs/gateway/events.md` (nothing checks it since upstream dropped the docs
verifier); the
entry in `event_atoms.erl`, the atom being the name in lower case; for a community event, whether it
is channel-scoped (then it needs `channel_id`) and whether passive sessions get it
(`bypasses_passive_filter/3` or `should_passive_receive/3`); a fork test; a gateway restart.

## Connecting, READY and RESUME

The outline is in `ARCHITECTURE.md` ("Connecting to the gateway"). The details that matter:

- IDENTIFY asks the API once (`session_manager_shard_drain:fetch_rpc_data/2`). READY's base is the
  answer with `guilds` emptied, so a field the API adds there reaches READY with no gateway change.
- IDENTIFY can be held without a reply (rollout paused, draining, at capacity, API 429 or 5xx,
  network error) and is retried every 1–2 s; over 300 a minute per IP it is ignored. A bad payload
  (4002), token (4004) or shard (4010, 4011), a 101st session of the user (4008) or an unexpected
  error (4000) closes the socket.
- The session joins presence (`session_connection_presence` → `presence_session`) and each guild
  (`session_connection_guild`); a guild answers with that user's GUILD_CREATE payload. READY goes
  out once presence and every guild have answered, or after 5 s with the rest unavailable (they
  follow as GUILD_CREATE). A bot gets READY at once.
- **Kept for RESUME**, in the session process: `seq`, `ack_seq` (heartbeats trim the buffer),
  `replay_floor`, the replay buffer (4,096 events or 16 MiB), guild connections with active flags
  and subscriptions, status. READY, events over 2 MiB and those in
  `session_dispatch:should_skip_replay_buffer/1` (member chunks and lists, GUILD_SYNC) are numbered
  but not kept.
- **Hold:** without a socket, `session_monitor:hold_session_for_resume/1` keeps the session for
  `constants:resume_timeout/0` and shows it offline after 5 s. A client close with 1000 or 1001 ends
  it at once (`gateway_handler:exit_on_client_close/1`): that client can never resume.
- **RESUME** works only on a socket without a session (else 4005). A seq beyond the current one or
  below `ack_seq` closes with 4007; an unknown session or a seq below `replay_floor` gets
  INVALID_SESSION. Sessions live only in memory: after a gateway restart every client identifies
  again; a deploy hands them to a new node instead ("Handing the gateway over").
- A new session-state field must also go into `session_lifecycle:serialize_transfer_state/1` and
  `session_init:extract_fields/1`, or moving a session between nodes drops it.

## Passive sessions

- A user's session is passive in each community until its client sends Lazy Request (op 14) with
  `active: true`, except in the IDENTIFY's `initial_guild_id`; bots never are. A community of 250
  members or fewer counts as active for everyone (`session_passive:is_small_guild/1`).
- A passive session in a larger community gets guild, role and channel updates, its own member
  updates, messages that mention it or that it wrote, guild deletes, audit-log entries, and
  PASSIVE_UPDATES every 30 s (`guild/guild_passive_sync.erl`). Turning active sends GUILD_SYNC.
- It misses `GUILD_PERSONAS_DIRTY`, `CHANNEL_SIGNAL_UPDATE` and `CHANNEL_SIGNAL_BAR_UPDATE`, and
  GUILD_SYNC does not make up for them (tyne-chat/tyne#149). Dev communities are small: test with `member_count` above
  250, as `test/fork_session_passive_tests.erl` does.

## Network calls

The gateway's requests go to the API's `/internal/rpc`:

- One `session` request per IDENTIFY, repeated every 1–2 s while the identify is held.
- Loading a community: six requests plus one per 1,000 members
  (`guild/guild_manager_shard_fetch.erl`), on any start, `guild.dispatch` included. The 30 s stop
  of an empty guild is armed only when a session leaves
  (`guild/guild_sessions_connect_cleanup.erl`), so a community loaded by a dispatch nobody joins
  stays loaded (read in the code, not observed). An API fan-out to every community, such as the
  fork's `SIGNAL_BAR_UPDATE`, loads them all (tyne-chat/tyne#149).

## Erlang traps

- **Clauses stay together.** A function's clauses must be contiguous and the first match wins; a
  clause after the catch-all (`(_) -> false`) never runs. So fork clauses sit inside upstream's.
- **An exception crashes the process**; nothing in a guild's dispatch path catches. When a guild
  crashes, each of its sessions sends GUILD_DELETE `unavailable: true` and reconnects a second
  later, which reloads the guild from the API; when a session crashes, its socket sends
  INVALID_SESSION. Read payload fields with `maps:get/3` and a default; a channel-scoped event
  without `channel_id` throws (`guild_dispatch_filter:extract_channel_id/2`).
- **Never block a guild or session.** `gen_server:call` waits (5 s by default) and exits the caller
  on timeout; two processes calling each other deadlock. Fan-out uses casts; slow work runs in
  spawned workers. The watchdog kills a guild whose mailbox keeps growing past 50,000.
- **Payloads are maps with binary keys**: `maps:get(<<"channel_id">>, Data, undefined)`.
- **No reload in development:** the gateway is compiled when the orchestrator starts it
  (`tools/dev/src/gateway.rs`); restart the orchestrator after an Erlang change.
- **erlfmt** covers `src` and `test`: `rebar3 fmt` in `fluxer_gateway` rewrites in place; check
  that only fork lines moved. Give every function a `-spec`, as upstream does.

## The fork's code

| Where | What | Kind |
|---|---|---|
| `push/fork_push_personas.erl` | the persona's name (title) and picture (icon) from `subprofile`, mentioned personas' names from `mention_personas` | fork-owned |
| `push/push_notification_format.erl` | `fork_push_personas:author_name/1` first in `resolve_author_name/3`'s list; `<<"personas">>` in `build_markdown_context/4` | one line each |
| `push/push_job_publisher.erl` | `<<"icon">>` calls `fork_push_personas:author_icon/2`, not `resolve_author_avatar_url/1` | one line replaced |
| `push/push_markdown_plaintext.erl`, `native/push_markdown_plaintext_nif/src/lib.rs` | pass `personas` to the parser (`packages/markdown_parser/rust/src/plaintext.rs`) | 1 and 4 lines |
| `utils/event_atoms.erl` | ten names: three signal-bar in `core_event_map/0`, `GUILD_PERSONAS_DIRTY` in `guild_event_map/0`, six `USER_PERSONA*` in `user_voice_event_map/0` | in upstream's maps |
| `utils/constants.erl` | `resume_timeout() -> 300000` (upstream 60,000), beyond the web client's 180 s resume window (`ResumeWindow` in `GatewaySocket.ts`); the docs say 300,000 ms | one value |
| `guild/guild_dispatch_filter.erl` | `channel_signal_update`, `channel_signal_bar_update` are channel-scoped | two clauses |
| `session/session_passive.erl` | `signal_bar_update` bypasses the passive filter | one clause |
| `gateway/fork_gateway_drain.erl`, `fork_cluster_join.erl`, `fork_cluster_discovery.erl`; `guild/fork_guild_handoff.erl`, `fork_guild_session_rebind.erl`; `session/fork_session_handoff.erl`, `fork_session_transfer_start.erl` | the handoff fixes ("Handing the gateway over", below) | fork-owned |
| `gateway/gateway_node_router.erl` | `select_owner_node/2` hashes over `fork_gateway_drain:owners/1` | one line replaced |
| `gateway/gateway_cluster_handoff.erl` | `drain_async/0` announces the drain, `clear_draining/0` withdraws it; the role `all` drain calls `fork_gateway_drain:reconnect_drain/0`; `maybe_start_handoff/1` also sees a handoff in flight stored as a map | two lines added, one replaced, one clause |
| `gateway/fluxer_gateway_app.erl` | `fork_cluster_join:defer_rpc_until_joined/0` after the config loads | one line |
| `gateway/gateway_cluster_discovery.erl` | `poll/1` compares with `fork_cluster_discovery:previous_peers/3` | one line added, one replaced |
| `guild/guild_manager_handoff_transfer.erl` | the transfer's options from `fork_guild_handoff:transfer_opts/2` | one line added, one replaced |
| `guild/guild_manager_shard_lookup.erl` | two calls to the appended fork block (`fork_lookup_not_found/2`, `fork_lookup_or_fetch_new/4`) | two lines replaced, block appended |
| `guild/guild_connect_async.erl` | `upsert_pending_session/5` hands an existing entry to the appended fork block (`fork_upsert_existing/5`) | one line replaced, block appended |
| `guild/guild_manager_shard_lifecycle.erl` | `start_transferred_guild/3` marks the carried-over sessions (`fork_guild_handoff:mark_carried_over/1`) | one call wrapped |
| `session/session.erl` | `export_state` answers through `fork_session_handoff:export_and_forward/2` | one clause body |
| `session/session_state_transfer.erl`, `session/session_manager_shard.erl` | a received state starts its session (`fork_session_transfer_start`) | one line; one clause |

The persona and signal lines in upstream's files have no `%% Fork:` marker; the handoff's do. Keep the hand-overs when upstream
changes these files: the `icon` line is the easiest to lose (no test checks a persona's icon through
`push_job_publisher`). Going back to 60 s changes behaviour: ask a maintainer. The NIF crates are
outside the root Cargo workspace, so the root `cargo fmt` and Clippy do not reach `lib.rs`. How the
API sends the fork's events: `fluxer_api/src/api/persona/AGENTS.md` and
`fluxer_api/src/api/signal_bar/AGENTS.md`.

## Handing the gateway over (deploys)

Production runs the gateway with clustering on, one node between deploys. A deploy starts a second
node, which joins the first; the edge sends new connections to it; the old node is drained and
removed (`scripts/gateway_handoff.sh` in the maintainers' tooling). Sessions, guilds and calls move
with upstream's handoff (`gateway_cluster_handoff`), and clients resume instead of identifying
again. Upstream's handoff loses events and routes to the wrong node in several places, measured in a
rehearsal (tyne-chat/tyne#196); the fork's modules close them:

- `fork_session_transfer_start`: a session's state starts its process on arrival, not at RESUME.
- `fork_session_handoff`: after `export_state` the old session process forwards every cast and call
  to the new one until it has passed nothing on for 2 s, so nothing sent to it after the export is
  lost.
- `fork_guild_session_rebind` and the block in `guild_connect_async`: a session that reconnects
  because of a handoff (its id from a new process, or an entry that came with the guild's
  transfer) is not marked `pending_connect`, which upstream's dispatch filters skip; a known
  session id from a new process takes the entry over.
- `fork_guild_handoff`: a moved guild's new process replaces the cached pid on every node, and its
  carried-over sessions are marked.
- `fork_gateway_drain`: a draining node, or one still starting, owns nothing (owner selection);
  with another node to hand over to, a draining node also leaves the API's NATS queue group; a
  guild its owner does not have yet is used where it still runs, never loaded afresh.
- `fork_cluster_join`: a node starting beside others subscribes to the API's NATS requests only
  once it has started and joined.
- `fork_cluster_discovery`: a DNS answer naming only this node is not a DNS failure.

A RESUME is lossless only if all of these hold; a change to upstream's handoff, session export,
ownership or startup order can reopen a gap that no unit test sees. Rehearse it (the maintainers'
`rehearse_gateway_handoff.sh`) before deploying such a change.

## Known gaps

- DM reactions batched into `MESSAGE_REACTION_ADD_MANY` lose `persona_id` and `subprofile`
  (`session_dispatch_voice:build_single_reaction/1`; tyne-chat/tyne#120).

## Tests

- EUnit (`rebar3 as test eunit`, application not started): modules in `test/`, and `-ifdef(TEST)`
  blocks in source modules for private functions. No shared fixtures; tests build maps and mock
  with `meck`.
- Fork tests: `test/fork_persona_event_atoms_tests.erl` (persona names),
  `test/fork_session_passive_tests.erl` (signal-bar names, scoping, the passive rule at 300
  members), `test/fork_push_personas_tests.erl` (preview, title, icon), and one per handoff module
  (`test/fork_gateway_drain_tests.erl` and the others named after their module). New ones go in
  `test/fork_<subject>_tests.erl`, never in an upstream test module or inline block.
- Not covered: the resume timeout's value, routing of the persona events, the `icon` line.
- Checks: the four `gateway_*` steps in `CHECKS.md`, as upstream's CI
  runs them; compiling builds both NIFs, so Cargo is needed. `make lint` (elvis) and
  `make typecheck` (eqWAlizer) are not among them; run them after a larger change. One module:
  `rebar3 as test eunit --module=<name>`.
