# Native Electron Migration: Plan and Implementation Handoff

Last updated: 2026-08-16

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

### Phase 2 - Secure Electron shell and IPC boundary (complete)

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
- Ship pinned Windows x64 provider payloads with the Book Writer installer so the
  normal first-run CLI installation path does not require a download. Bundle a
  provider only after its selected version's license and redistribution terms have
  been approved.
- Acquire each payload from the provider's official release endpoint during the
  controlled release build. Record provider, version, architecture, source URL,
  license, SHA-256, and available publisher/signature metadata in a checked-in
  manifest/SBOM; fail the release if verification does not match.
- Before installation, verify the embedded payload again and show its provider,
  version, publisher, install location, and requested privileges. Refuse a missing,
  stale, or mismatched payload rather than falling back silently.
- Prefer a direct signed standalone binary or installer and a per-user location;
  do not run a downloaded PowerShell/npm bootstrap script from the wizard. Book
  Writer must not silently elevate or modify machine-wide locations.
- Keep explicit recovery choices: select an already-installed executable, choose a
  local installer, or opt into the provider's official online installation path.
  These are fallbacks, not the default first-run path.
- Re-scan `PATH` and known installation locations after installation, display the
  discovered version, and let the user retry or choose an executable manually.
- Start the selected CLI's official interactive authentication command in a real
  visible terminal/PTY. The CLI, not Book Writer, prompts for credentials or opens
  the browser. Book Writer waits for exit, then performs a non-secret status/version
  check and reports success or actionable failure.
- State clearly that bundled installation is offline, but provider authentication
  and hosted model use can still require network access.
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
| `25446a6` | Temporary P2 shell/contract checkpoint used to verify repository commit access | Superseded by review fixes |
| `68a065a` | Reject lexical traversal segments in shared content paths | Complete |
| `6ca8e2b` | Integrate and validate the secure Electron preload boundary | Complete |
| `50bdc29` | Record the reviewed P2 shell and preload handoff | Complete |
| `f19f6ca` | Add project-scoped persistence and run lifecycle primitives | Complete |
| `56bc227` | Add replay-safe IPC subscription contracts and preload bridge | Complete |
| `62913f7` | Package the core and Electron-native SQLite runtime | Complete |
| `91f1817` | Add trusted chapter sync and bounded literal search | Complete |
| `6b7eac6` | Register sender-authorized native IPC services | Complete |
| `a5dc10e` | Add replayable native run manager and deterministic runner seam | Complete |
| `08a95be` | Add the renderer transport and first read-only native vertical slice | Complete |
| `aa2ce89` | Make packaged SQLite rebuilding target the Electron ABI deterministically | Complete |
| `6a7313d` | Add renderer-level failure recovery without exposing error details | Complete |

### Reviewed P2-01/P2-02 foundation

The original combined checkpoint in `25446a6` was created only to verify that the
session could write repository Git metadata. It was subsequently reviewed and
corrected in `6ca8e2b`; do not treat the checkpoint itself as an acceptance gate.

P2-01 now provides the single-instance lifecycle, ESM-safe main path resolution,
secure BrowserWindow settings, default-denied permission handlers, packaged/dev
navigation isolation, a traversal-safe local UI protocol, a production CSP,
user-data paths, and an allow-listed builder layout. The obsolete empty preload
was removed.

P2-02 now provides the typed allow-listed `window.bookWriter` bridge with stricter
request, response, event, structured-error, and JSON validation. Private/unknown
event fields, invalid callbacks, non-finite JSON numbers, cyclic values, and
unsupported request properties are rejected. Decimal chapter numbers remain
supported.

The sandboxed Electron preload is bundled as one CommonJS file at
`dist/preload/index.cjs`; main/shared code remains ESM. Electron `36.9.5`,
electron-builder `26.15.3`, and esbuild `0.25.0` are pinned and locked.

### Completed P2-03/P2-04 native boundary

The desktop main process now opens the application database below Electron
`userData`, resolves project roots only from trusted stored records, synchronizes
project-scoped chapters without touching the legacy server table, serves physically
contained world files, runs bounded literal search, and enforces a project-setting
key/value allow-list. Every IPC request is revalidated in main and authorized to the
registered application's exact main frame; responses are explicitly mapped and
validated before crossing the boundary.

