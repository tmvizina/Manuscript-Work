# Windows rollback and database compatibility

This is a manual recovery policy; the current release workflow has no
auto-update or automatic application downgrade. Keep it with the [Phase 7
release checklist](windows-release-qualification.md), [release workflow notes](windows-release.md),
and [user recovery guide](windows-installation.md).

## Rollback policy

1. Stop distribution and record the candidate tag/commit, installer filename and
   SHA-256, workflow run, signature status, and reason. Preserve the candidate.
2. Close Book Writer and provider processes. Copy the complete
   `%APPDATA%\Book Writer` directory to a restricted recovery location before
   changing the install or database.
3. Preserve `data\book-writer.db`, every published pre-migration backup, logs,
   settings, provider metadata, and imported project paths. Never edit SQLite
   while Book Writer is running.
4. Read the target prior release's compatibility statement. If its maximum
   supported schema is lower, restore a pre-upgrade backup (or verified copy at
   that schema) before launching the older app. Never change `PRAGMA user_version`
   or delete columns to force a downgrade.
5. Verify the prior installer hash/signature, install it per-user, and verify
   projects/settings with a disposable read-only smoke. Keep the quarantined
   candidate copy until the incident is closed.

If there is no compatible backup, leave the current database untouched and use
the newer release or a new empty profile. Do not discard the source manuscript
folder during recovery.

## Rollback artifacts

| Artifact | Required contents |
| --- | --- |
| Candidate and prior identity | Tag, commit, installer, SHA-256, workflow URL/run, release notes |
| Signature metadata | Authenticode status and certificate thumbprint/issuer, never private keys |
| Package evidence | Audit output and test summary |
| DB statement | Shipped schema, readable range, migrations, refusal and downgrade path |
| Data copies | Original DB, published pre-migration backup, and quarantined `%APPDATA%\Book Writer` copy with hashes |
| Incident record | Trigger, operator, UTC times, decision, redacted validation result |

Do not put credentials, OAuth codes, tokens, raw provider transcripts,
unredacted manuscript text, or unredacted paths in the pack. Apply the [provider
smoke privacy rules](windows-release-qualification.md#provider-smoke-privacy-rules)
to diagnostics as well.

## Database compatibility statement

The release owner must re-verify this statement for every candidate; it is
source-level compatibility information, not proof that a candidate was tested.

- SQLite `PRAGMA user_version` records the schema. The current source declares
  `DATABASE_SCHEMA_VERSION = 2`.
- Legacy/unversioned schema 0 migrates through migration 1; schema 1 migrates
  through migration 2. The current source upgrades both to schema 2.
- Migration 1 creates the shared schema and repairs additive legacy columns.
  Migration 2 adds `file_size` to `chapters` and `project_chapters`.
- Before a persistent upgrade, the app integrity-checks the source, creates a
  distinct pre-migration backup, and applies migrations transactionally. The
  backup includes committed WAL state, is fsynced and reopened for integrity
  validation, and only then receives its final name.
- Schema 2 opens only after integrity and required-schema checks. A schema newer
  than 2 is rejected without a downgrade attempt; the refusal path does not
  create an automatic backup.
- There is no downgrade migration. Restore a compatible pre-upgrade backup
  before using an older release.
- The DB stores application indexes/settings/project metadata/run history.
  Manuscript and Knowledge Base files remain in their selected folders and are
  not contained in a DB backup.

### Per-release statement (complete before approval)

| Field | Release value |
| --- | --- |
| Version/commit | `________________` |
| Schema shipped (`user_version`) | `________________` |
| Opens without migration | `________________` |
| Migrates from | `________________` |
| Backup pattern/location | `________________` |
| Refuses newer/corrupt schema without mutation | `________________` |
| Downgrade/restore procedure | `________________` |
| Upgrade and restore evidence | `________________` |
| Owner/date | `________________` |

Minimum candidate fixtures:

| Fixture | Expected behavior | Evidence |
| --- | --- | --- |
| Schema 0 with representative rows | Upgrade and retain rows; publish schema-0 backup | `Not run` |
| Schema 1 with chapter tables | Add schema-2 metadata; retain rows and schema-1 backup | `Not run` |
| Current schema | Open after integrity/required-schema checks | `Not run` |
| Newer schema | Refuse without rewrite or downgrade | `Not run` |
| Corrupt/incomplete backup | Reject; never present as a recovery point | `Not run` |
| Compatible backup in prior release | Open restored schema; source folder remains | `Not run` |

For normal user-facing paths and recovery steps, see [Windows installation,
upgrade, and recovery](windows-installation.md).
