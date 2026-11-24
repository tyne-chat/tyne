# The gateway

Upstream's realtime service, written in Gleam on Erlang/OTP since fluxerapp/fluxer#4254
(2026-11-23; it replaced the Erlang gateway). It holds the clients' WebSockets, with a process per
socket, gateway session, signed-in account (presence), loaded community (guild) and call. The API
reaches it over NATS (`rpc.gateway.*`) to fan out events and ask about permissions and members; it
calls the API over HTTP (`/internal/rpc`). Native code is in Rust NIFs (`rust/`, one library,
`priv/gateway_nif.so`). The code is upstream's, and upstream changes it often. The fork adds signal
routing, a longer resume hold, personas in the reaction buffer and in push notifications, the
pushes of DM threads, and fixes to upstream's handover (below); the gateway stores no persona data. The protocol is documented in
`fluxer_docs/src/content/docs/gateway/`.

## Where things are

Paths are under `src/fluxer_gateway/` unless they start with `test/`, `rust/` or `scripts/`.

| Concern | Files |
|---|---|
| Start, supervisor, roles, drain, health and status ports | `app/` |
| Settings (`FLUXER_*`, read once at boot; durations in code) | `config/settings.gleam`, `config/durations.gleam` |
| The socket: opcodes, IDENTIFY, RESUME, heartbeats, limits | `gateway/` (`socket.gleam`, `identify.gleam`, `resume.gleam`, `limits.gleam`) |
| RPC from the API (NATS, queue group `gateway`); requests to it | `rpc/`, the `rpc.gleam` of each area; `api/client.gleam` |
| Sessions, READY, replay buffer, resume, the reaction buffer | `session/` (`server.gleam`, `dispatch.gleam`, `reactions.gleam`, `replay_buffer.gleam`) |
| Communities: state, fan-out, passive rules, member list | `guild/` (`dispatch.gleam`, `dispatch/event.gleam`, `sessions/passive.gleam`) |
| Account events, DM push hold | `presence/` (`rpc.gleam`, `state.gleam`, `push_buffer.gleam`, `push_hook.gleam`) |
| Push jobs, outbox, read-state check | `push/` (`message.gleam`, `format.gleam`, `job.gleam`, `outbox/`, `read_state.gleam`) |
| Cluster membership, handoff, bouncer | `cluster/`, `handoff/`, the `handoff/` folders of each area; `bouncer/` and `bouncer_proto/` are separate Gleam packages |
| NIFs: push preview, permissions, member list, JSON scanning, zstd | `rust/crates/` (`md_plaintext` renders the push preview with `packages/markdown_parser`) |
| The fork's code | `fork/` and the `fork_*.gleam` files listed under "The fork's code" |

## How an event reaches a session

**Community events** (`guild.dispatch`): the guild process (`guild/dispatch.gleam`) normalizes the
name (`event.normalize`: any name of capitals, digits and underscores; there is no table of known
events), updates its state, picks the sessions by the event's scope (`event.scope`: channel-scoped
events go to those that can view their `channel_id`, permission-gated ones to those with the
permission, the rest to all), drops those the passive rules refuse (`sessions/passive.gleam`
`should_receive`), encodes once and sends; push candidates follow (`guild/push/`).

**Account events** (`presence.dispatch`, `presence/rpc.gleam` `dispatch`): sent as they are to every
presence inbox of the account (`UserDispatch`), which passes them to its sessions with no passive
filter. `user_event` reads the few the presence acts on (`USER_UPDATE`, `USER_SETTINGS_UPDATE`,
`MESSAGE_CREATE` and `MESSAGE_ACK` of DMs); every other name is `OtherEvent`. With no session, or
an owner node that cannot be reached, `offline_dispatch` turns a DM `MESSAGE_CREATE` into a push and
drops the rest.

**In the session** (`session/dispatch.gleam`): thread rules and `ignored_events` filter; with
`DEBOUNCE_MESSAGE_REACTIONS`, reaction adds wait 650 ms in the reaction buffer and go out together
(`MESSAGE_REACTION_ADD_MANY`); the event gets the next seq, enters the replay buffer and goes to the
socket.

**Adding an event:** the name in `fluxer_api/src/api/constants/Gateway.ts` and a section in
`fluxer_docs/src/content/docs/gateway/events.md`; nothing in the gateway unless it is channel-scoped
or reaches passive sessions (`fork/events.gleam`) or the presence acts on it.

## Connecting, READY and RESUME

The outline is in `ARCHITECTURE.md` ("Connecting to the gateway"). What matters here:

