# The signal bar in the web app

The web half of the signal bar, also used by the desktop app: `SignalBarStore`, the bar above the
composer, the managers' menu, the DM menu item, and the community settings tab with the bar editor and
the channel tree. Every file here is the fork's. What the signal bar is, its data and events, the
rules every client follows and where the web and mobile clients differ are in the server guide,
`fluxer_api/src/api/signal_bar/AGENTS.md`; read it first. This guide covers the web's side.

## Where things are

| Concern | File |
|---|---|
| State, REST, events, re-pointing | `state/SignalBarStore.ts` (a MobX singleton) |
| Gateway events | `events/SignalBarEvents.ts`, registered in upstream's `gateway/events/EventRouter.ts` |
| The bar, its buttons, rights, drag to reorder | `components/SignalBar.tsx` |
| Managers' right-click menu | `components/SignalContextMenu.tsx` |
| DM switch | `components/SignalBarDMMenuItem.tsx`, in `DMContextMenu` and `GroupDMContextMenu` |
| Community settings tab | `components/GuildSignalBarTab.tsx`: `SignalBarEditor.tsx`, `SignalBarChannelTree.tsx` |
| Channel tree model | `utils/SignalBarTree.ts` |
| Labels, emoji addresses, names, `moveSignal` | `utils/SignalUtils.ts` |
| Shapes, `resolveSignalBarEnabled` | `packages/schema/src/domains/signal_bar/SignalBarSchemas.ts` (shared with the API) |
| Whether the instance has a bar | `RuntimeConfig.signalBarGuildId` (instance discovery) |

## Where the bar shows

- **In every composer:** one line in `channel/components/LexicalChannelTextareaContent.tsx` mounts
  `<SignalBar attached>`. Channels and DMs get it, and so do threads (`ThreadComposerArea`, with the
  thread), forum posts (`ForumPostComposer`, with the forum) and the thread create pane (with the
  parent channel). A new composer built on it gets the bar too.
- **Above barriers:** `withSignalBar` in `GuildChannelView.tsx` adds a bar when the chat area is a
  barrier rather than a `ChannelTextarea` (verification, a limited account);
  `showsSignalBarAboveBarrier` in `DMChannelView.tsx` does the same for a blocked recipient, a limited
  account or an unclaimed account.
- The bar renders nothing until the instance has signals and the channel is known to be on.

## State and flows

| Field | Meaning |
|---|---|
| `signals`, `version` (-1 until loaded), `guildId` (home community), `canManage` | from `GET /instance/signal-bar` |
| `entriesByChannel` | lit entries of each channel loaded; emptied only by `invalidate()` |
| `enabledByChannel` | whether the bar is on; an unknown channel counts as off |
| `composerPersonas` | per channel, whom the mounted composer writes as (`null`: the account) |
| `epoch` | bumped by `invalidate()`, so mounted bars refetch |
| `collapsed` | the caret: one value for every account and channel. Collapsed, the bar keeps the lit signals and drops the rest; with none lit only the caret is left (as on mobile) |

- **Loading.** `fetchConfig` shares the request in flight. `fetchChannel` is neither shared nor
  cached: it replaces the channel's entries and flag, and `rememberEntries` writes each entry's `user`
  and `subprofile` into `Users.cacheUsers` and `PersonaStore.recordKnownPersona`.
- **Events.** `handleChannelUpdate` applies `added`/`removed` to loaded channels and ignores others.
  `handleEnabledUpdate` sets the flag; off empties the channel. A newer `version` or `bar_version`
  starts `fetchConfig`.
- **Resets.** `GatewayReady` calls `invalidate()` on every READY, `ForkAccountReadyWork` on a
  promoted resume (a desktop switch with no READY), and again when a sign-in or account switch is
  released. Nothing else resets the store: it has no
  `AccountScopedWork` cancellation and no logout hook.
