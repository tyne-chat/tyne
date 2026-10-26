# The markdown parser

One Rust crate, `fluxer_markdown_parser` in `rust/`, that parses Fluxer's Discord-style markdown
(mentions, timestamps, custom emoji, spoilers, alerts, tables) into a node tree. It is upstream's,
and pure: text, flags and an emoji context go in, nodes come out. The web app, the messages service,
the gateway's push previews and the mobile app all run it, so a change to its output reaches four
places in two repositories. The fork adds two things: a user mention may name a persona,
`<@user:persona>`, and issue shorthands (`tyne/101`) become links in the trees the apps display.

## Who runs it

| Consumer | How it gets the crate | What it reads |
|---|---|---|
| Web app, and the desktop app that bundles it | `pnpm --filter fluxer_app wasm:codegen` (`tools/ci/src/app_wasm.rs`) builds wasm32 into the gitignored `fluxer_app/src/features/messaging/utils/markdown/parser/MarkdownParserWasmBytes.ts`; `MarkdownParserWasm.ts` calls it | the JSON tree, typed in `Nodes.ts`; messages and the Lexical composer |
| `fluxer_messages` | path dependency | mentions, in `mention_extractor.rs` (`fluxer_messages/AGENTS.md`) |
| Gateway push previews | `fluxer_gateway/native/push_markdown_plaintext_nif`, a path dependency with its own `Cargo.lock`, built by the gateway's compile step | `plaintext::parse_and_render_plaintext` |
| tyne-mobile | `packages/fluxer_markdown_native/hook/build.dart` compiles `fluxer/packages/markdown_parser/rust` from its `fluxer` submodule | the binary tree through the C ABI, read by `packages/fluxer_markdown_native/lib/src/decode_binary.dart` |

## Where things are

In `rust/src/`:

| Concern | File |
|---|---|
| Node and mention types, flags, JSON names | `ast.rs` (`Node`, `MentionKind`, `ParserFlags`) |
| Parse driver; blocks; inline formatting | `parser.rs` (`MarkdownParser`); `block.rs`; `inline.rs` |
| Links, mentions, timestamps, custom emoji | `links.rs` (`parse_mention`) |
| Tidying the tree; emoji context (TSV) | `normalize.rs`; `emoji.rs` |
| JSON output | `json.rs`, `lib.rs` (`parse_markdown_json`) |
| Binary output | `binary.rs` (`write_ast_binary`) |
| Notification text | `plaintext.rs` (`PlaintextOptions`) |
| WASM ABI | `wasm.rs` (`markdown_alloc`, `markdown_free`, `parse_markdown_ast`), `rust/.cargo/config.toml` |
| C ABI, not on wasm32 | `native.rs` (`fluxer_md_parse`, `fluxer_md_parse_binary`, `fluxer_md_buffer_free`) |
| Limits | `constants.rs` (`MAX_AST_NODES`, `MAX_LINE_LENGTH`, …) |

## The two output formats

- **JSON** (`parse_markdown_json`; the WASM and `fluxer_md_parse` return it): serde, with a `type`
  tag on `Node`, a `kind` tag on `MentionKind` and the emoji kinds, and camelCase names through
  `serde(rename)`. The web's `Nodes.ts` mirrors it, and `cleanNode` in `MarkdownParserWasm.ts` fills
  in the optional fields the JSON leaves out. A new field is optional, skipped when absent, renamed
  to camelCase, and added to `Nodes.ts` and `cleanNode`; mobile's JSON reader (`fromJson` in
  `fluxer_markdown_native/lib/src/ast.dart`) needs it too.
- **Binary** (`write_ast_binary`; `fluxer_md_parse_binary` returns it): `FORMAT_VERSION` (1), then
  each node list as a varint count and each node as a one-byte tag (0 to 20) followed by its fields
  in a fixed order. Strings are a varint length and UTF-8; mention kinds are 0 to 6, emoji kinds 0
  and 1. The layout is positional: tags and field order are the contract. It is never stored or
  sent between machines: the writer and the reader ship in the same app build, so they only have to
  agree within one tyne-mobile commit. `decode_binary.dart` throws `FormatException` on another
  version, an unknown tag or kind, and trailing bytes, and the app then shows the message as raw
  text (`parseNativeFluxerMarkdownAst` in tyne-mobile `lib/shared/markdown/native_markdown_parser.dart`).

## Persona mentions (the fork)

