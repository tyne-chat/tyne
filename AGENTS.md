# Tyne: guide for agents and contributors

Tyne is a fork of [Fluxer](https://github.com/fluxerapp/fluxer): a chat app with its own server, web
app and desktop app. This file is the shared guide for coding agents (Claude Code, Antigravity and
others) and for people working in this repository. It describes the code and the rules for changing
it. The maintainers keep machine-specific instructions (their dev stack, deploys, releases, approval
rules) outside the repository.

If you change something this file describes, update it in the same commit. Do not add a `CLAUDE.md`
or `GEMINI.md` to the repository: both tools read this file.

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
- `fluxer_gateway/`: Erlang/OTP gateway that holds the clients' WebSocket connections.
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

The fork is rebased onto upstream every night, and upstream moves fast: it renames, prunes and
restructures whole areas in a day. Every fork line that sits inside an upstream line is a conflict
waiting for that day. Before editing a file upstream owns, find where the change can live so that
upstream can rewrite its side without touching ours, and say in one line where it is going and why
it cannot be a fork-owned file or an appended block.

**Prefer, in this order:** (1) a new fork-owned file; (2) a block appended to the end of an upstream
file, under a comment saying it is the fork's; (3) one small call or one added line in upstream's
code that hands over to fork code elsewhere. Rewriting or reordering upstream's own lines is the
last resort.

Rules with a mechanical answer; follow them every time:

- **Tests** go in a fork-owned file next to upstream's (`ReactionStateMachinePersona.test.ts`,
  `ForkEnvironmentOverrides.test.ts`, `fork_session_passive_tests.erl`,
  `tests/fork_binary_envelope.rs`). Never add a test or an assertion to an upstream test file. The
  exception is what upstream's own tests need to run against the fork's code: a fixture line for a
  fork type, or a `vi.mock` of a fork module that upstream's code now imports (a mock applies only
  to its own file), under a `// Fork:` comment saying why.
- **Upstream test expectations** that hard-code upstream's hosts, or upstream's behaviour where the
  fork deliberately differs, may be changed in place with a `// Fork:` comment saying why, after
  asking a maintainer. Everything else in the test stays as upstream has it.
- **Imports (TypeScript):** leave upstream's import statements exactly as upstream writes them. Fork
  imports go below them: a blank line, `// Fork imports.`, a blank line, then the imports. A name we
  need from a module upstream already imports gets its own line there. The one exception: an
  upstream import the fork's changes leave unused is a compiler error (TS6133, `noUnusedLocals`),
  so remove that name from upstream's statement.
- **Imports (Rust):** a name the fork needs goes in its own `use` in a `// Fork imports.` group
  below upstream's, never into upstream's `use` list.
- **Formatting:** upstream formats every file (Biome) and so does the fork's check, upstream's files
  included. Place fork code so the formatter leaves upstream's lines alone: do not wrap upstream's
  code in an `observer()`, a provider or a new component (rename upstream's component and export the
  wrapped one, or put a small fork component in the place of one upstream call); do not lengthen
  upstream's one-line signature past the line limit (collect the fork's parameters in a `...fork`
  rest parameter); no comments inside upstream's expressions; add fork behaviour as a separate
  statement. To format an upstream file, run
  `pnpm exec biome check --write --linter-enabled=false <file>` and check that only fork lines moved.
