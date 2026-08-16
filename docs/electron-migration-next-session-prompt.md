# Next Codex Session Prompt

Copy everything below into a new Codex session opened at
`C:\Users\tmviz\RiderProjects\Manuscript-Work`.

---

Continue the native Windows Electron migration in this repository.

Use GPT-5.6 Sol with medium reasoning as the primary orchestrator. Delegate
bounded implementation and review tickets to GPT-5.6 Luna workers with max
reasoning. Workers must have exclusive file/scope boundaries and must not commit;
the orchestrator reviews, integrates, validates, updates the handoff, and commits.

Work only inside this repository, including `.git`. Repository edits, dependency
installation, `git add`, and `git commit` are authorized. Network access is limited
to repository dependencies, the configured Git remote, and official provider
documentation/endpoints. Do not publish, push, open a PR, install machine-wide
software, launch provider authentication, or run paid provider prompts without
asking first. Preserve all existing work; never clean/reset/checkout/delete it to
make the tree clean.

Before editing:

1. Read `AGENTS.md` and `docs/electron-migration-handoff.md` completely.
2. Inspect `git status --short`, `git log --oneline -8`, and relevant diffs.
3. Confirm branch `feature/Swapping-To-Native-Electron-App` and the checkpoints in
   the handoff, including P2 review fix `6ca8e2b` and its traversal prerequisite
   `68a065a`.
4. Treat `25446a6` only as the temporary Git-permission checkpoint it was; its P2
   contents were reviewed and corrected by the later commits.

Resume at the handoff's **Exact next actions**. P2-01/P2-02 are reviewed and
validated; Phase 2 remains incomplete. The immediate objective is P2-03/P2-04:

- fix the project-scoping and contract blockers before registering handlers;
- define project onboarding/open semantics and lightweight world summaries;
- add project-scoped chapter/settings schema and multi-project collision tests;
- add core project, settings, run-history, and bounded literal-search services;
- design race-free run subscription/replay and lifecycle ownership;
- establish a compiled/packaged core strategy including `schema.sql` and Electron-
  rebuilt `better-sqlite3`;
- implement injected, sender-authorized, main-validating IPC handlers; and
- add IPC/lifecycle/security/native-package tests before renderer migration.

Provider install/auth methods belong to Phase 4. Keep them explicitly unavailable
until the trusted CLI discovery/install/auth design is implemented; never collect
credentials or expose raw Electron/process/filesystem objects to React.

Maintain context isolation, renderer sandboxing, Node integration off, strict
navigation/permission guards, typed allow-listed IPC, runtime validation, and the
browser/server compatibility path. The packaged app must not require Fastify,
localhost, Docker, containers, WSL, or a shell for normal execution.

After each integrated ticket:

1. Run proportional focused validation plus root typecheck/test/build where useful.
2. Review the actual diff and run `git diff --check`.
3. Commit only intended files with a phase/ticket-scoped message.
4. Update `docs/electron-migration-handoff.md` with hashes, results, blockers, and
   the precise next action.

The managed sandbox blocks esbuild/Vitest directory reads on this machine. When
repository-scoped elevated execution is available, use it and distinguish startup
restriction from assertion failures. The last accepted baseline passed 30/30 tests,
the full build, an unpacked electron-builder package, ASAR layout inspection, and a
five-second repository-local launch smoke test.

Continue autonomously while safe work remains. Do not call Phase 2 complete until
its acceptance criteria and packaged native-module checks actually pass.

---
