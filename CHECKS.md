# Checks before committing

The gate before every commit in this repository: `AGENTS.md` sends you here. The nightly rebase runs
the same checks before it starts and stops if one fails, so a commit that skips them can block the
next night's rebase.

- Run them once the change is done, not during research or planning.
- The web typecheck is always required. A change that touches personas, messaging or schemas needs
  the whole list, which covers what the nightly rebase gate checks. Folder guides name the extra
  tests for their folder.
- Each block says where it runs; the loops are in parentheses so a failure does not close an
  interactive shell.
- In the commit's description, say which checks you ran and how they ended. A check you did not run
  has not passed.

In the dev container, from the repository root:

```bash
# Web typecheck: zero errors, including unused declarations (TS6133).
pnpm --filter fluxer_app typecheck:only
# Typecheck and tests of every other workspace package the fork changed.
(B=$(git merge-base upstream/main HEAD); for c in typecheck test; do pnpm -r --filter "[$B]" --filter "!fluxer" --filter "!fluxer_app" --filter "!fluxer_api" --filter "!fluxer_desktop" --if-present $c || exit 1; done)
# API, desktop and web tests and typechecks. A few API test files are known to fail on the fork;
# the maintainers keep that list outside this repository.
pnpm --filter fluxer_api test
pnpm --filter fluxer_api typecheck
pnpm --filter fluxer_desktop typecheck && pnpm --filter fluxer_desktop test
pnpm --filter fluxer_app test
# Fork catalogues, and no hard-coded user-facing strings in the fork's code (fork-string-lint.mjs).
(cd fluxer_app && node scripts/fork-i18n.mjs check --upstream upstream/main && node scripts/fork-string-lint.mjs --upstream upstream/main) && pnpm --filter fluxer_app lingui:compile
# Upstream's lint job (Biome, ESLint with no warnings, data-flx attributes), plus Biome warnings on
# files the fork added, committed or not.
pnpm exec biome ci . && pnpm exec eslint . --max-warnings 0 && pnpm --filter fluxer_app theming:data-flx:check && pnpm exec biome ci --error-on-warnings --files-ignore-unknown=true --no-errors-on-unmatched $(git diff --name-only --no-renames --diff-filter=A $(git merge-base upstream/main HEAD)) $(git ls-files --others --exclude-standard)
# Rust formatting and Clippy. The native script also checks the Windows add-ons for
# x86_64-pc-windows-msvc, as upstream's CI does: needs `rustup target add x86_64-pc-windows-msvc` once.
cargo fmt --all -- --check && cargo fmt --manifest-path fluxer_app/rust/libfluxwebp/Cargo.toml -- --check && tools/ci/check-desktop-native-workspaces.sh fmt && cargo clippy --workspace --all-targets --all-features --locked -- -D warnings && tools/ci/check-desktop-native-workspaces.sh clippy
# cargo deny: licenses, bans and sources must pass; advisories are reported only.
# Needs `cargo install cargo-deny --version 0.20.2 --locked` once.
cargo deny --locked check -D warnings licenses bans sources && cargo deny --manifest-path fluxer_app/rust/libfluxwebp/Cargo.toml --config deny.toml --locked check licenses bans sources && (for m in fluxer_desktop/native/*/Cargo.toml; do cargo deny --manifest-path "$m" --all-features --locked check -D warnings -A unmatched-skip -A unnecessary-skip -D duplicate licenses bans sources || exit 1; done)
# Gateway, Knip, synced catalogues, API docs, and a check of the admin, messages and media-proxy
# crates. The gateway's eunit run covers the fork's own tests; upstream dropped its own and the CI step.
(for s in gateway_fmt gateway_compile gateway_dialyzer knip; do tools/ci/run.sh ci --step $s || exit 1; done) && (cd fluxer_gateway && rebar3 as test eunit)
pnpm i18n:compile && git diff --exit-code -- packages/errors/src/i18n/weblate fluxer_api/pkgs/email/src/email_i18n fluxer_api/src/api/content_i18n/weblate
pnpm --filter fluxer_docs build
cargo check -p fluxer_admin -p fluxer-messages -p fluxer-media-proxy
# Rust tests.
cargo test --workspace --all-features --locked
```

On the host, from the repository root (these start containers of their own):

```bash
# Production build of the web app, in a container of its own.
docker compose -f e2e/docker-compose.e2e-build.yml build app-proxy
# Full E2E suite on an ephemeral stack (builds its own images; --skip-build reuses the last ones).
./e2e/scripts/ci-run.sh
```
