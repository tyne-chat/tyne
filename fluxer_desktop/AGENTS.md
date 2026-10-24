# The desktop app

Upstream's Electron app: a main process that owns windows, tray, menus, links, notifications and
updates, a preload that gives the web app a `window.electron` bridge, and a production build of
`fluxer_app` packed inside. The fork builds it as **Tyne** (its own name, IDs, data folder and
`tyne://` scheme), starts it on a default homeserver, updates it from this repository's GitHub
releases through a workflow of its own, and adds extra app windows that come back at the next
launch. `native/` is upstream's and unchanged.

## Where things are

| Concern | File |
|---|---|
| Entry, start-up | `src/main/Bootstrap.ts`, then `src/main/index.ts` (`MainApp`) |
| Windows (the fork's at the end) | `src/main/Window.ts`, `ForkWindowSession.ts`, `ForkWindowCoordination.ts` |
| The bridge | `src/preload/index.ts`, typed by `ElectronAPI` in `src/common/Types.ts` |
| IPC | contracts in `packages/desktop_ipc/src/`; handlers in `IpcHandlers.ts` and `*Ipc.ts` |
| Serving the web app, API proxy | `LocalAppProtocol.ts`, `LocalAppRequestHandler.ts` |
| Name and IDs per channel | `src/common/DesktopIdentity.ts`, `Constants.ts`, `UserDataPath.ts` |
| Updates | `DesktopUpdateGate.ts`, `Updater.ts`, `ShellSelfUpdate.ts`, `ShellDownloadFormats.ts`, `ForkShellUpdate.ts` |
| Build, packaging, releases | `scripts/build.mjs`, `electron-builder.config.cjs`, `scripts/fork-*` |

## Three processes

- **Main** (`src/main`) serves the web app from `fluxer-app://app/` and forwards its
  `/api/<instanceKey>/…` requests to the chosen instance, one for one, without retries.
- **Preload** (`src/preload/index.ts`) runs in each app window and exposes `window.electron`
  through `contextBridge`.
- **Renderer**: the web app, which reaches the bridge through `getElectronAPI()`
  (`features/ui/utils/NativeUtils.ts`), typed by `fluxer_app/src/types/electron.d.ts`.

A new channel takes its name from a constant in a `packages/desktop_ipc` contract (upstream's older
ones in `IpcHandlers.ts` are literals) and needs a handler in main, `invoke` or `send` in a preload
module, and the method in both `src/common/Types.ts` and `electron.d.ts` (optional there: the web
app also runs in browsers). Fork channels go in a fork contract (names prefixed `fork-`) with a
fork-owned preload module, as `ForkAppWindowContract.ts` and `ForkAppWindowPreload.ts` do.

**Trust.** Navigation away from the bundled app is cancelled and other links open in the browser.
A handler that touches accounts, storage or windows checks its sender with
`requirePrivilegedRendererDocumentSender` or `createPrivilegedRendererDocumentOwners`
(`PrivilegedRendererDocuments.ts`); the latter accepts only windows for which
`isAppDocumentWindowContents` (`Window.ts`) holds, extra windows included.

## The web app inside

- **No module system.** Upstream's releases set `FLUXER_MODULES=1` and download the web app as
  modules behind a splash. Fork builds do not, so `Bootstrap.ts` imports `MainApp` at once: no
  splash, no module updater. Never import `SplashWindow` from `MainApp` code
  (`SplashBundleOwnership.test.mjs`).
- **Build.** `scripts/build.mjs` runs `pnpm --filter fluxer_app build:desktop`, copies
  `fluxer_app/dist` to `dist/renderer`, bundles main and preload, and builds the native add-ons.
  Unless given `--use-shared-renderer` it rewrites `fluxer_app/dist`, which the dev server serves,
  so never run it in the dev container while the dev stack runs (root `AGENTS.md`).
- **A release carries the web app of its commit**: a web fix reaches desktop users only with a new
  release.
- **The instance.** `DesktopRuntimeDiscovery` reads the instance's `/.well-known/fluxer`, a
  transaction activates the plan, and the proxy forwards only to that plan's API. The fork starts
  on `DEFAULT_HOMESERVER_URL` (`common/Constants.ts`, not behind the identity switch), which the
  preload also pins in the instance picker through `localDevelopmentInstanceUrl`.

## Identity: Tyne, not Fluxer

- `scripts/build.mjs` compiles `FLUXER_FORK_IDENTITY` (`'1'` unless built with `=0`) and
  `FLUXER_FORK_RELEASES` (default `tyne-chat/tyne`). Under the first, code at module load
  overwrites the `stable` entry of upstream's per-channel tables (name, bundle, desktop-entry,
  Velopack and Windows IDs, tray GUID, data folder `tyne`, scheme `tyne`); the block after
  `CHANNELS` in `electron-builder.config.cjs` packages the same.
