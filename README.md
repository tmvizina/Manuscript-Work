# Book Writer

Book Writer is a local-first manuscript workspace for planning, drafting,
reviewing, revising, formatting, and preparing text for narration. It supports
the original fantasy workflow and a reusable nonfiction profile designed for a
practical fly-fishing and night-fishing book.

This repository contains the text-authoring side of the pipeline. Audio
generation, cloud audio repair, and image generation are intentionally out of
scope.

## What it does

- Keeps project memory in a portable `world/` folder. Fantasy projects use it
  as world canon; nonfiction projects present it as a Knowledge Base.
- Provides guided workflows for note intake, outline development, human
  structure review, chapter planning, drafting, editorial review, revision,
  formatting, title cleanup, and TTS-safe text chunking.
- Preserves author voice and stable IDs such as `CHAR-NNN`, `THR-NNN`,
  `RV-NNN`, and `EP-NNN`.
- Runs Claude Code or Codex CLI through a native Windows desktop boundary,
  without WSL, Docker, a localhost production server, or stored provider
  credentials.
- Stores application data below the Windows user profile while leaving source
  manuscripts in their chosen folders.

## Start here

If you received a Windows installer, follow the
[first-time install and user guide](docs/windows-first-time-install.md). It
covers verification, installation, first launch, project import, provider
sign-in, the first workflow, backups, updates, removal, and troubleshooting.

Current installers are family-test candidates unless a release owner supplies
a valid Authenticode signature and published SHA-256 hash. Do not broadly
distribute an unsigned build.

### Choose a project profile

- **Fantasy** uses the established world-canon model for characters, locations,
  arcs, threads, voice, and continuity.
- **Fly & Night Fishing** creates a nonfiction `practical-narrative` profile.
  The same physical `world/` directory becomes a Knowledge Base for author
  voice, audience, techniques, equipment, species, conditions, places, people,
  stories, claims, sources, safety/regulations, terminology, and continuity.

Existing project files are never overwritten when a profile is scaffolded.
Changing regulations and safety claims still need a jurisdiction, source,
checked date, and verification status.

## Editorial workflow

The usual new-book path is:

1. `world-notes-seeder` captures notes, interviews, photographs, and sources.
2. `outline-enhancer` turns the concept into a structured outline and seeds
   project memory.
3. `story-arc-reviewer` pauses for human decisions about structure, coverage,
   omissions, and unresolved facts.
4. `manuscript-planner` produces writer-ready chapter briefs.
5. `manuscript-writer-v2` drafts or revises while protecting voice and
   provenance.
6. `book-reviewer-v2` creates stable `RV-NNN` findings.
7. `manuscript-editing-planner-v2` turns accepted findings into `EP-NNN` work.
8. Repeat writing/review as needed, then use `novel-formatting`, optional
   `chapter-title-cleanup`, and `audiobook-text-prep-chunker`.

RAG-aware variants are optional and never replace reading the actual manuscript
passages being reviewed or edited.

## Use with Codex or Claude Code

Open this repository as the workspace. Codex reads `AGENTS.md` and discovers
adapters under `.agents/skills/`; invoke a workflow with `$skill-name` or
describe the task normally. Canonical workflow instructions live in `skills/`
and `skills-rag/`. The `.claude/` directory remains for legacy Claude Code
compatibility.

For substantive reviews, editing plans, and writing passes, prefer the v2
skills. Use a `-rag` variant only when the Book Writer RAG service is available
and focused canon retrieval will help.

## Desktop development

Requirements:

- Windows x64 for packaging and installer qualification
- Node.js `>=22.12.0 <25` (the clean release workflow pins 22.14.0)
- npm, using the committed `package-lock.json`

From the repository root:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Build the Windows installer without launching it:

```powershell
npm.cmd run package --workspace book-writer-desktop
npm.cmd rebuild better-sqlite3
npm.cmd run audit:package --workspace book-writer-desktop
```

Packaging temporarily rebuilds `better-sqlite3` for Electron's ABI. The second
command restores the workspace copy for Node/Vitest; the packaged copy is
detached so it remains Electron-compatible.

The headless performance probe is:

```powershell
npm.cmd run benchmark:phase6 -- -Mode safe
```

GUI launch measurement is deliberately disabled unless explicitly enabled on a
clean disposable Windows VM. Do not run it on a normal working account.

## Architecture

- `app/desktop/` — secure Electron main/preload boundary and Windows packaging
- `app/ui/` — shared React renderer with native Electron and legacy HTTP transports
- `packages/core/` — shared SQLite, project, content, search, and execution logic
- `app/server/` — browser compatibility server; not packaged in production
- `skills/`, `skills-rag/` — canonical authoring workflows
- `.agents/skills/` — Codex discovery adapters
- `samples/` — sample manuscript, report, chunk, and manifest formats
- `test/` — provider fixtures, packaging checks, and benchmarks

Production Electron calls core services directly over typed IPC. The renderer
cannot choose executable paths, access Node, navigate to arbitrary content, or
receive raw provider/private events.

## Data, privacy, and recovery

Book Writer does not collect provider passwords, API keys, OAuth codes, or
tokens. Authentication happens in the provider's own terminal/browser. Prompts
and model responses may still be retained by the provider and in local run
history, so use synthetic content for release smoke tests.

On Windows, application state is under `%APPDATA%\Book Writer`; imported
manuscript folders stay where the user selected them. Database upgrades create
an integrity-checked pre-migration backup. Default uninstall preserves local
application data, and external manuscript folders are never uninstall targets.

See:

- [Windows installation, upgrade, and recovery](docs/windows-installation.md)
- [Windows release workflow](docs/windows-release.md)
- [Release qualification checklist](docs/windows-release-qualification.md)
- [Rollback and database compatibility](docs/windows-rollback-and-database-compatibility.md)
- [Phase 6 performance evidence](docs/performance/phase6-windows-benchmarks.md)
- [Electron migration handoff](docs/electron-migration-handoff.md)

## Current release status

Phases 4–6 are implemented and locally validated. Phase 7 repository tests,
checklists, rollback guidance, and compatibility evidence are present. A public
release remains on hold until a release owner completes the signed clean-machine
matrix, publishes the installer hash, resolves the GUI launch exception observed
by the automated benchmark attempt, records low-end measurements, and approves a
bounded real Codex provider smoke.

Known product limits include Windows x64-only packaging, no auto-update,
disabled embedded provider payloads pending redistribution approval, and native
literal search rather than semantic RAG in the desktop build.
