# Shipped installer record

The installer is **not** tracked in this repository. At ~102 MB it exceeds
GitHub's hard 100 MB per-file limit, and being an LZMA-compressed NSIS package
it does not shrink: zipping it saves 0%. A push carrying it is rejected
outright by the remote.

This file is therefore the artifact's identity. Keep the built `.exe` outside
git and hand it over directly, or attach it to a GitHub Release, and use the
hash below to confirm a copy is the build described here.

If tracking a build ever becomes necessary, Git LFS is the workable route
(GitHub's free tier allows roughly nine builds before its 1 GB storage quota
is used), and everyone cloning would then need LFS installed.

## Current artifact

| Field | Value |
| --- | --- |
| File | `Book Writer-0.1.0-x64.exe` |
| Size | 107,001,128 bytes |
| SHA-256 | `7e2c698c136302d3780ea94af32f5be374480015902f1c6209b16ce0108c96ab` |
| Authenticode | `NotSigned` — family distribution |
| Built from | `9670aa7` |
| Built on | The development workstation, 2026-08-17 |

Verify a copy before trusting it:

```powershell
Get-FileHash -LiteralPath '.\Book Writer-0.1.0-x64.exe' -Algorithm SHA256
```

## What this build was verified to do

Checked against the packaged artifact, not the development tree:

- all nine bundled guides load, including the workflow map at 44,039 bytes,
  and a traversal attempt on the guide path is refused;
- the app resolves and hash-verifies its own bundled embedding model, then
  embeds prose scoring a paraphrase 0.5295 and an unrelated sentence 0.2473,
  matching every earlier run;
- the ONNX runtime loads against the pinned Electron ABI with the GPU-only DLLs
  confirmed absent;
- launch produces a titled window and a four-process tree with no orphans; and
- the full suite passes at 290 tests.

## Not verified for this artifact

- The install/repair/uninstall lifecycle script did not run, because it refuses
  to start when `%APPDATA%\Book Writer` exists and the build's NSIS detection
  hook had written a provider-detection file there. It passed on the previous
  build, and no installer-script change has landed since.
- Working set measured 342.7 MB shortly after launch, above the 250 MiB idle
  target. Sampled at launch rather than settled idle, so it is not a clean
  comparison, but it is not evidence of compliance either.
- No machine other than the one that built it has installed this artifact.

See [Installing Book Writer](windows-install-for-family.md) for the guide to
send with it, and [Phase 7 release qualification](windows-release-qualification.md)
for the gates a real release would additionally require.