- READY's base is the API's answer to the session request, so a field the API adds there (the
  fork's `fork_dm_threads`) reaches READY with no gateway change.
- **Kept for RESUME**, in the session process: seq, the replay buffer (4,096 events or its byte
  cap), guild connections and status. A session without a socket is held for
  `limits.resume_timeout_ms()`, **300 s in the fork** (upstream 60 s), and shown offline after 5 s.
  A client close with 1000 or 1001 ends it at once.
- RESUME of an unknown or expired session gets INVALID_SESSION. Sessions live only in memory; a
  deploy moves them to the next node (upstream's handoff, below), a restart does not.

## Passive sessions

A user's session is passive in each community until its client sends Lazy Request (op 14) with
`active: true`, except in the IDENTIFY's `initial_guild_id`; bots never are. A community of 250
members or fewer counts as active for everyone (`guild/state.gleam` `is_small_guild`). A passive
session gets guild, role and channel updates, its own member updates, messages that mention it or
that it wrote, guild deletes, audit-log entries and PASSIVE_UPDATES, and with the fork
`SIGNAL_BAR_UPDATE` and `GUILD_COMMANDS_UPDATE`. It misses `GUILD_PERSONAS_DIRTY`,
`CHANNEL_SIGNAL_UPDATE` and `CHANNEL_SIGNAL_BAR_UPDATE` (tyne-chat/tyne#313). Dev communities are
small: test above 250 members (`passive_test.big_guild()` in Gleam, the bulk-member route in E2E).

## Deploys: upstream's handoff

The fork's own handoff (tyne-chat/tyne#196) was dropped with the Erlang gateway
(tyne-chat/tyne#905). Production runs upstream's membership mode (cluster on, peers by DNS or a
static list, no bouncer): a new node joins, takes over sessions, presences and guilds by moving
them, and the old node drains (`app/drain.gleam`, `session/manager/transfer.gleam`,
`session/departure.gleam`, `guild/handoff/`). A moved guild is frozen and its sessions rejoin
silently with a catch-up of up to 1,000 events. A new node is ready 10 to 12 s after it starts.
Upstream's handover lost account events and answered 403 in the maintainers' rehearsal; the fork
closes these gaps (tyne-chat/tyne#905):

- A community's owner changes at once, but the community moves to it later, one after another.
  Until it arrives, the owner has no read model for it, and upstream's handlers that read it
  answered `guild_not_found` (403 at the API on channel reads, message sends and reactions), their
  own errors (`viewable_channels_error`, `members_with_role_error`) or nothing (channel mentions,
  visitors to evict). Handlers that message the community's process reach it on the old node
  through the handle the owner's cold start finds there. `fork/guild_elsewhere.gleam` sends a
  request for a community the owner does not run, and a peer does, to that peer before it runs
  (`fork/guild_here.gleam` there), from `guild/rpc.gleam` `handle_local` and `voice_owned`, where
  requests end on the owner whichever node took them. Only the owner forwards, so a request is never
  passed back; if the community has left the peer by the time the request runs there, the peer says
  so and the owner runs it. Dispatches and starts are not forwarded: upstream's handle path waits
  for an arriving community in step with the move. `fork/guild_whereabouts.gleam` finds the peer.
- `guild.get_user_permissions_batch` (`GET /users/@me/guilds`) asks each community's owner and
  leaves out the ones it cannot answer for, which during a move were the moving ones.
  `fork/permissions_elsewhere.gleam` asks again where the community runs (upstream's `owned_bits`).
- A node that has just joined built its first presence route from itself alone, so it named
  itself the owner of presences still on the old node, until its route was rebuilt and then, for
  the presences it now owns, until they moved; its previous route named only itself. Account
  events that reached it (DM messages and reactions, persona updates to DM partners) found no
  presence and became pushes at most, and a session that started there (new, or handed over by the
  old node) started a second presence beside the old one. `fork/presence_elsewhere.gleam` asks
  every other node that runs presences, at once, on such a miss and before a session starts one;
  after a miss it asks the owner once more (the presence may have arrived in between). A peer that
  is slow or busy makes the lookup fail rather than count the user as offline; one whose presence
  manager is not running (stopping, or not connected) holds none.
- Upstream's presence route counts a draining node, so presences never left it: they died when it
  stopped (lookups failed, the API answered 502), and the sessions, already on the new node,
  started them again there one by one, so events in between reached only some sessions. A
  leaving node owns no presences in the route table (`fork/presence_route.gleam`; it stays in
  `presence_nodes`, so the presence registry does not count it as lost while it drains), the route
  is rebuilt at most every second (upstream 10 s), the presences start moving when the node
  announces its drain (one loop, ended by an undrain), and the stop waits up to 5 s for any left
  that has somewhere to go (`fork/presence_drain.gleam`). Both ask with
  upstream's `MoveTo` and `MoveRetry`, so a presence in backoff after a refused move moves at once.
- A node subscribed to the API's requests as it started, so one starting beside a running node got
  requests in its first second, before it knew its cluster or while it was joining, and answered
  some with `timeout` (504). It now subscribes only once it has joined (`fork/rpc_join_gate.gleam`;
  a bouncer worker once its bouncer links have) and turns ready up to 2 s later.
- In bouncer mode, which production does not run, none of these changes anything (upstream's
  leases decide there who may serve what), except the join gate, which also holds a bouncer worker
  until its bouncer links have joined.

Known gap (inferred, not measured): a stopping node leaves the API's NATS queue group only when it
stops, so requests in flight then time out after 5 s. Rehearse a change to drain, handoff or
ownership with the maintainers' rehearsal before deploying it.

## Network calls

The gateway's requests go to the API's `/internal/rpc` (`api/client.gleam`): one `session` request
per IDENTIFY; several to load a community, on any start, `guild.dispatch` included (an API fan-out
to every community, such as the fork's `SIGNAL_BAR_UPDATE`, loads them all; a community nobody joins
stops 600 s after it empties); `get_read_state` for a DM push buffered longer than the outbox's age
limit.

## Gleam traps

- **No comments, `case` arms in order.** Upstream's code has no comments; the first matching arm
  wins, so a fork arm goes before the catch-all, and a hook is best placed in the catch-all
  (`_ -> fork_module.f(...)`), as in `fork/events.gleam`.
- **Opaque types** (`Reactions`, `Template`, `RawJson`) are readable only inside their module: a
  fork change that needs their fields is an appended block in that module (`reactions.fork_cancel`).
- **A record field changes every constructor.** Upstream builds `MessageData` and `PreviewContext`
  with labels, so the fork's fields go first and every literal must name them (`fork:`,
  `personas:`). Such a record crosses nodes (a `MessageCreate` is cast to its owner node), and
  upstream's wire-epoch test (`test/fluxer_gateway/docs/wire_epoch_test.gleam`) hashes only
  top-level message types: a change to these records' layout, the fork's or upstream's, needs a
  deploy that restarts the gateway, or old and new nodes misread each other's casts.
  `fork/wire_records_test.gleam` fingerprints `Waiting` (what `Requeue` carries), `MessageCreate`
  and every record they carry, upstream's and the fork's, and fails on a change; record the new
  fingerprints in `test/fixtures/fork_wire_records.txt` and say so on the deploy. Other records
  nested in upstream's cross-node messages are not covered. Never bump upstream's `wire_epoch` for
  the fork.
- **Import cycles do not compile.** `push/format.gleam` imports the fork's push modules, so those
  must not import `format`.
- **Settings:** an invalid `FLUXER_GATEWAY_*` value stops the gateway as it starts: the log says
  `Gateway settings invalid: <reason>` and the application does not start (only a settings read
  before startup falls back to the defaults, logging `Gateway settings invalid, using defaults`).
  Durations are not environment variables: the fork changes their defaults in
  `config/settings.gleam`.
- **The NIF is built from `rust/` and `packages/markdown_parser/rust`;** `scripts/nif.sh` rebuilds
  it only when `rust/` changed. After a change to the parser, run `scripts/nif.sh --force`.
- **Formatting:** `gleam format` covers `src`, `test` and the bouncer packages; it sorts nothing
  across the `// Fork imports.` line, so the fork's imports stay in their own group after
  upstream's. Check that only fork lines moved.
- **No reload in development:** the orchestrator builds the gateway when it starts
  (`tools/dev/src/gateway.rs`, `scripts/gleam.sh build`); restart it after a change. The dev
  container needs Gleam 1.19.2.

## The fork's code

| Where | What | Kind |
|---|---|---|
| `fork/guild_elsewhere.gleam`, `fork/guild_here.gleam`, `fork/guild_whereabouts.gleam`, `fork/isolated.gleam` | the owner of a community that runs on a peer, not here, runs its requests (not dispatches or starts) on that peer (`guild_here.run` and `voice`) while it moves between nodes; `guild_whereabouts` asks the peers' manager shards where it runs, in a process of its own (`isolated`, also used by `presence_elsewhere`) (tyne-chat/tyne#905) | fork-owned |
| `guild/rpc.gleam` | `handle_local` and `voice_owned` start with `use <- guild_elsewhere.where_it_runs(...)` and `use <- guild_elsewhere.voice_where_it_runs(...)` | one line each |
| `fork/permissions_elsewhere.gleam` | a community the permissions batch left out is asked again where it runs (upstream's `owned_bits`) (tyne-chat/tyne#905) | fork-owned |
| `guild/rpc/permissions.gleam` | `one` pipes each community's bits through `permissions_elsewhere.bits` | one pipe |
| `rpc/server.gleam` | `subscribe` starts with `use <- rpc_join_gate.once_joined(...)` | one line |
| `fork/rpc_join_gate.gleam` | a clustered node (or a bouncer worker) subscribes to the API's queue group only once it has joined; until then the subscription waits for the server's retry (`server_subscribe_retry_ms`, 2 s), logged every 30 s (tyne-chat/tyne#905) | fork-owned |
| `fork/presence_elsewhere.gleam` | a presence lookup that misses on the owner, the previous owner and this node, and a session about to start a presence, ask every other node that runs presences, at once (tyne-chat/tyne#905) | fork-owned |
| `presence/manager.gleam` | the empty arm of `lookup_everywhere` calls `presence_elsewhere.find`; `start_or_lookup_timed` tries `presence_elsewhere.first` before it starts one | one arm; one `lazy_or` |
| `fork/presence_route.gleam`, `fork/presence_drain.gleam` | a leaving node owns no presences in the route table, unless no other node runs them; its presences start moving when the drain starts, and the stop asks those still on the node to move and waits up to 5 s until none is left (tyne-chat/tyne#905) | fork-owned |
| `presence/route.gleam`, `app/drain.gleam` | `rebuild` filters its nodes through `presence_route.without_leaving`; `announce` calls `presence_drain.begin()`, `run_membership` `presence_drain.await_moved()` once its handoff has settled | one line each |
| `config/settings.gleam` | `route_rebuild_interval_ms: 1000` (upstream 10,000), so the presence route follows a join or a drain before a deploy stops the old node | one value |
| `fork/events.gleam` | `CHANNEL_SIGNAL_UPDATE` and `CHANNEL_SIGNAL_BAR_UPDATE` are channel-scoped; `SIGNAL_BAR_UPDATE` and `GUILD_COMMANDS_UPDATE` reach passive sessions | fork-owned |
| `guild/dispatch/event.gleam`, `guild/sessions/passive.gleam` | the catch-all arm of `is_channel_scoped` and of `bypasses` calls `fork/events.gleam` | one arm each |
| `config/settings.gleam` | `limits_resume_timeout_ms: 300_000` (upstream 60,000), beyond the web client's 180 s resume window (`ResumeWindow` in `GatewaySocket.ts`; mobile 55 s); `test/.../gateway/protocol_test.gleam` expects it | one value; one expectation |
| `session/fork_reaction_persona.gleam` | personas in the reaction buffer: `MESSAGE_REACTION_ADD_MANY` entries keep `persona_id` and `subprofile`, and a remove cancels only the buffered add of the same persona (tyne-chat/tyne#120) | fork-owned |
| `session/reactions.gleam`, `session/dispatch.gleam` | `reaction_json` puts the entry's persona fields first (one statement); `fork_cancel` appended (upstream's `cancel`, matching the persona too); `route` calls `fork_cancel` | one statement; appended block; one call |
| `push/fork_message.gleam` | what the fork reads from a pushed message: the persona it was sent as (`subprofile`), the personas it mentions (`mention_personas`, at most 50), the DM thread (`fork_thread_*`) | fork-owned |
| `push/message.gleam` | `MessageData`'s first field, `fork`, its decoder line and `empty_data` | four lines |
| `push/fork_push_personas.gleam` | the persona's name first in the author name (title), its picture as the icon (a hash only: a URL or data URI falls back to the account's), mentioned personas' names for the preview | fork-owned |
| `push/format.gleam`, `push/job.gleam` | `author_name` puts the persona first; `markdown_context` fills `personas`; the icon's author is `fork_push_personas.icon_author` | one line each |
| `push/markdown.gleam`; `rust/crates/md_plaintext/` (`src/lib.rs`, `src/nifs.rs`, `benches/preview.rs`) | `PreviewContext.personas`, sent to the NIF as `{personas, upstream's context}` and passed to the parser (`packages/markdown_parser/rust/src/plaintext.rs`, `PlaintextOptions.personas`) | a field, the NIF's argument type and the call; in Rust a field, its default, `validate`'s list, `into_options`, two lines in the decoder, the benchmark's context |
| `fork/dm_thread_presence.gleam` | `FORK_DM_THREAD_EVENT` {t, d, push} at the presence: a thread message with a `push` is a DM message held and read under the thread; a thread's `MESSAGE_ACK` is an ack of the thread; offline, `push.message` goes the way of a DM message; an envelope without `push` (the author, a muted follower) makes no push (tyne-chat/tyne#699) | fork-owned |
| `presence/rpc.gleam` | the catch-all arms of `user_event` and `offline_dispatch` call it | one arm each |
| `fork/dm_thread_push.gleam` | the push of a DM-thread message: titled "Author (Thread)" or "Author (Thread, Group)" (`fork_thread_context`), `fork_thread_id` and `fork_thread_name`, the thread's `tag` and `notification_tag` replacing the DM's (the push service refuses a key given twice); channel_id and url stay the DM; the outbox and the read-state check go by the thread (tyne-chat/tyne#907) | fork-owned |
| `push/format.gleam`, `push/job.gleam`, `push/read_state.gleam` | `title` starts with `use <- dm_thread_push.title(...)`; `notification` passes `common` through `dm_thread_push.notification`; the template's channel and a stale entry's channel are `dm_thread_push.read_channel` | one line; one line; one line each |

Every hook in upstream's files is marked with a `// Fork:` comment or a call into a `fork` module,
and the fork's imports sit after upstream's under `// Fork imports.`. Keep the hooks when upstream
changes these files; the icon and the outbox key are the easiest to lose. Going back to 60 s
changes behaviour: ask a maintainer. So does upstream's 10 s presence route interval: a deploy's
old node would stop before its presences move. How the API sends the fork's events:
`fluxer_api/src/api/persona/AGENTS.md`, `fluxer_api/src/api/signal_bar/AGENTS.md` and
`fluxer_api/src/api/channel/AGENTS.md` (DM threads).

## Tests

- Gleam tests (gleeunit, run one at a time under eunit with the settings reset between tests):
  functions ending in `_test` in `test/fluxer_gateway/`, helpers in `test/support/` (a fake API,
  fake sessions and sockets, guild fixtures, scenario harnesses). Upstream's tests use `assert` and
  `let assert`. The fork's wait for a result or a later event, never a fixed time.
- Fork tests, in fork-owned files next to upstream's: `fork/events_test.gleam`,
  `guild/scenario/fork_signal_events_test.gleam` (a channel's signals only to its viewers; passive
  sessions in a 300-member community), `gateway/fork_resume_test.gleam`,
  `session/fork_reaction_persona_test.gleam` (the buffer, and a session that debounces reactions),
  `push/fork_push_personas_test.gleam` (preview, title, icon through the job body),
  `fork/dm_thread_push_test.gleam` (the envelope, the hold, the job body, the outbox key, the
  read-state check), `fork/guild_elsewhere_test.gleam` (on one node every request runs here),
  `fork/handover_scenario_test.gleam` with `support/fork_handover_peer.gleam` (two real nodes: one
  joins while presences and a community are still on the other; both find every presence, a second
  session started on the new node joins the old presence, both answer for the community, its
  channels, members, mentions, voice and the permissions batch, and the drain moves every presence
  before the stop), `fork/rpc_join_gate_test.gleam` (bouncer workers too),
  `fork/presence_route_test.gleam` (a lone or bouncer node keeps its presences),
  `fork/wire_records_test.gleam` (the cross-node push records, above). Rust:
  `rust/crates/md_plaintext/tests/fork_persona_preview.rs`,
  `packages/markdown_parser/rust/tests/fork_persona_mentions.rs`, and the DM-thread job decoded by
  the push service in `fluxer_push/src/fork_dm_thread_push.rs`. Never add a test to an upstream test
  file; an upstream expectation the fork changes carries a `// Fork:` comment.
- **Contract specs** (E2E, `e2e/web/gateway/`, helpers in `e2e/api-helpers/`): the fork's gateway
  behaviour against a running stack through raw gateway clients and a push sink on NATS. Run them
  after any change here and after a rebase that touched the gateway:
  `./e2e/scripts/ci-run.sh --no-cleanup web/gateway/`, then `./e2e/scripts/down.sh`. The resume spec
  waits 75 s.
- **Checks** (as upstream's CI, `tools/ci/src/gateway.rs`): `gateway_fmt`, `gateway_rust_fmt`,
  `gateway_clippy`, `gateway_compile` (warnings as errors), `gateway_rust_test`, `gateway_test`
  (the whole suite, about 20 minutes; `FLUXER_TEST_ONLY=fork_,reactions` runs the files whose path
  contains one of the words) and `gateway_bouncer_test` (`CHECKS.md`). They need Gleam 1.19.2,
  Erlang/OTP 28 and Cargo; the `build` stage of `Dockerfile` has all three. The test run needs no
  NATS: its connection errors in the log are expected.
