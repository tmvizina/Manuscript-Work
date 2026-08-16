[CmdletBinding()]
param(
  [ValidateSet("safe", "all", "launch", "package", "scan", "stream")]
  [string]$Mode = "safe",
  [string]$Executable = "",
  [string]$Installer = "",
  [string]$DistributionPath = "",
  [string]$ScanProject = "",
  [string]$Output = "",
  [string]$NodeExecutable = "node",
  [ValidateRange(1, 300)]
  [int]$LaunchTimeoutSeconds = 30,
  [ValidateRange(0, 120)]
  [int]$IdleSettleSeconds = 5,
  [ValidateRange(1, 120)]
  [int]$IdleSamples = 5,
  [ValidateRange(50, 5000)]
  [int]$IdleSampleIntervalMilliseconds = 250,
  [ValidateRange(1, 10000)]
  [int]$ScanFiles = 250,
  [ValidateRange(1, 1000000)]
  [int]$ScanCharactersPerFile = 20000,
  [ValidateRange(1, 10000000)]
  [int]$StreamEvents = 100000,
  [ValidateRange(0, 86400)]
  [int]$StreamDurationSeconds = 10,
  [ValidateRange(0, 60000)]
  [int]$StreamIntervalMilliseconds = 0,
  [switch]$BuildPackage,
  [switch]$KeepArtifacts,
  [switch]$RequireLaunch,
  [switch]$RequirePackage,
  [switch]$RequireScan,
  [switch]$RequireStream
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$benchmarkRoot = Join-Path $workspace ".tmp-tests\phase6"
$runRoot = Join-Path $benchmarkRoot ("run-" + [Guid]::NewGuid().ToString("N"))
$distribution = if ($DistributionPath) { $DistributionPath } else { Join-Path $workspace "dist\desktop" }
$nodeCommand = $null
$result = [ordered]@{
  schemaVersion = "phase6-windows-v1"
  status = "running"
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  repository = $workspace
  mode = $Mode
  thresholds = [ordered]@{
    coldLaunchMilliseconds = 3000
    warmLaunchMilliseconds = 1500
    idleWorkingSetBytes = 250 * 1024 * 1024
    unchangedScanMilliseconds = 2000
    rendererTaskMilliseconds = 100
    longStreamSeconds = 1800
  }
  system = $null
  launch = $null
  package = $null
  scan = $null
  stream = $null
  artifactsKept = [bool]$KeepArtifacts
}
$scriptExitCode = 0

function Get-SystemMetadata {
  $cpuName = $null
  $physicalMemoryBytes = $null
  try {
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    $cpuName = [string]$computer.Model
    $physicalMemoryBytes = [int64]$computer.TotalPhysicalMemory
  } catch {
    $cpuName = $null
    $physicalMemoryBytes = $null
  }

  $processorName = $null
  try {
    $processor = Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop |
      Select-Object -First 1
    if ($processor) { $processorName = [string]$processor.Name }
  } catch {
    $processorName = $null
  }

  $nodeVersion = $null
  try {
    $nodeVersion = (& $NodeExecutable --version 2>$null | Select-Object -First 1)
    if ($nodeVersion) { $nodeVersion = ([string]$nodeVersion).Trim() }
  } catch {
    $nodeVersion = $null
  }

  $commit = $null
  try {
    $commit = (& git -C $workspace rev-parse --short HEAD 2>$null | Select-Object -First 1)
    if ($commit) { $commit = ([string]$commit).Trim() }
  } catch {
    $commit = $null
  }

  return [ordered]@{
    os = [Environment]::OSVersion.VersionString
    powershell = $PSVersionTable.PSVersion.ToString()
    node = $nodeVersion
    commit = $commit
    computerModel = $cpuName
    processor = $processorName
    processorCount = [Environment]::ProcessorCount
    physicalMemoryBytes = $physicalMemoryBytes
    physicalMemoryMiB = if ($null -eq $physicalMemoryBytes) { $null } else { [Math]::Round($physicalMemoryBytes / 1MB, 1) }
  }
}

function Resolve-InputPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
  return [System.IO.Path]::GetFullPath((Join-Path $workspace $Path))
}

