# Messages in the web app

The web client's message engine: each channel's loaded messages, paging and jumps, the gateway's
message events, sending, editing, deleting, reactions, uploads and markdown. It is upstream's
design, and code upstream changes often. The fork threads personas through sending, editing,
reactions, mentions and typing, mostly inside upstream's files. The screens (list, rows, chips,
composer) are in `channel` (`../channel/AGENTS.md`), the choice of persona in `persona`
(`../persona/AGENTS.md`), the server side in `fluxer_api/src/api/channel/AGENTS.md`. Paths are
relative to this folder; other features are named from `fluxer_app/src/features/`.

## Where things are

| Concern | File |
|---|---|
| Store facade | `state/MessagingMessages.ts` (`Messages`) |
| One channel's window, buffers, jump state | `state/ChannelMessages.ts` |
| A message | `models/MessagingMessage.ts` (`Message`) |
| Fetch, jump, send, edit, delete | `commands/MessageCommands.tsx` |
| Send queue, local limit, failures | `state/MessageQueue.tsx` |
| Composer submit → send | `hooks/useTextareaSubmit.ts` → `hooks/useMessageSubmission.tsx` |
| Optimistic copy, request bodies, retry | `utils/MessageSubmitUtils.ts`, `MessageRequestUtils.ts`, `MessageRetryUtils.ts` |
| Reactions | `state/MessageReactions.ts`, `ReactionStateMachine.ts`, `ReactionUsersStateMachine.ts`, `commands/ReactionCommands.tsx` |
| Uploads | `upload/CloudUpload.ts`, `AttachmentUploadPlan.ts`, `ChunkedAttachmentUploader.ts` |
| Gateway events | `events/`, registered in `gateway/events/EventRouter.ts` |
| Markdown | `utils/markdown/` (parser in `parser/`, WASM), `components/markdown/renderers/` |

## The message store

- **Not MobX.** What components observe is `Messages.version` (`updateCounter`) and
  `cacheGeneration`. `ChannelMessages` and `Message` are plain objects, never mutated. Every change
  builds a new `ChannelMessages`, stores it with `commitMessages` (which re-indexes messages by
  author and by persona) and calls `notifyChange()`; skip either and nothing re-renders.
- **Readers** subscribe with `Messages.subscribe` (`channel/components/ChannelMessages.tsx`) or
  read `Messages.version` in an observer (`channel/state/PublishNudge.ts`); `getMessage` alone
  tracks nothing. The list is keyed by `cacheGeneration`, which changes when a session
  invalidation discards loaded messages.
- **`ChannelMessages`** is copy-on-write, kept in a static LRU of 50 channels that never evicts the
  selected channel or one held by `retainChannel`. Beside the visible list it keeps `beforeBuffer`
  and `afterBuffer` (up to 250 each), so scrolling back over them needs no request. Pages are 50;
  the window is kept to 100–200 messages, the rest moving to the buffers. Jump fields
  (`jumpDestinationId`, `jumpTicket`) are read by `platform/utils/ScrollManager.ts`.
- **`Message`** changes through `withUpdates`. Reactions are not on it: `message.reactions` reads
  `MessageReactions` by message id.
- **Loading:** `MessageCommands.fetchMessages` decides with a pure preflight: share an identical
  request in flight, wait out an account switch, skip a gated channel, serve the buffers, or fetch.
  A page is `cached` (stale) if the gateway connection changed meanwhile; `refetchStaleWindow`
  reloads it at most every 10 s. A replacing load keeps the sending and failed messages it lacks
  (`collectUnsentMessages`). On READY, `handleGatewayReady` reloads the selected channel and marks
  the others not ready, and `MessageReactions` is emptied.

## Sending: composer to echo

1. The composer (`channel/components/LexicalChannelTextareaContent.tsx`) calls `useTextareaSubmit`:
   reaction shorthand, slowmode, edits, slash commands, mention confirmation, then
   `useMessageSubmission.sendMessage`.
2. Fork block: with a persona selected, a lone `\\` clears it and sends nothing;
   `resolveOutgoingPersona` strips the tag and gives the `subprofile`.
3. Nonce = `SnowflakeUtils.fromTimestamp(Date.now())`. `MessageCommands.reserveSend` applies the
   local limit (5 sends per 2 s per channel). Files are claimed into `CloudUpload` under the nonce.
4. `createOptimisticMessage` (id = nonce, `SENDING`, the `subprofile`) → `createOptimistic`.
5. `MessageCommands.send`: text through `MessageQueue.enqueue`, one serial queue for all channels
   (five waiting at most; a sixth fails at once); files through `prepareAttachmentsForSend` and
   `sendImmediately`, outside the queue. The request carries only `persona_id`.
6. The HTTP response (applied in `send`) and `MESSAGE_CREATE` both reach `applyIncomingMessage`.