The injected run manager owns provider handles, persistence, cancellation,
subscription IDs, monotonic renderer sequences, live-before-replay registration,
and a replay buffer capped by `RUN_REPLAY_LIMIT`. Provider raw/private/unknown data
is not forwarded. The deterministic fake runner exercises the lifecycle without a
paid or authenticated provider call; production provider execution, installation,
and authentication remain explicitly unavailable until Phase 4.

Validation completed through `a5dc10e` on 2026-08-16:

- root typecheck passed for server, core, desktop, and UI;
- the full Vitest suite passed before the final Electron-native rebuild: 12 files
  and 65 tests;
- the full production build passed;
- electron-builder produced `dist/desktop/win-unpacked` successfully;
- the packaged ASAR contained only the allow-listed main/shared JS, bundled
  preload, and package metadata, with the built UI under `resources/ui`;
- the packaged Electron runtime imported `@book-writer/core`, loaded the unpacked
  `better-sqlite3` binary, opened the embedded schema in memory, and executed a
  direct database smoke query successfully;
- the final packaged runtime opened a trusted project, synchronized decimal chapter
  `2.5`, and returned `FEATURE_UNAVAILABLE` without launching a provider;
- ASAR inspection confirmed that only `contracts.js`, `manager.js`, and
  `sanitize.js` from the run subsystem ship; the fake runner and tests are excluded;
- the unpacked executable remained running during a five-second launch smoke test
  using repository-local temporary user data, then was stopped cleanly; and
- `git diff --check` and staged checks passed.

The system Node and Electron use different native ABIs on this machine. Validation
therefore rebuilt `better-sqlite3` for Node before Vitest, then electron-builder
rebuilt it for Electron before the final package/native smoke. This is expected
native-module state, not a test failure.

Phase 2 acceptance criteria are met.

### Phase 3 read-only renderer slice

The React renderer now selects a typed HTTP or Electron transport at runtime.
The Electron adapter detects only the allow-listed `window.bookWriter` shape and
normalizes structured errors without importing Electron or Node. The browser
adapter preserves the existing health, chapter, chapter-sync, and world routes.
It deliberately does not present semantic RAG as equivalent to native bounded
literal search; browser RAG remains on its existing page.

Project list/open and selection, chapter list/read/refresh, flat native world
list/read, and native bounded search are wired through the transport. Native
Markdown is rendered as inert text because the desktop boundary returns source
text, while the compatibility server retains its existing rendered-HTML path.
Project settings, bundled skill metadata, provider-neutral run history/start/
cancel/replay-safe subscription, review documents, desktop Help, project import,
and nonfiction/fantasy profiles are now migrated. Native review documents remain
inert source text. Real provider execution is deliberately unavailable, and RAG
remains explicitly gated, so a packaged renderer never silently falls back to
`/api` or localhost.

Validation completed through `aa2ce89` on 2026-08-16:

- root typecheck passed for server, core, desktop, and UI;
- the full Vitest suite passed with 15 files and 75 tests after rebuilding
  `better-sqlite3` for the system Node ABI;
- the focused final renderer suite passed with 4 files and 11 tests, including
  HTTP/Electron selection, response adaptation, search-semantics separation, and
  flat native world grouping;
- the full production build passed;
- the canonical `package:dir` workflow built the UI, main, preload, and core,
  explicitly rebuilt `better-sqlite3` for Electron `36.9.5`, and produced the
  unpacked Windows application;
- an initial package smoke exposed electron-builder's implicit rebuild retaining
  system Node ABI 137 instead of Electron ABI 135; `aa2ce89` replaced that
  unreliable implicit step with explicit `electron-rebuild` targeting the pinned
  Electron version; and
- the corrected unpacked executable remained alive through a five-second hidden
  launch with repository-local user data, after which all spawned app processes
  and temporary smoke data were removed.

The first Phase 3 read-only slice is complete. Phase 3 overall remains in progress.
The renderer root is also protected by an error boundary that replaces unexpected
component failures with a details-free reload action. Its focused recovery test and
UI production build passed after `6a7313d`.

Additional Phase 3 validation on 2026-08-16 passed the root TypeScript surfaces
and the full Vitest suite with 18 files and 85 tests. The suite required the
documented repository-scoped sandbox exception for Vitest/esbuild.

