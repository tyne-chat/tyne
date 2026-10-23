# Tyne architecture

How the server, web app and desktop app fit together: the components, where data lives, how the
main requests flow through them, and where the fork's features sit. Read it before changing
something that crosses folders. Rules for making changes are in `AGENTS.md`; folders with traps of
their own have an `AGENTS.md` too (listed at the end). When a change makes this file wrong, fix it in
the same commit.

Paths are from the repository root; `api/` means `fluxer_api/src/api/` and `features/` means
`fluxer_app/src/features/`. In the flows, web paths are under `fluxer_app/src/features/` and
gateway paths (`.erl`) under `fluxer_gateway/src/`. Upstream (Fluxer) renames and moves files often:
trust a file name here less than a function or folder name, and check before relying on either.
Checked against the code on 2026-10-18.

## The system

Tyne is Fluxer (a chat server with a web and desktop app) plus the fork's features, chiefly
personas. A TypeScript **API** owns writes and rules, and runs a **worker** from the same image for
background jobs. An Erlang **gateway** holds the clients' WebSockets and each guild's live state
(members, roles, permissions): the API asks it for permission checks and hands it events to fan out.
Rust services behind **NATS** build message objects, look up users, issue IDs, unfurl links and
search GIFs, and a Rust **media proxy** serves stored and external media. Nearly all data is rows in
one **PostgreSQL** key/value table. The React and MobX **web app** also runs inside the Electron
**desktop app**. The Flutter mobile app (tyne-chat/tyne-mobile) uses the same API, through a Dart
SDK generated from this repository's OpenAPI spec, and the same gateway.

## Components

An edge Caddy server routes by path (`deploy/self-hosting/Caddyfile`): `/api/*` to the API,
`/gateway` to the gateway, `/media/*` to the media proxy, `/livekit/*`, `/admin`, static paths, and
everything else to the app proxy, which serves the web app. The self-hosting compose file is
`deploy/self-hosting/docker-compose.yml`.