function Get-MiB {
  param([Parameter(Mandatory = $true)][int64]$Bytes)
  return [Math]::Round($Bytes / 1MB, 2)
}

function Measure-DirectoryBytes {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $null }
  [int64]$total = 0
  foreach ($file in @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction Stop)) {
    $total += [int64]$file.Length
  }
  return $total
}

function Get-ProcessTable {
  try {
    return @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
      Select-Object ProcessId, ParentProcessId)
  } catch {
    return @()
  }
}

function Get-ProcessTreeIds {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)
  $ids = @($RootProcessId)
  $table = @(Get-ProcessTable)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($entry in $table) {
      $processId = [int]$entry.ProcessId
      $parentId = [int]$entry.ParentProcessId
      if (($ids -contains $parentId) -and -not ($ids -contains $processId)) {
        $ids += $processId
        $changed = $true
      }
    }
  }
  return $ids
}

function Get-ProcessTreeMemory {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)
  [int64]$bytes = 0
  $processCount = 0
  foreach ($processId in @(Get-ProcessTreeIds -RootProcessId $RootProcessId)) {
    try {
      $process = Get-Process -Id ([int]$processId) -ErrorAction Stop
      $bytes += [int64]$process.WorkingSet64
      $processCount += 1
    } catch {
      # A renderer/GPU helper may exit between the CIM and Get-Process calls.
    }
  }
  return [ordered]@{
    bytes = $bytes
    MiB = Get-MiB -Bytes $bytes
    processCount = $processCount
  }
}

function Stop-DesktopProcessTree {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)
  if ($RootProcessId -le 0) { return }
  $ids = @(Get-ProcessTreeIds -RootProcessId $RootProcessId)
  for ($index = $ids.Count - 1; $index -ge 0; $index -= 1) {
    try {
      Stop-Process -Id ([int]$ids[$index]) -Force -ErrorAction SilentlyContinue
    } catch {
      # The process may have exited normally while the tree was being read.
    }
  }
}

function Measure-IdleWorkingSet {
  param(
    [Parameter(Mandatory = $true)][int]$RootProcessId,
    [Parameter(Mandatory = $true)][int]$SettleSeconds,
    [Parameter(Mandatory = $true)][int]$SampleCount,
    [Parameter(Mandatory = $true)][int]$IntervalMilliseconds
  )

  if ($SettleSeconds -gt 0) { Start-Sleep -Seconds $SettleSeconds }
  $samples = @()
  for ($index = 0; $index -lt $SampleCount; $index += 1) {
    $sample = Get-ProcessTreeMemory -RootProcessId $RootProcessId
    if ($sample.processCount -gt 0) { $samples += $sample }
    if ($index + 1 -lt $SampleCount) { Start-Sleep -Milliseconds $IntervalMilliseconds }
  }
  if ($samples.Count -eq 0) {
    return [ordered]@{
      status = "unavailable"
      reason = "The desktop process exited before an idle working-set sample was available."
      sampleCount = 0
    }
  }

  [int64]$sum = 0
  [int64]$peak = 0
  foreach ($sample in $samples) {
    $sum += [int64]$sample.bytes
    if ([int64]$sample.bytes -gt $peak) { $peak = [int64]$sample.bytes }
  }
  $last = $samples[$samples.Count - 1]
  return [ordered]@{
    status = "ok"
    sampleCount = $samples.Count
    settleSeconds = $SettleSeconds
    sampleIntervalMilliseconds = $IntervalMilliseconds
    idleWorkingSetBytes = [int64]$last.bytes
    idleWorkingSetMiB = Get-MiB -Bytes ([int64]$last.bytes)
    peakWorkingSetBytes = $peak
    peakWorkingSetMiB = Get-MiB -Bytes $peak
    averageWorkingSetBytes = [int64]($sum / $samples.Count)
    averageWorkingSetMiB = Get-MiB -Bytes ([int64]($sum / $samples.Count))
    processCount = [int]$last.processCount
    withinInitialBudget = ([int64]$peak -le (250 * 1MB))
  }
}

