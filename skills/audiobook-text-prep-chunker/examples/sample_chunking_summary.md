# Audiobook Chunking Summary

_Generated: 2026-06-13T01:20:26.705903+00:00_

## Files processed

| ID | File | Chapter | Chars | Est. chunks |
| --- | --- | --- | --- | --- |
| `ch00` | `/tmp/_chunker_in/Chapter 00 - The Long Road Home.txt` | 00 | 3127 | 2 |

## Chunk totals

- Source files: **1**
- Total chunks: **2**
- Total characters: **3125**
- Average chunk size: **1562** chars
- Smallest chunk: **1325** chars
- Largest chunk: **1800** chars
- Chunks under `1500` chars: **1**
- Chunks over `1800` chars: **0**
- Chunks over hard max `2000` chars: **0**
- Forced sentence splits: **0**
- Warnings: **0**

## Suspiciously short chunks

| Chunk | Chars | Sentences | Starts heading? | Trailing? |
| --- | --- | --- | --- | --- |
| `ch00_0002` | 1325 | 18 | no | yes |

## Recommended next command

Once you have the Speechify generation script wired up, point it at the manifest:

```bash
python scripts/generate_speechify_audio.py \
    --manifest /tmp/_chunker_out/chunk_manifest.json \
    --out audio/
```

After audio is generated, run the QA audit:

```bash
python audit_audiobook.py \
    --source-dir /tmp/_chunker_out/chunks \
    --audio-dir audio/ \
    --out reports/
```
