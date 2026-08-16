# First-time Windows install and user guide

This guide takes a new user from an installer file to a first Book Writer
workflow. It applies to the current Windows x64 desktop candidate.

It assumes a reader who can verify a hash and read a signature status. For
someone installing an unsigned family build who does not need that,
[Installing Book Writer](windows-install-for-family.md) covers the same ground
in plain language, including what to do at the SmartScreen warning.

## Before you install

You need:

- a standard Windows x64 user account;
- a Book Writer installer named like `Book Writer-0.1.0-x64.exe`;
- the SHA-256 value supplied with that exact installer; and
- either Claude Code CLI or Codex CLI if you want to run an AI workflow.

Book Writer itself does not require WSL, Docker, Node.js, or administrator rights
when installed normally. Provider authentication and hosted model use generally
require internet access.

### Verify the installer

For an approved release, compare the published hash:

```powershell
Get-FileHash -LiteralPath '.\Book Writer-0.1.0-x64.exe' -Algorithm SHA256
Get-AuthenticodeSignature -LiteralPath '.\Book Writer-0.1.0-x64.exe'
```

The hash must match character for character. A broadly distributed/tagged build
must report a valid Authenticode signature from the approved publisher. Current
family-test candidates may be unsigned; Windows may warn about an unknown
publisher. Continue with an unsigned installer only when you obtained it
directly from the trusted family-test owner and independently verified its hash.

## Install Book Writer

1. Close any existing Book Writer window.
2. Double-click the verified installer.
3. Keep the default per-user location unless you have a reason to change it.
4. Finish the wizard. The default install does not need elevation.
5. Launch Book Writer from the Start menu or desktop shortcut.

If Windows blocks the file, stop and verify its source, hash, and signature. Do
not bypass a warning for a file received unexpectedly.

## Create or import your first project

Book Writer does not move your manuscript. Choose the folder that should remain
the source of truth, preferably one already backed up or under version control.

On the first project screen choose one profile:

- **Import Fantasy Book** for characters, locations, arcs, threads, voice, and
  continuity canon.
- **Import Fly & Night Fishing Book** for a nonfiction Knowledge Base covering
  voice, audience, techniques, equipment, species, conditions, places, people,
  stories, claims, sources, safety/regulations, terminology, and continuity.

The nonfiction option writes a portable `.book-writer/project.json` and creates
missing Knowledge Base scaffolding beneath `world/`. It does not overwrite
existing files. The physical name remains `world/` so the same workflows and
tools work across profiles.

For a fishing book, start by adding the author's field notes, memorable trips,
equipment preferences, night-fishing procedures, local knowledge, and interview
or photograph provenance. Treat regulations, access rules, weather hazards, and
safety guidance as time-sensitive claims: record jurisdiction, source, checked
date, and verification status.

## Set up a provider

Book Writer recognizes only Claude Code and Codex CLI. It never accepts an
arbitrary renderer-supplied executable path.

1. Open **Provider Setup**.
2. Select Claude or Codex.
3. If it is already installed, choose **Rescan**. Per-user installs and command
   shims are supported, including paths containing spaces.
4. If it is missing, open the provider's official instructions or choose a
   trusted local `.exe`/`.msi` installer. Book Writer does not download or run
   bootstrap scripts.
5. Choose **Sign in**. Complete authentication only in the provider's own visible
   terminal/browser, then close it normally.
6. Return to Book Writer and confirm that the provider shows **Ready**.

Book Writer never asks you to paste a password, API key, OAuth code, or token.
Canceling sign-in is safe; retry or switch providers from Settings. Embedded
offline provider payloads are currently disabled pending redistribution and
publisher approval.

## Run a first workflow

For a new fishing project, a practical sequence is:

1. Open **World Notes Seeder** and point it at field notes or source material.
2. Review the proposed Knowledge Base entries and unresolved facts. Do not turn
   uncertain memories into verified claims.
3. Use **Outline Enhancer** to develop the book concept.
4. Complete the **Story Arc Reviewer** human checkpoint for audience, structure,
   coverage, omissions, and author decisions.
