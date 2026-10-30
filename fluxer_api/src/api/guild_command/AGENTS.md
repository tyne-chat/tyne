# Server commands on the server

Per-community slash commands (`/tuck`): a community's members define them, and running one fills in
its Liquid template here and posts an ordinary message from the member and their current persona,
which then carries a `command` field. This folder is the fork's. The design, the decisions and the
client side are in `docs/design/server-commands.md`; this guide is what the code does today (phases 1
and 2, tyne-chat/tyne#269 and #270: basic templates and scripts; counters are phase 3).

## Where things are

| Concern | File |
|---|---|
| Routes, buckets | `GuildCommandController.ts`; buckets `GUILD_COMMANDS_*` at the end of `rate_limit_configs/UserRateLimitConfig.ts` |
| Rules, the run flow, the event | `GuildCommandService.ts` |
| The Liquid engine, escaping, basic or script | `GuildCommandTemplateEngine.ts` |
| Tables | `database/types/GuildCommandTypes.ts`, declared in `ForkTables.ts`; access in `GuildCommandRepository.ts` |
| `command` on messages: the send hook, the read lookup, edits | `GuildCommandUses.ts` |
| Turning Use External Commands on for existing @everyone roles, once | `UseExternalCommandsBackfill.ts`, worker task `backfillUseExternalCommands` |
| Shapes and limits | `packages/schema/src/domains/guild_command/` |
| Error codes | `packages/constants/src/ForkApiErrorCodes.ts`, `packages/errors/src/i18n/ForkErrorCodeMappings.ts` |
| Public docs | `fluxer_docs` `http-api/guild-commands.mdx`, `gateway/events.md`, `http-api/permissions.mdx` |
| Script reference for LLMs and people | `docs/server-command-scripts.md`; keep it true when a tag, filter, variable or limit changes |

## Rules

- **Permissions** (fork bits, `packages/constants/src/ChannelConstants.ts`): `CREATE_COMMANDS` (62)
  creates and edits one's own, `MANAGE_COMMANDS` (61) edits anyone's, `USE_EXTERNAL_COMMANDS` (59)
  runs another community's commands in a channel. Bit 60 is skipped because upstream's tests use it
  as an unknown bit.
- **Where a command runs:** its community's members only (404 for anyone else, so commands are not
  probed), in that community, in another community's channel with `USE_EXTERNAL_COMMANDS`, and in
  DMs. Everything else is the send path's: `MessageRequestService.sendMessage` applies the tier gate
  and every check of `MessageSendService.sendMessage`.
- **Names:** `^[a-z0-9_-]{1,32}$` (the web composer's draft persistence accepts nothing else), not a
  client built-in (`RESERVED_GUILD_COMMAND_NAMES`), unique per community (checked against the
  partition, so two simultaneous creates can both pass). At most 500 per community.
- **Templates:** anyone who creates a community can write them, and they render on the API's main
  thread, so the engine is locked down: tags and filters are allowlists in the schema package (the
  editors suggest from the same lists), there are no loops, `templates: {}` so nothing reads files,
  `strictFilters`, and liquidjs's `parseLimit`, `renderLimit` (checked between nodes) and `memoryLimit`.
  A new tag or filter must count what it allocates, as `CountedCaptureTag` and `random` do. Variables are `Drop`s: they print as mentions, compare by mention, and
  give escaped `.name`s. `classifyGuildCommandTemplate` (schema package) says `basic` or `script`.
- **Problems:** `describeTemplateProblem` turns liquidjs's English errors into an issue (code, name,
  line, column) by their wording, which the engine's tests pin. A failed save sends it as
  `template_issue`; the preview route returns it with a 200; someone running a broken command gets
  `GuildCommandBrokenError`, with no details.
- **`command` on messages:** the send hook writes `guild_command_uses` (and a per-channel marker)
  after the message is stored and before `MESSAGE_CREATE`; `hydratePersonas` looks it up, one query
  per channel, and only in channels whose marker exists (cached for 10 s when absent). An edit that
  changes the content deletes the use.
- **`GUILD_COMMANDS_UPDATE`** (`{guild_id}`) goes to every session, passive ones too. Clients mark the
  community stale and fetch it on next use, never on the event itself.

## Hooks into upstream files

`MessageRequestService.ts` and `MessageSendService.ts` (a `fork` parameter and one hook line),
`MessageResponseDataService.ts` (one call in `hydratePersonas`), `MessageEditService.ts` (one line),
`constants/Gateway.ts`, `ChannelConstants.ts` (the bits, `DEFAULT_PERMISSIONS`,
`ElevatedPermissions`), `MessageResponseSchemas.ts` (the field), the worker's registry, lanes and
cron, and in the gateway `event_atoms.erl` and `session_passive.erl`. The shared registries
(`ForkControllerRegistry.ts`, `ForkTables.ts`, `ServiceMiddleware.ts`, `HonoEnv.ts`,
`ForkServiceSingletons.ts`) take one entry each.

## Tests

`tests/GuildCommands.test.ts` (routes, permissions, running in another community and a DM,
personas, input, the backfill), `tests/GuildCommandUses.test.ts` (query counts, edits),
`tests/GuildCommandTemplateEngine.test.ts` (the engine's limits and semantics), and
`fluxer_gateway/test/fork_session_passive_tests.erl`. After a change:
`pnpm --filter fluxer_api test src/api/guild_command`, then `CHECKS.md`.
