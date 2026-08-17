# Phase 6 Windows performance benchmarks

The Phase 6 handoff calls for measurements on a representative low-end Windows
machine: cold and warm launch, idle combined working set, large-project and
unchanged scans, first streamed token, renderer responsiveness, and package
size. The initial budgets are a usable window in 3 seconds cold and 1.5 seconds
warm, idle working set at or below 250 MiB, unchanged scan in 2 seconds, and no
unbounded memory growth during a 30-minute stream.

## Harness

The harness is Windows-only and writes one structured JSON report. It uses a
fresh temporary Electron profile for every invocation, so it does not touch the
normal Book Writer user data directory:

```powershell
npm.cmd run benchmark:phase6 -- -Mode safe -Output .tmp-tests\phase6-latest.json
```

The default `safe` mode never launches a GUI; it measures package, scan, and
mock-stream behavior. Launch measurement is an explicit manual mode because it
opens and closes the desktop app and may surface Electron error dialogs if the
staged package is stale or incompatible. Build it first, close any running Book
Writer instance, and then run:

```powershell
npm.cmd --prefix app\desktop run package:dir
npm.cmd run benchmark:phase6 -- -Mode launch -RequireLaunch -EnableExperimentalGuiLaunch
```

The package section reads the existing `dist\desktop` output and records the
installer size, SHA-256, unpacked directory size, ASAR size, and UI resource
size. To build the installer as part of the run, use the explicit opt-in switch:

```powershell
npm.cmd run benchmark:phase6 -- -Mode package -BuildPackage -RequirePackage
```

Useful focused modes and options are:

| Command/option | Measurement |
|---|---|
| `-Mode launch -EnableExperimentalGuiLaunch` | explicit clean-VM-only fresh/warm launch experiment; never run on a working desktop account |
| `-Mode package` | installer and packaged directory bytes plus installer hash |
| `-Mode scan` | two real compiled-core chapter syncs against a generated 250-file fixture |
| `-ScanProject <manuscript-root>` | use a representative fixture instead of generating one |
| `-Mode stream` | mock first token and compiled `RunManager` long-stream replay bound |
| `-StreamDurationSeconds 1800 -StreamIntervalMilliseconds 16` | opt into a 30-minute mock stream; the default is a short smoke run |
| `-RequireLaunch/-RequirePackage/-RequireScan/-RequireStream` | fail the command when that section cannot run or does not complete |
| `-KeepArtifacts` | retain the temporary profile, generated fixture, and scan database for inspection |

Run the report on the same machine before and after a performance change. Keep
the JSON alongside the commit, Windows build, fixture description, and whether
the launch was cold or warm. The script collects CPU/model where Windows allows,
Node and PowerShell versions, physical memory, and the current Git commit.

## What each result means

Launch readiness is the first non-zero top-level window handle. It is a stable
Windows automation signal, but it is not a renderer first-paint timestamp. Idle
working set sums the Book Writer process and all currently discoverable child
processes after the configured settle period; `peakWorkingSetMiB` is the safer
value to compare with the initial budget.

The scan probe invokes the compiled `syncProjectChapters` implementation twice
against a temporary SQLite database. Its second pass reports `unchanged`, so
the result distinguishes a full initial population from an unchanged scan. The
default generated fixture is synthetic; use `-ScanProject` for the agreed
reference project before treating the number as release evidence.

The stream probe uses the compiled desktop `RunManager` with a deterministic
mock provider. It records first-token latency, delivery count, replay length,
and Node heap/RSS samples while emitting many text events. This verifies the
bounded replay seam without credentials or network access. It does not prove
renderer task duration, React batching, real CLI startup, or a 30-minute
provider process; those require a clean-machine release qualification run.

Missing build artifacts are reported as `skipped` (the overall report becomes
`partial`); `-Require*` switches turn a missing section into a failing command.

## Local engineering baseline (2026-08-16)

The headless safe-mode probe passed on Windows 11 build 22631, an Intel
i7-12700K (20 logical processors), 65,346 MiB RAM, and Node 24.16.0 at commit
`12a012b` plus the uncommitted Phase 6 implementation:

- synthetic 250-file / 20,000-character initial scan: 150.461 ms;
- identical second scan: 33.840 ms, with all 250 files on the metadata fast path;
- mock first token: 1.410 ms;
- 20,000-event mock stream: 79.255 ms, replay capped at 1,000 events, peak
  heap 7,340,240 bytes, and peak RSS 53,420,032 bytes; and
- final Phase 6 installer: 85,090,658 bytes (81.15 MiB), SHA-256
  `20cc05b30ee530b9733e1a17fc3e0c7616f29471be2280db7a7a5fd3d72bf535`;
  unpacked package 291.42 MiB, ASAR 308,776 bytes, and UI resources
  288,401 bytes.

These are engineering checks, not representative low-end release evidence. A
first attempt at automated GUI launch measurement surfaced repeated Electron
exception dialogs and left child processes behind, so it was stopped. Default
mode was changed to headless `safe`, all leftover Book Writer processes were
terminated, and a later process/path check found no Book Writer, Electron, or
Windows Error Reporting process. GUI launch/idle measurement remains an explicit
Phase 7 clean-machine task after the staged package is diagnosed.
