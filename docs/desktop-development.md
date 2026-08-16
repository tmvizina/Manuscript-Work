# Desktop development baseline

This is the Windows baseline for developing and smoke-checking Book Writer on a
desktop. It describes the existing server/UI processes; it does not claim a
performance result and it does not replace the app's source or package
configuration.

## Prerequisites

- Windows PowerShell and Node.js. CI uses Node 20.x; record the exact local
  versions when collecting a baseline.
- The repository checked out locally.
- A manuscript checkout, if one is being used through `MANUSCRIPT_ROOT`.
- The Claude bridge is optional for launch/scan checks and required only for a
  real streamed Claude run. See [the bridge guide](guides/claude-bridge.md).

Use `npm.cmd` in PowerShell so the commands are explicit about the Windows npm
shim.

## Reproducible install and checks

From the repository root:

```powershell
Push-Location app/server
npm.cmd ci
npm.cmd run typecheck
Pop-Location

Push-Location app/ui
npm.cmd ci
# This runs tsc --noEmit and then vite build.
npm.cmd run build
Pop-Location
```

If your checkout has a root `package.json` with `scripts.test`, install its
test dependencies and run that test from the repository root. Prefer the lock
file when one is present; `--workspaces=false` keeps this focused on the root
test tool before the app-specific installs above:

```powershell
if (Test-Path .\package-lock.json) {
  npm.cmd ci --ignore-scripts --no-audit --no-fund --workspaces=false
} else {
  npm.cmd install --ignore-scripts --no-audit --no-fund --workspaces=false
}
npm.cmd run test
```

If there is no root package or no `scripts.test`, record root tests as
`N/A (not configured)`. The Windows CI job detects and runs root tests only
when that script is present.

## Local launch

For a development UI and API, use two PowerShell windows.

Window 1 — API server (`http://localhost:8321`):

```powershell
Set-Location .\app\server
npm.cmd start
```

Window 2 — Vite UI (`http://localhost:5173`):

```powershell
Set-Location .\app\ui
npm.cmd run dev
```

The UI dev server proxies `/api` and `/help` to the API. Verify the API without
depending on a browser using:

```powershell
Invoke-RestMethod http://localhost:8321/api/health | ConvertTo-Json -Depth 6
```

To smoke-test the built UI served by Fastify instead, run `npm.cmd run build`
in `app/ui`, stop the dev server, and then start `npm.cmd start` in
`app/server`. The built UI is served at `http://localhost:8321` when
`app/ui/dist/index.html` exists.

For a streamed skill run, start the bridge in a third window and leave it open:

```powershell
node .\bridge\claude-bridge.js
Invoke-RestMethod http://localhost:8412/health | ConvertTo-Json
```

Only run a streamed prompt when the Claude CLI is installed and the run is
intended. A bridge health failure is not a zero-latency result; record it as
unavailable.

## Lightweight manual metrics protocol

Record observations rather than estimates. For each baseline, capture the git
commit, Windows and Node/npm versions, whether the run is cold or warm, the
manuscript root/data directory, and whether the UI is Vite-dev or built. Keep
the same local dataset and the same short, read-only stream prompt across
repeats. One cold launch and two warm launches are enough for a lightweight
comparison; repeat only when a change warrants it.

### Launch

1. Stop the API/UI processes from any earlier run.
2. Start `npm.cmd start` in `app/server` and start a stopwatch immediately
   before the command.
3. Stop the stopwatch at the first successful response from
   `http://localhost:8321/api/health` (HTTP 200 with `ok: true`).
4. Record elapsed milliseconds and the server's startup log line, including its
   skills/chapter counts. Do not count a failed health poll as readiness.

For a repeatable health-poll timer after the server process has been started,
this PowerShell snippet measures the first successful response only:

```powershell
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$ready = $false
do {
  try {
    $health = Invoke-RestMethod http://localhost:8321/api/health -TimeoutSec 1
    $ready = $health.ok -eq $true
  } catch {
    Start-Sleep -Milliseconds 100
  }
} while (-not $ready -and $watch.Elapsed.TotalSeconds -lt 30)
$watch.Stop()
[pscustomobject]@{
  launch_ready = $ready
  launch_ms = $watch.ElapsedMilliseconds
}
```

Run the snippet in a second window immediately after starting the server and
label the result as `health-poll-ms`; if the stopwatch did not start before the
server command, do not label it a full process-launch measurement.

### Scan

The startup log includes the initial skill/chapter sync counts. To measure the
explicit chapter scan, time this request and retain both its duration and the
returned counts:

```powershell
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$scan = Invoke-RestMethod -Method Post -Uri http://localhost:8321/api/chapters/sync
$watch.Stop()
[pscustomobject]@{
  scan_ms = $watch.ElapsedMilliseconds
  scanned = $scan.scanned
  added = $scan.added
  updated = $scan.updated
  unchanged = $scan.unchanged
  deactivated = $scan.deactivated
}
```

Do not compare scan times across different manuscript roots or database states
without noting that difference.

### Memory

After the UI/API have been idle for the same period, capture the process
working set. Resolve the PID from the listening port so an unrelated Node
process is not included:

```powershell
$serverPid = (Get-NetTCPConnection -LocalPort 8321 -State Listen |
  Select-Object -First 1 -ExpandProperty OwningProcess)
Get-Process -Id $serverPid |
  Select-Object Id, ProcessName,
    @{Name = 'WorkingSetMiB'; Expression = { [math]::Round($_.WorkingSet64 / 1MB, 1) }},
    @{Name = 'PrivateMemoryMiB'; Expression = { [math]::Round($_.PrivateMemorySize64 / 1MB, 1) }}
```

If Vite is running, repeat for port `5173` and record the two processes
separately. Take the sample at the same point in each run; a single working-set
sample is an observation, not a memory limit.

### Stream

Only measure this when the bridge health endpoint is ready. Use one fixed,
short, read-only prompt and the same permission mode for each run. In the UI's
Network panel (the skill run request), record:

- time from clicking **Run** to the first streamed event/visible partial output;
- time from the first streamed event to the final completion event;
- total stream duration and event/byte count if the panel exposes them; and
- whether the run completed, was cancelled, or failed (include the bridge
  health/version in the notes).

Do not treat a run with no bridge, no first event, or an error response as a
zero-valued stream metric. Mark it `N/A` with the reason. Model/network variance
is expected, so keep stream observations separate from launch and scan timings.

## Results template

Fill this in only with values observed by running the protocol. Leave cells
blank or use `N/A (reason)` when a measurement was not collected.

| Date/commit | OS + Node/npm | Cold/warm + UI mode | Launch ready (ms) | Scan (ms / files) | Server working set (MiB) | UI working set (MiB) | First stream event (ms) | Stream duration (ms) | Outcome/notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
|  |  |  |  |  |  |  |  |  |  |
