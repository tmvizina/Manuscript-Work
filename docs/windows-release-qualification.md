# Phase 7 Windows release qualification

This is a release-owner checklist, not a test report. A row is complete only
when evidence identifies the exact candidate commit and installer, the machine
or account, and the date. `Not run` is not a pass. The migration handoff still
lists clean-VM UI, a prior-version upgrade, remove-data UI, low-end measurements,
and final provider checks as Phase 7 work; this document does not claim those
checks have happened. See the [migration handoff](electron-migration-handoff.md#phase-7---release-qualification-and-handoff),
[Windows release notes](windows-release.md), and [rollback/DB policy](windows-rollback-and-database-compatibility.md).

## Release record

| Field | Value |
| --- | --- |
| Version/tag and candidate commit | `________________` |
| Installer filename and SHA-256 | `________________` |
| Authenticode status/certificate thumbprint | `________________` |
| Windows edition/build, x64 architecture, and qualification account | `________________` |
| Operator and UTC date | `________________` |
| Decision (`HOLD / APPROVED / REJECTED`) | `________________` |

Do not put credentials, OAuth codes, provider account IDs, or unredacted user
paths in the shared release record.

## Family distribution (not a release)

Handing an unsigned build to people you know is a different, lower bar than a
release, and it does not use the checklist below. None of those gates may be
marked complete on the strength of a family build.

Current family candidate, built from `a99e342` on 2026-08-17:

| Field | Value |
| --- | --- |
| Installer | `Book Writer-0.1.0-x64.exe`, 85,179,719 bytes |
| SHA-256 | `5AC271A383CB56670180A07598CB8E19CC964F8EE953604B7A0FA805F988A9FE` |
| Authenticode | `NotSigned` |
| Built on | The development workstation, not a clean machine |

Before handing it to someone:

1. Send the SHA-256 alongside the file, through a different channel than the
   installer where practical, so the recipient can confirm what they received.
2. Send [Installing Book Writer](windows-install-for-family.md) with it. The
   recipient will hit SmartScreen, and that guide is what stops the install
   from ending there.
3. Tell them plainly that it is unsigned and why, rather than letting the
   warning be a surprise.
4. Install it yourself on one machine that did not build it, first. Everything
   measured so far comes from the machine that compiled the artifact, which
   cannot reveal a missing runtime dependency.

Family builds must not be published to a public location, listed for download,
or described as a release. Signing and the checklist below govern that.

## Release checklist

Attach the named evidence to the release record. The status column starts
intentionally blank for every candidate.

| ID | Gate | Evidence required | Status |
| --- | --- | --- | --- |
| RC-01 | Reproducible build | Clean checkout, exact commit, lockfile install, workflow URL, typecheck, tests, and production build | `Not run` |
| RC-02 | Package audit | `audit:package` output showing no source maps, tests, fixtures, fake runner, or server dependency | `Not run` |
| RC-03 | Installer | One per-user Windows x64 NSIS installer; filename and bytes match the record | `Not run` |
| RC-04 | Signature/hash | Valid Authenticode for a distributed/tagged build and matching published `.exe.sha256` | `Not run` |
| RC-05 | Standard-user matrix | All mandatory cases below on a clean standard-user profile | `Not run` |
| RC-06 | Lifecycle | First install, launch, same-version repair, actual prior-version upgrade, default uninstall, and explicit remove-data UI | `Not run` |
| RC-07 | Database | Release-specific compatibility statement, migration, newer-schema refusal, backup, and restore evidence | `Not run` |
| RC-08 | Provider mocks | Missing CLI, stale PATH, install failure, cancelled/auth failure, success, and both CLIs without secrets in output | `Not run` |
| RC-09 | Real provider smoke | Explicitly approved minimal smoke for each advertised provider, following the privacy rules below | `Not run` |
| RC-10 | Performance | Low-end cold/warm launch, working set, stream responsiveness, sustained stream, scan, and package-size measurements | `Not run` |
| RC-11 | Documentation | Install/onboarding, data, provider switching, troubleshooting, removal, known limitations, rollback, and DB links | `Not run` |
| RC-12 | Rollback pack | Prior installer/hash/signature, candidate artifacts, DB backup, compatibility statement, and redacted incident record | `Not run` |
| RC-13 | Owner sign-off | All mandatory gates have evidence and no unresolved release blocker | `Not run` |

The workflow's automated install/repair/default-uninstall check does not replace
the manual clean-VM matrix, prior-version upgrade, or assisted remove-data check.

## Standard-user Windows matrix

Use a non-administrator account on a clean Windows x64 profile. Record the exact
Windows edition/build, locale, network state, candidate hash, and provider CLI
version privately. Do not rely on UAC, Docker, WSL, a developer checkout, or a
machine-wide install. Use an install path and project root containing spaces in
the path case. The rows are acceptance criteria, not completed evidence.

| Case | Setup/action | Expected result | Evidence |
| --- | --- | --- | --- |
| SU-01 Neither CLI | No WSL/Docker/Claude/Codex; install and launch | Installs without elevation; onboarding explains missing providers and gates runs | `Not run` |
| SU-02 Claude only | Discover only the approved Claude CLI; rescan/auth/status | Intended executable/version is shown; credentials stay in the CLI flow | `Not run` |
| SU-03 Codex only | Discover only the approved Codex CLI; rescan/auth/status | Same guarantees for Codex; no stale Claude selection | `Not run` |
| SU-04 Both CLIs | Switch between both detected CLIs and rescan | Selection is explicit and revalidated before a run | `Not run` |
| SU-05 Offline install | Disable network for Book Writer install; no provider payload assumed | App installs/opens; no hidden download, bootstrap, elevation, or false provider success | `Not run` |
| SU-06 Cancelled auth | Cancel the provider's own visible auth terminal | Actionable cancellation; no secret stored; retry/switch remains possible | `Not run` |
| SU-07 Spaces | Install and project/manuscript roots contain spaces; read a chapter and run mock | No quoting/traversal/path truncation failure | `Not run` |
| SU-08 Provider switch | Change preferred provider and run a mock after each change | Correct provider appears in settings/history; no stale executable or credential exposure | `Not run` |
| SU-09 Repair | Same-version repair/reinstall with DB/settings/backup sentinel | Program files repair; application data and source folder remain | `Not run` |
| SU-10 Upgrade | Install the named prior release with representative data, then candidate | Supported migration creates backup and preserves data; hashes for both releases recorded | `Not run` |
| SU-11 Default uninstall | Uninstall without selecting removal | Program files go; local app data and imported source remain | `Not run` |
| SU-12 Explicit removal | Select and confirm `Remove all local Book Writer data` with disposable app data | Documented local data is removed; external source folder remains | `Not run` |
| SU-13 Rollback | Capture data, close app, restore compatible backup, install prior release | Prior release opens the restored schema; no direct newer-schema downgrade | `Not run` |

If a case needs administrator credentials, touches a machine-wide location, or
uses real manuscript data, mark it blocked/failed and retain the reason.

## Provider smoke privacy rules

Real provider smoke is opt-in evidence and may send the prompt to a hosted
provider. Use a disposable project/profile and obtain approval for that network
use. The provider-mock suite remains the default automated coverage.

- Use only a fixed synthetic prompt, for example `Reply exactly:
  BOOK_WRITER_PROVIDER_SMOKE_OK`; never use manuscript, Knowledge Base,
  customer, or author data. Assume prompt/result text can enter local run
  history and provider retention.
- Authenticate only through the provider's own visible terminal/browser. Never
  paste a password, API key, token, or OAuth code into Book Writer. Do not
  screen-record or photograph authentication, dump environment variables,
  browser profiles, shell history, or process listings.
- Run one bounded request per provider with a time/cost limit and no real
  project writes. Do not retain raw stdout, stderr, JSONL, transcripts,
  screenshots, or provider logs.
- Retain only provider/CLI/model version, candidate hash, UTC timestamp,
  coarse result/cancellation, bounded exit/error code, and the fixed sentinel
  when safe. Redact tokens, OAuth codes, emails, account IDs, usernames,
  absolute paths, and manuscript text before attaching evidence.
- Delete disposable project, temporary `userData`, run history, and provider
  test outputs after the redacted summary and hash are retained. If exposure is
  suspected, stop, do not upload the artifact, notify the release owner, and
  rotate/revoke the affected credential through official provider controls.

## Known limitations

- The packaged target is Windows x64 only; ARM64 is not built. The release
  owner must state and test the supported Windows edition/build; this repository
  does not infer a minimum OS from the artifact.
- Auto-update is not included; updating and rollback are manual.
- Embedded offline Claude/Codex payloads remain disabled pending approved
  artifacts, licenses, hashes, publisher/signature evidence, and maintenance
  policy. Provider auth/model use can still require network access.
- Family-test installers may be unsigned; tagged distribution requires valid
  Authenticode and a published hash sidecar.
- Existing high-end/headless benchmark numbers are not low-end evidence. Low-end
  launch, memory, long-stream, renderer, and scan results remain RC evidence.
- The compatibility server remains source/development infrastructure until the
  parity/removal decision is complete. Native bounded search is not semantic RAG.
- Database downgrade is not automatic; restore a compatible pre-upgrade backup
  before launching an older app. Imported manuscript/Knowledge Base folders are
  outside app data and need an independent backup.
