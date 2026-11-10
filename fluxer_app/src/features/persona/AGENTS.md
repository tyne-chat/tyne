# Personas in the web app

This folder is the web half of personas (see "Personas" in the root `AGENTS.md`): `PersonaStore`
with the account's own personas and selection, the REST commands and gateway handlers, the settings
page with the import (and its review) and export, the composer pill and picker, "React as…", the persona
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
| Avatar and banner menus (popout, Personas tab) | `utils/usePersonaImageMenus.tsx` |
| Reacting as several personas: chip, "Your reactions", "React as…" | `components/reactions/`, `components/PersonaReactAsModal.tsx`, `utils/PersonaReactionIdentities.ts` (pure) |
| Settings, import, export | `components/settings/PersonaSettingsTab.tsx`, `components/modals/PluralKitImportModal.tsx`, `PersonaEditModal.tsx`, `utils/PersonaImportFile.ts` |
| Import review and its decisions | `components/modals/PersonaImportReview.tsx`, `utils/PersonaImportReview.ts` (pure), `utils/PersonaImportImages.ts` |
| Deleted personas, Restore | `components/settings/DeletedPersonasSection.tsx` |
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
- **Image menus:** right-clicking the avatar or banner in the persona popout, and in the Personas
  tab's three views and one persona's page, opens upstream's `UserImageMenuItems`, the account
  profile's menu, with the persona's images handed in as preview overrides (`usePersonaImageMenus`).
  In the tab they are right-click only, like the profile card's: each card there is already a
  button. A persona without an avatar offers the account's, as the
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
sheet (`openPersonaGallery`); mobile web also has a button before the mutual friends. Inside the
account's own profile window the display tag is not a button (`inProfile`, tyne-chat/tyne#576).

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
- **Expand** (not on phones, not remembered; from the list or one persona's page): an attribute on the profile window hides upstream's
  banner, name block and tabs by their `data-flx` names (`utils/PersonaGalleryExpand.ts`, whose test
  fails if upstream renames one), and a slim bar takes their place. Expand turns into Restore in the
  same place, last in the toolbar or the persona's row (#589); Escape folds it back unless a menu or
  popout is open.
- **Upstream hooks:** `ProfileBody.tsx` (the tab), `UserProfileModalShared.ts` (`ProfileTab`),
  `UserProfileModalUserInfo.tsx`, `ProfileCardUserInfo.tsx` (`personaNameExtras`, under the name),
  `UserProfilePopout.tsx`, `UserAreaPopout.tsx` (one's own avatar at the bottom left),
  `UserProfileMobileSheet.tsx`, and `Modals.tsx` (the sheet).

## Reactions

- `getEffectiveReactionPersona` picks, in order: the persona whose signature emoji it is, a tag in
  the draft, then the selection. A plain click on a reaction chip reacts as that persona.
- **The chip** (`reactions/PersonaReactionChip.tsx`, hooked into upstream's `MessageReactions.tsx`):
  for an account with personas, once any of its identities reacted with the emoji
  (`opensOwnReactionsMenu`), the chip shows a caret and a click opens "Your reactions"
  (`reactions/OwnReactionsPopout.tsx`) instead of reacting; in the mobile layout it opens "React as…".
  Before that, and for accounts without personas, the chip is upstream's toggle. While the popout
  is open, the chip's hover tooltip (upstream's `ReactionTooltip`, on a layer above popouts) is kept
  closed (`reactions/useHideTooltipWhile.ts`), or it would take the clicks meant for the rows.
- **"Your reactions" and "React as…"** share `reactions/PersonaReactionList.tsx`: search, a Recent
  row (frecency, only with 7 or more personas), then those who reacted and everyone else, in an order
  fixed when it opens (the current persona, then the account, then by name). Rows are one line: name,
  display tag, Current, and "Account" on the account's. Each row's toggle is the emoji. A click,
  Enter or Space toggles and the list stays open, everywhere; clicking outside, Escape, the close
  button or the dialog's Done closes it (one rule, chosen in review over a click that closes and
  Shift+click to stay). One toggle is one request, and there is no
  select-all: a list of 60 personas would go over the reactions limit (30 per 10 s per channel) and
  near the global one. The rows read the reaction through `useMessageReactions`, which stays current.
- **"React as several personas at once"** (`multi_persona_reactions` in the persona settings, on by
  default; the switch is on the Personas settings page). Off, an emoji keeps one reaction from the
  account: a chip any of its identities reacted with has no caret and a click removes all of the
  account's reactions with it (one request each); a chip only others reacted with reacts as the
  current persona; the emoji picker and quick reactions follow the same rule (`toggleOwnReaction`,
  `utils/OwnReactions.ts`, through `handleEmojiSelect`); "React as…" is a single choice that
  closes on a pick and replaces the account's other reactions with the emoji (`reactAsOnly`). The
  composer's `+:emoji:` shorthand, emoji autocomplete reactions and forum posts still add as the
  current persona whatever the setting.
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
- **Duplicate** (tyne-chat/tyne#599): only in a persona's editor, next to Delete; refused (the bar
  flashes) while the editor has unsaved changes. `openPersonaDuplicateModal` closes the editor and
  opens a new persona's, under a key of its own, filled in from the saved persona: the same picture
  hashes (nothing uploaded; images are deleted only with the account), colours, pronouns, bio,
  visibility and tag matching, under `duplicatePersonaName` ("Lyra (2)", `utils/PersonaDuplicate.ts`,
  repeated by the mobile app), focused and selected. Tags and signature emojis start empty, since each
  belongs to one persona; pins, usage and the PluralKit link are not copied. Its bar ("Copy of …",
  Cancel, Create) stays up, and Create sends the one `createPersona` Add Persona sends.
- **Selecting many** (tyne-chat/tyne#542, `components/settings/PersonaBulkSelection.tsx`): chips
  with counts (All, Public, Unlisted, Private) filter the list; Select puts a checkbox on every row
  and hides the row's buttons; "Select all" takes what the search and chip show. The action bar
  makes the selection public, unlisted or private (`setPersonaVisibilities`, one request) or
  deletes it (`deletePersonas`, one request, dropping the personas and their pins in one action).
  Public, private and delete ask first (delete in red, saying it cannot be undone); a visibility
  change ends in a toast with Undo, one request that puts each persona back as it was. The
  `feature` subtab (the Personas tab's "Choose personas to feature") opens on Unlisted with Select on.
- **Import** (tyne-chat/tyne#243): `PluralKitImportModal` reads PluralKit JSON or a Tyne zip
  (`PersonaImportFile`), offers an Export backup first when the account has personas, then stores
  every picture in the file (`storeMemberPictures`: zip files, own copies, or the server's streamed
  download; not retried, kept for the file so Back and Import store nothing twice, #567) and sends the
  members with the stored hashes to `previewPersonaImport`, which changes nothing and compares
  pictures exactly (a Tyne media link's hash names its file, #572). With nothing to decide it applies
  at once; otherwise `PersonaImportReview` opens: one line each, with its list behind Show, for new members,
  exact matches (already linked, or connected by name and tag: one line, always connected),
  and personas not in the file; then sections of
  collapsed rows sorted by name: might be one of your personas (pick a persona or None of these,
  #573), tag already taken (Skip / Keep, #570), different in the file (#568), deleted (Leave deleted
  / Bring back, #574), then the display tag (two boxes to choose between). A picked, differing or brought-back
  persona gets a three-way switch over two cards, each saying what happens to it (overwrites in red):
  Use the file's, Keep both (the file's added as a copy, "Name (2)" with a free tag, both editable;
  `keepBothDecision`), Use Tyne's. Every card shows the same details (banner and avatar as on a profile
  card, name, tags, pronouns, bio with its line breaks; a changed bio marks the words the other lacks,
  `PersonaBioDiff`), except the display tag's. Every member starts on `defaultDecision`, which changes
  nothing; the footer says what Import will do; closing the open review asks first (#564).
  `findConflicts` blocks two choices giving one tag to two personas; `suggestTag` suggests free tags
  from typeable letters, then the old tag numbered. `applyPersonaImport` sends the actions, written
  whole or not at all; a failed picture is reported only where the choice used it. A link in the
  file is never shown; pictures stored for skipped members stay unused. The display tag is the file's
  system tag; it is applied unasked only on an account with no personas and no display tag. The older
  `importPersonas` (with `replace`) stays in the commands for older code paths; the dialog no longer
  uses it.
- **Deleted personas** (`DeletedPersonasSection`, at the end of the Personas settings): the list is
  fetched once, when the person opens it, and a failure waits for Retry. Restore brings back the
  same persona (`restorePersona`), and the toast names any tag it came back without.
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
  `PersonaReactionIdentities.test.ts` and `PersonaAvatarUsage.test.ts`. Fixtures:
  `state/__fixtures__/PersonaTestFixtures.ts` (`addTestPersona`) and `__fixtures__/IntervalTracker.ts`.
- Beside upstream files: the `*Persona*.test.ts(x)` files in `messaging`, `channel`, `lexical` and
  elsewhere.
- End to end: `e2e/web/*/persona-*.spec.ts` (26 specs).
- Request counts: `state/PersonaLookupBatcher.test.ts`, `events/PersonaRefresh.test.ts`.
- `gateway/events/ForkAccountReadyWork.test.ts`: the work after a promoted resume, its 3 requests and
  its wait for a switch.
- Not covered: the call from `completePromotedResume`, and request counts for the mention fetch
  (root `AGENTS.md`, "Network calls").
- Before committing, run the full list in `CHECKS.md`: a persona change needs all of it.
