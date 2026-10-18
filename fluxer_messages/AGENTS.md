# The messages service

`fluxer_messages` is the Rust service behind `svc.messages`. The API sends it stored message rows,
or asks it to read them, and gets back the message objects of REST responses and gateway events. It
also finds the mentions in a text. It is upstream's. The fork makes it pass on the persona ids it
finds: a message's `persona_id`, the `<@user:persona>` pairs in its text, and a per-persona breakdown
of each reaction. It checks no ownership and builds no persona objects: the API does both.

## Where things are

| Concern | File |
|---|---|
| Router or shard, Postgres or Scylla | `src/main.rs` |
| Wire types: requests, responses, the `Message` row | `src/types.rs` |
| Route and coalesce keys | `src/router_impl.rs` (`MessagesRouter`) |
| Reading rows, paging, visibility, building objects, reactions | `src/shard_impl.rs` (`MessagesShard`, `map_message_response`, `map_reactions`) |
| Mentions in a text | `src/mention_extractor.rs`, on `packages/markdown_parser` (its `AGENTS.md`) |
| The only caller; persona hydration | `fluxer_api/src/api/channel/services/message/MessageResponseDataService.ts` |
| The caller's stand-in in API tests | `fluxer_api/src/api/test/mocks/RepositoryBackedMessageResponseDataService.ts`, `ForkMessagePersonaMentions.ts` |
| The shape clients see | `packages/schema/src/domains/message/MessageResponseSchemas.ts` |

The API side, including when it builds a message and how it hydrates personas, is in
`fluxer_api/src/api/channel/AGENTS.md`; the persona rules are in `fluxer_api/src/api/persona/AGENTS.md`.

## Requests and responses

The API sends JSON to `svc.messages` (`requestSvcJson`, 6 s timeout). `MessageRequest` is tagged by
`op`; the answer is a `MessageResponse` (`FoundApi`, `FoundApiMany`, `FoundMentions` or `"NotFound"`),
or `{"error": ...}` from `fluxer_svc`, which the API turns into a 503.

| `op` | Does | Route key |
|---|---|---|
| `GetResponseById` | reads one message and builds it | channel |
| `ListResponses` | reads a page (`before`, `after`, `around` or the latest) and builds it | channel |
| `BuildResponse` | builds one row the API sends (send, edit, the event copy) | channel |
| `BuildResponses` | builds rows the API sends (search, pins, saved messages, threads, admin), in batches of at most 256 KB | first message's channel |
| `ExtractMentions` | lists users, roles, channels, `everyone`, `here` and persona pairs per text | `"mentions"`: every call goes to one shard |

The request carries the access decisions the API has made: the history cutoff, `include_hidden`
(admins), `threads_mask`, `exclude_types`. `MessagesRouter` sets `CACHES_RESPONSES = false`: it
decodes the request only for its keys, forwards the API's bytes unchanged to
`svc.messages.shard.<n>`, and relays the shard's reply unchanged. Concurrent identical `Get` and
`List` requests share one shard call (`coalesce_key`).

## Adding a field

Every hop is JSON by field name, and serde ignores unknown fields. The API and the service are
separate processes, so for a while either may run an older build than the other.

- **Request field:** `Option` or `#[serde(default)]` in `MessageRequest`, plus the payload in
  `MessageResponseDataService.ts`. If it changes the answer of a `Get` or `List`, add it to
  `coalesce_key`, or two different requests share one answer (the router forwards the first one's
  bytes). Upstream's router tests show the shape.
- **Row field:** builds receive the API's `Message.toRow()`, and on Postgres the shard decodes stored
  rows by name into `Message` (`decode_postgres_message`), so a column the API adds already arrives.
  To use it, add it to `Message` with `#[serde(default)]` (older rows lack it); ids go through the
  `serde_id` helpers (strings or numbers). Reactions go through `MessageReactionKvRow` and
  `MessageReactionDbRow`. Scylla also needs `MESSAGE_COLUMNS`, the statements and the row structs.