| Component | Folder | Role | Talks to |
|---|---|---|---|
| API | `fluxer_api` (`src/AppEntrypoint.ts`, routes in `api/app/ControllerRegistry.ts`) | REST (Hono); `/internal/rpc` for the gateway and push | gateway over NATS `rpc.gateway.<method>` (`api/infrastructure/GatewayService.ts`); Rust services over `svc.<name>`; the media proxy over HTTP |
| Worker | same image, `src/WorkerEntrypoint.ts` | jobs and cron (`api/worker/tasks/`) | JetStream `jobs.<task>` |
| Gateway | `fluxer_gateway` (Erlang/OTP) | sessions, presence, guild state, calls, push fan-out | serves `rpc.gateway.*`; calls the API's `/internal/rpc`; sends `push.job.*` requests through a per-node outbox that retries for up to 300 s (`push/push_outbox.erl`) |
| Messages | `fluxer_messages` (Rust) | builds API message objects from stored rows; extracts mentions; deletes rows with neither author nor webhook (its only write) | `svc.messages`; calls `svc.users` and `rpc.gateway.guild.resolve_channel_mentions` |
| Users, snowflakes, unfurl, gifs | `fluxer_users`, `fluxer_snowflakes`, `fluxer_unfurl`, `fluxer_gifs` | user partials, ID batches, link previews, GIF search | `svc.<name>` |
| Push | `fluxer_push` (Rust) | APNs, FCM, Web Push; the same binary is the public push relay (`--mode relay`) | answers `push.job.*` requests in a queue group; reads devices and badge counts from the API's `/internal/rpc` |
| Media proxy | `fluxer_media_proxy` (Rust) | object storage and signed external media, image transforms; internal `/_metadata`, `/_sniff`, `/_thumbnail`, `/_frames`; the upload relay, which writes into `uploads` | HTTP |
| App proxy | `fluxer_app_proxy` (Rust) | serves the built web app with its CSP | HTTP |
| Static | `fluxer_static` (a Caddy image, no code) | default avatars, badges, emoji, favicons and app icons, spellcheck dictionaries (the desktop app takes them from upstream's host unless configured otherwise) | HTTP |
| Admin | `fluxer_admin` (Rust) | server-rendered admin panel | the API's admin routes |
| Web app | `fluxer_app` (React, MobX, Rspack) | the client (see "Web app") | REST, gateway, media |
| Desktop | `fluxer_desktop` (Electron; 22 native add-ons in `native/`, loaded as `optionalDependencies`) | a shell around a bundled build of the web app | as the web app |

Each Rust service runs as a **router** and one or more **shards** on the `fluxer_svc` library:
routers take `svc.<name>` and forward to `svc.<name>.shard.<n>`, choosing the shard by rendezvous
hashing on a route key (`fluxer_svc/src/hash_ring.rs`; snowflakes takes turns instead). Payloads
are JSON or msgpack with field names (`to_vec_named`), never positional (`fluxer_svc/src/router.rs`,
`shard.rs`). At boot the shards also create the Postgres table and its indexes and run its
migrations (`fluxer_svc/src/postgres.rs`). The markdown parser (`packages/markdown_parser`, Rust)
is shared: the web app runs it as WASM, `fluxer_messages` and the gateway's push previews natively,
and the mobile app builds it from its `fluxer` submodule.

## Data stores

- **PostgreSQL** holds one table (`fluxer_kv`: `table_name`, `partition_key`, `row_key`, `row_data`
  as JSON, `expires_at`). Tables are declared Cassandra-style with `defineTable`, mostly in
  `api/Tables.ts` (a few next to their repository: voice's, and the signal bar's settings in
  `SignalBarSettingsRepository.ts`), and run on Postgres (`api/database/PostgresKvQueryExecutor.ts`;
  the Rust side is `fluxer_svc/src/postgres.rs`). The API and worker write; the messages and users
  shards read (the messages shard also deletes rows with neither author nor webhook). Cassandra is
  still selectable (`FLUXER_DATABASE_BACKEND`), but Tyne runs Postgres. The fork's tables are rows
  here too, declared in a fork block at the end of `api/Tables.ts`. A query loads and sorts every
  candidate row before applying its `limit`, and a query on a table declared newest first must state
  its order on Postgres (`NewestFirstQueryGuard.test.ts`).
- **Valkey**: caches, rate limits, KV queues and locks for the API and worker, and the signal bar's
  lit signals.
- **NATS with JetStream**: `rpc.gateway.*`, `svc.*`, `jobs.*` and `dlq.*`, `push.job.*`, and a few
  feeds.
- **Meilisearch** in the compose files and in development (the config's own default is
  Elasticsearch, `packages/config`): the API searches (`api/search`), and the worker indexes a
  channel the first time a search touches it, the search answering `{indexing: true}` until then.
  The fork's persona filters are written for Meilisearch
  (`api/search/message/PersonaMessageSearch.ts`).
- **S3 (SeaweedFS)**: buckets `cdn`, `uploads`, `reports` and `harvests`. The API and worker write;
  the media proxy reads, and writes into `uploads` through its upload relay.
- **LiveKit** for voice and video: the API issues tokens and takes webhooks.

## Main flows

### Sending a message

1. **Web:** the composer (`channel/components/LexicalChannelTextareaContent.tsx`) →
   `messaging/hooks/useTextareaSubmit.ts` → the composer's `handleSendMessage` →
   `messaging/hooks/useMessageSubmission.tsx`, which works out the persona
   (`resolveOutgoingPersona`, which calls `PersonaStore.matchOutgoingMessage`) and adds the
   optimistic copy (its id is the nonce) → `messaging/commands/MessageCommands.tsx` `send` → text
   through `messaging/state/MessageQueue.tsx` → `POST /channels/:id/messages`, with `persona_id` when
   sent as a persona.
2. **API:** `api/channel/controllers/MessageController.ts` → `MessageRequestService` →
   `MessageSendService`: permissions come from the gateway (`getGuildAuthContext`,
   `getUserPermissions`); the persona is checked (`resolveOwnedPersonaId` in
   `api/persona/PersonaOwnership.ts`); the ID comes from `svc.snowflakes`.
3. `MessagePersistenceService.createMessage` → `MessageRepository.upsertMessage`, which also stores
   the persona mentions (`withMentionedPersonas`). Link embeds are queued to the worker
   (`ExtractEmbeds`, which calls `svc.unfurl` and dispatches a `MESSAGE_UPDATE`).
4. `MessageGatewayDispatch.ts` → `MessageResponseDataService` → `svc.messages` builds the message
   object, and the API adds `subprofile` from the current persona row (`hydratePersonas`). The
   sender's HTTP response is built separately (`MessageRequestService`), so this runs twice per send.
5. `ChannelGatewayDispatch.ts` sends a guild message through `rpc.gateway.guild.dispatch`, and a DM
   through `rpc.gateway.presence.dispatch` per recipient.
6. **Gateway:** `guild.dispatch` hands the event to the guild process (loading the guild if it is
   not in memory) and returns before delivery. The guild process filters per session, encodes the
   payload once, casts it to the sessions and queues push notifications (`guild/guild_dispatch*.erl`,
   `push/push_outbox.erl`). Each session (`session/session_dispatch.erl`) numbers the event, keeps
   it for replay and forwards the encoded JSON to its socket.
7. **Web:** `gateway/transport/GatewaySocket.ts` → `gateway/events/EventRouter.ts` →
   `messaging/events/MessageCreate.ts` → `messaging/state/MessagingMessages.ts` → re-render.

### Connecting to the gateway

1. The WebSocket opens at `/gateway` (`gateway/gateway_handler.erl`, HELLO). The protocol is
   documented in `fluxer_docs/src/content/docs/gateway/`.
2. IDENTIFY → `session_manager:start`, which fetches the session's data from the API
   (`POST /internal/rpc` `{type: "session"}`, `api/rpc/RpcService.ts`): user, settings, read states,
   private channels, relationships, guild IDs. If the session cannot start yet (draining, at
   capacity, the API answering 429 or 5xx or not at all), the gateway holds the IDENTIFY without
   replying and retries every 1–2 s; a bad payload, token or shard closes the socket.
3. The session joins the account's presence process (`session_connection_presence` →
   `presence_session`) and each guild; a guild not in memory is loaded from the API.
