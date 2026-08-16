# Native Electron Migration: Plan and Implementation Handoff

Last updated: 2026-08-15

## Objective

Replace the container/WSL-hosted Book Writer application with an installable,
native Windows Electron application suitable for a low-end computer. Preserve
the existing browser/server application as a development and compatibility path
until the desktop version reaches release parity.

The installed application must:

- run without Docker, containers, or WSL;
- install through a normal Windows installer;
- keep manuscript and application data on the local machine;
- support either Claude CLI or Codex CLI as the execution provider;
- detect missing CLIs during installation and again on first launch;
- guide the user through installing the selected CLI and starting its own
  interactive authentication flow; and
- remain responsive on low-end Windows hardware.

## Orchestration contract

- Orchestrator: GPT-5.6 Sol, medium reasoning.
- Workers: GPT-5.6 Luna, max reasoning.
- The orchestrator owns architecture, task boundaries, integration, validation,
  commits, and this handoff document.
- Give each worker an exclusive file/scope boundary. Workers must not commit.
- Integrate and commit one independently reviewable ticket at a time.
- Do not discard or overwrite unrelated working-tree changes.
- Work only inside this repository. A safe execution profile grants write access
  to the repository, including `.git`, and denies filesystem access elsewhere.
- Network access should be limited to package registries, the configured Git
  remote, and official Claude/Codex installation and authentication endpoints.

## Target architecture

```text
React renderer
    |
typed, allow-listed window.bookWriter API
    |
context-isolated Electron preload
    |
validated IPC handlers in the Electron main process
    |
shared @book-writer/core services
    |-- SQLite application database
    |-- local manuscript and skill files
    `-- Claude CLI or Codex CLI child process
