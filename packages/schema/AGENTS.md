# Shared schemas (`@fluxer/schema`)

The Zod schemas of every API request and response, the protobuf definition of an account's synced
preferences, and a few pure helpers. The API validates with them, the web app takes its wire types
from them, and the OpenAPI specs, and from those the mobile app's Dart SDK, are generated from them.
Consumers import files by path; nothing here runs on its own. The package is upstream's; the fork
adds the persona and signal-bar domains, persona fields in upstream's schemas, some instance
settings, and a block of accessibility protobuf fields.

## Where things are

| Concern | File |
|---|---|
| Schemas by domain | `src/domains/<domain>/` (`<Domain>RequestSchemas.ts`, `…ResponseSchemas.ts`, `…Schemas.ts`); a value and its `z.infer` type share a name |
| Field types (snowflakes, strings, enums, bitflags) | `src/primitives/SchemaPrimitives.ts` and the `*Validators.ts` beside it |
| Component names, enum entries, the API's null-handling flags | `src/SchemaMetadata.ts` (`schemaMetadata`) |
| The web app's hand-written `Message` and `MessageReaction` types | `src/domains/message/MessageResponseSchemas.ts` |
| Personas (fork) | `src/domains/persona/`: routes in `PersonaApiSchemas.ts`, the `subprofile` object in `PersonaSchemas.ts`, `PersonaSearchSchemas.ts`, `PersonaMatcher.ts`, `PluralKitFormat.ts` |
| Signal bar (fork) | `src/domains/signal_bar/SignalBarSchemas.ts` |
| Synced preferences | `proto/fluxer/user/preferences/v1/*.proto` → `src/gen/` (generated); `src/domains/user/SyncedPreferencesCodec.ts` |
| Spec generator and output | `packages/openapi/` → `fluxer_api/src/api/openapi/openapi.json`, `fluxer_admin/openapi-admin.json` |

## From a schema to the spec and the Dart SDK

1. **Export it** from a file under `src/domains/`. `SchemaLoader` imports every `.ts` file there in
   Node (not `*.test.ts`, nothing in `tests/`) and registers each exported Zod value under its
   export name. No other registration is needed, and the file's location does not matter to the
   spec. Modules must load in Node: no side effects, no browser-only imports.
2. **Name it in the controller:** `Validator('json' | 'query' | 'param' | 'form', Name)` and
   `OpenAPI({..., responseSchema: Name})`. `RouteExtractor` reads the API's source without running
   it and takes the identifier's text as the name: an inline schema fails ("must use a named schema
   export"), and an import alias or a schema declared in the controller fails as "Unknown OpenAPI
   schema".
