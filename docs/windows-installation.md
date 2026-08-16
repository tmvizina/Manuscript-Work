# Windows installation, upgrade, and recovery

For release-owner qualification, see the [Phase 7 Windows release checklist](windows-release-qualification.md)
and [rollback and database compatibility policy](windows-rollback-and-database-compatibility.md).

Book Writer currently ships as a per-user Windows x64 NSIS installer. It does
not require administrator rights for the default installation. Family-test
artifacts are unsigned; do not distribute them more broadly until the project
has an approved code-signing certificate and policy.

## Install and provider setup

Run `Book Writer-<version>-x64.exe`, choose the default per-user location, and
launch Book Writer. A new project without a preferred provider opens Provider
Setup. Book Writer can use a detected CLI, a main-process-selected installed
executable, a user-selected local installer, or the provider's fixed official
installation instructions. Offline embedded provider payloads remain disabled
until their redistribution terms and publisher evidence are approved.

Provider authentication occurs in the provider CLI's own visible terminal.
Book Writer does not collect or persist credentials, OAuth codes, or tokens.

## Data locations

Mutable application data is below Electron's per-user `userData` folder,
normally `%APPDATA%\Book Writer`:

- `data\book-writer.db` — project registrations, settings, and run history;
- `backups\` — timestamped pre-migration database snapshots;
- `logs\` — Electron application logs; and
- `projects\` — application-managed project support data.

Imported manuscript and Knowledge Base files remain in the folders selected by
the author. They are not copied into the installation directory and are not
deleted by Book Writer's uninstaller.

## Upgrade and repair/reinstall

Installing a newer build over the existing per-user installation preserves
`userData`. Before a database schema upgrade, Book Writer creates a durable
snapshot in `backups\` and applies versioned migrations in one transaction. A
failed migration rolls back and leaves the backup available for recovery.

Repair/reinstall with the same version also preserves data. Close Book Writer
before installing, then launch it and verify the expected project and provider
selection.

## Uninstall and complete removal

The uninstaller offers an explicit data choice. **Preserve local application
data is the default.** Select `Remove all local Book Writer data` only when the
database, settings, logs, remembered project locations, and backups are no
longer needed.

Even when local application data is removed, imported manuscript folders are
left in place. Delete those source folders separately only after making an
independent backup and confirming they are no longer required.

## Database recovery

If an upgrade cannot open the database:

1. Close Book Writer.
2. Copy `%APPDATA%\Book Writer\data\book-writer.db` and the newest file under
   `%APPDATA%\Book Writer\backups` to a safe location.
3. Keep the failing application version and installer hash with those files.
4. Restore by copying a selected backup to `data\book-writer.db` only after the
   current database has been preserved under another name.

Do not edit SQLite files while Book Writer is running. A backup created by a
newer schema version may require the matching or newer Book Writer release.
