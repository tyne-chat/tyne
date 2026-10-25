# Personas in the web app

This folder is the web half of personas (see "Personas" in the root `AGENTS.md`): `PersonaStore`
with the account's own personas and selection, the REST commands and gateway handlers, the settings
page with the PluralKit import and export, the composer pill and picker, "React as…", the persona
profile popout and mobile sheet, and `PersonaTag`, the badge after a persona's name. Every file
here is the fork's. Rendering, sending, reactions and mentions happen in upstream components, which
call into this folder; those hooks follow the placement rules in the root `AGENTS.md`. The server
side is `fluxer_api/src/api/persona/`, which has its own `AGENTS.md`.

## Where things are

| Concern | File |
|---|---|
| Own personas, settings, selection, matching | `state/PersonaStore.ts` (a MobX singleton) |
| REST | `commands/PersonaCommands.ts` |
| Gateway events | `events/PersonaEvents.ts`, registered in upstream's `gateway/events/EventRouter.ts` |
| Loading after READY | `gateway/events/ForkAccountReadyWork.ts` |
| What a send goes out as | `utils/OutgoingPersona.ts` |
| Composer pill and picker | `components/PersonaComposerPill.tsx`, `components/PersonaPickerSheet.tsx` |
| Badge on messages | `components/PersonaTag.tsx`, handing off to `channel/components/MessagePersonaAccount.tsx` |
| Avatars | `utils/PersonaAvatarUrls.ts`, `components/PersonaAvatar.tsx` |
| Display tag icon | `utils/PersonaTagIconUrls.ts` |
| Profile popout and sheet | `components/PersonaProfilePopout.tsx`, `PersonaProfileMobileSheet.tsx`, `utils/usePersonaProfile.ts` |
| Settings, import, export | `components/settings/PersonaSettingsTab.tsx`, `components/modals/PluralKitImportModal.tsx`, `PersonaEditModal.tsx`, `utils/PersonaImportFile.ts` |
| Tag matching | `packages/schema/src/domains/persona/PersonaMatcher.ts` (`matchPersona`) |

## Which persona: the selection

- **Ask `latchedPersonaFor(channelId)`.** It is the one answer to "who does an untagged message in
  this channel go out as". Never read `activePersona` for a channel: with the per-channel scope it
  says nothing about any one channel.
- **Scope** (`active_persona_scope`): `global` (one selection for every channel, used when
  `is_latched`) or `channel` (a map from channel to persona; no entry means the account).