3. **`pnpm openapi:generate`.** A route without `responseSchema` (`null` declares an empty
   response) is left out, noted only in the console. Only components a route reaches are written.
   `/admin` routes go to `openapi-admin.json` (OpenAPI 3.0.3, read by `fluxer_admin`'s `build.rs`),
   the rest to `openapi.json` (3.1, the SDK's source). Neither is written unless both validate.
4. **Regenerate the SDK and adapt the app** in the root `AGENTS.md`'s order ("Generated code").
   Document the field on the route's page under `fluxer_docs/src/content/docs/http-api/`. Nothing
   reports a missing one since upstream dropped the docs verifier.

How names come out:

- **Every export is public:** a component, and a Dart class. A nested schema that is exported (or
  has a `name` in `schemaMetadata`) becomes a `$ref`; the rest is inlined. Renaming an export, or
  moving a field to another one, breaks the mobile app at the next SDK regeneration.
- A request schema becomes `XInput`, renamed `X` when it is request-only or both forms match. One
  used both ways usually keeps both, and the SDK gets two classes (`PersonaTagSchema`,
  `PersonaTagSchemaInput`).
- Two different values exported under one name stop generation ("Duplicate schema export");
  re-exporting the same value is fine. An upstream export that takes a fork export's name merges
  cleanly and then fails here: the root guide's "upstream ships its own version" case.
- Gateway event shapes (the signal-bar events) are in neither the spec nor the SDK: no route
  returns them.

## How the API applies them

- **Request clean-up** (`fluxer_api/src/api/Validator.ts`): `""` becomes `null`, and so does a
  nested object that is empty or all `null`. In `schemaMetadata`, `preserveEmptyValues` turns this
  off for a schema and `preserveNullFields` keeps its all-`null` objects. A patch that clears a
  setting with only `null`s needs the latter: the fork registers it on upstream's
  `InstancePolicyUpdateSchema` so that `signal_bar_guild_id: null` alone gets through.
- **Empty query values are a 400** unless the field accepts `null`: `?q=` reaches the schema as
  `null`, which `.optional()` and `.optional().default(…)` both refuse (`INVALID_FORMAT`). Clients
  send empty values more often than it looks: the web client sends `''` as `key=`, and a
  hand-written Dio call sends `null` as a bare `?key` (the generated SDK drops nulls). A fork query
  field a client may send empty is either `.nullish()`, with the handler treating `null` like a
  missing value, or registers `preserveEmptyValues` on the field after any `.default()` (the
  validator unwraps only `Optional` and `Nullable` to find it) and receives `''`
  (`ChannelPersonaMentionsQuerySchema`'s `q`, tyne-chat/tyne#200). Beware `z.coerce.number()`: it
  turns `null` into `0`, so an empty value can silently become a real filter.
- **Errors:** a Zod message that is a `ValidationErrorCodes` value reaches the client as that code;
  other text becomes `INVALID_FORMAT` (`PersonaTagSchema`'s refine message does).
- **Responses differ by environment.** Outside production (`dev.validate_responses`, on unless `env`
  is `production`) the `OpenAPI` middleware parses each JSON response with its `responseSchema` and
  sends the result: unknown keys removed, defaults filled in, a mismatch a 500. Production sends the
  body unchecked, so a field missing from the schema works there and vanishes in development.
- **Ids:** `SnowflakeType` parses to a `bigint` (the message, typing and thread `persona_id`, search
  filters); `SnowflakeStringType` stays a string (the reaction body and query).
- **Update schemas** take plain `.optional()` fields: a `.default()` fills in a field the request
  left out, overwriting the stored value (`PersonaUpdateRequestSchema`'s `visibility`).

## Synced preferences

- One `SyncedPreferences` message (`preferences.proto`, importing `accessibility.proto` and
  `pickers.proto`), stored by the API as a base64 blob; clients send the whole blob on each save.
  The API decodes it strictly on a save and refuses one it cannot read (`INVALID_FORMAT`).
- `pnpm --filter @fluxer/schema generate` runs `buf generate` into `src/gen/` and strips everything
  above the first `import`, so the generated files carry no header: the folder is the marker.
- **The web** (`fluxer_app/src/features/user/state/SyncedPreferencesEngine.ts`) merges by top-level
  field (all of `accessibility` is one unit) and decodes leniently: an unreadable blob becomes empty
  preferences. Each settings store builds its message afresh (`toMessage`, `SyncedField.ts`), so a
  web save drops any field the store does not carry. That is why the accessibility fields only the
  phone uses are carried, without UI, in the web's `accessibility/state/Accessibility.ts`.
- **The mobile app** has its own copy in tyne-mobile's `lib/core/synced_preferences/proto/`. It
  follows upstream's mobile app, whose files already differ from upstream's server files
  (accessibility 42 and 43 are reserved here, declared there). Only the fork block is kept in step,
  by hand; no test compares the copies.

**Adding a fork field:** number it by the root rule ("Numbers upstream hands out"), in the
`// Fork fields.` block at the top of the message, never reusing a number (check `reserved` lines,
the history and `RetiredSyncedPreferenceFields.ts`). Add the same name, number and type to
tyne-mobile's copy if the phone reads or writes it, touching only the fork block. Regenerate both
(tyne-mobile's `AGENTS.md`, "Generated code", for its side). If the phone writes it, carry it in the
web's store (`toMessage` and `applyMessage`) and get that to the web before a mobile release writes
it.

**Retiring a field:** stored blobs keep the old bytes and clients send them back. In the fork range,
remove the line and reserve the number in both copies. Numbers in upstream's range that the fork
once used are dropped from every blob, in and out, by
`fluxer_api/src/api/persona/RetiredSyncedPreferenceFields.ts`: top-level 120 to 125 (left out of
`preferences.proto` without `reserved`, so the file stays upstream's) and 64-bit values at
accessibility 66 to 68. Old bytes of another wire type at a number upstream defines would make the
whole blob undecodable, which is what it guards against. It is a workaround (removal:
tyne-chat/tyne#127).

## The fork's changes and where they hook in

Fork-owned: `src/domains/persona/`, `src/domains/signal_bar/`, their `tests/`,
`src/domains/auth/ForkHandoffReturnUri.test.ts`, `src/domains/tests/AdminResponseSchemas.test.ts`.
In upstream's files, with fork imports in a `// Fork imports.` group:

- `message/MessageRequestSchemas.ts`: `persona_id` and the deprecated `subprofile` (only its id is
  read) on `MessageRequestSchema` and in `MessageUpdateRequestSchema`'s `pick`;
  `...PersonaMessageSearchRequestFields` in `MessageSearchRequest`; `IndicateTypingRequestSchema`
  mid-file; `AddReactionBodySchema`, `RemoveReactionQuerySchema` at the end.
- `message/MessageResponseSchemas.ts`: `subprofile` and `mention_personas` on messages; `me_root`
  and `persona_reactions` on reactions; `ReactionUserItemResponse` in the reaction-user lists; the
  same fields on the `Message` and `MessageReaction` interfaces, which change with the schema.
- `channel/ThreadRequestSchemas.ts`, `ThreadSchemas.ts`: `persona_id`, `owner_persona_id`.
- `instance/InstanceSchemas.ts`, `admin/AdminSchemas.ts`: `desktop_app_prompt_enabled`,
  `signal_bar_guild_id`, `server_list_buttons`. They are optional in the admin responses, so the
  admin client and upstream's fixtures parse a response without them.
- `user/UserRequestSchemas.ts`, `guild/GuildRequestSchemas.ts`: `bio` up to `MAX_BIO_LENGTH`.
  `auth/AuthSchemas.ts`: `tyne://handoff`. `accessibility.proto`: the fork block.
  `packages/openapi/.../OpenAPIGeneratorCatalog.ts`: the `personas.*` scopes.

For new work: a field must sit in upstream's object, so add it last, or spread a fork-owned group
as `PersonaMessageSearchRequestFields` does. A new standalone schema goes in a fork-owned file, even
when upstream's schemas use it. Those still in upstream files (`IndicateTypingRequestSchema`, the
reaction schemas, `MessageReactionPersonaEntry`, `ServerListButtons*`) can move out, keeping their
names.

## Persona helpers

- **`PersonaMatcher.ts`:** tag matching for the web composer, called only by `PersonaStore`; the
  server never matches tags. Behaviour: `fluxer_app/src/features/persona/AGENTS.md`. tyne-mobile
  has a Dart port (`lib/features/profile/domain/persona_matcher.dart`); `isUnfinishedPersonaTag`
  runs the same table of cases in both tests, so change both together. The rest already differs
  (the Dart one also reads a `:shortcode:` in a tag as its emoji). Known gap: `matchPersona` ignores
  a latched persona with `auto_tag_disabled`, so its text goes out as the account
  (tyne-chat/tyne#130).
- **`PluralKitFormat.ts`:** the one mapping between personas and PluralKit's export (v2), plus the
  Tyne zip's `tyne.json`, used by the web import and the API export; the round trip is tested here.

## Tests

- `pnpm --filter @fluxer/schema test` and `typecheck`. Fork tests are the fork-owned files above
  (`AdminResponseSchemas.test.ts` tests the bio bounds of `LimitConfigUpdateRequest`); the rest,
  including `SyncedPreferencesCodec.test.ts`, is upstream's.
- In the API: `persona/tests/RetiredSyncedPreferenceFields.test.ts` and upstream's
  `user/tests/UserSettingsSyncedPreferences.test.ts`. A route test that needs its response checked
  sets `Config.dev.validateResponses = true` (`PersonaController.test.ts`).
- Not covered: nothing checks that fork protobuf fields are in the fork range or that the copies'
  fork blocks match.
- Before committing, a schema change takes the full list in `CHECKS.md` (with `fluxer_docs` verify
  and `cargo check -p fluxer_admin`), after `pnpm openapi:generate` ("Generated code").
