# Next Codex Session Prompt

Copy everything below into a new Codex session opened at
`C:\Users\tmviz\RiderProjects\Manuscript-Work`.

---

Continue the native Windows Electron migration in this repository.

Use GPT-5.6 Sol with medium reasoning as the primary orchestrator. Delegate
bounded implementation and review tickets to GPT-5.6 Luna workers with max
reasoning. Workers must have exclusive file/scope boundaries and must not commit;
the orchestrator reviews, integrates, validates, updates the handoff, and commits.

Security and authorization boundaries:

- Work only inside `C:\Users\tmviz\RiderProjects\Manuscript-Work`, including its
  `.git` directory. Do not read from or write to the rest of the machine.
- Do not use global/full-machine filesystem access.
- Repository edits, `git add`, and `git commit` are authorized.
- Network access is authorized only as needed for this repository's package
  dependencies, configured Git remote, and official Claude/Codex documentation or
  installation endpoints.
- Do not publish, push, open a PR, install machine-wide software, launch provider
  authentication, or run a real paid provider prompt without asking first.
- Preserve all existing user and agent changes. Never clean, reset, checkout, or
  delete uncommitted work to make the tree clean.

Before making changes:

1. Read `AGENTS.md` completely.
2. Read `docs/electron-migration-handoff.md` completely. It is the canonical
   migration plan and current-progress record.
3. Inspect `git status --short`, `git log --oneline -8`, and the complete
   uncommitted `app/desktop` diff.
4. Confirm the branch is `feature/Swapping-To-Native-Electron-App` and that the
   four committed checkpoints named in the handoff are present.
5. Confirm the uncommitted P2-01/P2-02 files are present. They are valuable
   in-progress work, not disposable changes.
6. Check whether this session can write repository `.git` metadata without
   machine-wide access. If it cannot, do not generate repeated approval prompts;
   explain the missing repo-scoped permission once and stop before commit work.

Resume at the handoff's **Exact next actions** section. The immediate objective is
to integrate and finish Phase 2 safely:

- review P2-01/P2-02 for security and contract mismatches;
- reconcile the main-process preload path/placeholder with the implemented preload
  entry point;
- install and lock workspace dependencies if the scoped network policy permits it;
- run desktop/root typechecks, focused tests, build, package smoke checks, and
  `git diff --check`;
- distinguish actual test failures from the documented managed-sandbox/esbuild
  startup restriction;
- commit the reviewed P2 shell and preload/contract work in coherent commits;
- implement P2-03 native IPC handlers against `@book-writer/core`; and
- add P2-04 integration/security tests before starting renderer migration.

Use workers in parallel only where their files cannot overlap. A suitable first
split is:

- Luna worker A: security and lifecycle review of `app/desktop/src/main/**` plus
  builder configuration; report findings or make narrowly scoped fixes.
- Luna worker B: contract/preload review and focused tests under
  `app/desktop/src/shared/**` and `app/desktop/src/preload/**`.
- Luna worker C: independently map core services to the required P2-03 IPC handlers
  and propose a file-level implementation plan without editing worker A/B files.

The orchestrator should continue useful local integration work while workers run.
Review every worker result and the actual diff; do not accept summaries as proof.

Implementation constraints:

- The packaged application must not require Docker, containers, WSL, Fastify, or a
  localhost server.
- Keep the existing server/browser path working as a compatibility path until
  desktop parity is demonstrated.
- Maintain context isolation, sandboxing, Node integration off, strict navigation
  guards, typed allow-listed IPC, runtime validation, and no raw Electron/process/
  filesystem exposure to React.
- Do not collect or store provider credentials. Phase 4 must hand authentication to
  the chosen CLI's own interactive flow.
- Preserve the required installer/first-run flow for detecting, selecting,
  installing, and authenticating Claude CLI or Codex CLI.
- Optimize for low-end Windows hardware using measurement, not guesses. Retain the
  performance targets and optimization backlog in the handoff.

After each integrated ticket:

1. Run validation proportional to the change.
2. Review `git diff` and `git diff --check`.
3. Commit only the intended files with a phase/ticket-scoped message.
4. Update `docs/electron-migration-handoff.md` with commit hash, completed work,
   tests/results, environment blockers, deviations, and the new exact next action.

Continue autonomously through the phased plan while safe, relevant work remains.
Do not call a phase complete unless its acceptance criteria are actually met. At
handoff, provide the branch, new commits, tests run, failures/blockers, uncommitted
files, and the precise next ticket.

---