## Exact next actions

Phase 4 began on 2026-08-16 with main-process-only Windows provider discovery.
The discovery service resolves allow-listed `claude` and `codex` names from PATH,
prefers direct executables, supports Windows command shims, records bounded version
output, and reports missing/version-failure states without accepting renderer paths.
Native Provider Setup and Settings expose rescan and per-project provider selection.
A detected CLI remains `auth_required`; workflow execution stays disabled until a
separate authentication check marks it ready. Installation remains visibly gated
because no provider payload has redistribution approval, publisher evidence, and a
verified checked-in SHA-256 manifest yet. A strict offline-only manifest parser and
local payload verifier now reject unknown fields, missing approvals, stale approval,
unapproved sources, metadata mismatch, unreadable payloads, and SHA-256 mismatch;
no actual provider manifest or payload is bundled. Focused Provider Setup and Native
Skill renderer tests cover missing, detected/auth-required, selection, rescan, and
run gating without network calls. Root typecheck, 22 test files/104 tests, the
production build, and diff validation passed for these slices.

The next Phase 4 slice now adds explicit authentication readiness probes and a
main-process-owned interactive sign-in service. Claude uses `claude auth login`
and verifies with the ephemeral, non-persisted `claude auth status --json` result;
Codex uses `codex login` and verifies by the documented exit status of
`codex login status`. Only those probes can produce `ready`; a version check or
zero exit from the login command is not sufficient. On Windows the provider is
started with hardcoded arguments in its own visible console, inherited terminal
I/O, no shell for direct executables, and no Book Writer stdout, input, credential,
or token capture. Command shims are constrained to the discovered canonical path,
trusted `ComSpec`, hardcoded arguments, and metacharacter rejection. Authentication
requests are deduplicated per provider, can be cancelled through a provider-only
IPC request, and are cancelled during runtime shutdown. Provider Setup supports
sign-in/cancel, and Settings supports provider switching and re-authentication.
Installation remains gated exactly as above.

Validation for this slice on 2026-08-16: root typecheck passed; all 25 Vitest files
and 117 tests passed; the full production build and unpacked x64 package passed;
the packaged GUI launched without a parent console, remained responsive, and
contained the authentication main module and narrow preload. Native Settings and
Reviews tests also prove their Electron transports issue no HTTP requests. A manual
sign-in smoke is still required to visually prove the separate provider terminal,
keyboard interaction, cancellation, and post-auth readiness before this
authentication slice is treated as release-accepted.

1. Package the current build and run a no-parent-console Windows smoke for Claude
   and Codex authentication; verify visible keyboard interaction, terminal close,
   explicit cancellation, post-auth readiness, and absence of credential logging.
2. Run the remaining packaged page-navigation smoke and confirm Provider Setup,
   Settings, Native Skill, and Reviews render without HTTP requests; their focused
   transport tests are now present.
3. Decide whether RAG becomes an embedded native index or remains an optional
   external compatibility service; do not disguise semantic RAG as literal search.
4. Implement the offline-first provider payload manifest and install wizard
   flow above only after release engineering confirms redistribution rights and
   selects the pinned Claude and Codex artifacts.

## Known risks and decisions still requiring evidence

- The unpacked packaged Electron runtime can load native `better-sqlite3`, the
  embedded schema, and the native service facade. A clean installed-app test remains
  a Phase 5 qualification item.
- Vitest and esbuild require execution outside the managed filesystem sandbox on
  this machine; the full suite passes when granted repository-scoped access.
- `electron-rebuild` changes the shared workspace `better-sqlite3` binary to the
  Electron ABI. After packaging, run `npm.cmd rebuild better-sqlite3` before the
  Node/Vitest suite; the packaged copy under `dist` remains Electron-compatible.
- Bundling Claude and Codex payloads is the approved offline-first design, but the
  exact artifacts, redistribution terms, signatures, update cadence, installer-size
  impact, and revocation response remain Phase 4 release gates. Never embed an
  unverified or unmaintained arbitrary download.
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

Expected at this handoff: the checkpoint table above is present, the working tree
is clean, dependencies are installed/locked, and the listed checks pass when run
with repository-scoped access outside the managed esbuild filesystem restriction.
