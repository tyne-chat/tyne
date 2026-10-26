# The message editor (Lexical)

The rich-text editor behind every message composer, the inline edit, the forward modal, the channel
topic and the bio, built on Lexical 0.50 (`search/` is the search bar's own editor, without fork
changes). It is upstream's design. The fork adds persona mentions, timestamp pills, caret anchors
and shortcuts on an empty selection. The composer around it is `channel`'s and sending and drafts
are `messaging`'s (read their guides; folders are named from `fluxer_app/src/features/`). Paths are
under `composer/` unless stated.

## Where things are

| Concern | File |
|---|---|
| Editor, node list, `ComposerHandle` | `LexicalComposerInput.tsx` (channel composer), `LexicalRichInput.tsx` (edit, forward, topic, bio), `ComposerHandle.ts` |
| Editor state to text and back | `ComposerSerialization.ts` (`$projectComposer`, `$hydrateComposerFromDraft`) |
| Offsets, inserting | `composerOffsets.ts`, `ComposerInsertion.ts` |
| Nodes and pills | `nodes/` (`ComposerAtomicTokenNode`, `ComposerMentionNode`, `ComposerMentionPill`, emoji, plain-segment and slash-slot nodes) |
| Live markdown, emoji, clipboard | `ComposerMarkdownHighlight.ts`, `markdownSpans.ts` (spans from the WASM parser), `ComposerBlockquote.ts`, `ComposerEmojiShortcode.ts`, `ComposerClipboard.ts` |
| Autocomplete | `useLexicalAutocomplete.ts`, `useAutocomplete{Member,Gif,Persona}Search.ts`; menu in `channel/components/Autocomplete*.tsx` |
| Fork: timestamps, caret anchors | `nodes/ComposerTimestamp*`, `ComposerTimestampTransform.ts`, `nodes/ComposerCaretAnchorNode.ts`, `registerComposerCaretAnchors.ts` |

## How the editor works

- One `LexicalComposer` on `PlainTextPlugin`: one paragraph whose text is always the markdown
  source. Text formats, `SyntaxMarkerNode`s and blockquote line nodes from the highlighter only
  change how it looks.
- Behaviour is `register*(editor)` functions merged with `mergeRegister` in `ComposerInner`'s
  effects. Rich mode adds slash slots, highlighting, blockquotes, emoji shortcodes and (fork)
  timestamps and caret anchors. Plain mode (`ChatInputSettings.renderComposerAsPlainText`) uses
  `ComposerPlainSegmentNode` text instead of pills; a switch projects and hydrates again.
- Mentions and emoji extend `ComposerAtomicTokenNode`: `getTextContent()` is the display (`@Name`,
  `:smile:`), `getWireText()` what is sent (`<@id>`, the emoji). The highlighter sets `literal`
  (escaped or in code) and `spoiler`. Pills are MobX `observer`s returned by `decorate()`.

## What is sent, saved and restored

- After each update that dirties a node, `$projectComposer()` gives the host
  `onChange(display, segments, wire)`: the text shown, the message text, and `MentionSegment`s
  (`type`, `id`, `displayText`, `actualText`, `start`, `end` in display offsets) between them. Slash
  state and timestamps (`timestamp:<epoch>:<format>`) are `special` segments.
- **Send:** messaging's `useTextareaSubmit` sends `getWireValue()`.
- **Drafts** are display plus segments, given back as `initialValue`/`initialSegments`.
  `$hydrateComposerFromDraft` drops a segment that fails `isValidComposerSegment` and keeps its
  display text, so that mention goes out as `@Name`. An outside change of the host's `value` calls
  `handle.hydrate`.
- **Edits:** `channel/components/EditingMessageInput.tsx` converts the message text with messaging's
  `applyMarkdownSegments`, mounts `LexicalRichInput` and saves its wire.
- **Clipboard:** copy writes the wire plus an `application/x-fluxer-composer+json` slice whose
  token must be one of the last 32 minted in this tab to paste back as pills. Other text goes through
  `channel/components/useChannelComposerPaste.tsx` and messaging's `detectPastedSegments`.
- **Autocomplete:** each change or caret move re-reads `getTextUpToCursor()` (display text) and runs
  messaging's `detectAutocompleteTrigger`. A pick: `optionToPayload` → `applyComposerReplacement`
  (checks the wire length) → `handle.replaceRange` → `$createComposerInsertNode`.

## Persona mentions (fork)