```

The packaged application should not start Fastify or expose a localhost port.
The existing server remains temporarily as an adapter over the shared core so
the web development path continues to work during migration.

Security requirements:

- `contextIsolation: true`, renderer sandbox enabled, and Node integration off;
- no raw `ipcRenderer`, filesystem, process, or shell object exposed to React;
- validate every IPC request, response, and streamed event;
- allow-list navigation and external URLs;
- serve packaged UI assets through a traversal-safe local protocol with a CSP;
- execute providers without a shell when possible and never pass secrets through
  renderer state, logs, or command-line arguments; and
- let each CLI own its credentials and authentication UI.

## Phased implementation plan

### Phase 0 - Baseline and safety net (complete)

- P0-01: establish the npm workspace, TypeScript base, desktop placeholder, and
  Vitest scaffolding.
- P0-02: add deterministic manuscript fixtures, provider JSONL fixtures, and a
  synthetic corpus/transcript generator.
- P0-03: add Windows CI and document the reproducible desktop baseline protocol.

Acceptance: workspace metadata is valid, fixtures are deterministic, and Windows
CI has typecheck/build/test entry points without requiring a real provider login.

### Phase 1 - Extract shared native core (complete)

- P1-01: centralize SQLite schema, migration, settings, and run-history helpers.
- P1-02: extract chapter, skill, help, review, world, and path services.
- P1-03: define provider-neutral execution events and normalize Claude/Codex
  streams into those events.
- Keep server modules as compatibility facades over `@book-writer/core`.

Acceptance: the server and desktop can share content, database, and normalized
provider contracts without Electron importing Fastify.

### Phase 2 - Secure Electron shell and IPC boundary (in progress)

- P2-01: create the secure single-instance main process, packaged UI protocol,
  path policy, and builder configuration.
- P2-02: create typed IPC contracts, runtime validation, structured errors, and
  the narrow preload bridge.
- P2-03: implement main-process IPC handlers by composing core services.
- P2-04: add lifecycle, protocol, path traversal, validation, and IPC integration
  tests; package and launch a smoke build.

Acceptance: the packaged renderer loads without a local server, cannot access
Node/Electron primitives, and can call tested native services only through the
allow-listed API.

### Phase 3 - Renderer transport migration

- Add a transport/service abstraction to the React UI.
- Implement an Electron transport using `window.bookWriter` and retain an HTTP
  transport for browser development until release parity.
- Replace direct `fetch` and EventSource assumptions with typed calls and
  provider-neutral streamed events.
- Migrate projects, chapters, skills, world notes, reviews, settings, search,
  run history, cancellation, and errors in small vertical slices.
- Add a desktop error boundary and offline/provider-unavailable states.

Acceptance: all supported UI workflows run in Electron with no Fastify process or
listening TCP port, while the existing web path remains usable.

### Phase 4 - Provider discovery, installation, and authentication

- Detect `claude` and `codex` using Windows executable resolution from the main
  process. Record executable path and version; do not trust renderer-supplied paths.
- Add an NSIS installation check that records whether either CLI is available.
  Do not make absence fatal: finish installing Book Writer and launch provider
  onboarding.
- On first launch, present three states: use detected CLI, install Claude, or
  install Codex. If neither exists, require a selection before enabling runs.
- Fetch installation instructions only from pinned/official sources or ship a
  versioned install recipe. Show the exact command and publisher before execution.
- Prefer a trusted Windows package manager where supported. Installation that
  modifies machine-wide locations must require normal Windows elevation; Book
  Writer itself must not silently elevate.
- Re-scan `PATH` and known installation locations after installation, display the
  discovered version, and let the user retry or choose an executable manually.
- Start the selected CLI's official interactive authentication command in a real
  visible terminal/PTY. The CLI, not Book Writer, prompts for credentials or opens
  the browser. Book Writer waits for exit, then performs a non-secret status/version
  check and reports success or actionable failure.
- Never collect, proxy, persist, or log passwords, API keys, OAuth codes, tokens,
  or the terminal's sensitive input.
- Allow provider switching and re-authentication later from Settings.
- Add mocked tests for missing CLI, install failure, stale `PATH`, cancelled auth,
  auth failure, successful auth, and both CLIs being installed.

Acceptance: a clean Windows user can install Book Writer, choose a provider,
install its CLI through an informed path, complete that CLI's own authentication,
and run a synthetic smoke prompt without WSL or containers.

### Phase 5 - Windows packaging, updates, and recovery

- Produce per-user x64 NSIS installers first; add arm64 only after verified demand.
- Package the compiled main/preload/core and built renderer, excluding source maps,
  tests, fixtures, server dependencies, and development tools from production.
- Store mutable database/log/settings data under Electron `userData`; never write
  inside the installation directory.
- Add schema backup and transactional migration before upgrading an existing DB.
- Define uninstall choices for preserving or removing user data.
- Sign the application and installer before distribution outside the family test.
- Add a release workflow that builds from a clean Windows runner and publishes
  hashes plus installer artifacts. Treat auto-update as a separate signed feature.

Acceptance: install, upgrade, repair/reinstall, and uninstall tests pass on a clean
Windows VM and preserve manuscripts by default.

### Phase 6 - Low-end performance pass

Measure before and after on a representative low-end Windows machine. Record cold
start, warm start, idle working set, large-project scan, first streamed token,
renderer responsiveness, and installer/package size.

Implement these improvements in measured order:

1. Remove Fastify and localhost networking from packaged production; call core
   services directly over IPC.
2. Start one renderer window and defer database scans, provider discovery, Markdown
   rendering, and nonessential indexes until after first paint.
3. Cache file metadata and hashes; rescan only changed directories/files instead of
   rereading the full manuscript on each launch.
4. Enable appropriate SQLite WAL/busy-timeout settings, reuse prepared statements,
   batch migrations/writes in transactions, and paginate history/search results.
5. Virtualize long chapter, skill, result, and history lists; memoize expensive
   Markdown and token-count work.
6. Buffer provider output and publish bounded UI updates (for example every
   16-50 ms) instead of triggering a React render for every token/event.
7. Move filesystem scans, parsing, indexing, and large normalization work off the
   renderer thread; use worker threads only after profiling proves a benefit.
8. Lazy-load infrequent UI routes and help content, tree-shake dependencies, exclude
   duplicate/native development binaries, and inspect the packaged artifact.
9. Bound logs, caches, retained run output, and in-memory event queues. Stream large
   output to disk/database rather than retaining multiple full copies.
10. Disable animations/transparency and reduce syntax/Markdown decoration when the
    app detects or the user selects reduced-performance mode.

Initial release budgets to validate and revise with real measurements:

- first usable window: <= 3 seconds cold and <= 1.5 seconds warm;
- idle combined working set: target <= 250 MiB;
- renderer interaction during streaming: no sustained task over 100 ms;
- no unbounded memory growth during a 30-minute provider stream; and
- initial full scan has visible progress and subsequent unchanged scan is <= 2 s
  on the agreed fixture/reference project.

### Phase 7 - Release qualification and handoff

- Run unit, IPC integration, renderer, provider-mock, installer, and upgrade tests.
- Test standard-user Windows accounts with no WSL, no Docker, neither CLI, each CLI
  separately, both CLIs, offline install, cancelled auth, and paths with spaces.
- Run a real opt-in smoke test for each provider without recording credentials or
  sensitive output.
- Document install, onboarding, data locations, backup/recovery, provider switching,
  troubleshooting, and complete removal.
- Keep rollback artifacts and a database compatibility statement for each release.

Acceptance: release checklist is signed off using a clean low-end Windows machine,
the installer hash is published, and all known limitations are documented.

## Current implementation state

Branch: `feature/Swapping-To-Native-Electron-App`

Committed checkpoints:

| Commit | Scope | State |
|---|---|---|
| `31f02a4` | P0-01 workspace and test scaffolding | Complete |
| `624b0a3` | P0-02 synthetic provider and benchmark fixtures | Complete |
| `e605e0e` | P0-03 Windows baseline workflow/documentation | Complete |
| `ee1dbd4` | P1 shared database, content, and execution core | Complete |

Phase 1 validation completed before commit:

- root, core, and server TypeScript checks passed;
- direct SQLite schema smoke check passed; and
- Vitest could not start in the managed sandbox because esbuild reported
  `Cannot read directory "../..": Access is denied`. No test assertion failed.

### Uncommitted Phase 2 work

The working tree intentionally contains a combined P2-01/P2-02 implementation.
It has not been integrated or committed. Do not run a cleanup/reset that would
discard it.

P2-01 files:

- `app/desktop/package.json`
- `app/desktop/electron-builder.yml`
- `app/desktop/tsconfig.json`
- `app/desktop/src/main/main.ts`
- `app/desktop/src/main/ipc.ts`
- `app/desktop/src/main/paths.ts`
- `app/desktop/src/main/preload.ts`
- `app/desktop/src/main/uiProtocol.ts`

Implemented: single-instance window lifecycle; secure BrowserWindow options;
navigation/window/webview guards; packaged/development path resolution; a secure
local UI protocol with CSP, `nosniff`, and traversal protection; user-data paths;
builder configuration; and an IPC registration placeholder.

Validation: JSON and builder YAML parsed; `git diff --check` found no content
errors. Full desktop TypeScript validation is blocked until Electron dependencies
are installed and locked.

P2-02 files:

- `app/desktop/src/shared/contracts.ts`
- `app/desktop/src/shared/errors.ts`
- `app/desktop/src/shared/validation.ts`
- `app/desktop/src/shared/window.d.ts`
- `app/desktop/src/preload/expose.ts`
- `app/desktop/src/preload/index.ts`
- `app/desktop/src/shared/contracts.test.ts`
- `app/desktop/src/preload/expose.test.ts`

Implemented: typed provider/project/content/run/search/settings contracts; fixed
IPC channel allow-list; request/response/event validators; serializable structured
errors; a context-isolated `window.bookWriter` API; filtered run subscriptions; and
unsubscribe behavior. Raw `ipcRenderer` is not exposed.

Validation: a targeted strict TypeScript check passed for the shared/preload
implementation. Vitest hit the same sandbox/esbuild startup error before executing
assertions.

## Exact next actions

1. Review the entire uncommitted desktop diff for contract mismatches and security
   issues. In particular, reconcile the P2-01 preload path with the P2-02 preload
   entry and remove the intentionally empty placeholder if it is no longer needed.
2. Install/update workspace dependencies and lock `electron`/`electron-builder`
   versions. Review the lockfile diff before accepting it.
3. Run desktop and root typechecks, focused tests, production build, package smoke
   test, and `git diff --check` outside the current esbuild-restricted sandbox.
4. Commit P2-01 and P2-02 separately if their file boundaries remain separable;
   otherwise make one clearly labeled P2 shell/boundary integration commit.
5. Implement P2-03 main-process handlers against `@book-writer/core`. Do not add
   renderer migration until IPC handler integration tests pass.
6. Continue with Phases 3-7 in order, updating this document after each accepted
   ticket and recording commit hashes, validation, deviations, and known issues.

Suggested immediate commit messages after review:

- `feat(P2-01): add secure Electron application shell`
- `feat(P2-02): expose validated desktop IPC contracts`

## Known risks and decisions still requiring evidence

- Electron 36 and native `better-sqlite3` packaging/ABI compatibility must be
  verified in a clean packaged build, not inferred from typechecks.
- The current root Vitest startup failure appears sandbox-specific but must be
  rerun outside that restriction before calling tests green.
- Claude and Codex installation/auth commands can change. Pin or verify official
  commands during Phase 4 and avoid embedding an unmaintained arbitrary download.
- Code signing, certificate ownership, distribution location, and update policy
  have not yet been selected.
- Performance budgets are initial targets, not measured results. Baseline and
  release numbers must identify hardware, data set, commit, and cold/warm state.
- The server compatibility path should be removed from packaged production only
  after renderer parity is demonstrated; source removal is a later explicit choice.

## Handoff verification commands

Run from the repository root:

```powershell
git branch --show-current
git status --short
git log --oneline -8
git diff --check
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

Expected at this handoff: the four commits above are present and the Phase 2 files
listed above are modified/untracked. Typecheck/build may require dependency
installation. If Vitest reports the documented esbuild access error before loading
tests, record it as an environment blocker rather than a passing or failing test.