- **Grammar** (`parse_mention` in `links.rs`): under `ALLOW_USER_MENTIONS`, an id that contains a
  colon is split at the first one. Non-empty digits before it and non-empty `[A-Za-z0-9_-]` after it
  give `MentionKind::User { id, persona_id: Some(..) }`; `<@!id:persona>` works like `<@!id>`. An id
  without a colon follows upstream's rule, with `persona_id: None`. Anything else stays text.
- **Tree** (`ast.rs`): `persona_id: Option<String>` on `MentionKind::User`, JSON `personaId`, left
  out when absent. Every `MentionKind::User` pattern in a consumer names the field or uses `..`; the
  compiler finds them.
- **Binary** (`binary.rs`): a persona mention is kind `FORK_USER_PERSONA_MENTION_KIND` (255), then
  the user id, then the persona id. A plain mention stays kind 0 with upstream's layout. The
  constant sits in the `// Fork:` block at the end of the file; fork kinds count down from 255 (root
  `AGENTS.md`, "Numbers upstream hands out"), so the next is 254, and node tags are a separate space.
  The reader's arm is `_forkUserPersonaMentionKind`, in the fork block at the end of
  `decode_binary.dart`. `FORMAT_VERSION` stays 1. The kind was 7, upstream's next number, until
  tyne-chat/tyne#135.
- **Plaintext** (`plaintext.rs`): `PlaintextOptions.personas` maps a persona id to a name. A mention
  shows the persona's name, else the account's, else `@<id>`. The push NIF takes the map from the
  gateway's context, which `fork_push_personas:mention_names` fills from the message's
  `mention_personas` (`fluxer_gateway/src/push/`).
- **Non-numeric persona ids** parse (`<@123:alice-pk>`; a test pins it), but the server's persona ids
  are snowflakes, and `fluxer_messages` records a pair only when both ids are non-zero numbers, so
  such a mention counts only as the account's for pings and search.
- **Readers:** the web resolves `personaId` in its mention renderers (`fluxer_app/src/features/persona/AGENTS.md`).
  Mobile's `markdown_bridge.dart` joins `id:personaId` into one string, which
  `lib/shared/markdown/fluxer_markdown_adapter.dart` splits at the first colon; that holds while the
  account id is digits only.

## Issue shorthands (the fork)

- **What:** `tyne/N` and `tyne-tools/N` become a `Link` to
  `https://github.com/tyne-chat/<repository>/issues/N`, with the shorthand as its text and `source`,
  so the apps show it as typed (tyne-chat/tyne#235). `src/fork_issue_links.rs` (`shorthand_at`) has
  the rule: a word of its own, ASCII letters and digits only (so `tyne/101を見て` links), a number
  from 1 with at most seven digits, not inside code, links, mentions or emoji, under
  `ALLOW_AUTOLINKS`, within `MAX_AST_NODES`.
- **Where:** a pass over the finished tree, called from `parse_markdown_json` (the web's WASM and
  `fluxer_md_parse`) and `fluxer_md_parse_binary`, never from `MarkdownParser::parse`. Push previews
  (`plaintext.rs`, `preserve_markdown`) would otherwise show `[tyne/101](https://...)`, and
  `fluxer_messages` has no use for links, so both still see plain text. The web's `Plaintext.ts`
  renders the link as typed for the same reason (`fluxer_app/.../markdown/ForkIssueShorthandLinks.ts`).
- **Formats:** an ordinary `Link`, so no new tag, kind or field; mobile's reader and
  `markdown_bridge.dart` need no change, only the submodule pointer.
- **Unfurls** come from the API, which does not run this crate: `extractURLs` expands `tyne/N`
  (never `tyne-tools/N`, whose issues are private) with `fluxer_api/src/api/utils/ForkIssueShorthands.ts`.
  Both matchers are tested against `tests/fork_issue_shorthand_cases.json`: change the rule in both
  and add the case there.

## Changing the output

What changes together:

1. Here: the node or field in `ast.rs`, its arm in `binary.rs`, and `plaintext.rs`.
2. Rust consumers: `fluxer_messages/src/mention_extractor.rs`, whose matches are exhaustive, so the
   compiler finds them; the push NIF goes through `plaintext.rs` but has its own `Cargo.lock`.
3. Web: `Nodes.ts`, `cleanNode`, the renderers, and a WASM rebuild.
4. tyne-mobile: `decode_binary.dart`, `ast.dart` (types and `fromJson`), `markdown_bridge.dart`, and
   its renderers.

Push the tyne commit first. Then, in one tyne-mobile commit, move the `fluxer` submodule pointer to it
and change the reader: the app builds the parser from that pointer, so nothing reaches it before the
pointer moves, and a reader arm for a kind nothing writes yet is harmless.

In the binary format, never take upstream's next tag or kind and never insert a field into an
upstream node's layout: add a fork kind or tag from 255 down instead, as the persona mention does. If
upstream changes `MentionKind::User`, keep the writer's and the reader's 255 arms identical.

## Rules and traps

- **`MarkdownParserWasmBytes.ts` is build output:** never edit or commit it. `wasm:codegen`,
  `typecheck` and `build` (through `codegen`) in `fluxer_app` rebuild it; `test` and
  `typecheck:only` (the web typecheck in `CHECKS.md`) do not. The web dev server runs `wasm:codegen`
  at start-up when the crate's files changed (`gather_wasm_inputs` in
  `tools/ci/src/app_dev_server.rs`) and does not watch them after. After a change, run
  `pnpm --filter fluxer_app wasm:codegen` before the web checks.