- **Form:** `<@userId:personaId>` (grammar in `packages/markdown_parser`). In the editor, a
  `ComposerMentionNode` of type `user` with the owner's id, the persona in its wire, and display
  `@PersonaName`; `getPersonaId()` reads the wire. `SLOT_USER_WIRE_RE` (`ComposerSerialization.ts`)
  accepts the form, so drafts and user slots keep it; `PERSONA_WIRE_RE` repeats it in
  `ComposerMentionNode.tsx` and `ComposerMentionPill.tsx`. Change the three together.
- **Choosing:** on `@` with a channel, `useAutocompletePersonaSearch` asks the server and
  `buildRecentPersonaOptions` adds personas from cached messages; other people's private personas
  are skipped by both. Merged by persona id, ranked by `filterPersonaMentions` (match on name,
  display tag, owner's names; then frecency), cut to `MENTION_RESULT_LIMIT`, listed after members
  and drawn by `renderPersona` in `channel/components/AutocompleteMention.tsx`. User slots of slash
  commands take them too (`optionToSlotPayload`).
- **Picking** (`optionToPayload`) records the owner in `MentionFrecency` and the persona with
  `PersonaStore.recordKnownPersona`, then inserts the mention.
- **The pill** takes `wire` and `personaId` in `...fork`. A branch atop the `user` case shows the
  current name: `PersonaStore.getKnownPersona`, else the persona on a cached message (recorded as
  known), else the stored `@Name` while it calls `fetchPersona` from render ("Network calls").
- **Editing a message** gives persona pills: messaging's `withPersonaMentionSegments` adds them to
  upstream's `convertMarkdownToSegments` (tyne-chat/tyne#99). **Pasting from outside** still gives
  raw text, because `detectPastedSegments` matches `<@id>` only; the text is sent unchanged.
- **Persona tags** are plain text here: no node, no highlight. The host passes `wireValue` to
  `PersonaComposerPill` and the send strips the tag (`persona/AGENTS.md`). Match tags against the
  wire, never the display, which shows emoji as `:name:` and mentions as `@Name`.
- `/persona` is parsed by `resolveCommand` (`LexicalMessageCommand.ts`) and run by
  `devtools/utils/CommandUtils.ts`.

## Timestamps, caret anchors, shortcuts (fork)

- **`ComposerTimestampNode`** is a plain `DecoratorNode`: the highlighter sets no `literal` or
  `spoiler` on it and `$nodeWireText` has no case for it (the highlighter reads its label).
  `ComposerTimestampTransform.ts` turns a typed `<t:…>` or `<t:N:f> (<t:N:R>)` into one;
  `ComposerHandle.insertTimestamp` serves the host's `TimestampModal`. `normalizeTimestampFormat`
  turns `s`, `S` and a bare `<t:N>` into `:f`. Labels use the current locale and device time zone;
  relative ones re-render each second. Double-click and right-click are handled in both
  `ComposerTimestampPill` and `LexicalComposerInput`'s pointer handlers: change both.
- **Caret anchors:** Blink and WebKit lose the caret before an inline pill at the start of a line,
  so `registerComposerCaretAnchors` keeps a `ComposerCaretAnchorNode` (a `TextNode` holding
  U+FEFF, empty text content) before each one. Upstream's `TextNode` loops skip it by name (the
  projection, `$nodeWireText`, the highlighter, `ComposerBlockquote.ts`, `ComposerEmojiShortcode.ts`,
  `ComposerPlainText.ts`); a new `TextNode` transform must too.
- **Shortcuts:** with an empty selection in a composer with text, Ctrl/Cmd+B, I, U and Shift+S
  insert an empty marker pair around the caret; upstream does nothing.

## Rules and traps

- `$` functions run only in `editor.update`, `editor.read` or `editorState.read`; node getters use
  `getLatest()`, setters `getWritable()`.
- Handle writes (`replaceRange`, `insertTimestamp`) are plain `editor.update`s, committed later;
  handle reads (`getWireValue`, `getSegments`) see committed state only. Use `{discrete: true}`, as
  `hydrate` and `clear` do, to read a write at once.
- Transforms re-run on whatever they dirty: write a node only when its value differs, and return
  while `editor.isComposing()` (IME). The caret anchors' paragraph transform does not check it.
- A transform that replaces text restores the caret: `$captureSelectionOffsets`, replace, then
  select the adjusted offsets (`$adjustEmbedCaret` in the emoji and timestamp transforms).
- `getTextContent()` is the display text that offsets and stored segments count; it may change
  only through an update. `ComposerTimestampNode` breaks this (its label follows the clock); do not
  copy it.