- **Writes.** `activate` is not optimistic: the signal shows lit when the event arrives.
  `deactivate` and `removeUser` remove the entry first; `reset` and `setDmEnabled` wait for the event.
  A failed write refetches the channel once. `saveSignals` shows the new list at once and, on failure,
  restores its snapshot and refetches the bar. Every method catches and logs.

## Signals and personas

`affirmPersona(channelId, subprofile)` is the one place that re-points: the account's own lit entries
in that channel whose persona differs change locally at once and get one PUT each. It is called for:

- **typing:** `useTextareaDraftAndTyping` calls `setComposerPersona` on every value change. That
  records the persona and affirms when `decideComposerTyping` answers `start`, the typing indicator's
  own test. It does not affirm while editing a message, while a tag is half typed, or when the
  composer sends no typing indicators;
- **a pick in the pill:** `PersonaComposerPill` (`affirmPick`);
- **every send:** `MessageCommands.send`, with the message's `subprofile`.

Opening a channel, or a selection made elsewhere, moves nothing. A click lights a signal as
`getEffectivePersonaId`: the composer's recorded persona or, with no composer mounted (above a
barrier), the persona resolved from the draft. Badges draw `entry.subprofile` with `PersonaAvatar`;
`getSignalEntryName` takes the persona's name, then the member's nickname, then the username.

## Rights and settings

- `canToggle`: always in a DM; Send Messages in a community. `canReset`: Manage Community; anyone in a
  one-to-one DM; a group DM's owner. A right-click opens `SignalContextMenu` only with `canReset`.
- At most three badges, then `+N`; the tooltip lists the names one per line.
- Collapsed, each lit signal keeps its index in the whole list, so dragging still reorders the bar
  correctly.
