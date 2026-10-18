# The channel view in the web app

The screens of an open conversation: the guild and DM views, the header, the message list and its
rows, the composer, pickers, search, pins, member and DM lists and the channel modals; plus the
`Channel` model, the `Channels` store and the `CHANNEL_*` events. Upstream's design (about 94,000
lines) and the web folder with the most fork changes: personas in rows, the composer and search, the
signal bar, a timestamp modal, collapsible panels, emoji-picker extras. Message state, sending and
reactions are `messaging`'s, the editor `lexical`'s (folders named from `fluxer_app/src/features/`).

## Where things are

| Concern | File (under `components/` unless a folder is given) |
|---|---|
| Views | `channel_view/GuildChannelView.tsx`, `channel_view/DMChannelView.tsx`, `channel_view/ChannelViewScaffold.tsx`, `ChannelChatLayout.tsx` |
| Header | `ChannelHeader.tsx`, `channel_header/`, `channel_header_components/` |
| Message list | `ChannelMessages.tsx` (`Messages`), `ChannelMessageStream.tsx`, `MessageGroup.tsx` |
| Row | `ChannelMessage.tsx` (shell), `UserMessage.tsx`, `CompactMessageLayout.tsx`, `MessageUsername.tsx`, `MessageAvatar.tsx`, `MessagePersonaAccount.tsx` |
| Replies | `ChannelReplyBar.tsx` (`ReplyBar`, above the composer), `ReplyPreview.tsx` (in the row) |
| Actions, reactions | `MessageActionBar.tsx`, `MessageActionMenu.tsx`, `MessageActionUtils.tsx`, `MessageReactions.tsx`, `state/QuickReactionStore.ts` |
| Composer | `ChannelTextarea.tsx` → `LexicalChannelTextareaContent.tsx`; `textarea/`, `UploadManager.tsx`, `useChannelComposerPaste.tsx`, `TypingUsers.tsx`, `modals/TimestampModal.tsx` |
| Pickers, autocomplete menu | `EmojiPicker.tsx`, `emoji_picker/`, `pickers/`, `Autocomplete*.tsx` |
| Search, pins | `message_search_bar/`, `ChannelSearchResults.tsx`; `popouts/ChannelPinsPopout.tsx`, `state/ChannelPins.ts` |
| Settings (no fork changes) | `modals/ChannelSettingsModal.tsx`, `modals/channel_tabs/` |
| Model, store, events | `models/Channel.ts`, `state/Channels.ts`, `commands/ChannelCommands.ts`, `events/` |

## How the view is put together

- `ChannelIndexPage` mounts `GuildChannelView` or `DMChannelView`. Each builds a
  `ChannelViewScaffold` (header, chat area, side panel) around `ChannelChatLayout`:
  `<Messages key={channel.id}>` and either `ChannelTextarea` or a barrier; a thread gets
  `ThreadComposerArea` (`threads`).
- **Remounts:** the list per channel and per messaging's `cacheGeneration` (an account switch), the
  composer per account and channel. State that must survive them belongs in a store.
- **The list does not observe the message store.** `CachedMessages` subscribes to seven stores and
  copies a shallow-compared snapshot (`readFromState`) into local state. A new input to the list
  goes into `readFromState`, with its store subscribed.
- `createChannelStream` (messaging; a change of persona starts a new group) → `renderChannelStream`
  → dividers, `BlockedMessageGroups` and `MessageGroup`s, `memo`'d by message identity. Not
  virtualised. Scrolling, paging and jumps are `platform/utils/ScrollManager.ts`'s; the list also
  auto-acks (`shouldAutoAck`; fork: not while AFK) and handles `ComponentBus` events.
- Search results, pins and other popouts reuse the row (`ChannelMessage`) with `previewContext` and
  `behaviorOverrides`.

## How a row is drawn