- **Response field:** add it with `skip_serializing_if = "Option::is_none"`, keep it optional in the
  API's types, and declare it in `MessageResponseSchemas.ts` (the OpenAPI spec and the Dart SDK come
  from it). Outside production the API validates REST responses against that schema and sends the
  parsed result (`OpenAPI` middleware, `validateResponses`), so an undeclared field vanishes from a
  development instance's REST responses while events still carry it. Make the API's stand-in
  produce the field too.

## The fork's persona fields

- **`persona_id`:** `Message.persona_id` in, `ApiMessageResponse.persona_id` out as a string; absent
  for the account (the API stores `null`). The API turns it into `subprofile` (`hydratePersonas`)
  and deletes it.
- **`persona_mentions`:** the `{user_id, persona_id}` pairs in the message's content, its embeds, and
  the content and embeds of what it forwards, from the same parse that fills `mentions` and `users`
  (`build_mention_context_entry`, `MessageMentionContext.embed_personas`, the appended
  `persona_mentions`). Sorted, absent when empty, set on `referenced_message` too, and not filtered by
  the stored `mention_users`. The API turns it into `mention_personas` and deletes it.
- **`ExtractMentions`** adds `personas`, the same sorted pairs (`sorted_persona_mentions`), left out
  when empty. The API stores them for search, keeping only accounts in `mention_users`.
- **Which pairs count:** `insert_persona` records a pair only when both ids are non-zero numbers. The
  account always goes into `users` as well, so pings and `mentions` stay upstream's. The parser
  accepts non-numeric persona ids; here they name no persona.
