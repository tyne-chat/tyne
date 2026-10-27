# The signal bar on the server

The signal bar is a row of emoji above the message box. Anyone who may write in a channel switches a
signal on ("lights" it) or off, as the account or as one of its personas, and everyone in the channel
sees who has which on. This folder is the server half, and this guide holds the design the clients
share. The folder is the fork's; its hooks into upstream files are listed near the end. The clients'
guides: `fluxer_app/src/features/signal_bar/AGENTS.md` (web, desktop) and tyne-chat/tyne-mobile
`lib/features/signal_bar/AGENTS.md`.

## What people see

- One bar per instance: up to 50 signals (`MAX_SIGNAL_BAR_SIGNALS`), each an emoji with an optional
  label (32 characters). An instance admin picks a home community in the admin panel; its managers
  (Manage Community) edit the bar on the web. No home community, no bar.
- The bar is off in every channel until switched on: in a community by its managers (a default, per
  category, per channel); in a DM by either person of a one-to-one DM or a group DM's owner. Web only.
- Managers turn one person's signal off or reset a signal for everyone.
- A signal stays lit while its owner is online and for 12 hours after they go offline
  (tyne-chat/tyne#89).

## Where things are

| Concern | File |
|---|---|
| Routes, rate-limit buckets | `SignalBarController.ts` |
| Every rule, the Valkey layout, events, the sweep | `SignalBarService.ts` |
| The two switch tables | `SignalBarSettingsRepository.ts` (declared here, not in `api/Tables.ts`) |
| Unknown signal: 404 with upstream's `UNKNOWN_EMOJI` code | `UnknownSignalError.ts` |
| Shapes, limits, `resolveSignalBarEnabled` (the web imports it too) | `packages/schema/src/domains/signal_bar/SignalBarSchemas.ts` |
| The sweep | `worker/tasks/SweepSignalBar.ts`, scheduled in `worker/WorkerMain.ts` |
| Home community | `signal_bar_guild_id` in the instance policy (`instance/InstanceConfigRepository.ts`); the admin panel's `signal_bar_form` in `fluxer_admin` |
| Delivery | `fluxer_gateway`: `event_atoms.erl`, `guild_dispatch_filter.erl`, `session_passive.erl` |
| Public docs | `fluxer_docs` (`http-api/signal-bar.mdx`, `gateway/events.md`) |

## What is stored where

| What | Where | Shape |
|---|---|---|
| The bar | upstream's `instance_configuration` table, key `signal_bar` (cached in memory by `InstanceConfigRepository`) | `{version, signals: [{id, emoji_id, emoji_name, animated, label}]}` |
| Home community | `signal_bar_guild_id` in the policy row | null: `getConfig` returns no signals, but keeps the stored list and version |
| Community switches | fork table `guild_signal_bar_settings`, key `guild_id` | JSON `{default, categories, channels}`, ids to booleans; no row: off |
| DM switch | fork table `dm_signal_bar_settings`, key `channel_id` | `enabled`; no row: off |
| Lit signal | Valkey `signalbar:entry:<channel>:<signal>:<user>`, TTL 10 minutes | `{signal_id, user, persona_id, subprofile, activated_at}` |
| Indexes | Valkey sets `signalbar:channel:<channel>`, `signalbar:user:<user>`, `signalbar:users` | TTL 7 days, renewed only when a signal is lit or re-pointed |
| Offline clock | Valkey `signalbar:offline_since:<user>`, TTL 24 hours | when the sweep first saw the account offline |

- A community channel takes its own setting, then its category's, then the community default
  (`resolveSignalBarEnabled`). A DM reads its row.
- **A lit signal stores copies.** `user` (`mapUserToPartialResponse`) and `subprofile`
  (`toSubprofileResponse`, with the display tag) are taken when it is lit and served as stored. Unlike
  messages, a renamed account or persona keeps its old name and avatar on a signal until it is turned
  off, or re-lit as someone else.
- No synced settings are involved; clients hold memory state only (and the web's collapsed caret).
  Deleting a community, channel, account or persona removes no row or key.

## Routes and who may do what

Every route needs a login. Bearer tokens are refused (no `requireOAuth2ScopeForBearer`), whatever
the `OpenAPI` block says; bots may call every route without `DefaultUserOnly`. Buckets
(`UserRateLimitConfig.ts`): read 60 per 10 s, toggle 30 per 10 s, mutate 30 per minute; all count
toward the global limit.

| Route | Who | Effect |
|---|---|---|
| `GET /instance/signal-bar` | anyone | the bar, `guild_id`, `can_manage` |
| `PUT /instance/signal-bar` | Manage Community in the home community; no bots | replaces the list; `SIGNAL_BAR_UPDATE` |
| `GET /channels/:id/signals` | can see the channel | `{enabled, bar_version, entries}`; off: no entries |
| `PUT /channels/:id/signals/:sid/@me` | can see; Send Messages in a community; not timed out; bar on; signal on the bar; owns `persona_id` | lights, or re-points the caller's entry |
| `DELETE …/:sid/@me` | can see | the caller's entry off |
| `DELETE /channels/:id/signals/:sid`, `…/:sid/users/:uid` | a manager | everyone off; one account off |
| `PUT /channels/:id/signal-bar` | a DM's manager; no bots | the DM switch; off clears the DM's signals |
| `GET`, `PUT /guilds/:id/signal-bar/channels` | Manage Community; no bots | the community switches |

- **Manager** (`assertCanManageChannel`): Manage Community in a community channel; either person in
  a one-to-one DM; the owner of a group DM.
- Listing, lighting and the DM switch call `ensureTextChannel`: threads and forums get 400.
- `updateBar` keeps an item's `id` only if it is on the current bar and not repeated, so a reorder
  keeps ids and the signals lit under them. A custom emoji must exist (in any community); Unicode
  text must contain a pictograph.
- `updateGuildSettings` keeps only category, text and announcement channel ids, writes, then for each
  text channel whose state changed clears its signals (when off) and sends `CHANNEL_SIGNAL_BAR_UPDATE`.

## Events

| Event | Sent on | Payload | Delivery |
|---|---|---|---|
| `SIGNAL_BAR_UPDATE` | every bar write (edit, emoji pruning) | `{version}` | `dispatchGuild` to every community, bypassing the passive filter: one copy per community a session is in, none for an account in no community |
| `CHANNEL_SIGNAL_UPDATE` | lighting, re-pointing, turning off, reset, removal, the sweep | `{channel_id, bar_version, added: [entry], removed: [{signal_id, user_id}]}` | `dispatchChannelEvent`: channel-scoped in a community, each recipient in a DM |
| `CHANNEL_SIGNAL_BAR_UPDATE` | a switch changing a channel's state | `{channel_id, enabled}` | as above. Switching off sends no `CHANNEL_SIGNAL_UPDATE` for the signals it clears |

- Passive sessions (in communities over 250 members) miss the two channel events (tyne-chat/tyne#149).
- Nothing is sent when the home community changes, a re-light keeps the persona, or an entry expires.
- A new event needs its name in `constants/Gateway.ts` and `event_atoms.erl`, and a decision in
  `guild_dispatch_filter.erl` and `session_passive.erl`.

## Lifetime: the sweep

`sweepSignalBar` runs once a minute (`30 * * * * *`, no ledger) and calls `sweep()`:

1. Custom-emoji signals whose emoji is gone leave the bar (a bar write).
2. Per account in `signalbar:users`: entries of signals no longer on the bar are stale. Online
   (`hasActivePresence`; a failed check counts as online), each TTL is renewed. Offline, the first
   sweep records `offline_since`; entries are renewed for 12 hours, then all are stale.
3. Stale entries are removed, with one `CHANNEL_SIGNAL_UPDATE` per channel.

Lit signals live on the sweep: if the worker stops for 10 minutes, they expire with no event.

## Signals and personas

- One entry per (channel, signal, account). The persona is an attribute, not part of the key.
- `persona_id` absent or `'0'` means the account. Otherwise ownership is checked inline (`findById`,
  not deleted, else `UNKNOWN_PERSONA`); the persona guide lists it among the checks to change together.
- Another persona replaces the entry in place, keeps `activated_at` (the order) and is sent under
  `added`. The same persona only renews the TTL and sends nothing.
- A private persona's name and avatar show on its signals, as on its messages.
- The server never re-points a signal itself; that is the clients' rule below.

## Keeping the clients in step

The server holds the truth; each client keeps a copy in memory. A client that breaks one of these
rules shows wrong signals to everyone in the channel, not only to its user.

- Load the bar with `GET /instance/signal-bar` and each channel with `GET /channels/:id/signals`. A
  channel not loaded counts as off.
- Apply `added` and `removed` only to loaded channels, replacing an account's entry in place.
- Refetch the bar, with one shared request, when a `version` or `bar_version` is newer than the copy.
- On READY, drop every channel.
- Lighting waits for the event; turning off may remove the entry first. After a failed write,
  refetch the channel once.
- Light as the persona the composer in that channel writes as. Re-point one's own signals only for
  something done in that channel (typing, a persona pick in its composer, a send), and not while a
  persona tag is half typed. Never because the selection changed elsewhere or on another device, or
  because the channel was opened.

Where the clients differ today:

| | Web | Mobile |
|---|---|---|
| Where | every composer, and above DM and community barriers | the open channel's composer, not while editing; none where a barrier replaces it |
| Channel `GET` | on every mount | once per channel per session |
| Managers | as the server | Manage Community, every DM, or a channel missing from the channel list |
| Names | persona, else the community nickname | persona, else the copy's `global_name`, else `username` |
| Configuration | editor, drag to reorder, channel tree, DM switch | none |
| Retries | none | replays transient failures |

## Network calls inside the API

- `PUT /instance/signal-bar`: one emoji read per custom emoji, then one `dispatchGuild` per community
  on the instance (pages of 100), all inside the request; a failed dispatch is logged and skipped.
- `PUT /guilds/:id/signal-bar/channels`: clearing and one dispatch per channel whose state changed, in
  sequence.
- The sweep, each minute: one emoji read per custom-emoji signal; one presence RPC per account with
  signals and two Valkey calls per entry; one channel read and dispatch per channel with removals.

## Rules and traps

- Shapes live only in `SignalBarSchemas.ts`; run `pnpm openapi:generate` after a change. The mobile
  app parses signal payloads by hand, not through the SDK: change its models too.
- No fork error codes: reuse upstream's (`MISSING_PERMISSIONS`, `UNKNOWN_EMOJI`,
  `CANNOT_SEND_MESSAGES_IN_NON_TEXT_CHANNEL`, communication disabled).
- Only lighting checks the switch; turning off, reset and removal work in a switched-off channel.
- Every bar write must bump `version`: the clients refetch on it.

## Known gaps

Tracked in tyne-chat/tyne#148 unless another issue is named.

- Bar writes and community switches read, then write, without compare-and-set: concurrent edits can
  lose one, and two bar writes can share a version.
- Nothing ends a signal when its owner loses access (kick, ban, removal from a group DM, a deleted
  channel), and lighting in a DM does not check blocks (`validateDMSendPermissions` is not called).
- Voice channels pass `ensureTextChannel` but are left out of the community switches: they follow
  their category or the default, are never announced and are never cleared.
- The sweep does not renew the index sets, which expire 7 days after their last lighting or
  re-point. Then a channel's GET stops listing its signals (channel index), or the sweep stops
  renewing an account's signals, or everyone's (`signalbar:users`), and they expire with no event.
- The home community is not checked for existence; changing it reaches clients at their next READY.

## Where this code hooks into upstream files

- Wiring: `app/ControllerRegistry.ts` (fork block), `types/HonoEnv.ts`,
  `middleware/ServiceMiddleware.ts` (a field and the `signalBarService` getter among upstream's),
  `worker/WorkerTaskRegistry.ts`, `worker/WorkerDependencies.ts` (`personaRepository`, for the sweep).
- One line each, no marker: the cron in `WorkerMain.ts`, the task in `WorkerLaneConfig.ts`, three
  event names mid-union in `constants/Gateway.ts`. The buckets end `UserRateLimitConfig.ts`.
- Gateway: three atoms in `event_atoms.erl`, two `is_channel_scoped_event` clauses, one
  `bypasses_passive_filter` clause. An Erlang function's clauses must stay together.
- Home community: `signal_bar_guild_id` among the fork's other policy fields in
  `InstanceConfigRepository.ts`, `InstanceConfigAdminController.ts`, `AdminSchemas.ts` (a `// Fork:`
  `register` line), `InstanceSchemas.ts`, `instance_bootstrap/src/Discovery.ts` and `fluxer_admin`.

## Tests

- `tests/SignalBar.test.ts` (`createApiTestHarness`, in memory): home community, edit rights and
  stable ids, persona re-pointing, manager rights, group DMs, the 12-hour sweep with a fake clock
  (`createSweepService`), switches and inheritance, clearing, the 50 cap, emoji checks and pruning,
  failed presence checks, paged fan-out, the worker task. Helpers: `setHomeGuild`,
  `enableEverywhere`, `setBar`.
- Elsewhere: the schema package's `SignalBarSchemas.test.ts`,
  `fluxer_gateway/test/fork_session_passive_tests.erl`, the `fork_tests` module at the end of
  `fluxer_admin/src/routes/system_actions.rs`, `e2e/web/desktop/signal-bar.spec.ts`.
- Not covered: blocked DMs, voice channels, lost access, concurrent bar writes, index expiry.
- After a change: `pnpm --filter fluxer_api test src/api/signal_bar` and the gateway eunit step, then
  the full list in `CHECKS.md`.