`ChannelMessage.tsx` (`Message`) is the shell: hover, focus, context menu, double-click, long-press,
a lazy `MessageActionBar`. It reads per-message state from stores (`MessageEdit`, `MessageReply`,
the fork's `MessageChangePersona`) unless `behaviorOverrides` sets it, and calls messaging's
`getMessageComponent`, which picks `UserMessage` or a system row. `UserMessage` draws the cozy
layout or `CompactMessageLayout` (`CompactAuthorPrefix`), with `ReplyPreview`,
`EditingMessageInput`, attachments and reactions.

**The persona is `message.subprofile`**, built by the server (by the client for a pending message).
The rules are in `persona/AGENTS.md`; this is where each part is drawn:

- **Name:** `MessageUsername` puts `subprofile.name` before the nickname; so do
  `SystemMessageUsername`, `ReplyPreview`, `ReplyBar`, `MessageReactionsSheet` and `TypingUsers`.
- **Avatar:** `MessageAvatar` and `ReplyPreview` spread `personaAvatarUrls(user.id, subprofile)`
  into upstream's `<Avatar>`; without a persona avatar the account's shows.
- **Badge:** `<PersonaTag>` after `MessageUsername` (both layouts) hands over to
  `MessagePersonaAccount`: the account's display tag (`display_tag_text`, `display_tag_icon`) or its
  avatar at 16 px, in a `PreloadableUserPopout` with `ignoreSubprofile`, so it opens the account.
- **Profile:** `PreloadableUserPopout` opens `PersonaProfilePopout` (mobile:
  `PersonaProfileMobile.open`) when the message has a `subprofile`.
- **OP tag:** only when `originalPosterTagAppliesToMessage` matches the message's persona with the
  thread's `Channel.ownerPersonaId`.
- **"Change persona":** a `MessageActionMenu` item (when the account has personas) calls
  `MessageChangePersona.startChangePersona`; an effect in `ChannelMessage` opens
  `PersonaPickerSheet` on the row, and a pick sends one edit carrying only the persona.
- **Reactions:** chips, quick reactions, the action bar, the message menu and the emoji picker ask
  `PersonaStore.getEffectiveReactionPersona(channelId, emoji, draft)` and toggle that persona's
  reaction (`hasPersonaReacted`), not `reaction.me`. Each reads the channel's draft, so all
  re-render when the draft is saved. Quick reactions follow that persona's pinned and frequent
  emojis.

## The composer

- `ChannelTextarea` decides whether writing is allowed and mounts `LexicalChannelTextareaContent`.
  `ThreadCreatePane` (`threads`) and `ForumPostComposer` (`forum`, `bare`) mount it with their own
  `onSubmit`.
- It keeps `value` (shown) and `wireValue` (sent: mentions as `<@…>`), both set by the editor's
  `onChange` (`lexical/AGENTS.md`).
- **Sending:** messaging's `useTextareaSubmit` sends `getWireValue()` through the composer's
  `handleSendMessage`, which calls the host's `onSubmit` or `useMessageSubmission.sendMessage`, then
  clears the editor, `value`, `wireValue` and segments. The persona is picked in `sendMessage`, not
  here (`messaging/AGENTS.md`). The @everyone confirmation passes the real `hasAttachments` (fork;
  upstream passes `false`), so a tag alone with files can go out.
- **Stickers, GIFs, memes:** `useTextareaExpressionHandlers` gets the fork's `clearComposer`, used
  only when the text was used up (a tag or escape alone; tyne-chat/tyne#122).
- **Shift-drop:** `UploadManager` builds its own optimistic message and calls `MessageCommands.send`
  itself, sent as the channel's selection (`getActiveSubprofile`) and without `reserveSend`.
- **Fork additions:** `PersonaComposerPill` after the plus button, given `wireValue` and
  `hasAttachments`; hidden by `showPersonasButton` and in a `bare` composer, whose host draws its
  own from `onWireValueChange`. `<SignalBar attached>` above the box (`signal_bar/AGENTS.md`).
  `handleInsertTimestamp` opens `TimestampModal` from both plus menus.
- **Plain paste** (`messaging/utils/PlainPasteUtils.ts`) is decided per paste event: ask
  `isPlainPasteEvent(event)`, never keep state of your own. It skips files and the composer's
  clipboard format; mentions and emoji still become pills, as in Discord. `TextareaContextMenu`'s
  Paste items hand a contenteditable the text as a synthetic paste
  (`pasteTextIntoContentEditable`), so the composer's paste checks run for them too.
- `ActiveComposer` (`threads`) picks the composer for a `ComponentBus` event that names no channel.

## Search, header and panels (fork)

Search suggests personas for `from:`, `mentions:` and plain words (tyne-chat/tyne#46):
`useSearchPersonaSuggestions` hands them to upstream's `useMessageSearchAutocomplete` after the
accounts, `PersonasSection` draws them, and a pick inserts a persona segment
(`replaceTokenWithPersona`).

A sidebar toggle with badges (`useCollapsedPanelBadges`) replaces the header's desktop back button.
The member toggle shows at every width (`useCanFitMemberList() || true`, so upstream's narrow-width
branches are dead). With a panel collapsed, hovering the edge shows a second mount of the member or
DM list as an overlay (`isMemberListPeeking`, `data-peek-drawer`), driven by `ui`'s `LayoutState`.

## Where the fork's code sits

- **Fork-owned:** `MessagePersonaAccount.tsx`, `channel_header/useCollapsedPanelBadges.ts`,
  `message_search_bar/PersonaSearchSuggestions.ts` and `PersonasSection.tsx`,
  `modals/TimestampModal.tsx`, `emoji_picker/hooks/useForkSearchFirstResultSelection.ts`.
- **Renamed and wrapped from outside:** `ChannelViewScaffold` (`ChannelViewScaffoldBase` in an
  `observer`), `EmojiPicker` (`EmojiPickerBase` inside the `EmojiPickerReactionContext` provider),
  `EmojiRenderer` (`EmojiRendererBase` in an `observer`). When upstream changes one, keep its body
  under the `…Base` name and the fork's export at the end of the file.
- **One fork element beside an upstream call:** `<PersonaTag>`, `<PersonaComposerPill>`,
  `<SignalBar>`, `withSignalBar(renderChatArea())` in `GuildChannelView`. `QuickReactionButton`
  takes the fork's props in `...fork`. `channel_header/shared.ts` and `MessageReactions.module.css`
  end with appended blocks.
- **Inside upstream's lines** (conflicts first): `LexicalChannelTextareaContent.tsx` and
  `ChannelMessage.tsx` (both among upstream's most changed here; the picker effect could move to a
  fork hook), `MessageReactions.tsx`, `MessageActionBar.tsx`, `MessageActionMenu.tsx`,
  `MessageActionUtils.tsx`, `UserMessage.tsx` (the inline edit runs `matchEditMessage`),
  `AutocompleteMention.tsx` (`renderPersona`), `EmojiRenderer.tsx` (drag-and-drop in upstream's
  render), `PreloadableUserPopout.tsx`, `DMChannelView.tsx` (upstream's barrier ternary re-indented
  in a fragment), the search-bar hook, `QuickReactionStore.ts`.
- **Copies to keep in step:** `usePresentableTypists` copies upstream's `usePresentableTypingUsers`;
  the display-tag icon address is worked out in `PersonaTag`, `MessagePersonaAccount` and
  `AutocompleteMention`.

## Rules and traps

- Never mutate a `Message` or `Channel` (`withUpdates` makes a new one): the group memo compares by
  identity, so a mutated message is not redrawn.
- A new per-message state read from a store needs a `MessageBehaviorOverrides` key, `false` in
  `DETACHED_MESSAGE_BEHAVIOR` (`channel_search_results/ChannelSearchResultsShared.tsx`), as
  `isChangingPersona` has.
- `ComponentBus` handlers ignore payloads for another channel.
- Every element carries a `data-flx` attribute (`theming:data-flx:check` in `CHECKS.md`).

## Network calls

| Action | Requests |
|---|---|
| Opening a channel | none from the views (the first page is messaging's). While the window is a placeholder and the gateway is connected, one recovery `fetchMessages`; a failure shows the load-error bar and waits for its button. One `fetchSlowmodeState` per composer mount in a slowmode community channel (shared in flight, capped, timed out). Signal bar: its guide |
| Scrolling | one page per entry into a trigger region, none while one loads; a page that grew the list under 100 px pauses loading until the user scrolls away |
| Typing in search | per `from:`/`mentions:` value and per plain word, `GET /channels/:id/persona-mentions?q=…&limit=500` 60 ms after the last change, unless the 15-minute per-channel cache has a match (`lexical/composer/useAutocompletePersonaSearch.ts`). Not shared, failures not remembered: a word matching no persona costs one request per pause (tyne-chat/tyne#150) |
| Opening pins | one GET the first time; a failure is recorded, not retried. Upstream's popout also acks unseen pins (one POST) and loads the authors' missing members |
| A reaction, "Change persona" | one request each (429 retries are messaging's) |

Nothing here fetches while rendering, but rows render mentions through messaging's
`MentionRenderer`, which does (tyne-chat/tyne#121). Do not add persona-search callers without a test
that counts requests (root `AGENTS.md`, "Network calls").

## Tests

- **Here (fork):** `MessagePersonaAccount.test.tsx`, `MessageActionBarQuickReaction.test.tsx` (also
  `EmojiRenderer` pins), `MessageReactionsContextMenu.test.tsx`, `useCollapsedPanelBadges.test.ts`,
  `PersonaSearchSuggestions.test.ts`, `TimestampModal.test.tsx`,
  `MobileTextareaPlusBottomSheet.test.tsx`, `ChannelOwnerPersona.test.ts`. Upstream's:
  `ChannelFrecency.test.ts`, `useVirtualPickerGrid.test.tsx`, four benches. Component tests use
  `// @vitest-environment happy-dom`, `installVoiceMenuTestBootstrap`, mocked Lingui macros, and
  `createRoot` with `act`.
- **Elsewhere:** `PersonaComposerPill.test.tsx`, `PersonaTag.test.tsx`,
  `MessageChangePersona.test.ts`, `AutoAckPredicate.test.ts` (AFK).
- **End to end:** `e2e/web/desktop/persona-*.spec.ts` (rows, replies, reactions, "Change persona",
  typing, mentions), `channel-timestamp-pills.spec.ts`, `window-activation-quick-reaction.spec.ts`,
  `signal-bar.spec.ts`, `e2e/web/mobile/persona-picker.spec.ts`.
- **Not covered:** no unit tests for `ChannelMessages`, `ScrollManager`, the composer or
  `UserMessage`; nothing counts the search requests; no end-to-end test of persona search
  suggestions or collapsible panels.
- Run `pnpm --filter fluxer_app test features/channel`, the specs above, then the list in
  `CHECKS.md` (all of it for a persona change).