function Start-DesktopMeasurement {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ApplicationPath,
    [Parameter(Mandatory = $true)][string]$UserDataPath,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [switch]$MeasureIdle
  )

  $process = $null
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $argument = '--user-data-dir="' + $UserDataPath + '"'
    $process = Start-Process -FilePath $ApplicationPath `
      -ArgumentList @($argument) `
      -WorkingDirectory (Split-Path -Parent $ApplicationPath) `
      -PassThru
    $processId = [int]$process.Id
    $ready = $false
    $exitCode = $null
    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
      try {
        $process.Refresh()
        if ($process.HasExited) {
          $exitCode = $process.ExitCode
          break
        }
        if ($process.MainWindowHandle -ne 0) {
          $ready = $true
          break
        }
      } catch {
        # Refresh can race process shutdown; the next poll gives a clearer state.
      }
      Start-Sleep -Milliseconds 100
    }
    $stopwatch.Stop()
    $launchMilliseconds = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
    if (-not $ready) {
      return [ordered]@{
        status = "error"
        label = $Label
        executable = $ApplicationPath
        userData = $UserDataPath
        processId = $processId
        launchMilliseconds = $launchMilliseconds
        exitCode = $exitCode
        error = if ($null -eq $exitCode) {
          "No top-level window appeared within $TimeoutSeconds seconds."
        } else {
          "The desktop process exited before a top-level window appeared (exit code $exitCode)."
        }
      }
    }

    $idle = $null
    if ($MeasureIdle) {
      $idle = Measure-IdleWorkingSet `
        -RootProcessId $processId `
        -SettleSeconds $IdleSettleSeconds `
        -SampleCount $IdleSamples `
        -IntervalMilliseconds $IdleSampleIntervalMilliseconds
    }
    return [ordered]@{
      status = "ok"
      label = $Label
      executable = $ApplicationPath
      userData = $UserDataPath
      processId = $processId
      launchMilliseconds = $launchMilliseconds
      withinInitialBudget = if ($Label -eq "cold") {
        $launchMilliseconds -le 3000
      } else {
        $launchMilliseconds -le 1500
      }
      idle = $idle
    }
  } catch {
    $stopwatch.Stop()
    return [ordered]@{
      status = "error"
      label = $Label
      executable = $ApplicationPath
      userData = $UserDataPath
      launchMilliseconds = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
      error = $_.Exception.Message
    }
  } finally {
    if ($null -ne $process) {
      Stop-DesktopProcessTree -RootProcessId ([int]$process.Id)
    }
  }
}

function Find-DesktopExecutable {
  if ($Executable) {
    $explicit = Resolve-InputPath -Path $Executable
    if (-not (Test-Path -LiteralPath $explicit -PathType Leaf)) {
      throw "The explicit -Executable path does not exist: $explicit"
    }
    return $explicit
  }
  $direct = Join-Path $distribution "win-unpacked\Book Writer.exe"
  if (Test-Path -LiteralPath $direct -PathType Leaf) { return $direct }
  if (Test-Path -LiteralPath $distribution -PathType Container) {
    $candidate = Get-ChildItem -LiteralPath $distribution -Recurse -Filter "Book Writer.exe" -File |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  return $null
}

function Measure-LaunchSection {
  $application = Find-DesktopExecutable
  if (-not $application) {
    return [ordered]@{
      status = "skipped"
      reason = "No unpacked Book Writer.exe was found. Build app/desktop package:dir or pass -Executable."
      executable = $null
    }
  }

  $coldUserData = Join-Path $runRoot "user-data-cold"
  $warmUserData = Join-Path $runRoot "user-data-warm"
  New-Item -ItemType Directory -Path $coldUserData, $warmUserData -Force | Out-Null
  $cold = Start-DesktopMeasurement `
    -Label "cold" `
    -ApplicationPath $application `
    -UserDataPath $coldUserData `
    -TimeoutSeconds $LaunchTimeoutSeconds `
    -MeasureIdle

  $warmBootstrap = Start-DesktopMeasurement `
    -Label "warm-bootstrap" `
    -ApplicationPath $application `
    -UserDataPath $warmUserData `
    -TimeoutSeconds $LaunchTimeoutSeconds
  $warm = $null
  if ($warmBootstrap.status -eq "ok") {
    Start-Sleep -Milliseconds 300
    $warm = Start-DesktopMeasurement `
      -Label "warm" `
      -ApplicationPath $application `
      -UserDataPath $warmUserData `
      -TimeoutSeconds $LaunchTimeoutSeconds `
      -MeasureIdle
  } else {
    $warm = [ordered]@{
      status = "error"
      label = "warm"
      error = "Warm bootstrap did not reach a usable window."
    }
  }

  $status = if ($cold.status -eq "ok" -and $warm.status -eq "ok") { "ok" } else { "error" }
  return [ordered]@{
    status = $status
    executable = $application
    cold = $cold
    warmBootstrap = $warmBootstrap
    warm = $warm
    budgets = [ordered]@{
      coldMilliseconds = 3000
      warmMilliseconds = 1500
      idleWorkingSetMiB = 250
    }
  }
}

function Measure-PackageSection {
  $resolvedDistribution = Resolve-InputPath -Path $distribution
  if (-not (Test-Path -LiteralPath $resolvedDistribution -PathType Container)) {
    return [ordered]@{
      status = "skipped"
      reason = "Package output directory was not found. Build app/desktop or pass -DistributionPath."
      distribution = $resolvedDistribution
    }
  }

  $installers = @(Get-ChildItem -LiteralPath $resolvedDistribution -Filter "*.exe" -File |
    Where-Object { $_.Name -notmatch "(?i)uninstaller" } |
    Sort-Object LastWriteTime -Descending)
  $installerRecord = $null
  if ($Installer) {
    $installerPath = Resolve-InputPath -Path $Installer
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
      throw "The explicit -Installer path does not exist: $installerPath"
    }
    $installerFile = Get-Item -LiteralPath $installerPath
    $installerRecord = [ordered]@{
      path = $installerFile.FullName
      name = $installerFile.Name
      bytes = [int64]$installerFile.Length
      MiB = Get-MiB -Bytes ([int64]$installerFile.Length)
      sha256 = (Get-FileHash -LiteralPath $installerFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  } elseif ($installers.Count -gt 0) {
    $installerFile = $installers[0]
    $installerRecord = [ordered]@{
      path = $installerFile.FullName
      name = $installerFile.Name
      bytes = [int64]$installerFile.Length
      MiB = Get-MiB -Bytes ([int64]$installerFile.Length)
      sha256 = (Get-FileHash -LiteralPath $installerFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }

  $unpackedPath = Join-Path $resolvedDistribution "win-unpacked"
  $unpackedBytes = Measure-DirectoryBytes -Path $unpackedPath
  $asarPath = Join-Path $unpackedPath "resources\app.asar"
  $uiPath = Join-Path $unpackedPath "resources\ui"
  $asarBytes = if (Test-Path -LiteralPath $asarPath -PathType Leaf) { [int64](Get-Item -LiteralPath $asarPath).Length } else { $null }
  $uiBytes = Measure-DirectoryBytes -Path $uiPath
  if ($null -eq $installerRecord -and $null -eq $unpackedBytes) {
    return [ordered]@{
      status = "skipped"
      reason = "No installer or win-unpacked directory was found in the package output."
      distribution = $resolvedDistribution
    }
  }
  return [ordered]@{
    status = "ok"
    distribution = $resolvedDistribution
    installer = $installerRecord
    installerCandidates = @($installers | ForEach-Object {
      [ordered]@{ name = $_.Name; bytes = [int64]$_.Length; MiB = Get-MiB -Bytes ([int64]$_.Length) }
    })
    unpacked = if ($null -eq $unpackedBytes) { $null } else {
      [ordered]@{ path = $unpackedPath; bytes = $unpackedBytes; MiB = Get-MiB -Bytes $unpackedBytes }
    }
    asar = if ($null -eq $asarBytes) { $null } else {
      [ordered]@{ path = $asarPath; bytes = $asarBytes; MiB = Get-MiB -Bytes $asarBytes }
    }
    ui = if ($null -eq $uiBytes) { $null } else {
      [ordered]@{ path = $uiPath; bytes = $uiBytes; MiB = Get-MiB -Bytes $uiBytes }
    }
  }
}

function New-ScanFixture {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$FileCount,
    [Parameter(Mandatory = $true)][int]$CharactersPerFile
  )
  $chapterPath = Join-Path $Path "chapters"
  New-Item -ItemType Directory -Path $chapterPath -Force | Out-Null
  for ($index = 1; $index -le $FileCount; $index += 1) {
    $seed = "Synthetic Phase 6 chapter $index records a measured observation and a clear stop. `n"
    $content = ""
    while ($content.Length -lt $CharactersPerFile) { $content += $seed }
    if ($content.Length -gt $CharactersPerFile) {
      $content = $content.Substring(0, $CharactersPerFile)
    }
    $name = "Chapter {0:D4} - Synthetic chapter {0:D4}.txt" -f $index
    Set-Content -LiteralPath (Join-Path $chapterPath $name) -Value $content -Encoding UTF8 -NoNewline
  }
  return $Path
}

