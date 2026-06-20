# Writer/Lector Loop Conventions

## Roles

- **Lector** = `book-reviewer` skill. Reads the manuscript, produces editorial findings.
- **Writer** = `manuscript-writer` skill. Receives findings, decides per finding, applies accepted changes.
- **Author** = the human. Owns all final creative decisions; arbitrates disputes between writer and lector.

## Task IDs

Findings produced by the lector or surfaced by the author get IDs:

- `RV-NNN` — review finding (from a numbered lector review)
- `WP-NNN` — writer pass (decisions on a batch of findings)
- `SR-NNN` — suggested rewrite (sidecar item)

IDs are stable across a pass. If a finding is re-opened in a later lector pass, it gets a new ID linked to the old one (`RV-014 (reopened from RV-007)`).

## Severity Rubric

| Label | Definition | Writer default |
|-------|-----------|----------------|
| **MUST FIX** | Continuity break, formatting failure, factual contradiction, reader-comprehension failure, audiobook-blocking issue. | Implement. |
| **SHOULD FIX** | Real craft issue, but voice, intent, or trade-off may warrant push-back. | Implement unless push-back is grounded. |
| **CONSIDER** | Polish-level or stylistic. Writer's call. | Suggest-only unless writer finds it compelling. |

## Decision Vocabulary

- **Implement** — the change is made; commit on revision branch.
- **Push back** — the writer disagrees and provides a counter-argument; manuscript unchanged; finding re-enters the loop on next lector pass.
- **Suggest-only** — the writer drafts a proposed change in the sidecar; manuscript unchanged; human decides.
- **Reclassify** — the writer disagrees with the severity, not the finding; proposes new severity with reasoning.
- **Defer** — the finding is real but out of scope for the current pass; recorded for a future pass with a stated trigger ("after Ch 25 paragraph reflow lands").

## Push-Back Justifications

Every push-back must be grounded in one of:

1. **Voice** — the recommendation flattens deliberate prose style.
2. **Intent** — the recommendation misreads the scene's purpose.
3. **Context** — the recommendation ignores setup/payoff elsewhere.
4. **Trade-off** — implementing would break a stronger thing.
5. **Disagreement on facts** — the finding misreads the text.
6. **Campaign-pending** — the recommendation would resolve a narrative thread whose resolution depends on the active D&D campaign and has not yet happened at the table. The writer cannot decide what the POV character learns and when; the campaign produces those answers. See `world/characters/gilbert-de-vere-veringard.md` § Campaign-pending for the canonical pattern in this manuscript.

Vague push-back ("I disagree", "it reads fine to me") is not allowed.

## Pass Scope

A "pass" is a single Writer iteration over a defined set of findings. Examples:

- "Critical paragraph-reflow pass" — only the formatting MUST FIX items.
- "Motif pass: dragon density Ch 17, 18" — narrow scope.
- "Full pass over 2026-06-13 review" — every finding in the document.

Each pass produces its own decisions file and sidecar. Passes do not bleed into each other.

## Branching

- Each pass lives on its own branch: `pass/critical-formatting`, `revise/ch25-paragraph-reflow`, `motif/dragon-density-ch17`.
- The writer never commits on `main`.
- After lector sign-off, the human merges the pass branch into `main` (or asks the writer to do so).

## Sign-Off

A pass is "signed off" when the lector, on a re-read, posts a final review with no MUST FIX items outstanding from the pass and the writer's push-backs are accepted or withdrawn. Sign-off is a tag, e.g., `pass/critical-formatting-signed-off-2026-06-15`.

## Commits

Commit messages reference finding IDs:

```
Ch 25: reflow paragraphs (RV-001)

Restored paragraph breaks in the obsidian basin chapter.
File was a single 5,550-word block in the previous draft.

Sourced breaks by sentence rhythm and dialogue boundaries.
No prose changes; structural only.
```

Commits never bundle multiple findings unless they are intrinsically linked.

## Failure Modes to Avoid

- **Wholesale rewriting under the guise of "polishing."** The writer's edits should be visible as discrete changes a human could approve or reject. If a diff looks like a rewrite, the work belonged in suggest-only.
- **Accepting MUST FIX without reading the passage.** Even MUST FIX needs evidence in the decisions log.
- **Push-back without grounding.** "I like it this way" is not a push-back.
- **Bundling findings into one commit.** Lost the ability to roll back individually.
- **Editing on `main`.** Always branch.
- **Letting the suggest-only sidecar grow without resolution.** Each pass should leave the sidecar at zero or hand it to the author with a clear ask.