5. Use **Manuscript Planner** for chapter briefs, then **Manuscript Writer v2**
   for a draft.

For an existing manuscript, begin with **Book Reviewer v2**, then use
**Manuscript Editing Planner v2** and **Manuscript Writer v2**. Keep optional
style suggestions separate from correctness, continuity, safety, and sourcing
fixes.

Before sending a prompt, confirm the selected project and provider. Prompts and
responses can be stored in local run history and may be retained by the hosted
provider. Do not use real manuscript material for a release smoke test.

## Where your data lives

Application data is below `%APPDATA%\Book Writer`:

- `data\book-writer.db` — projects, settings, snapshots, and run history;
- `backups\` — automatic pre-migration database backups;
- `logs\` — desktop logs; and
- provider/setup metadata and remembered project roots.

Your manuscript and `world/`/Knowledge Base stay in the project folder you
selected. A database backup is not a manuscript backup. Back up both locations,
and close Book Writer before copying or restoring its database.

## Update, repair, or roll back

Verify every new installer and hash before running it. A schema upgrade creates
an integrity-checked backup before the transactional migration. Same-version
repair/reinstall should preserve application data.

There is no automatic downgrade. To return to an older app version, close Book
Writer and restore a database backup whose schema that version supports; never
edit `PRAGMA user_version` to force compatibility. Follow the
[rollback and database compatibility policy](windows-rollback-and-database-compatibility.md).

## Uninstall

Default uninstall removes the application but preserves Book Writer's local
data, allowing a later reinstall to recover it. The assisted uninstaller offers
an unchecked **Remove all local Book Writer data** option. Select it only when
you intend to remove the database, settings, logs, and remembered projects.

Uninstall never removes external manuscript or Knowledge Base folders. Delete
those separately only after confirming you have the correct folder and backup.

## Troubleshooting

### Provider is not found

- Install it for the same Windows account running Book Writer.
- Restart Book Writer after changing `PATH`, then use **Rescan**.
- In Settings, select an already-installed `claude.exe`/`.cmd` or
  `codex.exe`/`.cmd` from a trusted location.
- Do not rename an unrelated executable to bypass provider checks.

### Provider needs authentication

Run **Sign in** again and finish in the provider's own terminal/browser. If you
canceled it, retry. Book Writer stores status, not the credential itself.

### A project or chapter is missing

- Confirm the remembered project root still exists and is not a symlink.
- Chapter files should follow `Chapter NN - Title.txt` under a supported chapter
  folder.
- Use **Refresh** after editing files outside Book Writer.
- Check that the Windows account can read the folder.

### Install or launch fails

- Recheck the installer hash and signature.
- Do not run multiple Book Writer instances during repair or measurement.
- Preserve `%APPDATA%\Book Writer` before troubleshooting an upgrade.
- Retain the exact error text, Windows build, installer hash, and relevant logs,
  but redact usernames, absolute personal paths, manuscript text, and provider
  account information.

An automated GUI benchmark produced repeated Electron exception dialogs on the
development workstation and remains disabled by default. The mechanism behind
the hang is fixed: the main process no longer relies on Electron's default
uncaught-exception handler, which displayed a modal dialog and left the process
alive until someone dismissed it. A main-process fault now logs and exits under
a bounded shutdown instead, so an unattended run fails rather than hanging.

What produced the original faults is still unknown — they did not reproduce on
the development workstation after the fix, and the crash guard converts such a
fault into a log entry rather than explaining it. Release owners should still
diagnose that path on a clean disposable Windows machine and check
`%APPDATA%\Book Writer\logs` for recorded exceptions. Normal users should not
enable the experimental GUI benchmark.

## More help

- [Windows installation, upgrade, and recovery](windows-installation.md)
- [Windows release workflow](windows-release.md)
- [Phase 7 release qualification checklist](windows-release-qualification.md)
- [Phase 6 performance notes](performance/phase6-windows-benchmarks.md)
- [Repository overview](../README.md)