function Invoke-NodeJson {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$ExposeGc
  )
  $lines = if ($ExposeGc) {
    @(& $nodeCommand --expose-gc $ScriptPath @Arguments 2>&1)
  } else {
    @(& $nodeCommand $ScriptPath @Arguments 2>&1)
  }
  $exitCode = $LASTEXITCODE
  $text = ($lines -join "`n").Trim()
  if ($exitCode -ne 0) {
    throw "Node benchmark failed with exit code ${exitCode}: $text"
  }
  if (-not $text) { throw "Node benchmark returned no JSON: $ScriptPath" }
  try {
    return $text | ConvertFrom-Json
  } catch {
    throw "Node benchmark returned invalid JSON: $text"
  }
}

function Measure-ScanSection {
  $helper = Join-Path $PSScriptRoot "phase6-scan-benchmark.mjs"
  $coreEntry = Join-Path $workspace "packages\core\dist\content\projectChapters.js"
  $dbEntry = Join-Path $workspace "packages\core\dist\db\index.js"
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    return [ordered]@{ status = "skipped"; reason = "The scan benchmark helper is missing." }
  }
  if (-not (Test-Path -LiteralPath $coreEntry -PathType Leaf) -or
      -not (Test-Path -LiteralPath $dbEntry -PathType Leaf)) {
    return [ordered]@{
      status = "skipped"
      reason = "The compiled core is missing. Run npm.cmd run build before measuring the native scan."
    }
  }

  $scanRoot = $ScanProject
  if (-not $scanRoot) {
    $scanRoot = New-ScanFixture `
      -Path (Join-Path $runRoot "scan-fixture") `
      -FileCount $ScanFiles `
      -CharactersPerFile $ScanCharactersPerFile
  } else {
    $scanRoot = Resolve-InputPath -Path $scanRoot
    if (-not (Test-Path -LiteralPath $scanRoot -PathType Container)) {
      throw "The scan project directory does not exist: $scanRoot"
    }
  }
  $database = Join-Path $runRoot "scan.sqlite"
  $scan = Invoke-NodeJson `
    -ScriptPath $helper `
    -Arguments @(
      "--repo-root", $workspace,
      "--project", $scanRoot,
      "--db", $database
    )
  return [ordered]@{
    status = "ok"
    project = $scanRoot
    fixture = (-not [bool]$ScanProject)
    result = $scan
    budgetMilliseconds = 2000
    withinUnchangedBudget = ([double]$scan.unchangedScanMs -le 2000)
  }
}

function Measure-StreamSection {
  $helper = Join-Path $PSScriptRoot "phase6-stream-benchmark.mjs"
  $managerEntry = Join-Path $workspace "app\desktop\dist\main\runs\manager.js"
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    return [ordered]@{ status = "skipped"; reason = "The stream benchmark helper is missing." }
  }
  if (-not (Test-Path -LiteralPath $managerEntry -PathType Leaf)) {
    return [ordered]@{
      status = "skipped"
      reason = "The compiled desktop run manager is missing. Run npm.cmd run build before measuring the mock stream."
    }
  }
  $stream = Invoke-NodeJson `
    -ScriptPath $helper `
    -Arguments @(
      "--repo-root", $workspace,
      "--events", $StreamEvents,
      "--duration-ms", ($StreamDurationSeconds * 1000),
      "--interval-ms", $StreamIntervalMilliseconds
    ) `
    -ExposeGc
  return [ordered]@{
    status = "ok"
    result = $stream
    replayBudget = 1000
    boundedReplay = ([int]$stream.replayLength -le [int]$stream.replayLimit)
    note = "This is an in-process mock provider and RunManager measurement; it does not measure renderer task duration."
  }
}

