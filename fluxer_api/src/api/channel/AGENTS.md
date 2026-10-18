# Channels and messages on the server

The API's channel domain: the `/channels/...` routes (messages, reactions, pins, typing, uploads,
threads and forums, calls, settings) and the services that check access, write rows and send gateway
events. It is upstream's design, and code upstream changes often. The fork threads personas through
it: a message, reaction or thread stores only a persona id, checked on the way in, and the API builds
`subprofile` and `mention_personas` on the way out. The persona rules are in `../persona/AGENTS.md`.

## Where things are

| Concern | File |
|---|---|
| Routes | `controllers/`: `MessageController` (messages, typing), `MessageInteractionController` (reactions, pins), `ThreadController`, `ForumController` and others |
| Route request → response | `services/message/MessageRequestService.ts` |
| Facades | `services/ChannelService.ts`, `services/MessageService.ts` (`send`, `edit`, `deletion`, `retrieval`, …) |
| Access | `services/BaseChannelAuthService.ts` (`getChannelAuthenticated`) |
| Send, edit, delete | `services/message/MessageSendService.ts`, `MessageEditService.ts`, `MessageDeleteService.ts` |
| Row writes | `services/message/MessagePersistenceService.ts` → `repositories/MessageRepository.ts` |
| Rewriting a message | `services/message/MessageWriteLock.ts` (`withFreshMessage`) |
| Message JSON, persona hydration | `services/message/MessageResponseDataService.ts` (the `svc.messages` client) |
| Events | `services/message/MessageGatewayDispatch.ts`, `services/ChannelGatewayDispatch.ts` |
| Reactions | `services/interaction/MessageReactionService.ts`, `repositories/MessageInteractionRepository.ts` |
| Pins, typing | `services/interaction/MessagePinService.ts`, `MessageReadStateService.ts` |
| Uploads | `services/AttachmentUploadService.ts`, `services/message/AttachmentProcessingService.ts` |
| Threads, forums | `services/thread/`, `repositories/ThreadRepository.ts` |
| Persona mention candidates (fork) | `controllers/ChannelPersonaMentionController.ts` |
| Rows, models, schemas | `api/Tables.ts`, `api/database/types/MessageTypes.ts`, `api/models/`, `packages/schema/src/domains/message/` |

## How a message moves

`ARCHITECTURE.md` ("Sending a message") has the path from composer to screen. Inside this folder:

1. `MessageController` parses JSON or multipart (`parseMessageRequestBody`) →
   `MessageRequestService.sendMessage` → `MessageSendService.sendMessage`.
2. Channel access (guild channels ask the gateway), **the persona check**, the personal-notes branch
   (`sendPersonalNoteMessage`), permissions, the nonce (a repeated nonce returns the existing
   message), reply or forward, uploads, the id, mentions (`ExtractMentions` on `svc.messages`),
   slowmode.
3. `MessagePersistenceService.createMessage` builds the row, `persona_id` included, and calls
   `MessageRepository.upsertMessage`.
4. Once the row exists the request must not fail: `settlePostCreateWork` runs the DM, mention,
   read-state and dispatch work with `Promise.allSettled` and only logs failures.
5. `dispatchMessageCreateBroadcast` builds the event copy (viewer = author, no reactions) and
   `dispatchChannelEvent` sends it to the guild, each DM recipient, or the owner of personal notes.
6. The HTTP response is a second build: `MessageRequestService.sendMessage` calls `buildMessage`
   for the sender, with reactions. Persona hydration runs for each copy.

**Edit:** `MessageEditService.editMessage`. Someone else's message goes to `handleNonAuthorEdit`,
which cannot change its persona. The author's edit writes through
`MessagePersistenceService.updateMessage` inside `withFreshMessage` and dispatches
`MESSAGE_UPDATE`. **Delete:** `MessageDeleteService` → `MESSAGE_DELETE` or `MESSAGE_DELETE_BULK`.
**Read:** `MessageRetrievalService` decides access (history cutoff, read permission), then
`svc.messages` reads the rows itself (`ListResponses`, `GetResponseById`).

## Where personas enter