- `canManage` (the home community's managers) lets a manager drag the instance-wide bar inside any
  channel's bar; the drop is one `PUT /instance/signal-bar`.
- The settings tab (`signal_bar`, in the `message_tools` category) needs Manage Community and is
  offered only while `RuntimeConfig.signalBarGuildId` is set. The editor shows only in the home
  community, the tree in every community.
- **Editor:** adds through the expression picker; labels save on blur; removal and reorder (its own
  `DndProvider`) save at once. Each change is a full-list PUT, which the API fans out to every
  community.
- **Tree:** tri-state checkboxes for the community, uncategorised channels and categories; text and
  announcement channels only. Each click is one PUT, rolled back to the click-time settings on
  failure. `normalize` folds the ticks into the smallest settings (a category whose channels all
  agree becomes a category default), so channels created later inherit.

## Network calls

The REST transport does not retry. After a 429 it answers the same method and path locally until
`retry_after`; other paths still go out. Without a bar on the instance, only config GETs are sent.

| Action | Requests |
|---|---|
| READY | 1 config GET (shared) and 1 `GET /channels/:id/signals` per mounted bar; once more after a sign-in or account switch |
| Opening a channel, thread or forum | 1 channel GET per mounted bar, every time (A → B → A is 3), also where the bar is off, since that is how the store learns it. Threads and forums answer 400 |
| Typing, a pill pick, a send | none, unless own lit signals in the channel name another persona: 1 PUT each, all at once |
| Clicking a signal; the managers' menu | 1 PUT or DELETE, and 1 channel GET if it fails |
| Opening a DM's context menu | 1 channel GET; the item sends 1 PUT |
| Settings tab | 1 config GET (shared) and 1 `GET …/signal-bar/channels`; then 1 PUT per click, label, removal, addition or drop |
| `SIGNAL_BAR_UPDATE` (one copy per community) | the first with a newer version starts 1 config GET; the rest share it |

A failed `fetchConfig` or `fetchChannel` is logged and not retried. While `version` stays -1, each bar
mount and each newer-version event tries the config again. No test counts these requests yet.

## Rules and traps

- Change a signal's persona only through `affirmPersona`, and only for something done in that channel.
- `SignalBarStore` is the only caller of the signal routes (`Endpoints.ts`); keep it so.
- `normalize` rewrites the settings on every click: check a tree change with `SignalBarTree.test.ts`.
- Strings go in `fork_locales` (root `AGENTS.md`), and every element carries a `data-flx` attribute
  (`CHECKS.md` checks it).

## Known gaps

Tracked in tyne-chat/tyne#148 unless another issue is named.

- Threads and forum posts mount the bar and send a GET the API refuses: one logged 400 per open.
- `affirmPersona` has no batch route and no cooldown. With many own lit signals in a channel, a
  persona change sends that many PUTs at once (the toggle bucket allows 30 per 10 s, and all count
  toward the global limit). A re-point the server refuses is sent again at the next keystroke,
  because the failure refetch puts the old persona back.
- Lit signals carry copies made when they were lit, and `rememberEntries` writes them over newer data
  in `Users` and `PersonaStore`: opening a channel can bring back an old name or avatar there.
- Every READY empties all channels, so the bar disappears until the channel GET returns.
- The caret uses raw `localStorage`, which production builds remove, so it is not saved there
  (tyne-chat/tyne#140). Keyboard use of the bar is tyne-chat/tyne#112.
- The bar shows above a blocked recipient's barrier, and the server does not check blocks.

## Where this code hooks into upstream files

- One line or element each: `LexicalChannelTextareaContent.tsx`, `DMContextMenu.tsx`,
  `GroupDMContextMenu.tsx`, `GuildSettingsTabComponents.ts`, `EventRouter.ts` (three `registry.set`),
  `GatewayReady.ts` (`invalidate()`), `MessageCommands.tsx` (`affirmPersona` in `send`, under
  `// Fork:`), `DndTypes.ts` (`SIGNAL`).
- Inside upstream's lines, the likeliest conflicts:
  - `DMChannelView.tsx`: `showsSignalBarAboveBarrier`, and upstream's barrier ternary wrapped in a
    fragment and re-indented. A sibling element before the ternary would leave upstream's lines alone.
  - `GuildSettingsConstants.ts`: two union members, the tab descriptor, the `message_tools` label, the
    `isGuildSettingsTabOffered` filter and an unused `_guildId?` parameter.
  - `useTextareaDraftAndTyping.ts`: the `clearComposerPersona` effect, `setComposerPersona` and an
    early return inside upstream's typing effect, and a widened dependency list (shared with personas).
  - `GuildChannelView.tsx`: `withSignalBar` around two `renderChatArea(…)` calls.
  - `Endpoints.ts` (seven entries mid-object); `RuntimeConfig.ts` and `RuntimeConfigSnapshot.ts`
    (`signalBarGuildId`, among other policy fields).
- In fork-owned files: `PersonaComposerPill.tsx`, `ForkAccountReadyWork.ts`.
- Upstream's `useTextareaDraftAndTyping.test.tsx` mocks `SignalBarStore`, which upstream's hook now
  imports.

## Tests

- `state/SignalBarStore.test.ts`: entries, the persona rules (typing, other channels), version
  refetch, rollbacks, the enabled flag. `components/SignalBar.test.tsx`: rendering, badges, toggling,
  rights, off, collapsed. `components/SignalBarMenus.test.tsx`: the managers' menu, reset, editor
  removal. `utils/SignalBarTree.test.ts`: order, mixed states, folding.
  `user/components/settings_utils/GuildSettingsTabsSignalBar.test.ts`: no tab without a home community.
- End to end: `e2e/web/desktop/signal-bar.spec.ts`: two accounts toggling in real time, the persona
  rules across channels and a second window, per-channel management.
- Not covered: request counts and failure paths, threads and forums, rendering of
  `SignalBarChannelTree` and `SignalBarDMMenuItem`.
- After a change: `pnpm --filter fluxer_app test signal_bar SignalBar useTextareaDraftAndTyping`, the
  end-to-end spec, then the list in `CHECKS.md`.
