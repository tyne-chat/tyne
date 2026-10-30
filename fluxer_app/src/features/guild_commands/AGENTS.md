# Server commands in the web app

The web half of server commands (`/tuck`), also used by the desktop app: the store of usable
commands, the composer hook that runs them, the chip on messages, and the community settings tab.
Every file here is the fork's. What a command is, the rules and the run flow on the server are in
`fluxer_api/src/api/guild_command/AGENTS.md`; the design and where this build differs from it are in
`docs/design/server-commands.md` ("Phase 1 on the web, as built").

## Where things are

| Concern | File |
|---|---|
| Usable commands, precedence, loading | `state/GuildCommandsStore.ts` (a MobX singleton) |
| `GUILD_COMMANDS_UPDATE` | `events/GuildCommandsEvents.ts`, registered in `gateway/events/ForkEventRouter.ts` |
| Rows in the `/` menu | `hooks/useWithGuildCommands.ts`, one line in `lexical/composer/useLexicalAutocomplete.ts` |
| Running `/name input` on Enter | `commands/RunGuildCommand.ts`, one call in `messaging/hooks/useTextareaSubmit.ts` |
| The chip after the timestamp | `components/GuildCommandChip.tsx`, one line each in `channel/components/UserMessage.tsx` and `CompactMessageLayout.tsx` |
| `command` on a message, grouping | `messaging/models/MessagingMessage.ts`; a fork block in `messaging/utils/MessageGroupingUtils.ts` |
| Settings tab | `components/GuildCommandsTab.tsx`, registered in `user/components/settings_utils/GuildSettingsConstants.ts` |
| Custom emoji in a template | `utils/GuildCommandTemplateEmoji.ts` |
| The template field: basic or script, loaded on demand | `components/GuildCommandTemplateEditor.tsx` |
| Script suggestions, from the server's allowlists | `utils/GuildCommandLiquidCompletions.ts` |
| Emoji suggestions, in both modes, from the message box's search | `utils/GuildCommandEmojiCompletions.ts` |
| The reference under the script mode | `components/GuildCommandScriptReference.tsx` |
| A script's preview, filled in by the server | `hooks/useGuildCommandScriptPreview.ts` |
| The server's template problems, in words | `utils/GuildCommandTemplateIssues.ts` |
| Permission labels | fork blocks in `permissions/utils/PermissionLabelDescriptors.ts` and `PermissionUtils.ts` |
| Routes | `app/constants/ForkEndpoints.ts` |

## How it works

- **Running:** picking a command in the `/` menu inserts `/name ` as plain text; the input is typed
  in the normal composer, so mentions, personas and emoji work as in any message. On Enter,
  `runForkGuildCommand` reads `/name input` from the composer's wire text, so typed, pasted and
  restored commands run the same way. Built-in commands, unknown names and edits go to upstream's
  path; so does any submit while slowmode is active, which upstream then blocks.
- **Precedence:** built-ins, then the channel's community, then the user's communities in sidebar
  order. `resolve(channel, name)` is the one place that decides; the menu, the run and the chip
  all use it. Another community's commands need Use External Commands in a community channel; in
  DMs every community's commands work.
- **Right-clicking the chip** opens that command in community settings, for those who may edit it
  (`commands/OpenGuildCommandSettings.tsx`, the server's rule); for anyone else it stays the
  message's menu. The tab takes the request from the store, so upstream's modal needs no change.
- **The chip** is clickable only when the message box is empty and its command is the one `/name`
  runs in that channel. It writes the draft and focuses the composer; the draft lags typing by
  400 ms, so a box typed into just now can look empty.

## Requests

- One `GET /users/@me/guild-commands` on first use (opening the `/` menu, a submit starting with
  `/`, a chip click), shared by every caller. READY and an account switch clear the store.
- `GUILD_COMMANDS_UPDATE` sends nothing: it marks the community stale, and the next use fetches
  that community. More than three stale communities are reloaded with the one list request, so a
  use sends at most three.
- After a failed request nothing is asked for 30 seconds. The tests count the requests
  (`GuildCommandsStore.test.ts`).
- One run per channel at a time; a second Enter while it is out does nothing, and retrying the same
  text reuses its nonce (`RunGuildCommand.test.ts`).
- A script's preview sends at most one request per 500 ms of typing, and none for a basic template,
  which the tab fills in itself. A failed one waits for the next edit
  (`useGuildCommandScriptPreview.test.tsx`).

## Traps

- Do not move commands into upstream's option bar (string or user slots) without fixing what it
  loses: a string slot sends a mention as `@Name`, and the user slot refuses personas (the design
  doc's "Mentions in the input").
- A command message always starts a new group, and so does the message after it: the grouping
  compares with the first message of the group, so checking only the current message would put
  later plain messages under a `/tuck` header (`MessageGroupingUtilsGuildCommands.test.ts`).
- The settings tab's `tabId` for `UnsavedChangesCommands` must equal the tab type, `'commands'`.
- The editor a command shows stays as chosen; the preview follows the text. Do not switch editors as
  the text changes: the field under the cursor would be replaced mid-word.
- Keep suggestions fed from `GUILD_COMMAND_TEMPLATE_TAGS` and `_FILTERS`: `liquid()`'s own source
  offers tags the server refuses.
- The server posts a template as written, so a custom emoji must be stored as `<:name:id>`. The
  template field shows it as `:name:` and saving converts it back, keeping the stored emoji of a
  name the editor cannot look up; the preview converts the same way, so it shows what will be
  posted. Standard emoji stay `:smile:`: the renderer shows them.