- **Mode** (`active_persona_mode`): `manual` (the selection changes only when the person picks) or
  `last` (a message sent with a persona's tag moves the selection to that persona).
- The setters change the store first and roll back if the request fails. `selectInChannel` sends
  `PUT …/personas/channel-states/:id`; `startChannelAs` makes a new thread or forum post start as the
  persona that opened it.

## Tags and escapes: matching

- `matchPersona` picks the persona whose prefix and suffix are the longest match. A persona with
  `auto_tag_disabled` is one whose tags are ignored (typing its tag sends the text as written).
  `matchPersona` also ignores it when it is the selected (latched) persona, so its text goes out as
  the account: a known gap (tyne-chat/tyne#130).
- Escapes, only while a persona is selected: `\\` alone clears the selection; `\\ text` sends as the
  account and clears it; `\ text` sends as the account and keeps it.
- **`matchOutgoingMessage` is the send, not a question.** It records a use, may clear the
  selection, and in `last` mode moves it. Call it once per message actually sent. To ask without
  side effects, use `previewOutgoingContent` (the text that would be sent) or
  `getEffectivePersonaForText` (who it would be sent as; `isTagUnfinished` says a prefix is still
  being typed, so typing indicators and signals stay quiet until it is complete).

## Sending and editing

- `resolveOutgoingPersona` returns the text without its tag and the persona. Only the persona's id
  goes on the wire (`persona_id`, built in `messaging/utils/MessageRequestUtils.ts`); the server
  checks ownership and builds the `subprofile` object itself.
- Uploads and voice messages use the selection only (`getActiveSubprofile`). Stickers, GIFs and
  memes match the draft: a draft that was only a tag is used up by the send, any other text stays in
  the composer (`messaging/utils/ExpressionDraftPersona.ts`). A retry resends the message's own
  persona. Threads and forum posts resolve against the parent channel.
- Editing (`matchEditMessage`): a leading `\` on a persona's message removes the persona, a tag
  switches to that persona, and anything else leaves the persona as it is (the request omits it).
  "Change persona" on one's own message edits only the persona.

## Showing personas

- A message's `subprofile` is the persona as the server built it for this response. `MessageUsername`
  shows its name; `UserMessage` and `CompactMessageLayout` add `<PersonaTag>`, whose click opens the
  account, while the name and avatar open the persona's profile.
- **Avatars:** a persona's avatar is a media hash. Turn it into an address only with
  `personaAvatarUrls` or `<PersonaAvatar>`; never pass it to upstream's `<Avatar>`.
  `utils/PersonaAvatarUsage.test.ts` scans the sources and fails if a hash reaches `<Avatar>`.
  Without a hash, the account's avatar shows.
- **The display tag icon** is also a media hash, of an image stored under the account. Turn it into
  an address only with `personaTagIconUrls(ownerUserId, icon)`, which gives nothing for any other
  value: never use the value as an image source, even when it looks like a link. A link would make
  the app fetch a picture from wherever it points and tell that server who is reading. Without the
  owner's id (no root user) the tag shows its text only.
- **Picked images wait for Save**, as in upstream's profile editor: the form keeps them as
  `pendingAvatar`/`pendingBanner` (previewed from there), Save uploads them
  (`PersonaCommands.uploadPersonaImage`) before saving the persona, and Reset drops them.
- **Mentions** of a persona take its colour, as in the mobile app: the text, and a fill a tenth as
  strong (`utils/PersonaMentionStyle.ts`, used by `MentionRenderer` and the composer's
  `ComposerMentionPill`). A persona without a colour gets the usual mention colours.
- **Profiles:** `fetchPersonaProfile` caches for 60 seconds; a 403 `PRIVATE_PERSONA` means the
  profile is private. Bio, banner and pronouns never come from a message.
- **Other people's personas** are cached in `_knownPersonas`, with their owner where it is known
  (`_knownPersonaOwners`), filled from messages' `mention_personas` (owners read from the
  `<@userId:personaId>` text, `utils/MentionedPersonas.ts`), reaction events, signals, lookups, a pick
  in the mention autocomplete and the composer pill's scan of cached messages. `MentionRenderer`,
  `Plaintext` and `ComposerMentionPill` resolve a mention's name from that cache, then from cached
  messages; `MentionRenderer`, `ComposerMentionPill` and thread owners then call `fetchPersona`.
- **`fetchPersona` looks personas up by ID** (`POST /personas/lookup`, which also names private
  personas) through `PersonaLookupBatcher`: lookups within 50 ms share one request, a lookup in
  flight is shared, and a failed or empty answer is not asked again for a while. It may be called
  while rendering for that reason.

## Reactions

- `getEffectiveReactionPersona` picks, in order: the persona whose signature emoji it is, a tag in
  the draft, then the selection. "React as…" (`PersonaReactAsModal`) picks explicitly.
- `ReactionCommands` sends the persona in the body when adding, and in the query when removing, where
  `'0'` means the account. Several personas of one account may each react to the same message.
- Open: tyne-chat/tyne#120 (`MESSAGE_REACTION_ADD_MANY` drops the persona), #123 (removing a
  reaction without `persona_id` on the server).

## Loading, resets and events

- After READY, `ForkAccountReadyWork` fetches the personas, the settings and the channel
  selections (3 GETs). A desktop account switch that resumes a session the account engine kept warm
  gets no READY: upstream's `completePromotedResume` calls `handleForkPromotedResume` instead. While `AccountScopedWork` is suspended (signing in, switching accounts) it
  waits, because upstream aborts requests made then.
- The store is emptied on the `AccountScopedWork` cancellation, on logout, and on a READY with a new
  session id. A send in the moment before the refetch goes out as the account.
- `PersonaEvents` patch the store and push updates into cached messages and reactions
  (`Messages.handlePersonaUpdate`, `MessageReactions.handlePersonaUpdate`). Payloads are accepted
  wrapped or bare. `GUILD_PERSONAS_DIRTY` for one's own account is skipped.
- `GUILD_PERSONAS_DIRTY` carries the persona only when it is public or unlisted; that one is applied
  as it comes and remembered only if already known. Otherwise (`update`, `sync`) `PersonaRefresh`
  waits a second, to collect the copy sent per shared community, then fetches again in one request
  the personas of that account this client holds (`Messages.getPersonaIdsByAuthor`,
  `PersonaStore.getKnownPersonaIdsOf`), and nothing if it holds none. A `delete` fetches nothing.
  Every such event clears that account's cached profile cards.

## Settings, import and export

- `PersonaSettingsTab`: mode, scope, the display tag (its icon is uploaded with
  `POST …/personas/avatar`), search, and the persona list, sorted by name. Setting a persona active
  from here exists only in the global scope.
- `PluralKitImportModal` reads PluralKit JSON or a Tyne zip (`PersonaImportFile`), reuses images
  already on the instance by hash, uploads the zip's images, has the server fetch remote ones (a
  streamed NDJSON response), then imports in chunks of 50. "Replace all" first deletes every
  existing persona, one request each, in sequence. A link in the file is never stored: every image,
  the tag icon included (the zip's file, or an older export's `tag_icon_url`), is stored on the
  instance first, and only its hash is saved; an image that cannot be stored becomes a warning.
- `exportPersonas` downloads the server's zip, which this import reads back.

## Where persona code hooks into upstream

About 50 upstream files import from this folder: mostly in `channel` (message rendering, the
composer, popouts) and `messaging` (submission, retry, reactions, message state), and a few each in
`gateway`, `threads`, `forum`, `lexical` (mentions, autocomplete), `emoji`, `signal_bar`, `devtools`
(`/persona`), `user`, `ui`, `app` and `auth`. The ones that edit inside upstream's lines, and so
conflict most often in the nightly rebase: `MessageUsername.tsx`, `UserMessage.tsx`,
`CompactMessageLayout.tsx`, `useMessageSubmission.tsx`, `useTextareaSubmit.ts`,
`useTextareaDraftAndTyping.ts`, `ReactionCommands.tsx`, `MessageReactions.ts`, `MentionRenderer.tsx`,
`useLexicalAutocomplete.ts`, `StickerSendUtils.ts`, the emoji picker, `ChannelMessage.tsx`,
`PreloadableUserPopout.tsx`, `MessageReactions.tsx`, `MessageActionBar.tsx`,
`AutocompleteMention.tsx`, `ReplyPreview.tsx` and `TypingUsers.tsx`. When you touch one, move fork
lines out of upstream's where you can. The folder guides of `channel` and `messaging` list them by
file.

The signal bar follows the composer's persona through `SignalBarStore.affirmPersona`; read
`features/signal_bar/AGENTS.md` before changing when the composer's persona changes.

## Tests

- Next to the code: `PersonaStore.test.ts`, `PersonaStorePerChannel.test.ts`,
  `PersonaEvents.test.ts`, `PersonaCommands.test.ts`, `OutgoingPersona.test.ts`, the component tests,
  and `PersonaAvatarUsage.test.ts`. Fixtures: `state/__fixtures__/PersonaTestFixtures.ts`
  (`addTestPersona`) and `__fixtures__/IntervalTracker.ts`.
- Beside upstream files: the `*Persona*.test.ts(x)` files in `messaging`, `channel`, `lexical` and
  elsewhere.
- End to end: `e2e/web/*/persona-*.spec.ts` (26 specs).
- Request counts: `state/PersonaLookupBatcher.test.ts`, `events/PersonaRefresh.test.ts`.
- `gateway/events/ForkAccountReadyWork.test.ts`: the work after a promoted resume, its 3 requests and
  its wait for a switch.
- Not covered: the call from `completePromotedResume`, and request counts for the mention fetch
  (root `AGENTS.md`, "Network calls").
- Before committing, run the full list in `CHECKS.md`: a persona change needs all of it.