Stickers, auto-sent GIFs and memes use `sendOptimisticMessage`, which matches the draft for the
persona and clears the draft only when it was nothing but a tag (`utils/ExpressionDraftPersona.ts`).
Callers that skip `reserveSend` (voice messages, `UploadManager`, share menus) are counted in
`send` itself.

## Optimistic copies and nonces

- `applyIncomingMessage` replaces the copy whose id is the incoming `nonce` and whose author
  matches (`ChannelIncomingMessageStateMachine.ts`); a copy still showing uploads is removed and the
  message appended. The second of response and event merges by real id, and `hydrateMessage` keeps
  the current object unless `shouldUseIncoming` sees a newer edit, other content or other embeds
  (or the window is stale).
- `createOptimistic` goes through `handleIncomingMessage`, which ignores a window that is not
  `ready`: the request goes out, but no pending row shows.
- A failed send gets `sendError` (`FAILED`); with files, `restoreFailedMessage` also puts the text
  and files back in the composer and deletes the copy. A 429 is retried at most twice, and only if
  the wait is 30 s or less; then a modal. Other errors show a modal or a local system message.
  "Retry" (`retryFailedMessage`) resends with the same nonce and persona; deleting a failed message
  is local (`deleteLocal`).

## Gateway events

`MESSAGE_CREATE` reaches typing, `Messages.handleIncomingMessage`, `MessageReferences`,
notifications, read states and the mention feed; `MESSAGE_UPDATE` reaches `handleMessageUpdate`
(loaded messages only), saved messages, pins and forum posts. Reaction events update
`MessageReactions`, then `Messages.handleReaction` clones the message so its row re-renders.

## Reactions

- `MessageReactions` is a plain store with per-message and per-emoji listeners, read through
  `useSyncExternalStore` (`hooks/useMessageReactionStore.ts`). `ReactionStateMachine` is pure; its
  `knownReactors`/`removedReactors` tombstones stop a hydrate after a local change from counting
  twice. Passing `reactions` to `withUpdates` re-hydrates the store.
- `ReactionCommands` applies the change first, retries a 429 three times, and reverts on failure.
- **Personas:** a reactor is keyed `user:persona` (`getReactorKey`); `me` means any of one's
  identities, `me_root` the account, `persona_reactions` the breakdown. Commands take `personaId`
  or fall back to `PersonaStore.getEffectiveReactionPersona`; add sends `{persona_id}`, remove
  always sends `?persona_id=` (`0` for the account). Chips ask `hasPersonaReacted`.

## Uploads

`CloudUpload` holds the composer's attachments per channel and each send's upload per nonce, in
RxJS `BehaviorSubject`s. With `features.presigned_attachment_uploads`, `AttachmentUploadPlan` gets
plans from `POST /channels/:id/attachments` and PUTs the bytes (whole, or in parts), and the send
carries only metadata; with the pre-upload privacy setting this starts when files are added
(`MessageQueue.startTextareaAttachmentUploads`). Otherwise, or when that fails and the files are
small enough, they go in a multipart POST with the message.

## Editing and deleting

- `MessageCommands.edit` PATCHes. Its last parameter is the persona: absent leaves it, `null` makes
  the message the account's. Text edits run `PersonaStore.matchEditMessage` first
  (`useTextareaSubmit`, `channel/components/UserMessage.tsx`); emptying the text or toggling embeds
  passes no persona. "Change persona" edits only the persona (`state/MessageChangePersona.ts`).
- Upstream waits for `MESSAGE_UPDATE`; the fork also applies the PATCH response, adding the sent
  persona if the response has none. In `handleMessageUpdate`, an update with `author` but no
  `subprofile` key means the account.
- Delete is not optimistic: one `DELETE`, shared while in flight; the row goes on `MESSAGE_DELETE`.

## Where the fork's code sits

Fork-owned: `state/MessageChangePersona.ts`, `utils/ExpressionDraftPersona.ts`,
`utils/PlainPasteUtils.ts` and the fork tests. Inside upstream's files, under `// Fork imports.`:

