# Shipped installer record

The build ships in two files, because a single one cannot be committed:
GitHub hard-blocks files over 100 MB, and the combined installer was 102.04 MB
and incompressible (zipping saved 0%).

| File | Size | Tracked |
| --- | --- | --- |
| `Book Writer-0.1.0-x64.exe` | 87.01 MB | no, delivered directly |
| `model_quantized.onnx` | 21.91 MB | yes, `app/desktop/resources/rag-model/` |

The weights are the only part large enough to matter, so they are excluded
from the installer and imported once by the application, which hash-verifies
them against the manifest that shipped inside it. The manifest, tokenizer,
LICENSE, and NOTICE stay in the installer: the manifest is what an imported
file is checked against and must be the application's own copy, never one
supplied alongside the file being checked.

Installing the model, for a recipient: open **Semantic**, choose **Install
model file…**, and select `model_quantized.onnx`. Anything else is refused by
name, size, and hash. Until then the rest of the application works normally and
literal search is unaffected.

The installer itself is still delivered out of band. At 87 MB it would now fit
in git, but every committed rebuild would add that permanently.

## Current artifact

| Field | Value |
| --- | --- |
| File | `Book Writer-0.1.0-x64.exe` |
| Size | 91,232,282 bytes |
| SHA-256 | `5d8ba1e9814a5c278e6c423d0d5c114414742dccc18e137b9419c126cd8bd684` |
| Authenticode | `NotSigned` — family distribution |
| Built from | `b10e80e` plus the model-split change |
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