- **Numbers upstream hands out:** where upstream numbers things in sequence or by position (protobuf
  fields, schema and migration versions, enum values and binary tags, bit flags, opcodes, numeric
  error codes, the column order of a table's key), the fork never takes the next free value and
  never inserts into the middle: the day upstream takes that number, the two collide, often
  silently. Use a name where the format allows one. Otherwise take the value from a fork range,
  declared in a `// Fork:` block that says so: protobuf fields from 2200 up, in the `// Fork fields.`
  block at the top of the message (`accessibility.proto` has one); one-byte tags counting down from
  255 (the persona mention in `packages/markdown_parser/rust/src/binary.rs`); flag bits from the
  top; schema versions not at all. Fork values in an upstream enum go last, after a blank line and
  `// Fork values.`, and an enum is never stored or sent by its position. A fork column never joins
  an upstream table's key; the one exception, `persona_id` in `message_reactions`' key, stays the 7th
  column for good (`MessageReactionsPersonaKey.test.ts`). A shipped number is permanent: moving it
  needs a migration and a window in which old and new builds both work, and a number given up stays
  reserved. (On 2026-10-16 upstream's protobuf field 65 collided with the fork's, and the fork's
  fields had to move to 2223–2226 with 8 production users already holding values.)
- **Strings:** fork catalogues only (see "Translations").
- **Generated files:** never edited by hand (see "Generated code").
- **Data:** fork-owned tables next to `Personas` (the one exception, a message's or reaction's
  persona, is under "Personas").

When upstream ships its own version of something the fork did, the behaviour decides which to keep:

- Same behaviour, or plainly a superset of ours: take upstream's, delete ours, and say so. Two
  answers to one problem is the most expensive kind of conflict.
- Taking upstream's would change what people see or lose something ours does (timing, defaults, a
  case it does not cover): that is a maintainer's decision. Stop and ask, describing both
  behaviours; the nightly pipeline escalates instead. Keep the fork's behaviour working meanwhile if
  that needs no large rewrite. (On 2026-10-10 upstream's AFK timeout handling was taken over the
  fork's without asking; that should have been a question.)
- Look at the whole fork commit, not only the part upstream replaced. When upstream makes a change
  the fork already carries, git folds the fork's copy into upstream's without a conflict and the
  rest of the commit stays behind unnoticed. After each nightly rebase a check opens a `task` issue
  listing fork commits that were dropped, lost a file, or lost at least half their changed lines;
  for each, decide whether the rest is still needed and drop it if not. (On 2026-10-01 a rebase
  folded a fork fix into upstream's #898; the commit's leftover member-fetch fallback signed a user
  out over and over until 2026-10-17, tyne-chat/tyne#114.)

Before proposing a commit, check where its tests and imports went. During a rebase conflict, resolve
towards this shape, not just towards "compiles": if fork lines sit inside upstream's, move them out
as part of the resolution and list those moves in the summary.

Do not go overboard. This is about where a change goes, not about plug-in layers upstream does not
have. If keeping something separate needs more than a small hook, or makes the code harder to follow
than a plain edit, make the plain edit; if it would take real architecture, ask a maintainer first.
A few honest conflicts a month are cheaper than an architecture nobody asked for.

Why this is written down: on 2026-10-10 one day of upstream work (dead code removed across 1,391
files, interfaces collapsed across 426) stopped the rebase about twenty times, and roughly a third of
the conflicted files were there only because of test and import placement. The nightly rebase agent
does not read this file; its prompt repeats these rules, so change both together.

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
- **Compiled Lingui catalogues:** see "Translations".
- **The Dart SDK** in tyne-mobile is generated from this repository's OpenAPI spec. To add or change
  a field, model, endpoint or parameter the mobile app uses, change the Zod schema
  (`packages/schema/src/domains/...`) or the route's `OpenAPI({...})` metadata, run
  `pnpm openapi:generate`, then regenerate the SDK (tyne-dart-sdk's `AGENTS.md`) and adapt the app.
  Commit and push in that order: this repository, then the SDK, then tyne-mobile.
- In a merge or rebase conflict on a generated file, do not merge the two sides: take upstream's
  version and regenerate.

## Translations

Every new user-facing string is translated into every supported language, and upstream's catalogues
are never edited: fork strings live in fork catalogues, so upstream's files stay byte-identical and
cannot conflict.

- Do not touch `fluxer_app/src/features/i18n/locales/*/messages.po`, and never commit the result of
  `pnpm --filter fluxer_app lingui:extract`.
- After adding or editing strings (`msg()` or `<Trans>`), run `node scripts/fork-i18n.mjs sync` in
  `fluxer_app`, then translate every empty `msgstr` in
  `src/features/i18n/fork_locales/*/messages.po`. No empty or raw English values in other locales;
  words that really are identical go in `fork_locales/reviewed-unchanged.json`. Details in
  `fork_locales/README.md`.
- `node scripts/fork-i18n.mjs check --upstream upstream/main` (in `fluxer_app`; with `--upstream` it
  also fails if upstream's catalogues were edited) and `pnpm --filter fluxer_app lingui:compile` must
  pass.
- The mobile app has its own fork catalogues; keep the wording aligned where a string exists in both.

## Network calls: count the requests

The server ends sessions over request floods. Upstream's API allows each user 50 requests per second
(a leaky bucket shared by all of the user's sessions; `getGlobalRateLimit` in
`fluxer_api/src/api/middleware/RateLimitMiddleware.ts`, 1,200 for accounts flagged
`HIGH_GLOBAL_RATE_LIMIT`). The request that goes over it does not just get a 429: the session that
sent it is revoked and the app returns to the login screen. A burst of requests is a sign-out, not a
performance issue.

Before adding a network call to code that runs once per channel, message, member or other list
item, inside a loop, from a component's render or a widget's `build`, or from a provider or store
many places watch, answer in the change's description:

1. How many requests does one user action (opening the app, opening a channel, scrolling) send, at
   the largest realistic size (about 200 channels in a server, hundreds of messages)? Calls that
   overlap must share one request.
2. What happens when the request fails (429, 401, offline)? A failure must not be retried on the
   next render or by the next caller: wait (a cooldown) or give up until something changes.
3. Is the call needed at all? Usually the data is already on its way (READY, a gateway event) or is
   fetched elsewhere.

Such a change needs a test that counts the requests, with the data missing and with the request
failing. (On 2026-09-28 a fork commit fetched the user's own member once per channel, unshared and
retried on every build; on a fast phone it sent 65 identical requests in half a second, and a user
was signed out again and again until 2026-10-17, tyne-chat/tyne#114. READY already brings the
member.)

## Reviews and fixes

- A review is never only of the diff's lines. For a new network call, loop or per-render trigger,
  follow its callers and say how many requests one user action sends and what happens when a request
  fails, even when asked to be brief ("one, and it gives up" is a fine answer). "No infinite loop"
  has to hold when the request fails, not only when it succeeds. (The fetch behind
  tyne-chat/tyne#114 passed a brief review that checked only the case where it succeeds.)
- Keep a confirmed fix apart from hardening against a cause nobody has shown. The fix goes in its own
  commit; extra fallbacks need evidence that their cause happens (a log line, a query, a repro).
- When a theory of a bug is not verified, say so when handing it on, so it is not implemented as
  fact.

## Issues

- One board: every issue lives on `tyne-chat/tyne`, whichever repository the work is in. Issues are
  switched off on the other repositories.
- Find or open the issue before starting. Search open and closed issues first
  (`gh issue list --repo tyne-chat/tyne --state all --search "<words>"`). Otherwise open one: `bug`,
  `enhancement`, or `task` (the Task form, with a priority) for tooling, docs, refactors and audit
  follow-ups; add the `priority:*` and `platform:*` labels that apply. Skip this only for a change
  too small to be worth a line in the history.
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
orchestrator.

Do not run the web production build (`pnpm --filter fluxer_app build`) in the dev container. It shares
`fluxer_app/dist` with the running dev server, which rewrites `dist/version.json` after every
compile (upstream's `VersionJsonPlugin`), so the build's `rm -rf dist` fails now and then, and a build
that succeeds leaves production files where the dev server serves from. Build the `app-proxy` image
instead (below): it runs the same `pnpm build` from a clean copy, and it is what the E2E run and
deploys use.

## Before committing

Run the checks only once the change is done, as the gate before committing, not during research or
planning. The web typecheck is always required; a change that touches personas, messaging or schemas
needs the whole list, which covers what the nightly rebase gate checks. Each block says where it
runs; the loops are in parentheses so a failure does not close an interactive shell.

In the dev container, from the repository root:

```bash
# Web typecheck: zero errors, including unused declarations (TS6133).
pnpm --filter fluxer_app typecheck:only
# Typecheck and tests of every other workspace package the fork changed.
(B=$(git merge-base upstream/main HEAD); for c in typecheck test; do pnpm -r --filter "[$B]" --filter "!fluxer" --filter "!fluxer_app" --filter "!fluxer_api" --filter "!fluxer_desktop" --if-present $c || exit 1; done)
# API, desktop and web tests and typechecks. A few API test files are known to fail or need the
# host's network (below); the maintainers keep those lists outside this repository.
pnpm --filter fluxer_api test
pnpm --filter fluxer_api typecheck
pnpm --filter fluxer_desktop typecheck && pnpm --filter fluxer_desktop test
pnpm --filter fluxer_app test
# Fork catalogues.
(cd fluxer_app && node scripts/fork-i18n.mjs check --upstream upstream/main) && pnpm --filter fluxer_app lingui:compile
# Upstream's lint job (Biome, ESLint with no warnings, data-flx attributes), plus Biome warnings on
# files the fork added, committed or not.
pnpm exec biome ci . && pnpm exec eslint . --max-warnings 0 && pnpm --filter fluxer_app theming:data-flx:check && pnpm exec biome ci --error-on-warnings --files-ignore-unknown=true --no-errors-on-unmatched $(git diff --name-only --no-renames --diff-filter=A $(git merge-base upstream/main HEAD)) $(git ls-files --others --exclude-standard)
# Rust formatting and Clippy.
cargo fmt --all -- --check && cargo fmt --manifest-path fluxer_app/rust/libfluxwebp/Cargo.toml -- --check && tools/ci/check-desktop-native-workspaces.sh fmt && cargo clippy --workspace --all-targets --all-features --locked -- -D warnings && tools/ci/check-desktop-native-workspaces.sh clippy
# cargo deny: licenses, bans and sources must pass; advisories are reported only.
# Needs `cargo install cargo-deny --version 0.20.2 --locked` once.
cargo deny --locked check -D warnings licenses bans sources && cargo deny --manifest-path fluxer_app/rust/libfluxwebp/Cargo.toml --config deny.toml --locked check licenses bans sources && (for m in fluxer_desktop/native/*/Cargo.toml; do cargo deny --manifest-path "$m" --all-features --locked check -D warnings -A unmatched-skip -A unnecessary-skip -D duplicate licenses bans sources || exit 1; done)
# Gateway, Knip, synced catalogues, API docs, and a check of the admin, messages and media-proxy
# crates.
(for s in gateway_fmt gateway_compile gateway_dialyzer gateway_eunit knip; do tools/ci/run.sh ci --step $s || exit 1; done)
pnpm i18n:compile && git diff --exit-code -- packages/errors/src/i18n/weblate fluxer_api/pkgs/email/src/email_i18n fluxer_api/src/api/content_i18n/weblate
pnpm --filter fluxer_docs verify && pnpm --filter fluxer_docs build
cargo check -p fluxer_admin -p fluxer-messages -p fluxer-media-proxy
```

On the host, from the repository root (these start containers of their own or need the host's
network; `<workspace>` is the dev container and `<workspace image>` its image):

```bash
# Rust tests: fluxer-svc's Postgres tests reach a container on the host's 127.0.0.1, and two app-proxy
# tests read FLUXER_* settings from the environment, which the dev container sets for the dev stack.
docker run --rm --network host --volumes-from <workspace> -u vscode -w /workspaces/fluxer <workspace image> cargo test --workspace --all-features --locked
# API tests that start their own Postgres on the host's 127.0.0.1 (only when a change touches the API's
# database code: src/api/database, a repository, the job ledger, instance config). Call vitest
# itself, never pnpm, in that container: pnpm there takes the shared node_modules for stale.
docker run --rm --network host --volumes-from <workspace> -u vscode -w /workspaces/fluxer/fluxer_api <workspace image> node_modules/.bin/vitest run <test files>
# Production build of the web app, in a container of its own.
docker compose -f e2e/docker-compose.e2e-build.yml build app-proxy
# Full E2E suite on an ephemeral stack (builds its own images; --skip-build reuses the last ones).
./e2e/scripts/ci-run.sh
```
