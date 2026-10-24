# Personas on the server

This folder is the server half of personas: several identities under one account (see "Personas" in
the root `AGENTS.md`). It owns the persona rows and the account's persona settings, the routes under
`/users/@me/personas`, the lookups other people make, the gateway events that keep clients in step,
and the ownership check every other path uses. The whole folder is the fork's: upstream never
touches it, so changes here cannot conflict. Its hooks into upstream files are listed at the end
and follow the placement rules in the root `AGENTS.md`.

## Where things are

| Concern | File |
|---|---|
| Routes, OAuth scopes | `PersonaController.ts` (registered in the fork block of `app/ControllerRegistry.ts`) |
| Rules, settings, events | `PersonaService.ts` |
| Rows | `PersonaRepository.ts` (behind `IPersonaRepository.ts`), plus `PersonaChannelStateStore.ts`, `ThreadOwnerPersonaStore.ts`, `PersonaImageSourceStore.ts` |
| New persona IDs | `PersonaIdGenerator.ts` |
| The three response shapes | `models/Persona.ts` (outside this folder) |
| Which persona a request names, and whether the caller owns it | `PersonaOwnership.ts` |
| Who is typing as whom | `TypingPersona.ts` |
| Image import from links | `PersonaAvatarImporter.ts`; the upload and link routes are in `user/controllers/UserAccountController.ts` |
| Deleting the images with the account | `PersonaImageDeletion.ts`, called from `UserDeletionService` |
| Export zip | `PersonaExportService.ts`, with the PluralKit mapping in `packages/schema/src/domains/persona/PluralKitFormat.ts` |
| Persona mentions on message rows | `MessagePersonaMentions.ts` |
| Old settings bytes | `RetiredSyncedPreferenceFields.ts` (a workaround; removal is tyne-chat/tyne#127) |
| Request and response schemas | `packages/schema/src/domains/persona/` |
| The `subprofile` object on messages | `channel/services/message/MessageResponseDataService.ts` |
| Account deletion | the fork block in `user/services/UserDeletionService.ts` |

## Rules that hold everywhere

- **Messages store an id, not a copy.** A message, reaction, thread or typing event carries only
  `persona_id`. The `subprofile` object clients draw is built from the current persona row every
  time a message is read or dispatched (`hydratePersonas` in `MessageResponseDataService`), so a
  renamed persona shows its new name on old messages. Never store persona fields on a message; add
  them to the persona and to `toSubprofileResponse` in `models/Persona.ts`.
- **A persona id is unique only within its account.** Look personas up by (user, persona): batch
  results are keyed by `personaLookupKey(userId, personaId)`, never by the persona id alone.
  New ids come from `PersonaIdGenerator.ts`: the 22 low bits are random, and each id has a
  millisecond of its own, so ids sort in the order personas were made (the export relies on it).
  Keep both; never make persona ids with `generateSnowflake`.
- **Ownership is checked in one place, with three exceptions.** A request names its persona through
  `requestedPersonaId` (`undefined`: the request says nothing; `null`: the account itself; an id).
  `resolveOwnedPersona` then accepts only a numeric id of the caller's own, live persona, and answers
  `UNKNOWN_PERSONA` otherwise. Send, edit, threads, forum posts and typing use these two. Reactions
  (`MessageReactionService.addReaction`), the signal bar (`SignalBarService`) and the channel
  selection (`PersonaService`) repeat the check inline: change all of them together. The reaction
  check runs only when `MessageReactionService` was given a persona repository; unlike send and edit
  it has no fallback to `getPersonaRepository()`.
- **The server stores the selection but never applies it.** Which persona a user has selected,
  globally or per channel, is kept for their clients. The server never picks a persona for a
  message: a request without `persona_id` is sent as the account.
- **Deletion is soft.** `delete` stamps `deleted_at`. `findById`, `findByUserId` and `count` skip
  deleted rows, so a deletion frees the 250-persona cap, the tags and the signature emojis.
  `findByUserAndPersonaIds`, which hydration uses, does not skip them, so old messages keep showing
  the persona. Rows are removed only when the account is deleted.
- **Private hides the profile, not the identity.** Visibility is `public`, `unlisted` (the default)
  or `private`. A private persona still speaks: its name and avatar appear on its messages,
  reactions, typing and signals, and in `mention_personas`. Only its profile (bio, banner, pronouns,
  profile card) is withheld: `GET /users/:id/personas/:pid` answers 403 `PRIVATE_PERSONA`, not 404,
  because the asker has already seen the persona on a message. Other people's lookups also pass
  upstream's `validateProfileAccess` first.
- **Knowing a persona's ID entitles anyone signed in to what a message from it shows**, whatever
  its visibility: `POST /personas/lookup` takes up to 100 `{user_id, persona_id}` pairs and returns
  `toSubprofileResponse` with the owner (`lookupPersonas`), deleted personas included. That shape
  carries nothing of the profile, pronouns included. An ID is only learned from something already
  seen, so no event names a private persona: `GUILD_PERSONAS_DIRTY` carries only the account for it,
  and clients that show its personas fetch them again by ID (tyne-tools#7). Public and unlisted
  personas still travel with the event for clients released before the lookup (tyne-chat/tyne#206).
- **Every image is stored here, never linked.** A persona's avatar and banner and the account's
  display tag icon are hashes of images this instance stores under the account (`avatars/<user
  id>/`, `banners/<user id>/`); clients build the address from the media endpoint, the owner's id
  and the hash. The schemas accept only `PERSONA_ASSET_HASH_PATTERN`, and images given as links are
  fetched into storage first (below). The tag icon links stored before the route checked were
  migrated to hashes once. As a backstop, values read from storage pass through
  `personaAssetHashOrNull` (in the `Persona` constructor for avatars and banners, in
  `PersonaRepository` for the tag icon), which drops anything that is not a hash, and the response
  schemas declare the pattern, so dev and tests fail on a response that breaks it. The clients
  turn a hash into an address only through helpers that refuse anything else. A link stored and
  shown would tell its server who reads the account's messages.
- **Counters and other concurrent fields need partial writes.** `update` and `recordUsage` write
  every other column from a read made earlier, so two concurrent edits can revert each other. An
  `upsertAll` row with columns missing becomes a partial update; use that for new counters.

## Data

The tables are declared in the `// Fork: this fork's tables` block at the end of `api/Tables.ts`,
with their types in `database/types/PersonaTypes.ts`. Like every table here, they are rows of the
single Postgres key/value table.

| Table | Key | Holds |
|---|---|---|
| `personas` | (user_id, persona_id) | profile fields; tags and signature emojis as JSON strings; usage counters; `visibility`; `external_uuid` (the PluralKit member id); `deleted_at` |
| `user_persona_settings` | user_id | mode (`manual` or `last`), scope (`global` or `channel`), the selected persona and whether it is latched, the account-wide display tag |
| `persona_channel_states` | (user_id, channel_id) | the per-channel selection; no row means the account |
| `thread_owner_personas`, `thread_owner_personas_by_user` | thread_id; (user_id, thread_id) | which persona started a thread; the by-user row is written first, so account deletion finds it |
| `persona_image_sources` | (user_id, persona_id) | the PluralKit link an image came from, and the hash it produced; only the export reads it |

The persona columns on upstream's tables (`persona_id` and `mention_personas` on `messages`,
`persona_id` in the key of `message_reactions`) are the one exception to "fork data in fork tables";
see the root `AGENTS.md`.

Limits: 250 live personas per account, 5 tags per persona (unique across the account's live
personas), 10,000 signature emojis per persona (unique across personas).

## Routes and OAuth

- `@me` routes: list and create, `/:persona_id`, `/import`, `/settings`,
  `/channel-states[/:channel_id]`, `/export`, `/import-image`. Other people's: `/users/:user_id/personas`
  (public personas only) and `/users/:user_id/personas/:persona_id`.
- **Route order:** a new literal path (`/users/@me/personas/<word>`) must be registered before
  `/:persona_id`, or the parameter route takes it.
- **OAuth:** the `@me` routes check `personas.read` or `personas.write` with
  `requireOAuth2ScopeForBearer`. A route without that call refuses bearer tokens, whatever its
  OpenAPI block says.
- The image routes in `UserAccountController` are also registered under `/users/@me/subprofiles/*`.
  No client calls those aliases and they are being removed (tyne-chat/tyne#124); do not add callers.
- **Schemas:** a change to `PersonaApiSchemas.ts` needs `pnpm openapi:generate`, then a regeneration
  of the Dart SDK for the mobile app (root `AGENTS.md`, "Generated code").

## Events

| Event | Sent to | When |
|---|---|---|
| `USER_PERSONA_CREATE`, `_UPDATE`, `_DELETE` | the account's own sessions | each write |
| `USER_PERSONAS_UPDATE` | own sessions | after a bulk import (the whole list) |
| `USER_PERSONA_SETTINGS_UPDATE` | own sessions | a settings save |
| `USER_PERSONA_CHANNEL_STATE_UPDATE` | own sessions only, on purpose | a per-channel selection |
| `GUILD_PERSONAS_DIRTY` | every guild the account is in, plus each DM and group-DM recipient | create (public and unlisted only), every update and delete, a bulk import, a display-tag change; carries the persona only when it is public or unlisted |

- `GUILD_PERSONAS_DIRTY` costs one gateway RPC per guild and per DM partner for every persona edit.
  Keep it off paths that run often.
- **Adding an event:** add the name to `constants/Gateway.ts` and to
  `fluxer_gateway/src/utils/event_atoms.erl`, document it in `fluxer_docs` (`gateway/events.md`;
  nothing checks that since upstream dropped the docs verifier), and restart the gateway. Without the atom, a DM dispatch
  (`rpc.gateway.presence.dispatch`) fails with `presence_dispatch_error`, and a guild dispatch is
  logged and dropped: nobody receives the event. A community event also needs a decision on channel
  scope and passive sessions: `fluxer_gateway/AGENTS.md`, "Event names".

## Import, export and images

- **Import:** the client reads a PluralKit export or a Tyne zip, sends the images first, then
  `POST /import` in chunks (the server takes at most 250 personas per request). `importPersonas`
  matches an existing persona by `external_uuid` or by its own id, so re-importing an export updates
  it. It is not atomic: a failure leaves the personas already written. The zip's tag icon is stored
  the same way, through `/import-image` or, for an older export's `tag_icon_url`, the batch link
  import; the settings then get its hash.
- **Image sources are a record, not images.** `persona_image_sources` keeps the PluralKit link each
  imported image came from. A link there is never sent to a client, in a response or an event, and
  never used as an image address; the one place it leaves the server is the account's own export,
  in `pluralkit.json`, so PluralKit keeps its links. Keep `loadPersonaImageSources` out of every
  other path.
- **Images from links** (`PersonaAvatarImporter`): the fetch goes through the media proxy, which
  enforces the network policy (public addresses only, redirects checked hop by hop, a size cap).
  This code refuses only non-http(s) links, links with credentials and links on the media
  endpoint's own host. All three image routes share one quota (2,500 per 10 minutes); a batch runs
  one at a time per account, under a Valkey lock.
- **Export:** `GET /export` streams a zip: the images and the tag icon as files, a README,
  `pluralkit.json` (PluralKit v2) and `tyne.json`. An image that has not changed since it was
  imported links back to its PluralKit source in `pluralkit.json`. Exports no longer write
  `tag_icon_url`; the import still reads it from older files.

## Mentions for search

`withMentionedPersonas` runs on every write of a message row (called from
`MessageRepository.upsertMessage`). When the content and `mention_users` are unchanged it keeps the
stored value, and it calls the messages service's parser only for a text that has `mention_users`
and looks like `<@id:id>`. It keeps a `<@user:persona>` pair only when its account is in
`mention_users`, so `allowed_mentions` applies.
If the parser fails the message is still written, without its persona mentions. Search indexes
`personaId` and `mentionedPersonaIds` (`search/message/PersonaMessageSearch.ts`).

## Account deletion

`UserDeletionService` gives each persona, deleted ones included, a new id with a "Deleted Persona"
row under the deleted user's id, rewrites the messages to that mapping, deletes and purges the
images (persona avatars and banners and the tag icon, `PersonaImageDeletion.ts`), then hard-deletes
every persona row, setting and fork-table row.

## Known gaps

- Removing a reaction without `persona_id` removes the account's persona reactions too
  (tyne-chat/tyne#123).
- Persona edits and deletions reach every mutual guild whatever the persona's visibility.
- Persona images share the account's `avatars/<user id>/` prefix, and deletion purges only the
  current hashes: an image a persona or the tag icon used before is left in storage.

## Where this code hooks into upstream files

- Wiring: `app/ControllerRegistry.ts`, `api/Tables.ts`, `ServiceMiddleware.ts`,
  `ServiceSingletons.ts`, `GuildStackServiceFactory.ts`, `WorkerDependencies.ts`, `HonoEnv.ts`.
- One-line hand-overs: `MessageRepository.upsertMessage`, `UserAccountSettingsService`,
  `ThreadRepository`, `MessageReadStateService`.
- Inside upstream lists, without a marker: the event names in `constants/Gateway.ts`, error codes in
  `ApiErrorCodes.ts` and `ErrorCodeMappings.ts`, one entry in `UserRateLimitConfig.ts`, the scopes in
  `OAuth2Constants.ts`.
- The largest blocks: about 240 lines of image routes inside `UserAccountController`, and the
  persona part of `UserDeletionService` (its image deletion has moved to `PersonaImageDeletion.ts`).
  Move code out of these when you touch it, not into them.

## Tests

- `persona/tests/` uses `createApiTestHarness` (in-memory database, a gateway with spies, in-memory
  search): no network needed. `PersonaService.test.ts`, `PersonaErrors.test.ts` and
  `MessagePersonaMentions.test.ts` are unit tests with mocks.
- `PersonaTagIcon.test.ts` covers the tag icon rule (route, rows holding a link, messages) and
  `PersonaImageDeletion.test.ts` the image deletion.
- Elsewhere: `user/tests/PersonaAvatarUpload.test.ts` and `PersonaAccountDeletionCompliance.test.ts`,
  `channel/tests/` (`MessagePersona*`, `ChannelPersonaMentions`, `MessageReactionPersona`),
  `search/message/PersonaMessageSearch.test.ts`, the schema package's tests, and the end-to-end specs
  `e2e/web/*/persona-*.spec.ts`.
- Not covered: that a private persona stays out of the payloads it should not be in.
- Before committing, run the full list in `CHECKS.md`: a persona
  change counts as one that touches personas.