- **Request:** `persona_id` on send, edit and typing (`MessageRequestSchemas.ts`; `null` means the
  account). The older `subprofile` object is read only for its id, only when `persona_id` is absent
  (`requestedPersonaId`).
- **Send:** `MessageSendService.resolveMessagePersonaId` → `resolveOwnedPersonaId`, right after
  channel access, before the personal-notes branch and the nonce. `validateForumStarter` calls it
  too, so a forum post naming someone else's persona is refused before the post exists.
- **Edit:** checked in `editMessage` before the lock. Re-sending the message's current persona skips
  the check, so a message stays editable after its persona is deleted. A persona-only edit sets no
  `edited_timestamp`, and `MessageValidationService` counts the stored content, attachments, embeds
  and stickers when an edit leaves them out, so such an edit is not "empty".
- **Storage:** `persona_id` and `mention_personas` on upstream's `messages` table.
  `MessageRepository.upsertMessage` runs `withMentionedPersonas` (persona guide) on every write.
- **Hydration:** `MessageResponseDataService.hydratePersonas`, called by `listMessages`,
  `getMessage`, `buildMessage` and `buildMessages`, so for every response and event. It sets
  `subprofile` (`null` for the account), walks `referenced_message`, and shows "Deleted Persona" when
  the author's account is deleted and "Unknown Persona" when the row is missing. It takes
  `persona_id` and `persona_mentions` off the response and turns the latter into `mention_personas`
  (absent when empty). The gateway's `push/fork_push_personas.erl` and the clients read both fields.
- **Typing:** `MessageReadStateService` puts the server's own `subprofile`
  (`resolveTypingSubprofile`) on `TYPING_START`.
- **Threads:** `services/thread/ForkThreadOwnerPersona.ts` checks the persona before the thread
  exists; the owner is kept in the fork's tables, sent as `owner_persona_id` (`ThreadMappers`), and
  the "thread created" system message carries `persona_id`.

## Reactions

- **The key:** `message_reactions` is keyed `(channel_id, bucket, message_id, emoji_id, emoji_name,
  user_id, persona_id)`, with `0n` for the account. A stored key is those values joined in that
  order, so moving or dropping `persona_id` in a rebase compiles but strands every stored reaction;
  `api/database/MessageReactionsPersonaKey.test.ts` pins it. Always write a `bigint`: `'0'` or
  `null` would be a different key.
- **Add:** `PUT …/reactions/:emoji/@me` with an optional JSON body `{persona_id}`.
  `MessageReactionService.addReaction` checks ownership itself, not through `PersonaOwnership`
  (change both together), and puts `persona_id` and `subprofile` on `MESSAGE_REACTION_ADD`. The
  check runs only when the service was given a persona repository; there is no fallback.
- Each persona's reaction is its own row, so it counts in `count` and toward the per-reaction user
  cap. The per-persona breakdown on a message (`persona_reactions`, `me_root`) comes from
  `fluxer_messages`.
- **Remove:** `?persona_id=` (`0` is the account). See "Known gaps" for a request without it.
- **Users list:** items are `ReactionUserItemResponse`: the user plus `persona_id` and `subprofile`.

## Rules and traps

- **Message JSON comes only from `svc.messages`** through `MessageResponseDataService`.
- **Rewrite an existing message only inside `withFreshMessage`** (a lock and a re-read).
- **`hydratePersonas` touches no repository when nothing names a persona.** Upstream's
  `MessageResponseDataService.test.ts` builds the service without one. The method is `protected`
  because the API's test stand-in subclasses the service and calls it.
- **Two meanings of `mention_personas`.** On the row it is a set of persona ids for search, kept only
  for accounts in `mention_users`. On a response it is a list of persona objects built at read time
  from the messages service's parse, not filtered by `mention_users`. The service never returns the
  stored column.
- **Hydration cost:** one point query per distinct (user, persona) pair and one settings query per
  100 authors, on every list and build, so twice per send. Keep lookups batched per call.
- **The optional `personaRepository`** (last constructor parameter of `ChannelService`,
  `MessageService` and the interaction services): send, edit and hydration fall back to
  `getPersonaRepository()`; reactions and `recordUsage` (an un-awaited usage count after a persona
  send) do not. The API passes it (`GuildStackServiceFactory`); `WorkerDependencies.ts` does not.