try {
  if ($env:OS -ne "Windows_NT") {
    throw "The Phase 6 harness is Windows-only; run it on a Windows workstation or runner."
  }
  New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
  $nodeCommandInfo = Get-Command $NodeExecutable -ErrorAction SilentlyContinue
  if (-not $nodeCommandInfo) { throw "Node.js was not found: $NodeExecutable" }
  $nodeCommand = $nodeCommandInfo.Source
  $result.system = Get-SystemMetadata

  if ($BuildPackage) {
    $desktopPath = Join-Path $workspace "app\desktop"
    & $nodeCommandInfo.Source --version | Out-Null
    Push-Location $desktopPath
    try {
      & npm.cmd run package
      if ($LASTEXITCODE -ne 0) { throw "npm.cmd run package failed with exit code $LASTEXITCODE" }
    } finally {
      Pop-Location
    }
  }

  if (@("all", "launch") -contains $Mode) { $result.launch = Measure-LaunchSection }
  if (@("safe", "all", "package") -contains $Mode) { $result.package = Measure-PackageSection }
  if (@("safe", "all", "scan") -contains $Mode) { $result.scan = Measure-ScanSection }
  if (@("safe", "all", "stream") -contains $Mode) { $result.stream = Measure-StreamSection }

  if ($RequireLaunch -and ($null -eq $result.launch -or $result.launch.status -ne "ok")) {
    throw "Launch measurements were required but did not complete."
  }
  if ($RequirePackage -and ($null -eq $result.package -or $result.package.status -ne "ok")) {
    throw "Package measurements were required but did not complete."
  }
  if ($RequireScan -and ($null -eq $result.scan -or $result.scan.status -ne "ok")) {
    throw "Scan measurements were required but did not complete."
  }
  if ($RequireStream -and ($null -eq $result.stream -or $result.stream.status -ne "ok")) {
    throw "Stream measurements were required but did not complete."
  }

  $sectionStatuses = @($result.launch, $result.package, $result.scan, $result.stream) |
    Where-Object { $null -ne $_ } |
    ForEach-Object { $_.status }
  if ($sectionStatuses -contains "error") {
    $result.status = "error"
    $scriptExitCode = 1
  } elseif ($sectionStatuses -contains "skipped") {
    $result.status = "partial"
  } else {
    $result.status = "ok"
  }
} catch {
  $result.status = "error"
  $result.error = $_.Exception.Message
  $scriptExitCode = 1
} finally {
  if (-not $KeepArtifacts -and (Test-Path -LiteralPath $runRoot)) {
    Remove-Item -LiteralPath $runRoot -Recurse -Force
  }
}

$result.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
$json = $result | ConvertTo-Json -Depth 12
if ($Output) {
  $outputPath = Resolve-InputPath -Path $Output
  $outputParent = Split-Path -Parent $outputPath
  if ($outputParent) { New-Item -ItemType Directory -Path $outputParent -Force | Out-Null }
  Set-Content -LiteralPath $outputPath -Value $json -Encoding UTF8
  $result.output = $outputPath
  $json = $result | ConvertTo-Json -Depth 12
  Set-Content -LiteralPath $outputPath -Value $json -Encoding UTF8
}
Write-Output $json
exit $scriptExitCode