4. READY goes out with the guilds inline once presence and every guild have answered, or after 5 s
   at most with the slow guilds marked unavailable (they follow as GUILD_CREATE). On the web,
   `gateway/events/GatewayReady.ts` handles it, and the fork's `ForkAccountReadyWork.ts` then fetches
   the personas over REST (after READY only, not after a RESUME or a desktop account switch:
   tyne-chat/tyne#141).
5. Heartbeat acks trim the replay buffer. RESUME (`gateway_handler_resume.erl`), accepted only on a
   socket without a session (4005 otherwise), finds or rebuilds the session and replays what the
   client missed. A session is kept for 300 s after its socket drops (the fork's value; upstream's
   is 60 s), but a client close with 1000 or 1001 ends it at once. Details:
   `fluxer_gateway/AGENTS.md`.

### Uploads and media

1. With presigned uploads (otherwise a multipart POST with the message):
   `messaging/upload/AttachmentUploadPlan.ts` → `POST /channels/:id/attachments` →
   `AttachmentUploadService.ts` returns presigned URLs into `uploads`, or a media-proxy relay URL;
   the client PUTs the bytes. See `fluxer_docs` `topics/uploads.md`.
2. The send names the upload; `AttachmentProcessingService.ts` sniffs it, reads its metadata, scans
   it, copies it to `cdn` and deletes the upload.
3. `/media/attachments/…` → the media proxy checks the URL's signature, reads S3 and transforms.
4. Avatars and icons go through `api/infrastructure/EntityAssetService.ts` (validate, hash, upload
   to `cdn`) and are served at `/media/avatars/<id>/<hash>`. Persona images use the same path.

## Web app

- Boot: `fluxer_app/src/index.tsx` → `fluxer_app/src/app/AppBootstrap.tsx`.
- **State:** MobX singletons in `features/<x>/state/`, read by `observer` components, with pure
  `*StateMachine.ts` decision functions. Messages are the exception: plain copy-on-write objects
  behind one observable counter in `MessagingMessages`; reactions and uploads are not MobX either.
- **Actions:** `features/<x>/commands/` call REST through `http`
  (`platform/transport/RestTransport.ts`, endpoints in `app/constants/Endpoints.ts`) and update the
  stores.
- **Gateway:** events reach `features/<x>/events/` through the handler registry in
  `gateway/events/EventRouter.ts`.
- **Storage:** production builds remove `localStorage` and `sessionStorage` from `window`
  (`platform/state/ProtectedWebStorage.ts`); go through `AppStorage`
  (`platform/state/PersistentStorage.ts`), never the raw objects (tyne-chat/tyne#140).
- **Routing:** its own router (`platform/components/router/`, routes in `fluxer_app/src/app/Routes.ts`).
- **Folders:** one per domain, each with `commands components events hooks models state utils`;
  cross-cutting `platform`, `ui`, `app`, `lexical` (the editor) and `i18n` (the fork's strings in
  `fork_locales/`). Shared types are in `packages/schema` (Zod; also the source of the OpenAPI spec).

## The fork's features

### Personas

Several identities under one account. The pieces, end to end:

- **Server** (`api/persona/`, guide in its `AGENTS.md`): persona rows and settings in fork tables;
  routes under `/users/@me/personas`; the ownership check every path uses; `USER_PERSONA_*` and
  `GUILD_PERSONAS_DIRTY` events; PluralKit-compatible import and export.
- **Messages store only ids:** `persona_id` and `mention_personas` on `messages`, `persona_id` in
  `message_reactions`' key. The **`subprofile`** object clients draw is built from the current
  persona row on every read and dispatch, never stored. (Lit signals are the exception: each keeps
  the `user` and `subprofile` it was lit with.)
- **Mentions:** `<@user:persona>`, a fork form in the shared parser (`packages/markdown_parser`).
  The messages service collects the pairs; the API stores them for search.
- **Gateway:** event names in `fluxer_gateway/src/utils/event_atoms.erl`; persona names in push
  notifications (`push/fork_push_personas.erl`).
- **Web** (`features/persona/`, guide in its `AGENTS.md`): `PersonaStore` (own personas, which
  persona is selected, tag matching), the composer pill and picker, `PersonaTag`, profiles, settings,
  import and export. About 50 upstream components call into it: message rendering, sending,
  reactions, mentions, the emoji picker.
- **Mobile:** its own implementation in tyne-mobile, with the same API.

A message sent as a persona: the composer asks `PersonaStore` which persona the text goes out as
(a typed tag, or the selection for the channel) → the request carries `persona_id` → the API checks
the persona is the sender's own and stores the id → building the message adds `subprofile` from the
persona row → clients draw the persona's name and avatar, followed by a badge for the account (its
display tag, or its avatar).

### Signal bar

A row of emoji above the message box. A click lights a signal or turns it off, as the account or as
the persona the composer is writing as; a lit signal shows who lit it. There is one bar per
instance, edited in its home community, and switched on or off per channel. Server
`api/signal_bar/` (`/instance/signal-bar`, `/channels/:id/signals…`): the bar in upstream's
`instance_configuration` table, the per-channel switches in two fork tables, lit signals in Valkey
with time limits; events `SIGNAL_BAR_UPDATE` and `CHANNEL_SIGNAL_*`. Web `features/signal_bar/`
(`SignalBar.tsx` above every composer and above barriers). Doing something in a channel as another persona moves one's
own lit signals there to that persona (`SignalBarStore.affirmPersona`). The design all clients share
is in the server folder's `AGENTS.md`.

### Other

- Desktop (`fluxer_desktop/AGENTS.md`): built as Tyne with its own IDs and `tyne://`; extra app
  windows (end of `src/main/Window.ts`); updates from this repository's GitHub releases
  (`ShellDownloadFormats.ts`, `ForkShellUpdate.ts`), built by `fork-desktop-release.yaml`, and
  installed only if the release's signed checksums list them (`ForkReleaseSignature.ts`). Each
  release carries the web app of its commit.
- Branding, the end-to-end suite in `e2e/`, and data migrations in `fluxer_api/scripts/migrate_*.ts`.

## Building, testing and running

- The dev stack is described in `AGENTS.md` ("Development environment"); the checks to run before
  committing are in `CHECKS.md`.
- Upstream's CI (`.github/workflows/tests.yaml`, `validate.yaml`) runs on pull requests and on pushes
  to `main`, not on pushes to `tyne`: the checks in `AGENTS.md` and the nightly rebase's gate are
  what hold the fork. `nightly-rebase.yaml` (on the `automation` branch) does the rebase;
  `fork-desktop-release.yaml` publishes the desktop app.
- The self-hosting compose file pulls upstream's images unless `FLUXER_REGISTRY_OWNER` (or
  `FLUXER_REGISTRY`) points elsewhere.
