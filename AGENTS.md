# Tyne: guide for agents and contributors

Tyne is a fork of [Fluxer](https://github.com/fluxerapp/fluxer): a chat app with its own server, web
app and desktop app. This file is the shared guide for coding agents (Claude Code, Antigravity and
others) and for people working in this repository. It describes the code and the rules for changing
it. The maintainers keep machine-specific instructions (their dev stack, deploys, releases, approval
rules) outside the repository.

If you change something this file describes, update it in the same commit. Do not add a `CLAUDE.md`
or `GEMINI.md` to the repository: both tools read this file. **Before every commit, read and run
`CHECKS.md`** ("Before committing", at the end).

## Repositories and branches

- This repository, `tyne-chat/tyne`, works on branch `tyne`. It is rebased every night onto upstream
  `fluxerapp/fluxer` `main` (remote `upstream`); the branch `automation` carries the rebase
  workflows.
- The mobile client is [tyne-chat/tyne-mobile](https://github.com/tyne-chat/tyne-mobile) (Flutter),
  with the generated Dart SDK [tyne-chat/tyne-dart-sdk](https://github.com/tyne-chat/tyne-dart-sdk)
  as its `dart_sdk` submodule. Each has its own `AGENTS.md`.
- Issues for all three live on `tyne-chat/tyne` (see "Issues").

## Map

- `fluxer_api/`: HTTP API and background worker, Node and TypeScript with Hono
  (`src/AppEntrypoint.ts`, `src/WorkerEntrypoint.ts`).
- `fluxer_app/`: web client, React with MobX, built with Rspack. The desktop app ships its own build
  of it.
- `fluxer_desktop/`: desktop app, with native Rust workspaces under `native/`.
- `fluxer_gateway/`: gateway that holds the clients' WebSocket connections, in Gleam on Erlang/OTP
  with Rust NIFs.
- `fluxer_messages/`: Rust service, reached over NATS, that builds message objects for responses and
  events from the stored rows and extracts mentions. The API writes messages and dispatches the
  events.
- `fluxer_admin/`, `fluxer_app_proxy/`, `fluxer_media_proxy/` and the other `fluxer_*` folders:
  further services, mostly Rust.
- `packages/schema/`: Zod schemas (the source of the OpenAPI spec) and protobuf definitions.
- `e2e/`: Playwright end-to-end suite that runs against a stack of its own.
- `.github/README.md`: what Tyne adds to Fluxer, for users.

## Architecture and folder guides

`ARCHITECTURE.md` describes how the components fit together, the main flows and where the fork's
features sit, and lists the folders that have an `AGENTS.md` of their own. Read it before a change
that crosses folders, and read a folder's `AGENTS.md` before changing code under it: some tools load
it only when they open a file there, others never do. Keep both up to date as you would this file.

## Personas

The fork's largest feature: several identities under one account, for plural systems and anyone who
writes as more than one person. The code calls them personas; the object embedded in a message is
called `subprofile`. A message or reaction stores only the persona's id, and the API builds
`subprofile` from the current persona whenever it returns or dispatches the message. The server side
is `fluxer_api/src/api/persona/`, the web side `fluxer_app/src/features/persona/`; each has an
`AGENTS.md` with its design and traps.

Data: fork-only data lives in fork-owned tables next to `Personas`, never in new columns on
upstream's tables. The one deliberate exception is the persona of a message or reaction:
`persona_id` and `mention_personas` on `messages`, and `persona_id` in `message_reactions`' key. A
message or reaction comes from a persona, so the row is not a full description without it.

## Keep fork changes out of upstream's way

`tyne` is rebased onto `upstream` every night. Before editing an upstream-owned file, state in
one line where the change goes and why it cannot live in a fork-owned file or an appended block.

**Prefer, in order:** (1) a new fork-owned file; (2) a block appended at the end under a fork
comment; (3) one small hook/call in upstream's code handing over to fork code elsewhere. Rewriting
or reordering upstream lines is last resort.

Mechanical rules (enforced where possible by the placement/safety lints):

- **Tests:** fork tests go in fork-owned files next to upstream's (`ReactionStateMachinePersona.test.ts`,
  `ForkEnvironmentOverrides.test.ts`, `fork_reaction_persona_test.gleam`,
  `tests/fork_binary_envelope.rs`); never add tests or assertions to upstream test files. Necessary
  compile fixtures, `vi.mock`s (`fluxer_api/AGENTS.md`), or maintainer-approved host/behaviour
  expectation changes carry `// Fork: <why>`.
- **Imports (TS, Rust, Gleam):** leave upstream imports untouched; put fork imports below after a
  blank line and `// Fork imports.`. Remove upstream names only when fork changes leave them unused
  and the compiler fails (`TS6133`, Rust/Gleam warnings). In Gleam, use already-imported upstream
  modules qualified (`module.name`), never duplicate imports (`fluxer_gateway/AGENTS.md`).
- **Formatting (Biome):** place fork code so `pnpm exec biome check --write --linter-enabled=false <file>`
  moves only fork lines (no wrapping upstream components in `observer()`/providers — rename/wrap
  or swap one call; no lengthening upstream one-line signatures past the line limit — use `...fork`;
  no comments inside upstream expressions; add fork behaviour as a separate statement).
- **Lists and objects:** fork entries go first in upstream lists, objects and argument lists (spread
  a fork list where order shows/matters).
- **Numbers upstream hands out:** never take upstream's next sequential/positional value or insert
  into the middle. Use names where supported; otherwise declare a fork range in a `// Fork:` block:
  protobuf fields `>= 2200` in `// Fork fields.` at message top (`accessibility.proto`); 1-byte
  tags counting down from `255` (`packages/markdown_parser/rust/src/binary.rs`); flag bits from the
  middle (`ForkFlagBits.test.ts`); enum values last after `// Fork values.` (never stored/sent by
  position); no fork schema versions; no fork columns in upstream primary keys (`persona_id` stays
  7th in `message_reactions`, `MessageReactionsPersonaKey.test.ts`). Shipped numbers are permanent
  and retired ones stay reserved (`tyne-chat/tyne#125`).
- **Suppressions:** every fork `@ts-expect-error`, `eslint-disable`, `biome-ignore`, `*-ignore:` or
  `px-ok:` explains why on its line or the line above; reviewed upstream `--all` findings live in
  `fluxer_app/scripts/fork-lint-reviewed.json` (`--check-reviewed`), never inline in untouched
  upstream files.
- **Strings, generated files, data:** fork catalogues only ("Translations"); never hand-edit
  generated files ("Generated code"); fork-only data in fork tables next to `Personas` ("Personas").

When upstream ships its own version: if identical or a clear superset, take upstream's, delete ours
and say so; if taking upstream's changes user-visible behaviour, stop and ask a maintainer
(keeping ours working meanwhile if small). Also check whether a partially folded fork commit left
unneeded code behind (`tyne-chat/tyne#114`).

During conflicts, resolve towards this placement and list any moves. Keep each spot in few commits:
fix earlier fork commits with `git commit --fixup=<commit>` (never `--autosquash`: verify every
intermediate commit still builds, `tyne-chat/tyne#220`), undo edits in the commit that made them,
and keep all `fluxer_docs/` changes in `docs: Tyne's additions to the API documentation`. Do not
over-architect: prefer a plain edit over an unasked plugin layer, and ask before adding real
architecture. Because the nightly rebase agent does not read this file, keep its placement prompt in
sync when changing these rules.

## Generated code

Never edit generated code by hand; change its source and regenerate. A file that says `GENERATED
CODE - DO NOT MODIFY BY HAND` or `@generated`, or is listed here, is rewritten from scratch by a
tool: a hand edit compiles today and silently disappears at the next regeneration or rebase, even
when it is "just one field". Check the first lines of a file before editing it. If you cannot tell
what a generated file's input is, stop and ask.

- **OpenAPI specs** (`fluxer_api/src/api/openapi/openapi.json`, `fluxer_admin/openapi-admin.json`):
  output of `pnpm openapi:generate`; never edit or hand-merge the JSON. Request and response schemas
  must be exported from `packages/schema/src/domains` (a schema declared inside a controller makes
  generation fail), and new OAuth scopes are declared in
  `packages/openapi/src/generator/OpenAPIGeneratorCatalog.ts`. After `pnpm openapi:generate`,
  `git status` must be clean.
- **Protobuf** (`packages/schema/src/gen/`): `pnpm --filter @fluxer/schema generate`.
- **Web sources from `fluxer_app/scripts/`**: a header `Generated by scripts/<name>.ts` (such as
  `ThemeVariableManifest.ts`) names the script; run it through `fluxer_app`'s `generate:*` scripts.
- **Compiled Lingui catalogues:** see "Translations".
- **The Dart SDK** in tyne-mobile is generated from this repository's OpenAPI spec. To add or change
  a field, model, endpoint or parameter the mobile app uses, change the Zod schema
  (`packages/schema/src/domains/...`) or the route's `OpenAPI({...})` metadata, run
  `pnpm openapi:generate`, then regenerate the SDK (tyne-dart-sdk's `AGENTS.md`) and adapt the app.
  Commit and push in that order: this repository, then the SDK, then tyne-mobile.
- In a merge or rebase conflict on a generated file, do not merge the two sides: take upstream's
  version and regenerate.

## Translations

Every user-facing string (toasts, placeholders and error fallbacks included) belongs in `msg`,
`<Trans>` or `i18n._` and in the fork catalogues; never edit `fluxer_app/src/features/i18n/locales/*/messages.po`
or run `lingui:extract`, `i18n:auto` or `i18n:refresh`.

- In `fluxer_app/`, run `node scripts/fork-i18n.mjs sync`, translate every empty `msgstr` in
  `src/features/i18n/fork_locales/*/messages.po` (`reviewed-unchanged.json`, `GLOSSARY.md`,
  `fork_locales/README.md`, matching mobile wording), and run `pnpm --filter fluxer_app lingui:compile`
  (needed manually for dev-server reloads).
- `node scripts/fork-i18n.mjs check --upstream upstream/main` and
  `node scripts/fork-lint.mjs --linter string --upstream upstream/main` must pass (literal exceptions
  need `// i18n-ignore: <reason>`; also inspect cross-file string variables manually).

## Sizes in the web app

Use `rem` (16px = 1rem, `remFromPx(n)`, `var(--radius-full)`), not `px`, which ignores desktop zoom
(`tyne-chat/tyne#636`). Enforced by `fork-lint.mjs` (`--linter px`); upstream `px` exceptions are
in `CHECKS.md`.

## Network calls: count the requests

Upstream's API allows 50 req/s per user across devices (`getGlobalRateLimit` in
`RateLimitMiddleware.ts`; 1,200 with `HIGH_GLOBAL_RATE_LIMIT`; `exemptFromGlobal` excluded). Global
429s fail all app requests; the dev stack disables them (`FLUXER_DISABLE_RATE_LIMITS`), so count
requests in tests. Before adding a network call inside per-item/loop/render/build/shared-store code
(`fork-lint.mjs --linter render-fetch` also checks render/effect fetches), state in the change description:

1. Max requests for one user action (~200 channels / hundreds of messages; share overlapping calls).
2. Failure handling (`429`/`401`/offline): wait/cool down or give up until state changes — never retry per render.
3. Whether `READY`, gateway events or another fetch already brings the data.

Add a request-counting test covering missing data and failing requests (`tyne-chat/tyne#114`).

## Reviews and fixes

- **Follow callers, not only diffs:** for any network call, loop or per-render trigger, state max
  requests per action and failure behaviour (including error non-looping).
- **Turn bug classes into AST lint rules, as routine as regression tests.** When fixing a bug,
  reviewing a failure or auditing code, check if the bug class has an AST-detectable shape (or
  propose one on the issue). Add or tighten a pass in the unified single-parse pipeline
  (`fluxer_app/scripts/fork-lint.mjs` + `scripts/fork-lint/`; mobile `tool/fork_lint.dart` +
  `tool/fork_lint/`) reusing its shared IRs: verify it fires on the real unfixed code
  (`git show <fix>^:<file>` for past bugs) and clears with the fix, add positive and negative unit
  tests, sweep `--all` (proving real siblings with failing-first regression tests, recording verified
  upstream semantic exceptions by AST symbol in `fork-lint-reviewed.json` with `--check-reviewed`,
  and tightening precision when suppressions share a safe structural pattern), and condense any
  prose rule it replaces here to one line.
- **Verify facts before hardening or reporting:** separate a confirmed fix from unverified extra
  fallbacks, label unverified theories explicitly, never blame the environment before reproducing
  through the failing wrapper/orchestrator (`tyne-chat/tyne#194`), and for user-specific bugs
  compare stored account/server settings and roles before reading more code (`tyne-chat/tyne#193`).

## Issues

- One board: every issue lives on `tyne-chat/tyne`, whichever repository the work is in. Issues are
  switched off on the other repositories.
- Except security vulnerabilities: never put one in an issue, a comment or anything else public
  here. Report it as `.github/SECURITY.md` says.
- Find or open the issue before starting. Search open and closed issues first
  (`gh issue list --repo tyne-chat/tyne --state all --search "<words>"`). Otherwise open one: `bug`,
  `enhancement`, or `task` (the Task form) for tooling, docs, refactors and audit follow-ups, with
  the `priority:*` (`docs/issue-priorities.md`) and `platform:*` labels that apply. Skip this only
  for a change too small to be worth a line in the history.
- Start a bug's title with `[Upstream]` when upstream has it too (its code, changed by the fork or
  not, or a dependency at its version); not for fork-only or setup bugs. Look for its fix first.
- Write the investigation on the issue as you go, not only in chat: the cause with file and line,
  how you know (what you ran, what you only read), whether it is upstream's behaviour or the fork's,
  the options and the choice. A theory is labelled as one.
- Write the resolution when the work lands: commits, what changed for users, tests added, checks
  actually run, who verified it and where, and what is still needed before users have it (a deploy,
  an APK, a desktop release). Then close it. `Fixes #N` in a commit closes the issue when pushed to
  `tyne`; from another repository write `Fixes tyne-chat/tyne#N`. The closing comment is still
  needed.
- Work that stops part-way gets a comment saying where it stands and what it waits for; leave it
  open. Other problems found on the way get issues of their own, linked.

## Development environment

The dev stack runs in the dev container defined in `.devcontainer/` (compose service `workspace`,
repository mounted at `/workspaces/fluxer`, user `vscode`); the dev orchestrator `fluxer-dev` runs in
it. Frontend changes are hot-reloaded by Rspack, the API and worker by `tsx watch`, and the admin
service by `cargo-watch`. Changes to other Rust services need `cargo build` and a restart of the
orchestrator; gateway (Gleam) changes need the restart, which builds them (`scripts/gleam.sh build`;
the dev container needs Gleam 1.19.2).

Mobile layout follows the device, not the window (`ARCHITECTURE.md`).

Do not run the web production build (`pnpm --filter fluxer_app build`) in the dev container. It shares
`fluxer_app/dist` with the running dev server, which rewrites `dist/version.json` after every
compile (upstream's `VersionJsonPlugin`), so the build's `rm -rf dist` fails now and then, and a build
that succeeds leaves production files where the dev server serves from. Build the `app-proxy` image
instead (`CHECKS.md`): it runs the same `pnpm build` from a clean copy, and it is what the E2E run and
deploys use.

## Before committing

**Read `CHECKS.md` before every commit and run what it lists for the change.** No tool loads that
file by itself. In short: run the checks once the change is done; the web typecheck always; the whole
list for a change that touches personas, messaging or schemas. The nightly rebase runs the same
checks and stops on a failure, so a commit that skips them can block it.
