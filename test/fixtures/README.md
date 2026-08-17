# Synthetic fixtures

These fixtures are deliberately small, deterministic, and synthetic. They do
not contain text, names, identifiers, or world facts from a private
manuscript. The `project/` tree looks like a small manuscript project, while
`streams/` contains representative Claude and Codex JSONL output plus streams
that are intentionally malformed.

## Layout

- `project/manifest.json` describes the fixture and its expected file counts.
- `project/manuscript/` contains two short chapter text files with headings,
  dialogue, a scene break, Unicode punctuation, and blank paragraphs.
- `project/world/` contains synthetic setting, character, and timeline notes.
- `streams/claude/` contains a successful tool-using run and an error result.
- `streams/codex/` contains a successful `codex exec --json`-style run and a
  failed turn.
- `streams/malformed/` contains invalid JSON, a truncated final object, and a
  stream with blank lines/mixed event shapes.

The fixture files are intentionally checked in at a readable size. For
throughput and memory tests, use the generator instead of adding a giant file:

```text
node test/benchmarks/generate-corpus.mjs --kind corpus --chars 10000000 --output <temp-file>
node test/benchmarks/generate-corpus.mjs --kind transcript --chars 10000000 --output <temp-file>
```

No output is written unless `--output` or `--stdout` is supplied, so a normal
test run cannot accidentally add a multi-megabyte artifact to the repository.