- `fluxer_api/scripts/migrate_*.ts` are one-off data migrations for existing instances, run by hand
  and not part of start-up; read one before running it.

## Glossary

- **guild = community:** the code and API say guild, the UI says community.
- **persona, subprofile, root:** the stored identity; the copy of it the API builds into messages,
  reactions and typing on every read; the account itself.
- **svc:** `fluxer_svc` is the library the Rust services share. **Router, shard:** svc routing,
  unrelated to the web router, gateway bot shards or the gateway's `*_manager_shard_*` partitions.
- **Proxy:** the edge (Caddy), app, static and media proxies, the dev proxy, the upload relay. A
  "proxy tag" or "proxied message" is PluralKit's sense: sending as a persona.
- **Worker:** the API worker, the web service worker, or a gateway worker pool.
- **KV:** the Postgres table, Valkey, or NATS KV. **RPC:** NATS `rpc.gateway.*`, HTTP
  `/internal/rpc`, and `svc.*` are three different mechanisms.
- **Session:** a login session (a token), or a gateway session (resumable WebSocket state).
- **Fluxer, Tyne:** upstream, the fork. Folders keep their `fluxer_*` names.

## Folder guides

These folders have an `AGENTS.md` with their design and traps; read it before changing code under
the folder. A new folder guide is added to this list in the same commit.

