param(
  [string]$Installer = ""
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$distribution = Join-Path $workspace "dist\desktop"
if (-not $Installer) {
  $candidate = Get-ChildItem -LiteralPath $distribution -Filter "Book Writer-*-x64.exe" -File |
    Where-Object { $_.Name -notlike "*.__uninstaller.exe" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $candidate) { throw "No Book Writer x64 installer found in $distribution" }
  $Installer = $candidate.FullName
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path

$testRoot = Join-Path $workspace ".tmp-tests\windows-installer-lifecycle"
$installDirectory = Join-Path $testRoot "app"
$appDataDirectory = Join-Path $env:APPDATA "Book Writer"
$sentinel = Join-Path $appDataDirectory "phase5-preserve-sentinel.txt"

if (-not $testRoot.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing lifecycle test outside the workspace: $testRoot"
}
if (Test-Path -LiteralPath $testRoot) {
  throw "Lifecycle test directory already exists; inspect it before retrying: $testRoot"
}
if (Test-Path -LiteralPath $appDataDirectory) {
  throw "Book Writer user data already exists; use a clean Windows account or VM: $appDataDirectory"
}

try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  New-Item -ItemType Directory -Path $appDataDirectory | Out-Null
  Set-Content -LiteralPath $sentinel -Value "preserve-by-default" -NoNewline

  $first = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$installDirectory" -Wait -PassThru
  if ($first.ExitCode -ne 0) { throw "Initial install failed with exit code $($first.ExitCode)" }
  $executable = Join-Path $installDirectory "Book Writer.exe"
  if (-not (Test-Path -LiteralPath $executable)) { throw "Installed executable is missing: $executable" }

  $repair = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$installDirectory" -Wait -PassThru
  if ($repair.ExitCode -ne 0) { throw "Repair reinstall failed with exit code $($repair.ExitCode)" }
  if (-not (Test-Path -LiteralPath $sentinel)) { throw "Repair reinstall removed user data" }

  $uninstaller = Join-Path $installDirectory "Uninstall Book Writer.exe"
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Uninstaller is missing: $uninstaller" }
  $signatureTargets = @($executable, $uninstaller)
  $elevate = Join-Path $installDirectory "resources\elevate.exe"
  if (Test-Path -LiteralPath $elevate) { $signatureTargets += $elevate }
  $signatureStatuses = @($signatureTargets | ForEach-Object {
    $signature = Get-AuthenticodeSignature -LiteralPath $_
    "$([System.IO.Path]::GetFileName($_))=$($signature.Status)"
  })
  if ($env:REQUIRE_VALID_SIGNATURE -eq "1" -and ($signatureStatuses | Where-Object { $_ -notlike "*=Valid" })) {
    throw "A tagged-release executable has an invalid signature: $($signatureStatuses -join ', ')"
  }
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "Uninstall failed with exit code $($uninstall.ExitCode)" }
  for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $executable); $attempt += 1) {
    Start-Sleep -Milliseconds 200
  }
  if (Test-Path -LiteralPath $executable) { throw "Uninstall left the application executable behind" }
  if (-not (Test-Path -LiteralPath $sentinel)) { throw "Default uninstall removed user data" }

  [pscustomobject]@{
    ok = $true
    installer = $Installer
    install = "passed"
    repairReinstall = "passed"
    uninstall = "passed"
    userDataPreserved = $true
    signatures = $signatureStatuses
  } | ConvertTo-Json -Compress
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
  if ((Test-Path -LiteralPath $appDataDirectory) -and (Test-Path -LiteralPath $sentinel)) {
    # The precondition proved this directory did not exist before the test,
    # and the sentinel proves this invocation created it.
    Remove-Item -LiteralPath $appDataDirectory -Recurse -Force
  }
}