- **These IDs never change once shipped**: the system would take the app for another one.
  `ForkIdentityConsistency.test.mjs` holds the app, packaging, workflow and release scripts to them.
- **New upstream tables are not covered.** When upstream adds a `Record<BuildChannel, …>` table of
  names or IDs, Tyne ships Fluxer's value until the fork overrides it. Look for one after a rebase.
- **The packages' scheme comes from the environment**: `FLUXER_FORK_LINK_SCHEME`, which the
  workflow sets, because upstream's `ChannelIsolation.test.mjs` expects stable to declare `fluxer`.
  A stable package built without it declares `fluxer://`, and on Linux the package is the only
  place `tyne://` is registered (tyne-chat/tyne#153).
- **In tests the defines are absent**, so upstream's tests see upstream's values; only the builder
  config's fork block is on (off only with `FLUXER_FORK_IDENTITY=0`). A fork test that needs Tyne's
  values sets `process.env.FLUXER_FORK_IDENTITY = '1'` before importing.

## Windows and links

- **Extra app windows** open from "Open in new window" (`fork-app-window:open`; web side
  `features/platform/utils/ForkAppWindows.ts`), File > New window or `--new-window` on a second
  launch: at most 12, on routes that pass `isForkAppWindowRoute`. Each is a full app document with
  its own gateway connection.
- They load one at a time (`ForkWindowLoadQueue`, 8 s at most each): upstream's runtime activation
  fails when two documents overlap. An account change in one window reloads the others. For each
  new message one window announces it (`claimNotification`), none when the focused window shows
  that channel. The layout (`window-session.json`) is saved on change and at quit, and restored
  once the main window is signed in and visible.
- **`getMainWindow()` returns the frontmost extra window** once the main window is closed. Deep
  links, notification clicks, `updater-event`, badges and the tray go to it. For a new caller,
  choose between the main window and the one that asked (`BrowserWindow.fromWebContents`).
- **`openAppWindow` copies `createWindow`'s per-window setup**, so a listener upstream adds there
  does not reach extra windows. Missing today: `unresponsive` logging, console forwarding, the
  Windows badge overlay, and the screen-share clean-up on navigation or crash
  (`drainPendingDisplayMediaRequests`; tyne-chat/tyne#153). After a rebase that changes `createWindow`, compare the
  two, and keep its window-open handlers as the named functions both share.
- **Extra windows do not use upstream's account engine.** It serves one renderer, the one
  `getMainWindow()` returns, so `openAppWindow` drops the flag that announces it
  (`forkExtraAppWindowRendererArguments`) and each extra window keeps its own gateway session.
  Otherwise extra windows are refused, or take the engine's one connection from each other once the
  main window is closed.
- **`tyne://`**: `DeepLinks.ts` registers it at run time in packaged Windows and macOS builds,
  turns `tyne://<path>` into an in-app route, and refuses a link that names an instance. Links
  inside messages keep the `fluxer:` form. `tyne://handoff` ends a browser sign-in; an instance
  that knows only `fluxer://` answers 400, and `initiateWithReturnLink` asks again without the
  link, so the sign-in ends with the browser's code.

## Updates and releases

- **URLs**: the block at the end of `ShellDownloadFormats.ts`, on when `FLUXER_FORK_RELEASES` is
  set (each helper returns null otherwise, and the caller uses upstream's URL):
  `tyne-latest-<platform>-<arch>.json` from the latest release (version, files, sha256), the bare
  repository URL for Velopack (it reads releases through the GitHub API), and
  `…/download/desktop-v<version>/<asset>`. These names are permanent; `tyne-latest` is not
  `latest` so that builds from before the rename never take a Tyne release.
- **Controller**: `armForkShellUpdate` (`ForkShellUpdate.ts`, called in `index.ts` after
  `registerUpdater`) arms upstream's `DesktopUpdateGate` for self-updating installs (Windows,
  AppImage, macOS). An update runs `runShellSelfUpdate` with a progress window and a "Restart now"
  question (`confirmRestart`); on macOS, which has no update feed yet (tyne-chat/tyne#202), it
  opens the releases page. Other Linux installs use upstream's manual check in `Updater.ts`, which
  reads the same JSON.
- **`ShellDownloadFormats.ts` may import only `@electron/common/BuildChannel`**:
  `fork-release-assets.mjs` runs it in a `vm` and stops on any other import
  (`ForkReleaseFeed.test.mjs` stubs two more, so it does not catch those).
- **The workflow** (`.github/workflows/fork-desktop-release.yaml`) runs by hand; a push to
  `desktop-test/<name>` builds artifacts only. It builds Windows x64 (unsigned Velopack), Linux x64
  and macOS arm64 (ad hoc in the build, then signed with the Developer ID and notarized by the
  `sign-macos` job, `scripts/fork-sign-macos.sh`, which runs only Apple's tools; `test-macos` then
  checks that the signed DMG passes Gatekeeper and the app starts,
  `scripts/fork-test-macos-launch.sh`; `macos_signing=ad-hoc` skips both and publishes the ad-hoc
  build when notarization is too slow), publishes the release as latest, and
  `fork-verify-update-feed.cjs` asks Velopack (the version in `package.json`) whether an installed
  Tyne is offered it. Versions are semver, higher than the last. Its token is read-only except in
  the publish job, which runs only `gh` and GitHub's own actions; keep builds, installs and anything
  from npm out of it. Every action is pinned to a commit.
- **Signed releases**: the publish job signs the release's `SHA256SUMS.txt` with an Ed25519 key
  (secret of the `desktop-release` environment, usable from `tyne` only), and installed apps install
  a Windows package or AppImage only if that signed list gives its name and SHA-256
  (`ForkReleaseSignature.ts`, called from `ShellSelfUpdate.ts`). Any new way of installing an update
  goes through the same check. Signing is `scripts/fork-sign-release-checksums.sh`; a test run from
  `tyne` without publishing runs it too (`check-release-signing`) and keeps the signed list. The
  public keys are in `ForkReleaseSignature.ts` and `scripts/fork-release-signing-keys.pem`, kept
  equal by its test; rotating the key is described there.
- **Breaks without a rebase conflict**: the workflow calls 15 `build-desktop --step` names from
  upstream's `tools/ci/src/desktop.rs` and copies its `vpk` arguments. Check both when upstream
  changes its desktop build.
- **Linux Electron**: upstream packages Linux only with its patched Electron (a VA-API fix compiled
  from Chromium source, given through `FLUXER_ELECTRON_DIST`; `electron/build-linux.sh`). GitHub's
  runners cannot compile it, so the maintainers build it with `build-linux.sh` and publish the ZIP
  and its `.fluxer.json` as a release of
  [tyne-chat/tyne-electron](https://github.com/tyne-chat/tyne-electron). The release workflow
  downloads them without a token and stops unless both match the SHA-256 pinned next to
  `FLUXER_FORK_ELECTRON_RELEASE`. When upstream moves Electron or the patch, the packaging checks
  fail until a new build is published there under a new tag and the workflow points at it.
  `FLUXER_FORK_STOCK_LINUX_ELECTRON=1` still packages stock Electron for a local build (it skips
  those checks and leaves `VaapiOnNvidiaGPUs` off, `ChromiumRuntime.ts`). A new upstream
  requirement of this kind fails only at release time: the nightly rebase does not build the
  desktop app.
- **NVIDIA hardware video decoding** (`VaapiOnNvidiaGPUs`) is off unless the build sets
  `FLUXER_FORK_NVIDIA_VAAPI_DECODE=1`, although upstream turns it on. With nvidia-vaapi-driver, X11
  sessions show black video: three bugs in Chromium's X11 dma-buf import (ANGLE's GLX pixmap
  binding, DRI3 1.0 without modifiers, cached pixmaps). Wayland worked in a nested test.
  Details, test harness and reproducers in tyne-chat/tyne#187.

## Native add-ons

- 22 Node-API add-ons in Rust plus two helper crates, each its own Cargo workspace and `Cargo.lock`
  (24). Each add-on is a package `@fluxer/<name>` in `optionalDependencies`
  (`file:./native/<name>`), built for the current OS by `build.mjs` through `tools/ci`.
- At start, `NativeModulePreflight` loads those listed in `NativeModulePreflightModules.json` in a
  child process: a `fatal` failure stops the app, a `degraded` one (`app-store`, `gateway-socket`)
  is logged. Callers load add-ons lazily and treat a failure as a missing feature.
- A new add-on needs `DESKTOP_NATIVE_ADDONS` (`tools/ci/src/desktop_native.rs`), both lists in
  `build.mjs`, `package.json`, an OS list in `tools/ci/check-desktop-native-workspaces.sh`,
  `nativeRuntimeFilePatterns`, perhaps the preflight list, and skips in `native/deny.toml`
  (`-D duplicate` fails on any new duplicate version).
- The script's `clippy` and `test` run on Linux only, and `clippy` also checks the Windows add-ons
  for `x86_64-pc-windows-msvc`: install that target (`rustup target add`; upstream's CI does,
  `.devcontainer/Dockerfile` does not). macOS and Windows code is otherwise compiled only by a
  release or `desktop-test/` build.

## Where the fork hooks into upstream's files

- **Fork-owned**: `src/main/Fork*.ts`, `src/common/ForkLinks.ts`, `ForkAppWindowPreload.ts`,
  `ForkAppWindowContract.ts`, `scripts/fork-*`, `build_resources/icons-tyne/`, the workflow.
- **Appended blocks** in `Window.ts`, `ShellDownloadFormats.ts` and the builder config; override
  blocks after the tables they change in `DesktopIdentity.ts`, `Constants.ts`, `UserDataPath.ts`,
  `DesktopTray.ts`; one-line hand-overs in `index.ts`, `DeepLinks.ts`, `DesktopRuntimeDiscovery.ts`,
  `Updater.ts`, `UpdaterDownloads.ts`, `preload/index.ts`, `common/Types.ts`, `build.mjs`.
- **Inside upstream's lines**, where conflicts come: `Window.ts` (`getMainWindow`,
  `isAppDocumentWindowContents`, `showWindow`, `setQuitting`, the fullscreen guard, `createWindow`'s
  handlers), `ShellSelfUpdate.ts`, `BrowserHandoff.ts`, `Menu.ts`, `DisplayMedia.ts`,
  `MainI18n.ts`, the builder config's package and signing lines, and "Fluxer" strings.

`ShellDownloadFormats.ts` keeps, unmarked above its fork note, four Linux format helpers upstream
deleted; `forkReleaseAssetName` uses them. A main-process string needs `FALLBACK_STRINGS` in
`MainI18n.ts`, a descriptor in `DesktopLocaleBridge.ts`'s `NATIVE_MESSAGES` (fork ones in
`ForkAppWindowMessageDescriptors.ts`) and the fork catalogues.

## Network calls

- **Updates** go to github.com, not the Tyne API. Self-updating installs: one GET of the JSON 2
  minutes after start, then every 6 hours, and one per click on "Check for updates"; overlapping
  checks share one request; a failed check waits for the next; nothing installs or retries without
  the user. Other Linux installs: the web app asks every 5 minutes and on focus, and main caches the
  JSON for 5 minutes.
- **The API**: proxied requests count against the user's rate limit as a browser's do. A restored
  layout of N extra windows boots the web app N+1 times, spaced only by the load queue; an account
  change reloads every other window. No test counts these requests.
- **Linux spellcheck** downloads dictionaries from upstream's static host (`STATIC_CDN_URL`),
  retrying at 5, 15 and 45 s; the fork does not override it.

## Tests and checks

- `pnpm --filter fluxer_desktop typecheck` and `test` (`CHECKS.md`) first write the
  git-ignored `src/common/BuildChannel.ts` from `BUILD_CHANNEL` (default `stable`). The tests are
  `node --test` over `src/{main,preload,common}/*.test.mjs`, with Electron stubbed
  (`installElectronStub` in `src/main/LocalAppTestSupport.test.mjs`).
- Fork tests: `src/main/Fork*.test.mjs`; web side `ForkAppWindows.test.ts`,
  `ForkAppWindowBridge.test.ts`. Put logic that needs no Electron in a `Fork*.ts` module so it can
  be tested; the `Window.ts` block has no test. A `packages/desktop_ipc` change also needs the root
  guide's "every other workspace package" loop and the web typecheck.
- Native code: the `fmt`, `clippy` and cargo-deny lines in `CHECKS.md`, plus
  `tools/ci/check-desktop-native-workspaces.sh test`. The host `cargo test --workspace` there
  runs `tools/ci`'s tests of the add-on registry and of the preload's imports
  (`the_real_preload_closure_resolves`, which fails on an import it cannot follow).
- Packaging or workflow: a `desktop-test/<name>` build. Only a real release exercises publishing:
  check the run's conclusion, the release, and the verify step's output.