- `fluxer_api/AGENTS.md`: the API and worker: how a route is put together, where fork code hooks in,
  and how to test in its shared test runtime.
- `fluxer_api/src/api/channel/AGENTS.md`: channels and messages on the server, and where personas
  enter them.
- `fluxer_api/src/api/persona/AGENTS.md`: personas on the server.
- `fluxer_api/src/api/signal_bar/AGENTS.md`: the signal bar on the server, and the design its
  clients share.
- `fluxer_app/src/features/channel/AGENTS.md`: the channel view in the web app: views, message rows,
  composer, search.
- `fluxer_app/src/features/lexical/AGENTS.md`: the web message editor (Lexical): what is sent,
  pills, persona mentions.
- `fluxer_app/src/features/messaging/AGENTS.md`: messages in the web app: the store, sending,
  reactions, uploads.
- `fluxer_app/src/features/persona/AGENTS.md`: personas in the web app.
- `fluxer_app/src/features/signal_bar/AGENTS.md`: the signal bar in the web app.
- `fluxer_desktop/AGENTS.md`: the desktop app: its processes and IPC, Tyne's identity, extra
  windows, updates and releases, native add-ons.
- `fluxer_gateway/AGENTS.md`: the Erlang gateway: its processes, how events reach sessions, resume,
  passive sessions, and the fork's hooks.
- `fluxer_messages/AGENTS.md`: the service that builds message objects and extracts mentions, and
  the persona fields it passes on.
- `packages/markdown_parser/AGENTS.md`: the markdown parser shared by the web app, the server and the
  mobile app, its two output formats, and the persona mention.
- `packages/schema/AGENTS.md`: the shared Zod schemas behind the OpenAPI spec and the Dart SDK, and
  the synced-preferences protobuf.