- **Reactions** (`map_reactions`): each row has a `persona_id`, absent or `0` for the account.
  `count` counts rows, so each persona's reaction counts. `me` means the viewer reacted as anyone,
  `me_root` as the account. `persona_reactions` lists `{persona_id, count, me}` per persona (`me`:
  one of the viewer's own), by count (highest first), then by id compared as text. Both are left
  out when false or empty. The list is keyed by persona id alone, which relies on persona ids being
  unique across accounts (the API issues snowflakes).

## Rules and traps

- **The service reports what rows say.** Access, ownership and persona objects are the API's; do
  not add persona lookups here.
- **Change the API's stand-in with the service.** API tests never run this service:
  `createApiTestHarness` uses `RepositoryBackedMessageResponseDataService`, which builds responses
  from the in-memory repositories, with persona pairs from `ForkMessagePersonaMentions.ts` (a regex,
  not the parser). Its `mapReactions` sends only `emoji`, `count` and `me`, so no API test sees
  `me_root` or `persona_reactions`.
- **Rows without an author are deleted.** Every read and build drops a row with neither `author_id`
  nor `webhook_id` and deletes it from storage (`cleanup_orphaned_messages`, the service's only
  write), a row sent to `BuildResponse` included. Never send a placeholder row to be built.
- **`BuildResponse` skips the hidden-author check** (authors with `content_hidden_since`) that the
  other build and read paths apply.
- **`DeletedUser`:** a missing user partial becomes `deleted_user(id)`, username `DeletedUser`. A
  failed or slow `svc.users` call does that to every author, silently, and the API's
  `isDeletedAuthor` then reads the username as a deleted account and shows a persona message as
  "Deleted Persona" (tyne-chat/tyne#152).
- **Absence:** `me_root` and `persona_reactions` are left out when false or empty. The web's
  hydration (`ReactionStateMachine.ts`) keeps its previous value when a field is absent, so it cannot
  tell "none" from "not sent" (tyne-chat/tyne#152).
- **Scylla is behind the fork.** `MESSAGE_COLUMNS` selects `persona_id`, which
  `tools/dev/cassandra_target_schema.json` does not have (it still lists the retired `subprofile`),
  and the two Scylla reaction statements do not select `persona_id`. Tyne runs Postgres (the compose
  files and `config/env/development.env` set it), but the image is built with `--features scylla`.
  Clippy with `--all-features` compiles that code and cannot catch this (tyne-chat/tyne#152).

## Where the fork's code sits

Fork-owned: `src/fork_shard_tests.rs` (included by `#[path]` at the end of `shard_impl.rs`),
`tests/fork_persona_mentions.rs`, and `examples/fork_persona_mentions.rs`, a one-off tool that ran
this parser over stored texts for a backfill (JSON lines in and out, nothing else). Inside
upstream's files:

- `types.rs`: the fields on `Message`, `ApiMessageReactionResponse`, `ApiMessageResponse` and
  `ExtractedMentionsResponse` (and its `From`). `ApiPersonaReactionEntry`, `ApiPersonaMention` and
  `sorted_persona_mentions` sit between upstream's items.
- `shard_impl.rs`, upstream's most-changed file here: a `// Fork imports.` group; `persona_id` in
  `MESSAGE_COLUMNS`, `MessageDbRow`, the three reaction row structs, their decoders and
  `From<MessageDbRow>`; `embed_personas` threaded through `build_mention_context_entry` and the
  signatures of `collect_user_ids_from_embed` and `collect_user_ids_from_embed_child`; two lines at
  the end of `map_message_response`; `map_reactions` rewritten (`Group`, both closures, the mapping),
  the largest edit; the appended `persona_mentions` and `mod fork_tests`.
- `mention_extractor.rs`: `MessageMentions.personas`, one line in `extend_mentions_from_markdown`,
  the `User` arm of `collect_mention_kind`, and `insert_persona`.

When upstream changes one of these, keep its lines and re-add the fork's as separate statements
where possible. Fork tests still sit in upstream's `mod tests`, against the root `AGENTS.md`; move
them when you touch them: `reactions_include_persona_breakdowns` in `shard_impl.rs` (the `Clone` on
`MessageReactionDbRow` is for it), and in `mention_extractor.rs` `extracts_persona_user_mention` and
the persona mentions added to `extracts_real_user_role_and_channel_mentions`, which
`tests/fork_persona_mentions.rs` already covers. The `persona_id` lines in the `reaction()` and
`minimal_api_message` fixtures are the allowed fixture exception.

## Network calls

Server-internal; the fork adds none. Opening a channel is one `ListResponses`. For a plain page the
shard makes up to two `svc.users` calls (plus one per refill round when hidden authors leave the
page short, at most 5), at most one gateway RPC (`rpc.gateway.guild.resolve_channel_mentions`), and
Postgres reads in batches (reactions per 64 messages, attachment decay per 128 ids, one per reply target or
forward source). Nothing is retried. Failed users, gateway and reaction calls are silent (`DeletedUser`
authors, no `mention_channels`, no `reactions`); a failed message or decay read fails the request.

## Tests

- **Upstream's:** inline `mod tests` in the four source files; `shard_impl.rs` uses in-memory
  storages and a stub `svc.users` on `InMemoryTransport`.
- **The fork's:** `src/fork_shard_tests.rs` (`persona_mentions` from content, embeds, forwards and
  replies, through `map_message_response`) and `tests/fork_persona_mentions.rs` (pairs, zero and
  non-numeric ids, `ExtractMentions` order and omission). New fork tests go in these files.
- **Run:** `cargo test -p fluxer-messages` needs no database or network. Before committing, run the
  full list in `CHECKS.md`: a change here touches messaging. It includes `cargo fmt`, Clippy with
  `--all-features` and `cargo test --workspace`.
- **Against the stand-in:** `fluxer_api/src/api/channel/tests/MessagePersona.test.ts`,
  `MessagePersonaMentions.test.ts`, `MessageReactionPersona.test.ts`.
- **With the real service:** `e2e/web/desktop/persona-mention-pipeline.spec.ts`,
  `persona-reactions-ui.spec.ts`, `persona-reactions-update.spec.ts`, `persona-replies.spec.ts`.
- **Not covered here:** a message's `persona_id` in the built object, `persona_id` decoded from stored
  rows, `me_root` for a stored `0` (the test uses an absent id), and the Scylla path.
