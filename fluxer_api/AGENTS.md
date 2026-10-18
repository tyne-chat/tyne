# The API and worker

`fluxer_api` is the TypeScript HTTP API (Hono) and the background worker, built into one image. It is
upstream's; the fork adds two domains of its own (`src/api/persona/`, `src/api/signal_bar/`) and
threads personas through upstream's, chiefly `channel` and `user`. This guide covers what every
change here meets: how a route is put together, where fork code hooks in, and how to test without
tripping over the shared test runtime. The domains with traps of their own have guides:
`src/api/persona/AGENTS.md`, `src/api/channel/AGENTS.md`, `src/api/signal_bar/AGENTS.md`. Paths below
are under `src/api/` unless they start with `src/`, `scripts/` or the repository's other folders.

## Where things are

| Concern | File |
|---|---|
| Processes | `src/AppEntrypoint.ts` → `src/App.ts` (`createAPIApp`); `src/WorkerEntrypoint.ts` → `worker/WorkerMain.ts` |
| Route registration | `app/ControllerRegistry.ts` (the fork's controllers in a block at the end) |
| Services per request (`ctx.get('personaService')`) | `middleware/ServiceMiddleware.ts`; shared repositories in `middleware/ServiceSingletons.ts` (`getPersonaRepository()`) |
| Configuration, logging | `Config.ts`, `Logger.ts` |
| Tables | `Tables.ts` (the fork's in a block at the end) |
| Request validation, response checks | `Validator.ts`; `middleware/ResponseTypeMiddleware.ts`; the schemas are in `packages/schema` (its `AGENTS.md`) |
| Rate-limit buckets | `rate_limit_configs/*RateLimitConfig.ts`, applied by `middleware/RateLimitMiddleware.ts` |
| Error codes and messages | `packages/constants/src/ApiErrorCodes.ts`, `packages/errors/src/i18n/ErrorCodeMappings.ts`; error classes per domain (`persona/errors/PersonaErrors.ts`) |
| Worker tasks and cron | `worker/tasks/`, `worker/WorkerTaskRegistry.ts`, `worker/WorkerLaneConfig.ts`, cron lines in `worker/WorkerMain.ts` |
| Test runtime | `test/Setup.ts`, `test/ApiTestHarness.ts`, `test/TestRequestBuilder.ts`, the fakes in `test/` and `test/mocks/`; `vitest.config.ts` |
| Bundle and image | `scripts/build.mjs`, `Dockerfile` |

## A route, end to end

A domain has controllers, services and repositories, with models that build responses
(`toResponse`). A route is a chain of middleware, in this order (`persona/PersonaController.ts`):

1. `RateLimitMiddleware(RateLimitConfigs.X)`: the route's bucket. Every bucket counts toward the
   user's global limit unless it is `exemptFromGlobal` (root `AGENTS.md`, "Network calls").
2. `requireOAuth2ScopeForBearer('scope')`, only if OAuth bearer tokens may call the route; without it
   they are refused. New scopes are declared in `OpenAPIGeneratorCatalog.ts` (root `AGENTS.md`).
3. `LoginRequired`, then `DefaultUserOnly` to refuse bots.
4. `Validator('json' | 'query' | 'param', Schema)` and `OpenAPI({responseSchema, …})`, with schemas
   exported from `packages/schema`, or the spec and the mobile app's SDK cannot be generated.
   Unless the environment is `production` (`Config.dev.validateResponses`), the response is parsed
   with `responseSchema` before it is sent, so a field the schema lacks vanishes in development but
   not in production (`packages/schema/AGENTS.md`, "How the API applies them").
5. The handler: `ctx.get('user')` and a service from `ctx.get(...)`.

**Where the fork's code hooks in:** a fork domain is its own folder; its controller goes in
`ControllerRegistry.ts`'s fork block, its service getter in `ServiceMiddleware.ts` (under
`// Fork imports.`), its tables in `Tables.ts`'s fork block (the signal bar's two are an exception,
declared in `SignalBarSettingsRepository.ts`), its buckets at the end of
`UserRateLimitConfig.ts`'s object. A fork error code is added to `ApiErrorCodes.ts` and mapped in
`ErrorCodeMappings.ts` to one of upstream's translated messages: fork codes have no messages of
their own yet, so pick the closest and list the code in `fluxer_docs` (`http-api/errors.md`).

## Configuration and logging

`Config` and `Logger` are proxies that throw until `initializeConfig` and `initializeLogger` run, and
the first call wins. The entry points call both; anything else that imports API modules (a script,
a test) must too, or import only modules that do not read them at load. Tests get both from
`test/Setup.ts`: the test configuration, and a `NoopLogger` whose `child()` returns itself.

## Building