- **Order on Postgres:** a limited or cursored query on messages or pins must give `orderBy`; the
  store answers oldest first (`api/database/NewestFirstQueryGuard.test.ts`).
- **`GET /channels/:id/persona-mentions`** loads every member of the guild, and their users, on each
  request. Do not add callers or call it per keystroke.

## Where the fork's code sits

Fork-owned: `controllers/ChannelPersonaMentionController.ts` (one line in `controllers/index.ts`),
`services/thread/ForkThreadOwnerPersona.ts` and the tests. Inside upstream's files, largest first:

- `MessageResponseDataService.ts`: helpers before the class, `hydratePersonas` and
  `findDeletedUserIds` in it, the constructor widened, two lines in each build and list method.
- `MessageSendService.ts` (upstream's most-changed file here): `resolveMessagePersonaId` and its two
  calls, and a `recordUsage` block repeated at the end of `sendMessage` and `sendPersonalNoteMessage`.
- Reactions: `MessageReactionService.ts`, `MessageInteractionRepository.ts` (`removeReaction`
  rewritten), `MessageInteractionService.ts`, `MessageInteractionController.ts` (schemas swapped).
- `MessageValidationService.ts`: upstream's empty-message condition rewritten.
- Smaller hand-overs: `MessageEditService.ts`, `MessagePersistenceService.ts`, `MessageRepository`,
  `MessageAuthorRepository.anonymizeMessage` (account deletion), typing, the thread files (imports
  under `// Fork: threads started as a persona.`, elsewhere `// Fork imports.`), and an `orderBy` in
  upstream's pin query.

When upstream changes one of these, keep the hand-over shape and move fork lines out of upstream's.

## Tests

- `tests/` holds integration tests on `createApiTestHarness` (in-memory database, gateway and
  search; no network). `svc.messages` is replaced by
  `api/test/mocks/RepositoryBackedMessageResponseDataService.ts`, with persona mentions from
  `ForkMessagePersonaMentions.ts`. A change to what `fluxer_messages` returns needs the same change
  there.
- Fork tests: `tests/MessagePersona.test.ts` (send, edit, ownership, hydration, replies, forum
  posts, threads), `MessagePersonaMentions.test.ts`, `MessageReactionPersona.test.ts`,
  `ChannelPersonaMentions.test.ts`, `MessageAuthorRepository.test.ts`,
  `services/message/MessageValidationServicePersona.test.ts`; typing is in
  `../persona/tests/TypingPersona.test.ts`.
- A new fork test goes in a fork-owned file: `tests/<Feature>Persona.test.ts`, or
  `<UpstreamFile>Persona.test.ts` next to an upstream unit test. One file:
  `pnpm --filter fluxer_api test src/api/channel/tests/MessagePersona.test.ts`. Before committing, the
  whole list in `CHECKS.md`: a change here touches messaging.
- End to end: `e2e/web/*/persona-{messaging,replies,reactions-*,mention-pipeline,typing}.spec.ts`.
- Not covered: the reaction breakdown (the stand-in's `mapReactions` leaves it out), the reaction
  events' payloads, removing without `persona_id` while persona reactions exist, and the users list
  with several persona rows per user.

## Known gaps

- Removing a reaction without `persona_id` deletes every row of that user for the emoji and sends
  one `MESSAGE_REACTION_REMOVE` without `persona_id`, the same event as removing only the account's
  (tyne-chat/tyne#123).
- Reactions batched by the gateway (`MESSAGE_REACTION_ADD_MANY`) lose their persona
  (tyne-chat/tyne#120).
- The reaction users list pages by user id, so a page that ends inside one user's persona rows skips
  the rest of them (tyne-chat/tyne#152).
- Upstream's `repositories/ThreadRepository.test.ts` compares the `messages` columns with
  `tools/dev/cassandra_target_schema.json`, whose fork entry still lists the retired `subprofile`
  column instead of `persona_id` and `mention_personas`, so that check fails on the fork
  (tyne-chat/tyne#152).
