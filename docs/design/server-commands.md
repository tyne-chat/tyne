# Server commands

Per-community slash commands: an admin writes `/tuck` once, and members post it by typing `/tuck
@Yami`. The message comes from the member and their current persona, the command they typed is not
shown, and a small `/tuck` chip after the timestamp tells others how it was made.

- **Issue:** tyne-chat/tyne#246 (the brainstorming, the Temple's command list and the decisions are
  in its comments); the work is tracked per phase in #269, #270 and #271.
- **Status:** draft, 2026-10-29. Nothing is built. Reviewed the same day by Argon (Antigravity)
  against the code; its findings are worked in (persona and variable semantics, the web submit
  path, string slots, hydration's guild, double submits, counter order).
- **Line numbers** refer to tyne `24e196042`, tyne-mobile `e166da049` and tyne-dart-sdk `09c71b12`
  (2026-10-29); they drift, the names do not.
- **Wording:** the UI says "community" and calls the tab **Commands**. The code calls them guild
  commands (`guild_command`), as upstream calls communities guilds.

## Contents

1. [Background](#background)
2. [Goals and non-goals](#goals-and-non-goals)
3. [Decisions](#decisions)
4. [What people see](#what-people-see)
5. [Templates](#templates)
6. [Counters](#counters)
7. [Data](#data)
8. [API](#api)
9. [Web client](#web-client)
10. [Mobile client](#mobile-client)
11. [Network calls](#network-calls)
12. [Translations](#translations)
13. [Hooks into upstream files](#hooks-into-upstream-files)
14. [Tests](#tests)
15. [Phases](#phases)
16. [Open questions](#open-questions)
17. [Alternatives considered](#alternatives-considered)

## Background

**What the Temple used.** On Discord the Temple ran Arcane (arcane.bot). Its 21 custom commands
(listed on the issue) use two template tags, `{member.mention}` (who ran it) and `{args}` (free
text, usually a mention typed into it), plus markdown: `#` headings, bold, custom emoji (many
animated) and spoilers. Two commands mention one fixed member inside a spoiler, on purpose. None
uses random choice, conditions, embeds, roles or cooldowns. Arcane also posted welcome and goodbye
messages and ran leveling; those are out of scope here.

**What Arcane offers** (its documentation is open source, `privy-gg/docs.arcane.bot`): a command
is a name, a response in its "Tag System v2", a per-user cooldown and an NSFW switch, run as `/name
args:… target:@member`. The tag language has variables, embeds, `{choose:}`, `{range:}`, maths,
`{if()}`, variables that last for one run, who-may-run checks, and side effects (roles, purge,
redirect, reactions). Its storage does not persist between runs, so it has no counters. There is
no export of any kind.

**What upstream has.**

- Slash commands that run in the client only: a fixed list on the web
  (`fluxer_app/src/features/devtools/hooks/useCommands.ts`) and on the phone
  (`lib/features/chat/utils/composer/composer_slash_commands.dart`).
- Bots and webhooks, but no application commands or interactions (no `INTERACTION_CREATE`, no
  buttons).
- No scripting or template engine anywhere: no Lua, JavaScript sandbox, Rhai, WebAssembly runtime,
  Liquid or Handlebars in either lockfile. The closest thing is ICU MessageFormat
  (`@messageformat/core`), which `packages/i18n` uses for the API's own strings.

## Goals and non-goals

Goals:

- Commands defined per community, edited in community settings on the web and on phones.
- Usable wherever that community's custom emoji are: by its members, in its channels, in other
  communities' channels (unless switched off there) and in DMs.
- Running one posts an ordinary message as the member and their current persona, with every normal
  check (permissions, slowmode, timeouts, mention rights, length).
- The typed command is never shown; a chip on the message names the command.
- Random choices, conditions and plurals for those who want them; counters later.
- The same behaviour on the web, the desktop app and the phone app.

Not now:

- Application commands for bots (Discord's interactions). Upstream may build them; this design
  stays out of their way.
- Importing from Arcane (it has no export).
- Welcome and goodbye messages, leveling, role changes, purge, redirect.
- Page breaks (scene breaks). They get their own design; their style list will likely live in the
  same Message Tools category.

## Decisions

| Date | Decision |
|---|---|
| 2026-10-27 | Editing commands needs a permission like "Create emoji & stickers". |
| 2026-10-28 | A command message shows a `/name` chip after its timestamp (option 2 of four on the mockups). It always starts its own header, so the chip is never hidden. |
| 2026-10-28 | Clicking the chip puts the command in the message box, at least when the box is empty. |
| 2026-10-28 | No import from Arcane. The Temple's commands are added by hand or loaded once from the issue's list. |
| 2026-10-28 | Settings copy follows upstream's: short, sentence case, "community", no helper text where a field is obvious. |
| 2026-10-29 | Templates are Liquid, rendered on the server with `liquidjs`. The basic editor and the script editor edit the same template. |
| 2026-10-29 | Loops, partials and file access are removed from the engine; the engine's own limits stay on as a second layer. |
| 2026-10-29 | Chiara agreed with the design's other contestable choices, which are therefore decided: server-side rendering; no optimistic message; the send-path hook; posting as the member's persona; loading the list on first use; Liquid with one template under both editors; phase 1 basic templates only; one one-line input with the first mention as target; built-ins winning; name rules; a command leaving attachments and the reply bar alone; the use table and per-read lookup; dropping the chip on edit; deleted commands keeping their chips; counts not lowered on delete, persona by default, simultaneous uses possibly showing the same number; templates visible only to editors; the Roles-style tab with one Save bar and local drafts; Message Tools; scripts edited on web and desktop only. |
| 2026-10-29 | Each command owns its counters; counters are not shared between commands. |
| 2026-10-29 | Commands get permissions of their own: Create commands, Manage commands, Use external commands (fork bits 62, 61, 60; Use external commands moved to 59 the same day, because upstream's tests use 60 as an unknown bit). |
| 2026-10-29 | The phone app's `allPermissions` mask covers every bit, not only upstream's. |
| 2026-10-29 | Commands are usable where their community's emoji are, plus a membership check, with the precedence in [Where commands work](#where-commands-work). |
| 2026-10-29 | Use external commands is on by default wherever Use External Emojis is, and is turned on once at release for every existing @everyone role. |
| 2026-10-29 | Up to 500 commands per community; the input may be up to 10,000 characters. |
| 2026-10-29 | Clicking the chip when the message box is not empty is refused, with a tooltip. |
| 2026-10-29 | No conversion of Arcane syntax on paste: commands come from many bots, and none is favoured. |
| 2026-10-29 | Phase 1 includes using commands in other communities and DMs. One issue per phase. Order of work: server, Dart SDK, web, phone. |
| 2026-10-29 | `GUILD_COMMANDS_UPDATE` reaches passive sessions too, and clients do not refetch on it: it marks the community stale, and the next use fetches that community's list ([Events](#events)). |

Proposals in this document that are not in this table are not decided.

## What people see

### Running a command

1. In a community channel, typing `/` lists upstream's built-in commands and the community's
   commands. Each row shows the name and description.
2. A command with input opens the option bar upstream already has, with the command's hint as the
   placeholder (`Who are you tucking in?`). Mention autocomplete works there, personas included.
   (The first web build inserts `/tuck ` as text instead:
   [Phase 1 on the web, as built](#phase-1-on-the-web-as-built).)
3. Enter sends. Nothing appears in the composer's place until the server's message arrives (there
   is no optimistic message; see [Open questions](#open-questions)). While the request is out, a
   second Enter or tap does nothing, and a retry of the same attempt reuses its nonce, so a double
   press cannot post twice.
4. On failure (slowmode, no permission, a template error) the composer keeps the command and shows
   the error the way upstream shows a failed `/nick`.
5. A command sends only text. Staged attachments and an open reply stay as they were.

### Where commands work

Like custom emoji: a member of a community can use its commands everywhere they can post.

| Where | Rule |
|---|---|
| The command's own community | Always |
| Another community's channel | If the member has **Use external commands** there (on by default, like Use External Emojis) |
| DMs and group DMs | Always; the people in the DM need not share a community |

- **Membership:** the server checks that the member belongs to the command's community when it runs.
  Emoji are looser (the server only checks that the emoji exists, and the web offers emoji from
  communities one is only visiting); commands are not.
- **No premium gate.** Emoji outside their community also need upstream's
  `feature_global_expressions` limit, a paid-tier switch that is on for everyone on this instance
  (self-hosted, premium for everyone). Commands do not use it.
- **Precedence** when names collide, for typed or pasted `/name` text:
  1. built-in commands (a community cannot create `/me`; if upstream adds a built-in with an
     existing command's name, the built-in wins and the settings tab marks the command as hidden);
  2. the current community's command;
  3. other communities' commands, in the member's sidebar order.

  The same order on the web and on phones. Emoji are not a model here: typed emoji names resolve
  differently on the two (tyne-chat/tyne#170, #268).
- **Autocomplete** shows every usable command, each with its community's name and icon, ordered by
  the same precedence. Picking a row runs that exact command, whatever its name.

### The message

- An ordinary message from the member's current persona, with the template filled in.
- A chip after the timestamp: `Chiara · Today at 23:17 · /tuck`. In compact mode it follows the
  name: `[23:17] Chiara /tuck: …`.
- A command message always starts a new header, and the message after it does too, so the chip is
  always on screen.
- The chip's tooltip names the command's community (a `/tuck` in a DM could come from any of
  them).
- Clicking or tapping the chip, when the member's message box in that channel is empty and they
  may use that command there, puts `/tuck` in it with the option bar open (on the web for now,
  `/tuck ` as text). When the box is not
  empty, the tooltip says so and nothing changes. For anyone who may not use the command, the chip
  is not clickable.
- Right-clicking the chip offers **Edit /tuck** to those who may edit that command (Manage commands,
  or Create commands for one's own), and opens it in community settings. For anyone else, and for a
  deleted command, a right click stays the message's own menu.
- Editing the message removes the chip: the text no longer matches the command.
- A deleted command's messages keep the chip with the name as it was, not clickable.

### Managing commands (web and desktop)

A **Commands** tab under **Message Tools** in community settings, after Signal Bar. Layout follows
the Roles tab: a list beside an editor on wide windows, the list then the editor on narrow ones.

- **List:** "Command slots 20 / 500", **New command**, a search box, and one row per command: `/name`,
  its description, the creator's avatar.
- **Editor**, top to bottom:
  - `Edit /tuck`, `Created by …`, **Delete command**.
  - **Command:** Name (with a fixed `/`), Description.
  - **Input:** None / Optional / Required as radio buttons, like the Moderation tab's choices, and a
    Hint when the command takes input.
  - **Message:** the template. In the basic editor, two chips insert **Person running it** and **What
    they type**, shown as pills; markdown, emoji and mentions work as in a message. A link switches
    to the script editor (below).
  - **Preview:** the message as it will look, from the viewer's current persona, with a **Sample
    input** field.
- **Saving:** upstream's unsaved-changes bar (Reset, Save changes), holding edits across several
  commands, as Roles does. **New command** makes a local draft; nothing is saved until Save, unlike
  Roles, which creates "New role" at once, because a saved command is usable immediately.
- **Delete** asks first.
- **Empty state:** "No commands" / "This community doesn't have any commands yet.", with **New
  command**.
- **Script editor** (phase 2): a code editor over the same template, with Liquid highlighting, the
  same preview (rendered by the server), and errors with line numbers. A template opens in the
  basic editor when it only uses what the basic editor can show (see
  [Basic or script](#basic-or-script)), otherwise in the script editor.

Mockups exist (web tab, phone list, phone editor, empty state, the four chip options); they are
private and linked from the issue's comments on request.

### Phones

- Server settings › **Commands**: the list as a page, the editor as a page with "Back to commands",
  the save bar floating at the bottom. System back returns to the list, and leaving the tab with
  unsaved edits asks first (upstream's server settings tabs drop unsaved edits silently today).
- Only the basic editor. A script template shows read-only: "This command uses a script. Edit it on
  the web or desktop app."

## Templates

### Why Liquid

Commands are text generators, not programs. Liquid (here `liquidjs`, MIT, one dependency,
`commander`, used only by its command-line tool) was made for templates written by untrusted users
(Shopify's themes): `{{ }}` interpolation, `if`/`case`/`unless`, `assign`/`capture`, filters, and
custom tags and filters. Other options are under [Alternatives considered](#alternatives-considered).

### Variables

| Variable | Value |
|---|---|
| `person` | The member who ran it, as a mention: `<@user:persona>` from a persona, `<@user>` otherwise |
| `person.name` | Their display name (persona name, else community nickname, else global name, else username), escaped |
| `input` | What they typed, as wire text: mentions and custom emoji stay `<@…>` and `<:name:id>` |
| `target` | The first member or persona mentioned in `input`, as a mention; `nil` if none |
| `target.name` | That mention's display name, escaped; empty if none |
| `channel`, `channel.name` | The channel's mention and name (in a DM: empty mention, the DM's name) |
| `channel.community.name` | The name of the community the message is posted in; empty in DMs |
| `community.name` | The name of the command's community |

- **Objects:** `person`, `target` and `channel` are liquidjs `Drop`s whose value is the mention, so
  `{{ person }}` prints the mention, `{{ person.name }}` the name, and `{% if person == target %}`
  (hugging yourself) compares the mentions. A plain string would have no `.name`; a plain object
  with `toString` would make `==` compare object identity. Tests cover all three.
- **`nil` when absent:** in Liquid only `false` and `nil` are falsy; `""` and `{}` are true. So
  `target` is `nil` when `input` has no mention, and `{% if target %}` works. `{{ target }}` then
  prints nothing (`strictVariables` is off).
- **Escaping:** names are escaped for every markdown character that could change the message
  (`\`, `*`, `_`, `~`, `` ` ``, `|`, `[`, `]`, `<`, `>`, and `#`, `>` or `-` at the start of a
  line), so a name like `||x||`, `[x](url)` or `<@123>` cannot add formatting, links or mentions.
- **Target ownership:** a persona mention `<@USER:PERSONA>` in `input` counts as that persona only
  if the persona belongs to that account (`personaRepository.findByUserAndPersonaIds`, as
  `hydratePersonas` checks); otherwise it is the account. A hand-written mention cannot borrow
  another persona's name or count.
- Persona mentions are `<@USER_ID:PERSONA_ID>` (`packages/markdown_parser/rust/src/links.rs:199-231`;
  `fluxer_messages/src/mention_extractor.rs:145-154` keeps numeric, non-zero pairs).
- **Input bounds:** `input` is at most 10,000 characters and one line (no `\r` or `\n`) in the run
  and preview schemas, matching what the clients' slots allow
  (`fluxer_app/src/features/lexical/composer/SlashSlotPersistence.ts:94-95`), so an API caller
  cannot put a heading into a one-line template. The filled-in message must still fit the
  member's message limit (2,000 or 4,000 characters), so a long input fails at the send with
  `CONTENT_EXCEEDS_MAX_LENGTH`. The web saves a draft's slot state in an id of at most 32,768
  characters (`SlashSlotPersistence.ts:10-12`); check that a 10,000-character input with
  non-ASCII text still fits, or accept that such a draft loses its slot state.
- Counters add variables of their own ([Counters](#counters)).

### Tags and filters

Tags and filters are allowlists, `GUILD_COMMAND_TEMPLATE_TAGS` and `GUILD_COMMAND_TEMPLATE_FILTERS`
in `packages/schema/src/domains/guild_command/GuildCommandSchemas.ts`: the engine deletes everything
else, so a liquidjs upgrade adds nothing by itself, and the editors suggest from the same lists.

Kept from Liquid: `if`/`elsif`/`else`/`unless`/`case`, `assign`, `capture`, `echo`, `liquid`,
`raw`, comments, and the filters for text, numbers and short lists (with `strictFilters`, so a
misspelt filter is an error in the editor, not empty output).

Left out: `for`, `tablerow`, `break`, `continue`, `cycle` (loops); `include`, `render`, `layout`,
`block` (other templates and files); `increment`, `decrement` (per-render counters, confusing next
to ours). Filters that need a loop or objects to be of use (`map`, `where`, `group_by`, and the
`_exp` family, which also run an expression per item), hashes, JSON dumps and HTML filters.

Ours:

```liquid
{% random %}
# {{ person }} gently tucks {{ input }} in to sleep!
{% or %}
# {{ person }} wraps {{ input }} in a giant burrito blanket!
{% endrandom %}

{{ "warm" | one_of: "gentle", "big" }}           → one of the three words
{{ hugs | plural: "time", "times" }}             → "time" or "times", by the language's plural rules
{{ hugs | ordinal }}                             → "12th"
```

- Communities have no stored language, and the language of a template is the author's, not the
  runner's. So `plural` takes the first word for 1 and the second otherwise, and `ordinal` writes
  English ordinals; a script in another language writes its own suffix.
- `random` and `one_of` use `crypto.randomInt`, so results cannot be steered.
- `one_of` also takes a list: `{{ "a,b" | split: "," | one_of }}`.
- `{% random %}` drops the spacing around the branch it picks, and the finished message is trimmed,
  so tags on lines of their own leave no blank lines at its ends.

### Basic or script

The server classifies each template when it is saved and returns `kind: 'basic' | 'script'`, so
both clients agree. A template is **basic** when it contains only text and the outputs `{{ person
}}` and `{{ input }}` (any spacing, no filters); anything else is a **script**. Removing the logic
from a script makes it basic again; no flag is stored. The server can tell with liquidjs's static
analysis (`parseAndAnalyzeSync`, `variablesSync`) and by walking the parsed templates.

Phase 1 accepts basic templates only.

### Rendering safely

The API renders on its main thread, so the engine is locked down rather than trusted:

```ts
// fluxer_api/src/api/guild_command/GuildCommandTemplateEngine.ts (sketch)
import {Liquid} from 'liquidjs';

export function createGuildCommandTemplateEngine(): Liquid {
	const engine = new Liquid({
		templates: {}, // no file system: lookups use this empty map
		ownPropertyOnly: true, // the default; templates see only the scope's own properties
		strictFilters: true,
		strictVariables: false,
		parseLimit: MAX_GUILD_COMMAND_TEMPLATE_LENGTH,
		renderLimit: 50, // milliseconds per render
		memoryLimit: 100_000, // characters allocated by filters such as append and join
	});
	for (const name of Object.keys(engine.tags)) if (!ALLOWED_TAGS.includes(name)) delete engine.tags[name];
	for (const name of Object.keys(engine.filters)) if (!ALLOWED_FILTERS.includes(name)) delete engine.filters[name];
	engine.registerTag('capture', CountedCaptureTag);
	engine.registerTag('random', RandomTag);
	engine.registerFilter('one_of', oneOf);
	engine.registerFilter('plural', plural);
	engine.registerFilter('ordinal', ordinal);
	return engine;
}
```

- **The limits are real** (read in liquidjs 10.30.1's `liquid-options.d.ts`: `parseLimit`,
  `renderLimit`, `memoryLimit`), with two caveats: `renderLimit` is checked between template nodes,
  not inside a filter call, and the render still blocks the event loop until the limit hits. Hence
  both layers: no loops and small limits.
- **No loops is not enough on its own:** `{% assign x = x | append: x %}` repeated doubles the
  output each line. `memoryLimit` stops that (`append`, `prepend`, `join` and others count against
  it).
- **Everything stored counts:** liquidjs's `capture` does not charge `memoryLimit` for what it keeps,
  so the fork's `CountedCaptureTag` does, as `random` does for its branch.
- **The memory limit is 100,000 characters,** not liquidjs's unlimited default: a message holds at
  most 4,000.
- **Files:** by default `include`, `render` and `layout` read template files from disk. The tags are
  removed and `templates: {}` makes any lookup use an empty map.
- **Output size:** plain outputs are not counted as they are written, so `render` refuses a result
  over the memory limit before copying it (Node builds long strings lazily, so this costs nothing).
  Below that, the send path rejects content over the member's limit (2,000 or 4,000 characters) with
  `CONTENT_EXCEEDS_MAX_LENGTH`.
- **Property walks:** liquidjs applies `ownPropertyOnly` to plain objects but not to `Drop`s, so
  `{{ person.__proto__ }}` is readable. It stops at `Drop.prototype`, the constructors there throw
  when called, and a template cannot pass arguments, so nothing else is reachable. Tests pin this.
- **Sizes on save:** the template at most 4,000 characters; the parse must succeed.
- **Synchronous:** parse on save and cache the parsed template per command and `updated_at`; render
  with `renderSync`. No filter of ours is asynchronous.
- **To verify in tests:** that deleting from `engine.tags` makes `{% for %}` a parse error, and that
  every option above behaves as described.

### Errors

Liquid's errors are English, so the engine turns them into an `issue`: a code (`unknown_tag`,
`unknown_filter`, `not_closed`, `too_long`, `too_large`, `too_slow`, `invalid`, `failed`), the name
concerned and the line and column. The clients translate the code. A failed save carries it as
`template_issue` in the 400; the preview route returns it with a 200, because a template with a
problem is an answer there, not a failed request. Members running a broken command get
`GUILD_COMMAND_TEMPLATE_INVALID` with no details; those show in the editor.

## Counters

Phase 3. "Yami has been hugged 12 times!".

**A counter** belongs to one command (decided 2026-10-29: no counters shared between commands; can
be revisited). In the editor, a **Counters** section under the template lists them. Each has:

- a name, unique within the command;
- what it is kept per, any combination of: the person running it, the recipient (`target`), the
  pair (one direction), the channel, the typed text; or nothing (one count for the command);
- persona or account for the person and the recipient (persona by default);
- a period: all time (phase 3), later today / this week / this month in the community's time zone.

Every run of the command adds one to each of its counters. Templates read a counter by name after
that increment, so the first hug shows 1:

```liquid
{% if hugs == 1 %}It's {{ target.name }}'s first hug!{% else %}
{{ target.name }} has been hugged {{ hugs }} {{ hugs | plural: "time", "times" }}!{% endif %}
```

Rules:

- A counter kept per recipient needs a recipient: such a command's input is the **person** type
  (exactly one member or persona, picked from autocomplete). Free text with no mention counts
  nothing.
- Counts are uses. Deleting the message does not lower them; admins can set or reset a count in
  settings.
- Counts survive members leaving and personas being renamed.
- Counts work wherever the command runs, DMs included; a count kept per channel counts per DM.
- Deleting a command deletes its counts.
- Caps: 5 counters per command; rows are bounded by members × counters × scope.

How an increment works: see [Running a command](#running-a-command-step-by-step), steps 4 and 7.

## Data

New fork tables, declared in `fluxer_api/src/api/ForkTables.ts` (the fork's table file, exported
from `Tables.ts:1521-1522`) with `defineTable` (`database/CassandraTableDsl.ts:73-79`; example
`signal_bar/SignalBarSettingsRepository.ts:24-34`). No upstream table gets a column.

| Table | Key (partition) | Columns |
|---|---|---|
| `guild_commands` | `guild_id`, `command_id` (`guild_id`) | `name`, `description`, `template`, `kind`, `input_mode` (`none`/`optional`/`required`), `input_type` (`text`, later `person`), `input_hint`, `counters` (phase 3: JSON list of `{id, name, scope, identity, period}`), `creator_id`, `created_at`, `updated_at` |
| `guild_command_ids` | `command_id` | `guild_id` (to find a command's community from its id) |
| `guild_command_uses` | `channel_id`, `message_id` (`channel_id`) | `guild_id`, `command_id`, `command_name`, `created_at` |
| `guild_command_use_channels` | `channel_id` | `since` (a marker: a command has been used in this channel) |
| `guild_command_counts` (phase 3) | `guild_id`, `command_id`, `counter_id`, `scope_key` (`guild_id`, `command_id`) | `value` (a JS number, so it can be incremented), `updated_at` |

- `command_name` and `guild_id` are copied into each use, so a renamed or deleted command's
  messages keep their chip and its tooltip can name the community. Nothing else is stored per use:
  the message has its author and persona, and counts live in `guild_command_counts`.
- `guild_command_use_channels` is written with a channel's first use and never removed. Command
  messages can appear in any channel, DMs included, so the hydration lookup reads this marker
  (cached) to skip channels where no command was ever used
  ([Attaching `command`](#attaching-command-to-messages)).
- Names are unique per community, checked on write against the partition (at most 500 rows). Two
  simultaneous creates with one name can both succeed; the list then shows both and the composer
  uses the older. Acceptable at this size.
- The KV layer stores every table as rows of one Postgres key/value table; there is no migration
  and no schema version (root `AGENTS.md`).
- Increments: `advanceRow` with `increment` (`database/CassandraQueryExecution.ts:290`,
  `KvAdvance` in `database/CassandraTypes.ts:107-115`) runs as one SQL statement on Postgres
  (`PostgresKvQueryExecutor.advanceRow`, 1687-1740), as `read_state/ReadStateRepository.ts:170-196`
  uses it. It returns whether it wrote, not the new value.
  - **The guard is required.** Postgres checks the stored guard value `<=` (or `<`) the given one,
    and a missing column passes (`COALESCE(…, true)`). Proposed: guard on `updated_at` (epoch
    milliseconds as a bigint) with `orEqual: true` and the current time, and set `updated_at` in
    the same write. It passes unless another write stored a later time from a clock running ahead.
  - **The in-memory test executor** has no `advanceRows` and runs the caller's read-then-write
    fallback instead; that fallback must apply the same guard and increment, and a test must run
    on both.
- Clean-up: no fork hook removes data on guild, channel or message deletion today (the signal bar
  removes nothing either). Proposed: delete a message's use row in
  `channel/repositories/message/MessageDeletionRepository.ts` `addMessageDeletionBatchQueries` (49),
  the one path every message deletion takes; delete a community's commands and counters from
  `guild/services/data/GuildOperationsService.ts` `purgeGuild` (829-916); leave use rows of deleted
  channels to a TTL-less sweep later, or accept them.

## API

A new fork domain, `fluxer_api/src/api/guild_command/`, laid out like `signal_bar/`:

| File | Holds |
|---|---|
| `GuildCommandController.ts` | routes, buckets |
| `GuildCommandService.ts` | rules, the run flow, events |
| `GuildCommandRepository.ts`, `GuildCommandUseRepository.ts`, later `GuildCommandCounterRepository.ts` | table access |
| `GuildCommandTemplateEngine.ts` | the engine above, classification, error mapping |
| `GuildCommandUses.ts` | the send hook and the hydration lookup |
| `AGENTS.md` | the folder guide, written when the code lands |
| `tests/` | below |

Wiring (the signal bar's pattern, `fluxer_api/AGENTS.md`):

- Controller: `app/ForkControllerRegistry.ts:9-12` (`registerForkControllers`). The folder guide
  still says `ControllerRegistry.ts`'s fork block; fix it in the same commit.
- Service: a getter in `middleware/ServiceMiddleware.ts` (fork imports at 154-160, fields 244-245,
  getters around 706-719) and its type in `types/HonoEnv.ts:158-159`.
- Schemas: `packages/schema/src/domains/guild_command/GuildCommandSchemas.ts`. No registration is
  needed: `packages/openapi/src/registry/SchemaLoader.ts:14-31` loads every export under
  `src/domains/`. Pass schemas by name to `Validator` and `OpenAPI`, then run `pnpm openapi:generate`
  (and regenerate the Dart SDK).

### Routes

| Route | Who | Does |
|---|---|---|
| `GET /users/@me/guild-commands` | anyone | Summaries of the commands of every community the caller is a member of (id, community, name, description, input), for the composer: one request instead of one per community |
| `GET /guilds/:guild_id/commands` | members | One community's list. `template` only for those who may edit commands. Used by the settings tab |
| `POST /guilds/:guild_id/commands` | Create commands | Creates; `GUILD_COMMANDS_UPDATE` |
| `PATCH /guilds/:guild_id/commands/:command_id` | creator with Create commands, or Manage commands | Updates; event |
| `DELETE /guilds/:guild_id/commands/:command_id` | creator with Create commands, or Manage commands | Deletes, with its counts; event |
| `POST /guilds/:guild_id/commands/preview` | Create or Manage commands | Fills in `{template, input, channel_id}` without posting or counting; `{content, issue}`. The channel counts only if it is in this community and the member can see it |
| `POST /channels/:channel_id/commands/:command_id` | see step 1 below | Runs it: `{input, persona_id, nonce}` → the message |

Phase 3 adds a route to set or reset a count. Counter definitions travel inside the command.

### Running a command, step by step

1. Load the command by id (`guild_command_ids`, then `guild_commands`; 404 if gone) and check:
   - the caller is a member of the command's community;
   - if the channel belongs to another community, the caller has Use external commands in it;
   - (the send itself, step 6, checks that the caller may post in the channel at all, in a
     community channel or a DM).
2. Check `input` against the command's mode, type and bounds; resolve `target` from the first
   mention, checking persona ownership.
3. Build the scope ([Variables](#variables)); names come from the persona or member.
4. (Phase 3) Read the counters the command shows and add one to those it adds to; nothing is
   written yet.
5. Render. A template error is a 400 with the fork error code; nothing is posted.
6. Post through `MessageRequestService.sendMessage({user, viewer, channelId, data, requestCache})`
   (`channel/services/message/MessageRequestService.ts:188-220`; service getter at
   `ServiceMiddleware.ts:636`), with `data = {content, persona_id, nonce}` built with
   `MessageRequestSchema`. This applies the tier gate and every check in
   `MessageSendService.sendMessage` (641-983): channel access, persona ownership, send permission,
   timeouts, verification level, slowmode, content moderation, length, nonce de-duplication and
   mention rights (`@everyone` only with Mention Everyone). The route therefore does not take the
   `CHANNEL_MESSAGE_CREATE` bucket itself, but slowmode still applies.
7. The send path calls the fork hook (below) after the message is stored and before
   `MESSAGE_CREATE` is dispatched. The hook writes the `guild_command_uses` row with
   `insertIfNotExists` and, only if that row is new, increments the counters (phase 3).
8. Return the message as the send route does; the client applies it as it applies a send
   response.

Why counters work this way:

- **Nothing to undo.** A run refused by slowmode, a timeout or a permission never reaches the hook,
  so it changes no count. Incrementing before the send would mean taking increments back on every
  refusal, and others would briefly see wrong counts.
- **Repeats are free.** A repeated nonce returns the existing message before the hook runs
  (`findExistingMessage`, 708-715), and the use row is written only once, so retries never count
  twice.
- **The cost:** two members hugging the same person at the same instant can both see the same
  number, while the stored count goes up by two. Accepted for text like "has been hugged 12
  times".

**The send hook.** `MessageSendService.sendMessage` creates the message id (781), stores the message
(`persistenceService.createMessage`, 854-881) and dispatches `MESSAGE_CREATE` (925-949) before it
returns, so a row written after the call would miss the event. Two upstream changes, one line each:

- an optional `fork?: {commandUse?: GuildCommandUseInput}` in the parameters of
  `MessageRequestService.sendMessage` and `MessageSendService.sendMessage` (641-655), passed
  through;
- after `createMessage` (881) and before the post-create work: `await
  recordForkGuildCommandUse(this.deps, message, fork);`, which writes the row (and, in phase 3,
  the increments) when there is one.

### Attaching `command` to messages

Messages carry a new field, `command: {id, name} | null`, built the way `subprofile` is.

- `channel/services/message/MessageResponseDataService.ts` `hydratePersonas` (210-336) builds
  `subprofile` for every list, get, build and broadcast (`listMessages` 351, `getMessage` 395,
  `buildMessage` 420, `buildBroadcastMessage` 445, `buildMessages` 466). Calling a protected
  `hydrateForkGuildCommandUses(messages)` from inside it reaches all of them, and the test
  stand-in (`test/mocks/RepositoryBackedMessageResponseDataService.ts`, which calls
  `hydratePersonas` itself in four places) needs no change for the call.
- **No guild needed:** the lookup goes by channel, so `hydratePersonas`'s signature stays as it is.
  (A per-community shortcut would have needed the guild, which message responses lack; the callers
  hold it in `MessageResponseAccessContext.sourceGuildId`, 37-38, if that is ever wanted.)
- **The lookup:** nothing for channels without a `guild_command_use_channels` marker (cached in
  memory with a short TTL). Otherwise one `IN` query per channel on `guild_command_uses`
  (`fetchManyInChunks`, 100 keys a chunk). So channels where no command was ever used pay nothing.
  Command messages can appear in DMs and in any community, so the marker is per channel, not per
  community; the hook writes it with the first use (`insertIfNotExists`).
- Schema: `command` beside `subprofile` in `MessageBaseResponseSchema`
  (`packages/schema/src/domains/message/MessageResponseSchemas.ts:182-188`) and in the hand-written
  `Message` interface (411-412). Without the schema field, development responses drop it
  (`Config.dev.validateResponses`).
- `fluxer_messages` (Rust) needs nothing: it does not build `subprofile` either.

In channels where commands have been used, the lookup adds one query per channel to every message
read, where `hydratePersonas` today touches nothing when no message has a persona. Accepted; a fork
message flag could remove it later (see [Alternatives considered](#alternatives-considered)).

### Edits and deletes

- **Edit:** in `channel/services/message/MessageEditService.ts`, before
  `dispatchMessageUpdateBroadcast` (240), one fork line deletes the use row when the content changed
  (the condition at 242 is the precedent), so the update and later reads carry `command: null`.
- **Delete:** see [Data](#data), clean-up.

### Events

`GUILD_COMMANDS_UPDATE`, payload `{guild_id}`, on every create, update and delete:

1. The name in `fluxer_api/src/api/constants/Gateway.ts` (the event union).
2. `<<"GUILD_COMMANDS_UPDATE">> => guild_commands_update` in `guild_event_map()`,
   `fluxer_gateway/src/utils/event_atoms.erl:85-94`.
3. Not channel-scoped (`guild/guild_dispatch_filter.erl` `is_channel_scoped_event/1`, 95-111): it
   goes to every session in the community.
4. Passive sessions (communities over 250 members): add a `bypasses_passive_filter/3` clause
   (`session/session_passive.erl:65-85`). Without it they miss the event, as they miss
   `GUILD_EMOJIS_UPDATE`. The event is rare (only when someone edits commands) and tiny
   (`{guild_id}`), so delivering it to every session costs little.
5. Sent with `gatewayService.dispatchGuild({guildId, event, data})` (`infrastructure/GatewayService.ts:510-516`;
   example `EmojiService.ts:301-307`).
6. Documented in `fluxer_docs` `gateway/events.md`; tested in
   `fluxer_gateway/test/fork_session_passive_tests.erl`.

**Clients do not refetch when the event arrives** (decided 2026-10-29). The costly part is not the event
but what follows it: in a community of 5,000 members, refetching at once would send up to 5,000
requests within a second of one edit. Instead:

- the event marks that community's commands stale;
- the next time the member uses them (types `/`, clicks a chip, or sends `/name …`), the client
  fetches that one community's list (`GET /guilds/:guild_id/commands`, summaries for members), with
  one shared request, and waits for it before resolving a typed command;
- a run that hits a command deleted meanwhile gets 404, which also marks the community stale; the
  error says the command no longer exists;
- joining a community marks it stale the same way; leaving drops its commands locally, with no
  request.

So members who never use commands send nothing, and the rest spread their requests over time.

### Permissions

Commands get permissions of their own (decided 2026-10-29), mirroring the emoji ones:

| Bit | Permission | Mirrors | Default for @everyone |
|---|---|---|---|
| 62 | `CREATE_COMMANDS`: create commands, edit and delete one's own | `CREATE_EXPRESSIONS` (43) | no |
| 61 | `MANAGE_COMMANDS`: edit and delete anyone's | `MANAGE_EXPRESSIONS` (30) | no |
| 59 | `USE_EXTERNAL_COMMANDS`: use other communities' commands in this community's channels | `USE_EXTERNAL_EMOJIS` (18) | yes |

- **Own versus anyone's** works like `checkModifyExpressionPermission`
  (`guild/services/content/ContentHelpers.ts:20-27`): the creator needs Create commands, anyone
  else Manage commands. The fork's copy of that rule lives in the commands service, not in
  upstream's helper.
- **Running** needs Use external commands only outside the command's community; the send path
  checks the rest.

**Why these bits.** Permissions are a 64-bit field. Upstream uses 41 bits: 0–18, 20–30, 34–38, 40,
43, 51–54. That leaves 23 free: 19, 31–33, 39, 41–42, 44–50 and 55–63.

- Upstream numbers permissions like Discord (43 is Create Expressions and 51 Pin Messages in both;
  Discord's 31 is Use Application Commands; this comparison is from Discord's published list, not
  from the code). The low gaps are therefore where upstream would put Discord's equivalents.
- Upstream's own bits are going upward: 53 and 54 are Fluxer's.
- Bit 63 is the sign bit of a signed 64-bit integer (Postgres `bigint`, Rust `i64`, Dart `int`).
- So the fork counts down from 62 (the root guide's "flag bits from the top"), declared in a
  `// Fork:` block at the end of `Permissions`. About eight bits lie between the two.
- Bit 60 is skipped: upstream's tests use `1n << 60n` as an example of an unknown permission
  (`packages/constants/src/BotPermissionUtils.test.ts`, `fluxer_api/src/api/oauth/tests/OAuth2BotGuildAdd.test.ts`).

**Where the bits must be added:**

- `Permissions` and `DEFAULT_PERMISSIONS` (`packages/constants/src/ChannelConstants.ts:172-266`). The
  server's `ALL_PERMISSIONS` masks (`GuildRoleService.ts:111`, `ChannelOperationsService.ts:121`,
  `GuildOperationsService.ts:1070`, `OAuth2RequestService.ts:209`, `utils/featureUtils.ts:27`) and the
  OpenAPI validators (`packages/schema/src/primitives/PermissionValidators.ts`) follow
  `Permissions` automatically.
- The web role editor: `fluxer_app/src/features/permissions/utils/PermissionUtils.ts:265-456` (the
  list) and `PermissionLabelDescriptors.ts:554-660` (titles and descriptions), with translated
  fork strings. The web's masks follow `Permissions`.
- The phone:
  - three values last in `enum Permission` (`lib/core/permissions/permission.dart`) under
    `// Fork values.`;
  - the role editor's list;
  - **the mask:** `allPermissions` is hard-coded as `(1 << 55) - 1` (`permission.dart`). Owners and
    administrators get exactly that, and the channel resolver masks every value with it
    (`channel_permission_resolver.dart:6`; also `permission_resolver.dart`,
    `channel_effective_permissions.dart`, `thread_permissions.dart:95`,
    `guild_permissions_provider.dart:74`, `guild_role_hierarchy.dart:120`). A fork bit would be
    stripped for everyone. Decided: the mask covers every bit, `0x7FFFFFFFFFFFFFFF` (all but the
    sign bit). The uses found are all checks on the device; before changing it, confirm none sends
    the mask to the server, for example as a role's permissions.
- `fluxer_docs` `http-api/permissions.mdx` (a hand-written table).
- The gateway needs nothing: it checks only the bits it lists (`fluxer_gateway/src/utils/constants.erl:125-165`),
  and owners and administrators get `16#FFFFFFFFFFFFFFFF` (`guild_permissions.erl:25`). No Rust
  service reads permissions.
- **On by default, like Use External Emojis** (decided). Defaults come from one constant on each
  side, and Use external commands goes wherever Use External Emojis is:
  - server: `DEFAULT_PERMISSIONS` (`packages/constants/src/ChannelConstants.ts:251-266`), applied
    to @everyone when a community is created (`GuildOperationsService.ts:993`), to new roles
    (`GuildRoleService.ts:112`), and as a fallback (`GuildRoleService.ts:175`,
    `GuildOperationsService.ts:1075`);
  - web: the same constant, as a fallback when @everyone is missing
    (`fluxer_app/src/features/permissions/utils/PermissionUtils.ts:133, 146`);
  - phone: its own copy, `defaultPermissions` (`lib/core/permissions/permission.dart:50-65`).

  There is no instance-level default, and nothing creates communities from templates or at instance
  setup.
- **Existing communities: turned on once at release** (decided). A new bit is off in every stored
  role, and defaults apply only to new communities and roles. A one-off worker job sets Use
  external commands on every community's @everyone role
  (`fluxer_api/src/api/guild_command/UseExternalCommandsBackfill.ts`, task
  `backfillUseExternalCommands`).
  - It saves through the role repository and sends `GUILD_ROLE_UPDATE`, not SQL on `row_data`, so
    the gateway's copy of the role changes too (`fluxer_api/AGENTS.md`, "Data changes").
  - It only adds the bit; an @everyone role keeps everything else.
  - It runs once: the worker's cron tries it every ten minutes, and it does nothing once the
    instance configuration holds its marker (`fork_use_external_commands_backfill`, with the time
    and the number of roles changed). A community that turns the bit off afterwards keeps it off.
  - On production it therefore runs within ten minutes of the first deploy that contains it. That
    deploy needs Chiara's approval like any other, and `deploy_prod.sh` takes a full database dump
    before upgrading. Changed from the earlier plan of running it by hand: the API has no admin
    route that edits roles or starts a job, and SQL would bypass the gateway.

### Rate limits

At the end of `rate_limit_configs/UserRateLimitConfig.ts` (the signal bar's buckets are at 301-312):

| Bucket | Limit | Global |
|---|---|---|
| `guild_commands:read` | 60 per 10 s | counts |
| `guild_commands:write` | 30 per minute | counts |
| `guild_commands:run::channel_id` | 20 per 10 s per channel, as `CHANNEL_MESSAGE_CREATE` | counts |
| `guild_commands:preview` | 30 per 10 s | `exemptFromGlobal`, like `USER_GROUP_DM_CREATE` (127-130) |

The preview is exempt because the script editor sends it while typing (debounced); going over the
global limit revokes the session.

### Error codes

Fork codes in `packages/constants/src/ApiErrorCodes.ts`, mapped in
`packages/errors/src/i18n/ErrorCodeMappings.ts` to the nearest upstream message (fork codes have no
messages of their own yet), and listed in `fluxer_docs` `http-api/errors.md`: unknown command,
command name taken, too many commands, template error. Upstream's codes cover the rest
(`MISSING_PERMISSIONS`, `CONTENT_EXCEEDS_MAX_LENGTH`, slowmode).

### Dependency

```yaml
# pnpm-workspace.yaml, catalog (29-175)
liquidjs: ^10.30.1
```

```jsonc
// fluxer_api/package.json, dependencies
"liquidjs": "catalog:"
```

- Then `pnpm install`; the lockfile gains `liquidjs` and `commander`.
- The workspace's policies apply: `minimumReleaseAge: 1440` (a version must be a day old),
  `trustPolicy: no-downgrade`, `blockExoticSubdeps`.
- `fluxer_api/scripts/build.mjs` bundles only `@app/`, `@pkgs/` and `@fluxer/` imports and leaves
  `liquidjs` external. It stops the build if a package is not declared in `fluxer_api`'s own
  dependencies (81-86). The image installs it with `pnpm deploy --filter=fluxer_api --prod`
  (`fluxer_api/Dockerfile:25`).
- No tool checks JavaScript licences (`cargo deny` covers Rust only); liquidjs's `package.json` says
  MIT. Knip will see it used.
- The clients do not need liquidjs: the server returns `kind`, and basic templates are previewed
  with two substitutions.
- The web script editor (phase 2) adds `@codemirror/lang-liquid` (6.3.3, MIT) to `fluxer_app`. Its
  CodeMirror dependencies are already there for upstream's Quick CSS editor; `@codemirror/lang-html`
  would be new.

## Web client

A fork feature folder, `fluxer_app/src/features/guild_commands/`, with an `AGENTS.md` once built.

**State and events.**

- `GuildCommandsStore`: a MobX singleton like `signal_bar/state/SignalBarStore.ts`. It holds the
  summaries from `GET /users/@me/guild-commands` (all the member's communities), loaded on first
  use with the request in flight shared (`??=`), plus a set of stale communities.
- `GUILD_COMMANDS_UPDATE`: one `registry.set` in `gateway/events/ForkEventRouter.ts:23-34`; it
  only marks the community stale ([Events](#events)). Joining marks a community stale; leaving
  drops its commands.
- **Precedence** ([Where commands work](#where-commands-work)): built-ins, then the current
  community, then `GuildList.guilds` order (sidebar order, `guild/state/GuildList.ts:145-162`).
  Visiting a community without joining does not make its commands usable.
- **Use external commands** is checked with `Permission.can` on the channel, like
  `checkEmojiAvailabilityWithGuildFallback` checks Use External Emojis
  (`expressions/utils/ExpressionPermissionUtils.ts:60-142`).
- Cleared on READY (`gateway/events/GatewayReady.ts:133`) and after an account switch
  (`gateway/events/ForkAccountReadyWork.ts`).
- Routes in `app/constants/ForkEndpoints.ts`. The signal bar's guide still names `Endpoints.ts` and
  `EventRouter.ts`; fix it in passing.

**The composer.**

- **List:** wrap the list at `lexical/composer/useLexicalAutocomplete.ts:260` (`const commands =
  useCommands();`), e.g. `useWithGuildCommands(useCommands(), channel)`. `channel` is in scope and
  the file has a fork imports block. Do not add to `useCommands`'s memo (356), which has no channel.
  Rows show the command's community (`channel/components/AutocompleteCommand.tsx` shows only name
  and description today, so the fork needs its own row or a subtitle there).
- **Shape:** server commands become `ActionCommand`s (`devtools/hooks/useCommands.ts:103-110`) with
  one option.
  - Draft persistence requires the name to match `/^\/[a-z0-9_-]{1,32}$/`, option names
    `/^[a-z0-9_-]{1,32}$/`, and option objects with exactly the keys `name, description, type,
    required, allowEmpty, choices` (`lexical/composer/SlashSlotPersistence.ts:48, 72-73, 122-158`).
    Breaking this throws in `$projectComposer` (`ComposerSerialization.ts:262`). The server's name
    rule matches it.
  - Server commands are told apart by name, through the store, not by an extra key.
  - Rows are keyed by name (`channel/components/AutocompleteCommand.tsx`), another reason built-in
    names are refused.
- **Running:**
  - A fork branch before `return null` in `lexical/composer/LexicalMessageCommand.ts:239` returns a
    new `ParsedCommand` `{type: 'guild_command', …}`.
  - A `case` in `executeCommand` (`devtools/utils/CommandUtils.ts:305`) posts to the run route with
    `PersonaStore.latchedPersonaFor(channelId)?.id ?? null` and a nonce, then applies the response
    with `Messages.handleIncomingMessage`, as `send` does
    (`messaging/commands/MessageCommands.tsx:681-689`). Not `resolveOutgoingPersona`
    (`persona/utils/OutgoingPersona.ts:18-36`): it strips proxy tags and backslash escapes from the
    text and updates the "last used" persona, neither of which suits a command's input.
  - `useTextareaSubmit.ts:636-660` then clears the composer and reports errors for free. It also
    calls `MessageCommands.stopReply`; for server commands the reply stays (proposal), so that call
    is skipped for them.
  - `doesCommandSendCurrentChannelMessage` (`CommandUtils.ts:226-228`) returns true for it, so
    slowmode blocks it.
  - **One run at a time:** nothing stops a second Enter while `executeCommand` waits. The fork
    keeps an in-flight run per channel, ignores submits while it is set, and keeps the attempt's
    nonce for a retry.
- **Typed or pasted commands:** text typed as `/tuck x` without picking from the menu, pasted, or
  restored from a draft has no command node.
  - In the chat composer the resolver then returns `{status: 'no-command'}`, not `null`, and
    `useTextareaSubmit.ts:474-478` calls `CommandUtils.isCommand`/`parseCommand` only for `null`.
    So a fork branch in `parseCommand` would never run. The check goes in `useTextareaSubmit.ts`
    itself: when the resolution is `no-command`, the channel is in a community and the text starts
    with `/name`, hand it to the fork resolver.
  - Neither resolver receives the channel or guild today; the fork resolver takes them from the
    hook, which has `channel`.
  - **Cold list:** if the community's list is not loaded yet (pasted text, or Enter before the
    first list request answers), the submit waits for the shared list request before deciding.
    Otherwise `/tuck @Yami` would go out as a plain message.
- **Mentions in the input:**
  - `user` slots reject persona mentions today: `USER_WIRE_RE` in
    `lexical/composer/slashSlotValidation.ts:29`, `readUserSlot` in `LexicalMessageCommand.ts:91-99`,
    and `SlashSlotPersistence.ts:74, 236`. The insertion side already handles personas
    (`useLexicalAutocomplete.ts:1015-1107`).
  - String slots get the normal `@` menu, but lose what it inserts.
    - `SlashSlotNode.getWireText` (`lexical/composer/nodes/SlashSlotNode.ts:272-282`) returns the
      resolved wire only for single-value slots (user, role, channel, choice), and otherwise
      `getTextContent()`. So a mention node inside a string slot goes out as `@Name`, and a custom
      emoji as `:name:`.
    - Restoring a draft rebuilds mention nodes only for `user`, `role` and `channel` slots
      (`ComposerSerialization.ts:441-448`); a string slot comes back as plain text.
    - Confirmed by reading the code, not by running it.
  - **Proposed for phase 1:** commands take a `string` input, and a fork helper reads it.
    - The helper walks the slot's children, taking each mention, emoji or timestamp node's wire
      text and each text node's text.
    - It then applies the same emoji resolution a normal send uses (`resolveTypedEmojiContent`,
      `useTextareaSubmit.ts:642`).
    - Draft restore of mentions in string slots is a later fix.
  - The `user` slot fix is needed for the phase 3 person input.

**The message.**

- **Model:** `command` in `messaging/models/MessagingMessage.ts`: the field (176), the constructor
  (178-252), `withUpdates` (316-360, `'command' in updates ? … : this.command`, so an edit can clear
  it), `equals` and `toJSON`.
- **Chip:** a fork component, `GuildCommandChip`, styled like `channel/components/ChannelUserTag.tsx`.
  - Cozy: one line after `</TimestampWithTooltip>` in `channel/components/UserMessage.tsx:574`,
    inside the author row.
  - Compact: after the persona tag in `CompactMessageLayout.tsx:244`, not in the timestamp, whose
    width is measured for the hanging indent.
- **Grouping:** after the persona block in `messaging/utils/MessageGroupingUtils.ts:71-86`, return
  true when `currentMessage.command` or `prevMessage.command` is set. `prevMessage` is the first
  message of the current group (`createChannelStream`, 240-262), so checking only the current
  message would put later plain messages under a `/tuck` header.
- **Chip click:**
  - The composer's handle is private. When `Drafts.getDraft(channelId) === ''` and nothing is
    uploading, write a draft with a `special` segment made by `createSlashCommandStateSegmentId('/tuck',
    options)`; the composer rebuilds the command node from it (`ComposerSerialization.ts:415-421`).
    Precedent: `MessageQueue.restoreFailedMessage` (`messaging/state/MessageQueue.tsx:1121-1137`).
  - Then focus the composer with upstream's `FOCUS_TEXTAREA` event.
  - New text reaches the draft after 400 ms (`useTextareaDraftAndTyping.ts:151`); a box typed into
    in the last 400 ms may look empty. Acceptable, or read the composer through `ActiveComposer`.

**Settings.**

- **Tab registration** (`user/components/settings_utils/GuildSettingsConstants.ts`): `'commands'` in
  `GuildSettingsTabType` (100-113), a descriptor after the signal bar's (187-193) with category
  `message_tools`, permission `[CREATE_COMMANDS, MANAGE_COMMANDS]` (either one), and its label.
  Then `commands: GuildCommandsTab` in `GuildSettingsTabComponents.ts` (an exhaustive record).
  - The modal, desktop and mobile web views, and the right-click Settings menu, need nothing.
  - `GuildSettingsTabsSignalBar.test.ts:22` asserts there is no `message_tools` tab when the signal
    bar is off; update that fork test.
  - Order: the Commands tab shows even when the signal bar is not offered
    (`isGuildSettingsTabOffered`, 285-288, filters only the signal bar).
- **Unsaved changes:** `UnsavedChangesCommands` with `tabId` `'commands'` (it must equal the tab
  type); the webhooks hook (`webhook/hooks/useWebhookUpdates.tsx:37-80`) is the pattern.
- **Template field:** `lexical/composer/LexicalRichInput.tsx`, as the channel topic editor uses it
  (`ChannelOverviewTopicEditor.tsx:299-325`), given one of the community's text channels so members,
  roles, channels and personas autocomplete. Not `LexicalChannelTextareaContent`: it mounts the
  signal bar, slowmode and upload handling, and takes over composer events.
  - The **Person running it** and **What they type** pills are a fork Lexical node,
    `ComposerTemplateVariableNode`. It is registered and serialised the way the fork's
    `ComposerTimestampNode` is: in `LexicalComposerInput.tsx`'s `nodes` list (219-234), and as a
    `special` segment (`ComposerSerialization.ts:54-63`) with ids `template-var:person` and
    `template-var:input`. Its wire text is `{{ person }}` or `{{ input }}`. `LexicalRichInputProps`
    need no change.
- **Preview:** the appearance tab's pattern (`user/components/modals/tabs/appearance_tab/MessagesTab.tsx:104-213`):
  a fake `Channel` with the community's `guild_id`, a `MessageModel` with `skipUserCache` and
  `skipReactionHydration`, and `<Message … previewContext={MessagePreviewContext.SETTINGS}>`.
  - Basic templates are substituted in the client: no request.
  - Scripts go to the preview route, debounced by 500 ms.
- **Script editor** (phase 2, `components/GuildCommandTemplateEditor.tsx`): CodeMirror 6, set up like
  `theme_settings/components/QuickCssEditor.tsx`, with `liquidLanguage` from
  `@codemirror/lang-liquid` and loaded on demand, as its grammars weigh more than the rest of the tab.
  - **Suggestions** are the fork's (`utils/GuildCommandLiquidCompletions.ts`), from the server's
    allowlists: `liquid()`'s own source always offers Liquid's full list, `for` included.
  - **Emoji:** `:` at the start of a word suggests emoji from the message box's search
    (`utils/GuildCommandEmojiCompletions.ts`), in both modes; a pick inserts `:name:`, which saving
    resolves.
  - **Which editor:** a command opens by the server's `kind`, and the choice then stays until
    changed, so a template does not change editor while it is typed. **Use the script editor** is
    always offered from the basic one; the way back only when the template is basic again.
  - **The preview follows the text, not the editor:** a template that classifies as basic is filled
    in by the client, a script by the server (`hooks/useGuildCommandScriptPreview.ts`), and its
    problem shows in the preview's place and as a mark in the editor.
  - **Sample input** is a `LexicalRichInput`, so `@` offers real members and personas and
    `{% if target %}` can be tried.
  - **Reference:** a short panel under the editor (`components/GuildCommandScriptReference.tsx`)
    with the variables and worked examples. The app links to upstream's documentation site, and the
    fork's documentation is not public.

### Phase 1 on the web, as built

Where the first web build differs from the plan above, and why. The code is in
`fluxer_app/src/features/guild_commands/`.

- **No option bar.** Picking a command inserts `/tuck ` as plain text, and the input is typed in
  the normal composer. A string slot sends a mention as `@Name` and the user slot refuses personas
  (see "Mentions in the input"); plain text keeps mentions, personas and emoji working with no
  change to upstream's slot code.
  - So typed, pasted, restored and picked commands all take one path: `runForkGuildCommand`
    (`commands/RunGuildCommand.ts`), called from `useTextareaSubmit.ts` before the slowmode check.
    It reads `/name input` from the composer's wire text. `LexicalMessageCommand.ts` and
    `CommandUtils.ts` are not touched.
  - The command's **hint is not shown yet**: it was to be the option bar's placeholder.
  - Input on two lines is refused with a system message, like the server's rule.
  - With slowmode active the submit goes to upstream's path, which blocks it as for any message.
- **Autocomplete** lists only the command each name runs (precedence decides), with the
  community's name after the description. No icon yet.
- **Chip click** writes `/tuck ` as the draft's text, not a command segment, then focuses the box.
  It is clickable only when that command is the one `/tuck` runs in the channel.
- **Template field:** the same CodeMirror field as the script editor, in a plain mode with no line
  numbers, code font or highlighting, not `LexicalRichInput`. **Person running it** and **What they
  type** insert the literal `{{ person }}` and `{{ input }}` at the cursor; there are no pills or
  mention autocomplete, and `:` suggests emoji as in the script editor. Custom emoji are typed as
  `:name:`, shown that way, and stored as
  `<:name:id>`, resolved on save as in a message sent in the community
  (`utils/GuildCommandTemplateEmoji.ts`); the preview resolves the template and the sample input the
  same way.
- **Preview:** shows the viewer's account, not their current persona.
- **Not built yet:** the creator's avatar in the list, and the settings mark for a command hidden by
  a newer built-in command of the same name (the autocomplete already skips it).
- **Release task:** the Use external commands backfill runs by itself once (worker task
  `backfillUseExternalCommands`, see [Permissions](#permissions)); nothing to run by hand.

## Mobile client

A fork feature folder, `lib/features/guild_commands/`, with an `AGENTS.md` once built. Line numbers
are in tyne-mobile.

**The SDK and the message model.**

- `command` reaches the app only through the SDK: messages are parsed into
  `MessageResponseSchema` (`dart_sdk/lib/models/message_response_schema.dart:159-165` has
  `subprofile` and `mention_personas`) on REST and on the gateway (`event_parser.dart:31-40`), and no
  raw JSON is kept. So: the server schema, `pnpm openapi:generate`, `regen_dart_sdk.sh`, then
  `dart_sdk/test/serialization/fork_model_roundtrip_test.dart`, then the app.
- The commands routes can start on `fluxerDioProvider` (`lib/core/api/fluxer_client_provider.dart:143-152`)
  like `SignalBarRepository`, and move to the SDK before shipping (the root guide's rule).
- `Message` (`lib/features/chat/domain/message.dart`): a `command` field in `fromSdk` (1115-1176),
  `fromReferencedSdk` (1178), `fromSearchResult` (1302), `fromRow` (1367), `toCompanion` (1587),
  `copyWith` (1641, with an `_unset` sentinel so an edit can clear it), `applyGatewayUpdate` (1747)
  and `isRenderEquivalent` (1454-1518). Without the last, `MessageTileCache` keeps the old row.
- **Drift:** channels open on cached messages first, so the chip and grouping need columns:
  `command_id`, `command_name` in `lib/core/database/tables/messages.dart` under a `// Fork:`
  comment, added to `ensureForkMessageColumns` (`lib/core/database/fork_schema.dart:77-95`), and a
  test in `test/core/database/fork_schema_test.dart`. No schema version is taken.

**State and events.**

- A commands notifier holding the all-communities list, like
  `lib/features/signal_bar/providers/signal_bar_providers.dart:10-45`: the request in flight
  shared, a failure keeping the old state, raw-Dio repository first. Stale communities, joining
  and leaving work as on the web.
- **Precedence:** built-ins, then the active community, then sidebar order
  (`lib/features/guilds/providers/organized_guild_list_provider.dart:171,184`), the same as the
  web. Not the emoji send path's rule, which takes the oldest emoji of any community
  (`channel_textarea.dart:2406-2449`).
- **Use external commands** from the channel's permission bits, as `emoji_picker_provider.dart:304`
  uses Use External Emojis.
- `GUILD_COMMANDS_UPDATE` arrives as `UnknownGatewayEvent` (`dart_sdk/lib/gateway_client/event_parser.dart:424`)
  and goes from the fork block in `lib/core/gateway/gateway_event_handler.dart:797-818` through a
  callback wired in `lib/core/providers/gateway/gateway_provider.dart:573-576`.
  - The payload must be an object: array payloads are dropped (`gateway_connection.dart:684-686`).
  - Following `lib/core/gateway/AGENTS.md:83-84`, the block becomes one fork function call.
- Reset on READY (`gateway_provider.dart:215-218`) and on account switch (the signal bar does not
  reset on account switch; this should).

**The composer.**

- **List:** one change on `composer_autocomplete_field_state.dart:1364`, wrapping
  `composerSlashCommands(l10n)` with a fork function that adds the community's commands (`ref.read`;
  the guild comes from `_resolveComposerChannel()`, 1351). Commands are plain
  `ComposerActionSlashCommand`s (`domain/composer_slash_command.dart:61`; the base class is sealed),
  recognised through the notifier. Rows get the community's name as a subtitle, as emoji
  autocomplete rows already do.
- **Running:** one line after the slowmode block in `channel_textarea.dart` `_onSendPressed` (after
  2236): `if (await _forkTryGuildCommand(channelId, wireText)) return;`.
  - It runs after upstream's edit and slowmode handling, and before `resolveOutgoingPersona` (2346),
    which has side effects.
  - It matches the active slash session's command or a leading `/name`, posts with the persona from
    `activePersonaProvider.latchedIdFor(channelId)` (`lib/features/profile/providers/persona_providers.dart:71`),
    and stores the returned message as `MessageRepository._persistSdkMessage` does
    (`message_repository.dart:869`).
  - **Clearing:** it clears only the text and the slash session. Not
    `_resetComposerInputAfterSend` (463): that also drops staged attachments and the reply, which
    a command does not send.
  - **One run at a time:** while the POST is out, further sends in that channel are ignored, and
    the attempt keeps its nonce for a retry. POSTs are not retried by `RetryInterceptor`.
  - **Cold list:** as on the web, a send that starts with `/name` in a community whose list has not
    loaded waits for it before deciding.
- **Mentions in the input:** with a `string` input (phase 1), the slot's wire text carries the
  mentions; check that it does, then apply `resolveTypedCustomEmojiShortcodes` as a normal send does
  (`channel_textarea.dart:2283`). User slots show personas, but validation rejects their wire
  (`slash_slot_validation.dart:8, 37-55`; `composer_slash_session.dart:305-312` never passes
  `resolveUser`), and upstream's `_userMentionWire` (`composer_command.dart:149`) does not match
  `<@u:p>`. That fix is needed for the phase 3 person input.

**The message.**

- **Chip:** cozy, a last child after the silent indicator in `message_item.dart` `_buildMainRow`
  (after 2325); compact, in `_buildCompactAuthorPrefix` (1959-2017). Wrap it in
  `MessageDoubleTapExempt` (`message_double_tap_exemption.dart:22`) so a tap does not count toward
  a double tap.
- **Grouping:** after the null check in `lib/features/chat/utils/messages/message_grouping_utils.dart:51-54`,
  return true when either message has a command; test in
  `test/features/chat/utils/messages/message_grouping_utils_fork_test.dart`.
- **Chip tap:** a fork `pendingComposerTextInsertProvider` like `pendingTimestampInsertProvider`
  (`lib/features/chat/providers/pickers/timestamp_insert_provider.dart:3-20`), listened to in
  `ChannelTextarea.build` (the listeners are at 827-920). The listener checks that the box is empty
  (`_controller.toWireText().isEmpty && !_slashSession.isActive`) and starts the slash session.
  - `updateMessageText` from outside does not reliably reach the field (`composer_text_session.dart:59-110`).
  - Plain `/tuck ` text does not open a session.

**Settings.**

- **Tab registration:** no fork value exists yet in `GuildSettingsTab` or `GuildAction`. Add `commands`
  last under `// Fork values.` in:
  - `lib/features/settings/domain/guild/guild_settings_tab.dart` (enum 9-22, plus its exhaustive
    switches at 30, 84, 144 and the string ones at 101, 165);
  - `guild_settings_page_shell.dart` (title 125, icon 142);
  - `guild_settings_modal.dart` (body switch 338);
  - routes in `lib/core/router/route_names.dart` and `fluxer_router.dart`;
  - `GuildAction` in `lib/features/guilds/presentation/widgets/guild_menu_data.dart` (its tab defs at
    259-320, where the tab needs `createCommands` or `manageCommands`) and the two exhaustive switches (`guild_settings_actions.dart:342`,
    `guild_navbar_list_item_state.dart:952`);
  - a category label for Message Tools (`guildSettingsTabCategoryLabel`, 68).
  - About ten upstream files, one case each; the recipe for user settings in
    `lib/features/settings/AGENTS.md` is the model.
- **Pages:** like `settings_bans_page.dart` (`GuildSettingsPageShell`, `GuildSettingsAsyncBody`); the
  save bar is `FluxerSettingsSheet`; back handling like `ApplicationDetail`
  (`lib/features/settings/presentation/widgets/applications/application_detail.dart:669-678`).
- **Template field:** `ComposerAutocompleteField` (as the profile bio uses it, `user_profile.dart:876-882`)
  with the mention trigger added, a text channel of the community as `channelId`, and a
  `ComposerMentionController`.
  - The controller resolves account labels against the chat that is open, not the settings'
    community (`composer_mention_controller.dart:63`); to be handled.
  - **The pills:** `ComposerMentionController` extends `InlineTokenTextEditingController`
    (`lib/features/ui/input/inline_token_text_editing_controller.dart:8-26`). It maps private-use
    characters (U+E000–U+F8FF) to `InlineToken` widgets with their own wire text. A fork
    `InlineToken` for `{{ person }}` and `{{ input }}` plugs into it.
- **Preview:** `UserAccessibilityPreview`'s pattern (`user_accessibility_preview.dart:80-122`) with
  `MessageMarkdown(data:, guildId:, channelId:)` (`message_markdown.dart:18`) so mentions resolve.

### First phone build, as built

The first slice is using commands and seeing the chip; settings, and so scripts on phones, come later.
Where it differs from the plan above, and why. The code is in tyne-mobile's
`lib/features/guild_commands/`.

- **No slash session:** a command is a `ComposerActionSlashCommand` with no options, so picking it
  inserts `/tuck ` as text, as on the web, and the input is typed in the normal composer.
- **Through the SDK from the start,** not raw Dio: the SDK already had the routes.
- **The message is not stored from the response:** `MESSAGE_CREATE` delivers it like any other, which
  saves an edit to upstream's message repository.
- **Three columns,** not two: `command_id`, `command_guild_id` and `command_name`.
- **Use External Commands is a constant,** not a `Permission` value: upstream's switches over the enum
  are exhaustive, and the role editor that would list it is not on phones yet. `allPermissions` now
  covers every bit, and nothing sends it to the server.
- **Errors** appear as a client system message in the channel, as a failed `/msg` does, with the same
  wording as the web.
- **Not built yet:** tapping the chip, the chip's community name, and the settings tab.

## Network calls

The root guide's three questions:

1. **Requests per action:**
   - Opening a channel or the app sends none.
   - The first `/` anywhere sends one request for the commands of all the member's communities,
     shared by every composer. One request per community would have sent dozens at once for
     someone in many communities, near the 50 per second that signs a session out.
   - After that, nothing until a community is marked stale (`GUILD_COMMANDS_UPDATE`, joining, or a
     404 on a run); then one request for that community, the next time the member uses commands.
     The event itself never triggers a request, so an edit in a large community does not set off
     thousands of refetches. With more than three communities stale, the one list request reloads
     them all instead, so a use never sends more than three. The next READY starts over.
   - A send of `/name …` before the list has loaded, or while its community is stale, waits on that
     same shared request.
   - Running a command sends one; presses while it is out send none.
   - The settings tab sends one list request, plus one per save or delete.
   - The script preview sends at most one per 500 ms of typing, none for a basic template, and one
     per press of **Run again**. Its bucket is 30 per 10 s, outside the global limit.
   - On the server, a message read costs nothing extra in channels where no command was used, and
     one query per channel where one was.
   - `GET /users/@me/guild-commands` reads one partition per community the caller belongs to; it
     is called once per session, not per channel.
2. **On failure (429, 401, offline):** the list keeps what it had, or stays empty, and is not
   requested again for 30 seconds or until the next event or READY. A failed run is not retried; it
   shows the error. A failed preview waits for the next edit.
3. **Is it needed?** The list is not in READY or `GUILD_CREATE`, and adding it there would change
   upstream's payloads; loading it on first use is cheaper. The settings tab's per-community route
   is separate because it carries templates.

Tests that count requests, with the data missing and with the request failing:

- web: the store with a mocked fetch;
- phone: the recording Dio adapter of `test/core/permissions/channel_effective_permissions_fork_test.dart`;
- server: `countStatements` on the in-memory executor for the hydration lookup.

## Translations

- Every new string goes in the fork catalogues: web `fluxer_app/src/features/i18n/fork_locales/`
  (`node scripts/fork-i18n.mjs sync`, then translate, `check --upstream upstream/main`,
  `lingui:compile`, `scripts/fork-string-lint.mjs`), phone `l10n_fork/fork_*.arb`
  (`tool/fork_l10n.sh`, `tool/fork_string_lint.dart`). Keep the wording the same in both.
- Commands' names, descriptions and templates are community content and are not translated.
- Starter templates, if ever added, would be shipped text and need translating; not planned.

## Hooks into upstream files

Everything else is in fork-owned files.

**tyne (server):**

- `MessageRequestService.ts`, `MessageSendService.ts`: the `fork?` parameter and the hook line.
- `MessageEditService.ts`: one line before the update dispatch.
- `MessageResponseDataService.ts`: one call inside `hydratePersonas`.
- `packages/constants/src/ChannelConstants.ts`: three fork permission bits at the end of
  `Permissions`, and Use external commands in `DEFAULT_PERMISSIONS`.
- `MessageDeletionRepository.ts`, `GuildOperationsService.ts`: clean-up lines (if adopted).
- `MessageResponseSchemas.ts`: the `command` field, beside `subprofile`.
- `constants/Gateway.ts`, `event_atoms.erl`, `session_passive.erl`: the event.
- The registries already shared with the signal bar: `ForkControllerRegistry.ts`, `ForkTables.ts`,
  `ServiceMiddleware.ts`, `HonoEnv.ts`, `UserRateLimitConfig.ts`, `ApiErrorCodes.ts`,
  `ErrorCodeMappings.ts`, `pnpm-workspace.yaml`, `fluxer_api/package.json`.

**tyne (web):**

- `useLexicalAutocomplete.ts`, `LexicalMessageCommand.ts`, `CommandUtils.ts`,
  `useTextareaSubmit.ts`: list, resolution (including typed and pasted commands), execution, one
  run at a time.
- `slashSlotValidation.ts`, `SlashSlotPersistence.ts`: persona mentions in user slots, if that route
  is taken.
- `UserMessage.tsx`, `CompactMessageLayout.tsx`, `MessageGroupingUtils.ts`, `MessagingMessage.ts`:
  the message.
- `GuildSettingsConstants.ts`, `GuildSettingsTabComponents.ts`, `ForkEventRouter.ts`,
  `ForkEndpoints.ts`, `GatewayReady.ts`: settings and wiring.

**tyne-mobile:**

- `composer_autocomplete_field_state.dart`, `channel_textarea.dart`: list and send.
- `slash_slot_validation.dart`, `composer_slash_session.dart`: persona mentions in user slots.
- `message_item.dart`, `message_grouping_utils.dart`, `message.dart`, `messages.dart` (Drift):
  the message.
- `fork_schema.dart`: the columns.
- `gateway_event_handler.dart`, `gateway_provider.dart`: the event.
- The settings files above.

Under the root guide's rules: fork imports in their own block, fork tests in fork-owned files, fork
enum values last, and every one-line hook naming the fork function it calls.

## Tests

- **Server** (`fluxer_api/src/api/guild_command/tests/`, `createApiTestHarness`):
  - routes and permissions (own versus anyone's);
  - name rules and built-in names;
  - the 100 cap;
  - running: persona ownership (the runner's and the target's), slowmode, timeouts, mention
    rights, length, input bounds;
  - the use row, `command` on `MESSAGE_CREATE`, lists and gets;
  - an edit clearing it; a repeated nonce;
  - the event, spied on `NoopGatewayService.prototype.dispatchGuild`;
  - where commands run: own community, another community with and without Use external
    commands, a DM with someone who shares no community, a non-member refused;
  - the all-communities list route: one request, only communities the caller is a member of;
  - the hydration query count: none for channels where no command was used;
  - (phase 3) increments only for a new use row, never for a refused run or a repeated nonce, on
    both the Postgres path and the in-memory fallback.
- **Engine:**
  - removed tags are parse errors; `templates: {}` blocks file lookups;
  - the doubling attack hits `memoryLimit`; `renderLimit` fires;
  - classification (basic or script);
  - the `Drop`s: `{{ person }}`, `{{ person.name }}`, `{% if person == target %}`, and
    `{% if target %}` with no mention;
  - escaping of names;
  - `random`, `one_of`, `plural`, `ordinal`;
  - error mapping.
- **Schema package:** the new shapes.
- **Gateway:** the passive-filter clause in `fork_session_passive_tests.erl`.
- **Web:**
  - grouping (`MessageGroupingUtils` fork test) and the model's `withUpdates`;
  - the store's request sharing and failure cooldown;
  - command resolution: picked from the menu, typed, pasted, before the list loads;
  - the string input's wire text with mentions and custom emoji;
  - a double Enter sending once;
  - the chip's empty-box rule;
  - the settings tab, and the updated signal bar tab test.
- **Phone:**
  - `message_grouping_utils_fork_test.dart`, `fork_schema_test.dart`, the SDK round trip;
  - the provider with the recording adapter;
  - the send interception, a double tap sending once, attachments and reply left in place;
  - gateway handling (model: `test/core/gateway/gateway_event_handler_missing_events_fork_test.dart`).
- **End to end:** a web spec in `e2e/web/desktop/` that creates `/tuck`, runs it and checks the chip.
- **Before committing:** `CHECKS.md`, and the mobile checks in tyne-mobile's `AGENTS.md`.

## Phases

1. **Basic commands** (tyne-chat/tyne#269), enough for the Temple:
   - the three permission bits on every side, the phone's mask covering every bit, and the
     defaults;
   - tables, routes (the all-communities list included), event, run flow, `command` on messages;
   - the settings tab with the basic editor, on web and phones;
   - the composer on both, with the precedence rules, other communities' channels and DMs, and the
     stale-list handling;
   - chip, grouping and chip click;
   - personas, and mentions in the input;
   - at release, the one-off task turning on Use external commands for existing @everyone roles.

   Templates must be basic, but go through the Liquid engine from the start.
2. **Scripts** (tyne-chat/tyne#270):
   - the web script editor and the preview route;
   - `random`, `one_of`, `plural`, `ordinal`, conditions and `assign`;
   - phones show scripts read-only.
3. **Counters** (tyne-chat/tyne#271):
   - the person input type;
   - counter definitions in the command editor;
   - increments in the send hook, once per new use row;
   - "first time" through `== 1`.

**Order of work in each phase** (decided): the server first, then the Dart SDK regenerated from its
spec, then the web app, then the phone app, each checked on chat-dev before Chiara tests. That is
also the root guide's order for schema changes (tyne, then the SDK, then tyne-mobile). Commits,
deploys, the APK and the one-off production task each need Chiara's approval.

## Open questions

- **Remaining limits:** 4,000-character templates and 5 counters per command?
- **Replies, later:** a command could be sent as a reply to the message in the reply bar (the send
  path takes `message_reference`). Phase 1 leaves the bar alone.
- **The phone's mask:** confirm that no code sends `allPermissions` to the server before widening
  it.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| A bot (Arcane-style) using upstream's bot API | No slash commands for bots, so the trigger message shows; no personas; another service to run |
| Discord-style application commands | Large, and upstream may build its own; ours would then have to give way |
| Filling templates in the client | Simpler, but the chip could be put on any text, counters cannot be trusted, and the logic would be written twice (TypeScript and Dart) |
| Copying Arcane's tag syntax | Improvised and hard to read; we would write and keep its parser |
| ICU MessageFormat alone | Good plurals, no random choice or real logic, hard for non-programmers; its compiler generates JavaScript per template |
| Sandboxed JavaScript (QuickJS in WebAssembly) | A full language: more to secure, harder to write; possible later for things Liquid cannot do (games with state) |
| Lua or Luau | A third language in the stack, less familiar to Discord users |
| A "used /tuck" line above the message, a marker at the end, or nothing visible | Compared on the mockups; the chip after the timestamp was chosen |
| Commands only in their own community's channels | DMs are where much RP happens; emoji already work everywhere, and commands follow them |
| Community commands in DMs only with people who share that community | Ambiguous with several shared communities, and emoji have no such rule |
| Personal commands (each account's own list, usable anywhere) | A good later addition; not needed once community commands work in DMs |
| Copying emoji's name-conflict rules | They differ between web and phone today (current community first versus oldest anywhere); commands get one rule on both |
| Upstream's expression permissions for commands | Chiara wants commands and emoji managed separately; three fork bits are cheap |
| Counters shared between commands ("affection" for `/hug` and `/pat`) | No use case yet; each command owns its counters, and sharing can come later |
| A fork message flag marking command messages, to skip the per-read lookup | Needs another hook in upstream's send path (`calculateMessageFlags` keeps only `SENDABLE_MESSAGE_FLAGS`); the per-channel marker is enough for now |
| One list request per community | Dozens of requests at once for someone in many communities, near the limit that signs a session out |
| Converting Arcane syntax (`{member.mention}`, `{args}`) on paste | Commands come from many bots; favouring one is not worth it |
| Refetching the list as soon as `GUILD_COMMANDS_UPDATE` arrives | One edit in a large community would set off thousands of requests at once; marking stale and fetching on next use spreads them |