`scripts/build.mjs` bundles `@app/`, `@pkgs/` and `@fluxer/` imports with esbuild and leaves every
other package external, so a package must be a declared dependency of `fluxer_api` itself, even
when only a `pkgs/*` package imports it; otherwise the build stops ("The bundle imports packages
that fluxer_api does not declare"), and with it the image. `pnpm --filter fluxer_api typecheck`
covers `scripts/` too.

## Data changes

`scripts/migrate_*.ts` are the fork's one-off data migrations from September 2026, run by hand.
They edit `row_data` with SQL, past the KV layer's encoding, Valkey caches, gateway events and the
search index, and nothing records that one ran. Later fork data changes are normalised in the API
on read or save instead (`persona/RetiredSyncedPreferenceFields.ts`), which keeps working on any
database. The fork takes no schema versions or migration markers of upstream's kind (root
`AGENTS.md`, "Numbers upstream hands out").

## Tests

### The harness

- `createApiTestHarness()` boots the whole app in-process on in-memory fakes: the database, Valkey,
  storage, search (off unless `{search: 'enabled'}`), the gateway (`NoopGatewayService`) and the
  worker (`NoopWorkerService`). Create it in `beforeAll`, call `harness.reset()` in `beforeEach` and
  `harness.shutdown()` in `afterAll`.
- Make data with `createTestAccount` (`auth/tests/AuthTestUtils.ts`) and
  `setupTestGuildWithMembers` (`channel/tests/ChannelTestUtils.ts`); call routes with
  `createBuilder(harness, token).post(path).body(…).expect(status, code?).execute()`.
- **The database is emptied after every test** (`test/Setup.ts`'s `afterEach`): data made in
  `beforeAll` is gone by the second test.
- **The baseline is a hosted instance:** `Setup.ts` sets `FLUXER_SELF_HOSTED=false`. A test of
  self-hosted behaviour overrides the loaded config (`stripe/tests/SelfHostedPremiumRoutes.test.ts`).
- **Test mode:** rate limits apply only with the header `x-fluxer-test-enable-rate-limits: true`;
  outbound HTTP goes through MSW, and an unhandled request fails the test (add handlers with
  `server.use(...)`).
- **The Rust services are stand-ins:** `svc.messages` is `test/mocks/RepositoryBackedMessageResponseDataService.ts`
  and `svc.users` `RepositoryBackedUsersServiceClient`. A field the Rust side adds is invisible here
  until the stand-in has it (`src/api/channel/AGENTS.md`).
- Jobs: the harness's start-up injects `NoopWorkerService`, which drops them, so a test that needs
  them injects its own with `setInjectedWorkerService` in `beforeEach`, after `harness.reset()`, and
  puts the no-op back in `afterEach` (`channel/tests/AnnouncementChannelConversion.test.ts`).
  `RecordingWorkerService` records jobs; `SyncTaskWorkerService` runs them, inline or on `drain()`.
  No sleeps in fork tests: drain, or use a fake clock.

### One runtime for many files

`vitest.config.ts` has three projects. The big one, `api`, runs with **`isolate: false`**: the files a
worker runs share one module registry. So:

- the first `initializeConfig` and `initializeLogger` win, and module state (singletons, caches, a
  changed `Config` field) carries over to the next file: restore what you change in `afterEach`;
- **`vi.mock` is unreliable here.** A module another file already loaded keeps its real imports, so
  the mock reaches the code under test or not depending on file order and worker count. Spy on the
  live object instead: `vi.spyOn(Logger.child({}), 'warn')` (the `NoopLogger` returns itself),
  `vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild')`, restored after each test. That is how
  `middleware/tests/ForkRateLimitDiagnostics.test.ts` stopped failing at random (tyne-chat/tyne#126);
- the files upstream isolates are listed in `vitest.config.ts` (`MODULE_REGISTRY_TEST_FILES`,
  `INSTANCE_POLICY_TEST_FILES`). Those lists are upstream's and change often: keep fork tests out
  of them.

**An order-dependent failure** becomes repeatable with one worker and a shuffle seed; try a few seeds
with the files that may interact (in the dev container, in `fluxer_api`):

```bash
pnpm exec vitest run --project api <file A> <file B> --sequence.shuffle.files --sequence.seed=3 --maxWorkers=1
```

### Counting requests and queries

For the root guide's "test that counts the requests", on the server side:
`FakeNatsConnectionManager.requests` (NATS requests), `countStatements('select:channels')` on the
in-memory executor (database reads), spies on `NoopGatewayService.prototype` (gateway calls), and
spies returned by MSW handler factories (outbound HTTP).

### Running

- One file, in the dev container: `pnpm --filter fluxer_api test src/api/<path>.test.ts`.
- Tests that start their own Postgres (`test/DockerTestContainer.ts`) need the host's network, and a
  few files are known to fail; `CHECKS.md` has the host command, and the maintainers keep both lists
  outside the repository.
- A fork test goes in a fork-owned file (`<Upstream>Persona.test.ts`, `tests/Fork*.test.ts`), never in
  upstream's (root `AGENTS.md`). Before committing: `CHECKS.md`.