- A new non-text node needs the `nodes` list in `LexicalComposerInput` (and the tests' lists) and a
  case in `$projectComposer`, `$createComposerSegmentNodes`, `isValidSegmentWire`, `$nodeWireText`
  and `$createComposerInsertNode`, plain mode included.
- `baseAutocompleteMenu` in `useLexicalAutocomplete` lists its dependencies by hand and Biome's
  `useExhaustiveDependencies` is off: add every input (`personaSearchResults` is missing today,
  tyne-chat/tyne#150).
- Pills re-render often and remount on `hydrate`, a mode switch and a `literal`/`spoiler` change: no
  requests or store writes from `decorate()` or a pill.

## Where the fork's code sits

Fork-owned: the timestamp and anchor files, `useAutocompletePersonaSearch.ts`, six tests. Inside
upstream's files, each under `// Fork imports.`:

| File | Fork change |
|---|---|
| `LexicalComposerInput.tsx` (upstream's most changed) | theme key, two nodes, two `register*` calls, `insertTimestamp`, timestamp branches in the pointer handlers |
| `useLexicalAutocomplete.ts` | `buildRecentPersonaOptions`, persona merge in the `mention` case, `optionToSlotPayload`, `optionToPayload` |
| `nodes/ComposerMentionPill.tsx`, `nodes/ComposerMentionNode.tsx` | persona branch (in the persona's colour), plain-mode name; `getPersonaId`, two props |
| `ComposerSerialization.ts`, `composerOffsets.ts`, `ComposerInsertion.ts`, `ComposerHandle.ts` | persona form; timestamp and anchor cases; `timestamp` payload (built only by a test) |
| `ComposerMarkdownHighlight.ts`, `ComposerBlockquote.ts`, `ComposerEmojiShortcode.ts`, `ComposerPlainText.ts` | anchor checks inside upstream's conditions |
| `ComposerMarkdownShortcuts.ts`, `LexicalMessageCommand.ts` | empty-selection shortcuts; `/persona` |

When touching them, move fork lines out: persona helpers into `useAutocompletePersonaSearch.ts`, the
pill's branch into a fork component behind one line (its fetch in an effect), anchor checks into
one shared predicate.

## Network calls

- **Typing after `@`** (composer with a channel), and each search-bar term:
  `GET /channels/:id/persona-mentions?q=…&limit=500`, 60 ms after the last change (at once for a
  bare `@`), unless the channel's cache is under 15 minutes old and matches. A word matching no
  persona costs one per pause. Not shared, not cancelled (late answers to old queries are dropped;
  tyne-chat/tyne#150).
  A failure caches nothing and the next change asks again. The server lists the guild's members
  each time. `persona/events/PersonaEvents.ts` clears the cache.
- **An unknown persona's pill** (a draft restored after a reload): `PersonaStore.fetchPersona` →
  `GET /users/:owner/personas/:persona` on every render until one succeeds, per pill; failures are
  not remembered (tyne-chat/tyne#121).
- Upstream's: member search 200 ms after typing; GIFs 250 ms after, cached per query.

Before adding one, answer the root `AGENTS.md`'s "Network calls".

## Tests

- Vitest beside the code (`// @vitest-environment happy-dom`, `installVoiceMenuTestBootstrap`, an
  editor from `createEditor` with the composer's nodes, Lingui and pills mocked).
- Fork: `ComposerPersonaMention.test.ts`, `useLexicalAutocomplete.test.tsx` (personas from
  messages, private ones skipped, a pick's wire), `useAutocompletePersonaSearch.test.ts` (debounce,
  errors, ranking; mocks `http` with fake timers, the shape for counting requests),
  `ComposerTimestamp.test.ts`, `ComposerEmojiCaret.test.ts` (anchors),
  `ComposerMarkdownShortcuts.test.ts`. Upstream: `useAutocompleteMemberSearch.test.tsx`. Two fork
  names could collide with upstream's (`useLexicalAutocomplete`, `ComposerMarkdownShortcuts`); name
  new ones `<File>Persona.test.ts` or similar.
- End to end: `e2e/web/desktop/persona-mentions.spec.ts`, `persona-mention-pipeline.spec.ts`,
  `channel-timestamp-pills.spec.ts`.
- Not covered: request counts (pill, persona search), fetched personas reaching the menu, the pill
  itself, anchors under undo and IME.
- Run `pnpm --filter fluxer_app test src/features/lexical`, then the list in `CHECKS.md` (all of it for a
  persona change). By hand: a mention, emoji, timestamp and slash command, sent and drafted; a
  reload with a draft; a plain/rich switch; copy and paste; an edit; a pill starting a line.
