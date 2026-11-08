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
| An account's personas: Personas tab, sheet and pill | `components/gallery/`, `components/PersonasPill.tsx`, `state/PersonaDirectory.ts`, `utils/usePersonaDirectory.ts`, `utils/PersonaProfileTab.ts` |
| Avatar and banner menus (popout) | `utils/usePersonaImageMenus.tsx` |
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
  `auto_tag_disabled` is one whose tags are ignored (typing its tag sends the text as written). In
  every other way it acts like any other persona, also when selected. The editor's "Don't match this
  persona's tags" switch sets it.
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
  memes match the draft (`resolveExpressionPersona`): a draft that was only a tag is used up by the
  send, any other text stays in the composer (`messaging/utils/ExpressionDraftPersona.ts`), and a
  backslash sends as the account. A retry resends the message's own persona. Threads and forum posts
  resolve against the parent channel.
- A forward and its comment are one speaker (`resolveForwardPersona`): a tag in the comment decides
  for both; otherwise the selection where the forward started, then the destination's, then the
  account.
- Editing (`matchEditMessage`): a leading `\` on a persona's message removes the persona, a tag
  switches to that persona, and anything else leaves the persona as it is (the request omits it).
  When the message's text already started with `\`, the backslash is text and removes nothing.
  "Change persona" on one's own message edits only the persona. The inline edit's selector
  (`channel/components/InlineEditControls.tsx`) keeps its pick in `MessageChangePersona` until Save;
  a typed tag or `\` wins over it (`resolveEditSubprofile`), and the selector shows that as you type.

## Showing personas

- A message's `subprofile` is the persona as the server built it for this response. `MessageUsername`
  shows its name; `UserMessage` and `CompactMessageLayout` add `<PersonaTag>`, whose click opens the
  account, while the name and avatar open the persona's profile.
- **Avatars:** a persona's avatar is a media hash. Turn it into an address only with
  `personaAvatarUrls` or `<PersonaAvatar>`; never pass it to upstream's `<Avatar>`.
  `utils/PersonaAvatarUsage.test.ts` scans the sources and fails if a hash reaches `<Avatar>`.
  Without a hash, the account's avatar shows.
- **Image menus:** right-clicking the avatar or banner in the persona popout opens upstream's
  `UserImageMenuItems`, the account profile's menu, with the persona's images handed in as preview
  overrides (`usePersonaImageMenus`). A persona without an avatar offers the account's, as the
  popout shows it, and without a banner there is no banner menu. The mobile sheet has no menus,
  like upstream's account sheet.
- **The display tag icon** is also a media hash, of an image stored under the account. Turn it into
  an address only with `personaTagIconUrls(ownerUserId, icon)`, which gives nothing for any other
  value: never use the value as an image source, even when it looks like a link. A link would make
  the app fetch a picture from wherever it points and tell that server who is reading. Without the
  owner's id (no root user) the tag shows its text only.
- **Picked images wait for Save**, as in upstream's profile editor: the form keeps them as
  `pendingAvatar`/`pendingBanner` (previewed from there), Save uploads them
  (`PersonaCommands.uploadPersonaImage`) before saving the persona, and Reset drops them.
- **A persona's colour** has one rule, `personaColor` in `utils/PersonaColor.ts` (the mobile app's
  `persona_color.dart` repeats it): the accent colour, else the colour of the persona's own avatar,
  else none. Mentions, typing names and the profile card all use it; only the settings list shows
  the accent setting itself. Don't compare `color` or `avatar_color` anywhere else
  (tyne-chat/tyne#254).
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

## An account's personas: the Personas tab, sheet and pill

tyne-chat/tyne#189. Wherever a display tag shows on a profile, the "Personas (N)" pill follows it
(`PersonasPill`, `AccountPersonaNameExtras`; since 2026-11-07 the account's own profile shows its
display tag too). The pill opens the full profile's "Personas (N)" tab, or on phones the Personas
sheet (`openPersonaGallery`); mobile web also has a button before the mutual friends.

- **Data:** `usePersonaDirectory(userId)`. Someone else's list comes from `PersonaDirectory`
  (`GET /users/:id/personas`: the display tag and the public personas, most used first): one
  request per account, shared while in flight, kept a minute, a failure left alone a minute unless
  Retry is pressed, a 403 hides the pill. `GUILD_PERSONAS_DIRTY` marks it out of date at once (a
  profile opened then asks again) and, a second after the last copy (one arrives per shared
  community), tells the components showing it, which ask once; a request on its way then is followed
  by one more. Entries are keyed by the signed-in account too. One's own personas come from `PersonaStore`, with no request. Never ask
  for the list per persona or per message.
- **Counts:** N is the number of public personas, for the owner too. Others see public personas
  only; the owner sees them as others do, and a switch adds the unlisted and private ones, marked,
  with their proxy tags. "Recently used" is the owner's only: it would show who is fronting.
- **Views:** Gallery (Discovery's card with the profile's 17:6 banner and corner avatar), List (the
  settings row) and Avatars (PluralKit's "tiny"), kept per device in `PersonaGalleryPrefs`.
- **One persona:** `PersonaGalleryDetail`, in place of the list, with Back, previous/next, the arrow
  keys and a swipe on phones. Clicking a name in a persona's popout opens it there too
  (`PersonaGalleryNav` carries the request to the profile window); a persona the list does not hold
  (an unlisted one) is fetched on its own, and the tab then stays for it.
- **Upstream hooks:** `ProfileBody.tsx` (the tab), `UserProfileModalShared.ts` (`ProfileTab`),
  `UserProfileModalUserInfo.tsx`, `ProfileCardUserInfo.tsx` (`personaNameExtras`, under the name),
  `UserProfilePopout.tsx`, `UserProfileMobileSheet.tsx`, and `Modals.tsx` (the sheet).

## Reactions

- `getEffectiveReactionPersona` picks, in order: the persona whose signature emoji it is, a tag in
  the draft, then the selection. "React as…" (`PersonaReactAsModal`) picks explicitly.
- `ReactionCommands` sends the persona in the body when adding, and in the query when removing, where
  `'0'` means the account. Several personas of one account may each react to the same message.
- Open: tyne-chat/tyne#120 (`MESSAGE_REACTION_ADD_MANY` drops the persona), #123 (removing a
  reaction without `persona_id` on the server).
- **Pinned emojis** (`emoji/state/EmojiPins.ts`): the account's pins come first, then the active
  persona's, in the picker's frequently used row and the quick reactions. Both live in the account's
  synced preferences (the fork's `emoji_pins` field, read and written by the mobile app too), the
  persona's by persona id; `removePersona` drops a deleted persona's. The per-persona emoji ranking
  (`EmojiPicker.getPersonaUsage`) is still raw `localStorage`, so production builds never keep it
  (tyne-chat/tyne#140).

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
  streamed NDJSON response), then imports the whole file in one request, which the server writes
  whole or not at all. "Replace all" is that request with `replace`: the server deletes the existing
  personas in the same write, so a refused import keeps them, and the dialog never deletes any
  itself (tyne-chat/tyne#359). `importPersonas` then drops the replaced personas here in one MobX
  action, so their emoji pins go in one synced-preferences change. A link in the file is never
  stored: every image, the tag icon included (the zip's file, or an older export's `tag_icon_url`),
  is stored on the instance first, and only its hash is saved; an image that cannot be stored
  becomes a warning and does not stop the import.
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