| File | Fork change |
|---|---|
| `useMessageSubmission.tsx`, `useTextareaSubmit.ts`, `useTextareaExpressionHandlers.ts` | persona blocks in both send callbacks; `matchEditMessage` around the edit calls; the draft kept on expression sends |
| `MessageCommands.tsx` | `subprofile` on `SendMessageParams`; `SignalBarStore.affirmPersona` in `send`; `edit`'s last parameter and response block |
| `MessageRequestUtils.ts`, `MessageSubmitUtils.ts`, `MessageRetryUtils.ts`, `MessageQueue.tsx` | `persona_id` in requests; `subprofile` carried through |
| `MessagingMessage.ts`, `ChannelMessages.ts` | `subprofile` in constructor, `withUpdates`, `equals`, `toJSON`; `mention_personas` → `PersonaStore.recordKnownPersona`; `skipReactionHydration` |
| `MessagingMessages.ts` | persona index inside upstream's index methods; `patchPersonaMessages` (a copy of `patchAuthorMessages`); `handlePersonaUpdate`, `handleAuthorDisplayTagUpdate` (from `persona/events/PersonaEvents.ts`) |
| `ReactionStateMachine.ts`, `ReactionUsersStateMachine.ts`, `MessageReactions.ts`, `ReactionCommands.tsx`, reaction events, `ReactionUtils.ts` | upstream's functions rewritten for persona reactors; widened signatures; `MessageReactionsModal.tsx`, `EmojiRenderer.tsx` pass ids to "React as…" |
| `Nodes.ts`, `MarkdownParserWasm.ts`, `MentionRenderer.tsx`, `Plaintext.ts` | `personaId` on user mentions; a persona branch at the top of the `User` case |
| `MessageGroupingUtils.ts`, `MessageReferences.ts`, `SystemMessageUtils.tsx` | a persona change starts a group; reply previews keep a known persona; persona names |
| `TypingStart.ts`, `useTextareaDraftAndTyping.ts` | the typist's persona; the composer's persona to typing and the signal bar, silent while a tag is half typed |

Smaller fork changes: emoji autocomplete limit, typed shortcode case, `<t:>` in the profile's
time zone, plain paste, an emptied composer deleting its draft. The mention parser is in
`packages/markdown_parser/rust`; `pnpm --filter fluxer_app wasm:codegen` rebuilds the gitignored
`MarkdownParserWasmBytes.ts` from it. `patchPersonaMessages` and the reaction state machines copy
or rewrite upstream's code: an upstream fix there has to be carried over by hand.

## Rules and traps

- `getMessage` and `getMessages` create an empty window for an unknown channel and touch the LRU;
  to look without creating, use `getCachedMessages`.
- Building a `Message` from one already in the store must not re-hydrate its reactions, or
  tombstones are subtracted twice: `withUpdates` and `hydrateMessage` pass `skipReactionHydration`.
  Upstream still re-hydrates; keep the option when upstream changes those lines.
- A field that can change without new content, edit time or embeds (a persona-only edit sets no
  `edited_timestamp`) reaches a loaded message only through `MESSAGE_UPDATE` or the edit response,
  because `shouldUseIncoming` ignores it.
- Persona resolution is the send itself (`../persona/AGENTS.md`): a new send path calls
  `resolveOutgoingPersona` once per message.

## Network calls

- **Opening a channel:** none if the window is loaded and fresh or loading, else one page GET
  (retried twice on network and gateway errors). A failure shows the list's retry bar; nothing
  retries by itself.
- **Send:** one POST; with files, first a plan request and one PUT per file or part. A 429 costs at
  most two more. Sending as another persona re-points one's lit signals in the channel, one request
  each (`SignalBarStore.affirmPersona`).
- **Edit:** one PATCH, at most five retries (network and gateway errors, and 429s unless the
  message was published). **Delete:** one. **Reaction:** one; a 429 is retried three times.
- **Render:** `MentionRenderer` calls `PersonaStore.fetchPersona` for an unknown persona on every
  render (tyne-chat/tyne#121). Add no fetches to rendering.

## Tests

- Vitest next to the code; one file: `pnpm --filter fluxer_app test src/features/messaging/<path>`.
  Before committing, the full list in `CHECKS.md`.
- Upstream's: `ReactionStateMachine`, the two `MessagingMessages*` tests,
  `MessageQueueAccountTransition`, `MessagePaginationUtils`, `useImageRecovery`,
  `useTextareaDraftAndTyping` (with two fork `vi.mock` blocks).
- The fork's: the `*Persona.test.ts(x)` files, `ReactionUsersStateMachine`, `MessageSubmitUtils`,
  `MessageRetryUtils`, `MessageGroupingUtils`, and the emoji, autocomplete, paste and parser tests.
  Several carry names upstream could take; name a new one `<File>Persona.test.ts`.
- Tests mock stores with `vi.mock`, and `@lingui/core/macro` where a module uses `msg`. To count
  requests, mock `http` as `MessagingMessagesAccountTransition.test.ts` does.
- No unit test covers `useMessageSubmission`, `send`, the queue's failure and 429 paths, presigned
  uploads, or `ReactionCommands`' retry and revert. End to end: `e2e/web/desktop/persona-*.spec.ts`.

## Known gaps

- Reactions the gateway batches into `MESSAGE_REACTION_ADD_MANY` (asked for with
  `DEBOUNCE_MESSAGE_REACTIONS`) carry no persona and count as the account's (tyne-chat/tyne#120).
- Both send paths resolve the persona before `reserveSend`, so a send the local limit refuses has
  already recorded the persona's use and, in `last` mode, moved the selection; and a failed send with
  files comes back without its persona tag (tyne-chat/tyne#151).