- **One parse serves every mention use** in `fluxer_messages`: a grammar change moves pings,
  `mentions`, `users` and the persona pairs stored for search at once.

## Where the fork's code sits

Fork-owned: `src/fork_issue_links.rs`, `tests/fork_binary_envelope.rs`, `tests/fork_issue_links.rs`
and `tests/fork_issue_shorthand_cases.json`. Inside upstream's files:

- `lib.rs` and `native.rs`: one line each handing the tree to `fork_issue_links`, and the module
  declared in a `// Fork:` block at the end of `lib.rs`.

- `links.rs`: `parse_mention`'s three-line user branch rewritten as about thirty, the largest edit,
  in a file upstream changes often. An id with a colon never passes `is_digit_only`, so the fork's
  branch could be a separate statement before upstream's `if`, which would then need only
  `persona_id: None`; prefer that shape when upstream changes the function.
- `binary.rs`: upstream's `User` arm of `write_mention` became an `if`/`else`; the constant is in an
  appended `// Fork:` block.
- `ast.rs`: the `persona_id` field, two lines with no `// Fork:` comment.
- `plaintext.rs`: the `personas` field, its `Default`, and upstream's `User` arm rewritten.
- Fork tests still in upstream's test modules, against the root `AGENTS.md`: three in `links.rs`
  `mod tests` (with `use crate::ParserFlags;`), and a persona case written into upstream's
  `preserves_notification_markdown_and_resolves_mentions` in `plaintext.rs`. `parse_mention` and
  `parse_and_render_plaintext` are public, so these can move to a `tests/fork_*.rs` file when you
  touch them, and upstream's test can go back to upstream's text.

## Tests

- **Crate:** `tests/binary_envelope.rs` (upstream's golden bytes), `tests/fork_binary_envelope.rs`
  (golden bytes for kinds 0 and 255: it pins the fork's kind), `tests/fork_issue_links.rs` (issue
  shorthands, against the shared cases and through both entry points), `tests/fixtures.rs`,
  `tests/code_blocks.rs`, `tests/native_abi.rs` (the C ABI), and unit tests in `links.rs` and
  `plaintext.rs`. Also a criterion bench (`benches/parser.rs`) and a fuzz target in `fuzz/`, which
  is outside the workspace with its own lockfile. New fork tests go in `tests/fork_*.rs`.
- **Run:** `cargo test -p fluxer_markdown_parser` and `cargo test -p fluxer-messages`. The crate is a
  member of the root Cargo workspace, so the checks in `CHECKS.md` (`cargo fmt`, Clippy,
  `cargo test --workspace`) cover it, and the gateway steps build the NIF.
- **Web:** `pnpm --filter fluxer_app wasm:codegen`, then `pnpm --filter fluxer_app test
  src/features/messaging/utils/markdown/parser/MarkdownParserWasm.test.ts` (persona cases) and
  `src/features/messaging/utils/markdown/PlaintextIssueShorthands.test.ts`.
- **API:** `pnpm --filter fluxer_api test src/api/utils/ForkIssueShorthands.test.ts` (the shared
  cases and `extractURLs`).
- **Gateway:** `fluxer_gateway/test/fork_push_personas_tests.erl` renders persona names through the
  NIF (`gateway_eunit`).
- **Mobile,** after moving the pointer: `(cd packages/fluxer_markdown_native && dart test)` in
  tyne-mobile. `binary_envelope_test.dart` decodes a persona mention through the library built from
  the submodule, so it checks the writer and the reader together.
