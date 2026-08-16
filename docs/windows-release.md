# Windows release and compatibility

User-facing install, data, uninstall, and recovery guidance is in
[Windows installation, upgrade, and recovery](windows-installation.md).

The `Windows x64 release` workflow in `.github/workflows/windows-release.yml`
is the reproducible packaging path for the Electron desktop app. It runs on a
clean `windows-2022` runner when a `v*` tag is pushed, and can also be started
manually from GitHub Actions.

The workflow uses the root `package-lock.json`, Node.js 22.14.0, the pinned Electron
version in `app/desktop/package.json`, and the existing scripts in this order:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
Push-Location app/desktop
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm.cmd run package
npm.cmd run audit:package
Pop-Location
./test/packaging/windows-installer-lifecycle.ps1
```

The package configuration produces a per-user x64 NSIS installer in
`dist/desktop/`. The workflow uploads the single `Book Writer-<version>-x64.exe`
installer and a matching `.exe.sha256` sidecar. The sidecar uses the conventional
`<sha256> *<filename>` format and is computed after packaging from the exact
installer bytes.

Manual runs may produce an unsigned family-test candidate. Tagged releases are
blocked unless the resulting installer has a valid Authenticode signature.
Release owners provide an approved certificate through the protected
`WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` repository secrets; no signing
credentials are checked into the repository. Certificate ownership and the
external distribution destination still require owner approval. Auto-update is
not part of this workflow.

The installer is Windows x64 only. ARM64 is not built, and the installed app
uses Electron's bundled runtime rather than requiring Node.js on the target
machine. The NSIS settings are per-user, do not silently elevate, allow an
installation directory choice, and preserve application data on uninstall by
default. The clean Windows runner performs silent install, same-version
repair/reinstall, and default uninstall, and proves that a user-data sentinel
survives. A manual clean-VM pass still qualifies assisted UI, an actual
prior-version upgrade, and the explicit remove-data choice before distributing
beyond family testing.
