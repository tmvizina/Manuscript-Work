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

Resume at the handoff's **Exact next actions**. Phase 2 is complete through
`a5dc10e`; the immediate objective is Phase 3 renderer transport migration:

- inventory direct renderer HTTP/EventSource usage and define a transport interface;
- preserve the HTTP transport for browser development;
- add an Electron transport using only `window.bookWriter`;
- migrate project/chapter/world/search as the first read-only vertical slice; and
- add transport/component/error-state tests before migrating mutations and runs.

Provider install/auth methods belong to Phase 4. Keep them explicitly unavailable
until the trusted CLI discovery/install/auth design is implemented; never collect
credentials or expose raw Electron/process/filesystem objects to React.

Phase 4 now requires offline-first onboarding: the release pipeline embeds pinned,
verified Windows x64 Claude and Codex payloads in the Book Writer installer, and the
first-run wizard installs the selected payload per-user without a network download.
Do not download or embed an artifact until its exact version, official source,
license/redistribution rights, SHA-256, signature/publisher identity, and update
policy are approved and recorded. Keep existing-CLI, local-installer, and explicit
official-online-install fallbacks. Authentication remains the CLI's own visible
interactive flow and may require provider network access.

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
