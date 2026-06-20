# Chapter Plan — Chapter 01: The First Broken Seal

> **At a glance:** **Updated 2026-06-13 — chronicle frame is dropped.** Ch 1's opening paragraphs need significant revision. The "Gilbert de Vere began the account in the second year of their wandering" / "set quill to parchment" framing is cut. The anchor aphorism "Memory was not a scribe…" is **preserved in spirit** — the *cadence* (denial of an obvious metaphor, then the truer one) stays; the *scribal/parchment imagery* changes. The second anchor aphorism "Such was the memory of men / Such, perhaps, was mercy" stands as-is (no scribal imagery). Per initial review, also cut 30% of single-line landings.
> **Source findings:** RV-2026-06-13-002 (RESOLVED — frame dropped), G-007 (RV-021-adjacent) aphoristic density, initial-review § Ch 1.
> **Plan items:** 4.
> **Effort:** M (Ch 1 is the heaviest single chapter for the frame-drop sweep).
> **Dependencies:** None (S01 resolved). Coordinates with `chronicle-frame-implementation.md` sub-plan.
> **Audiobook impact:** Yes (opening cadence changes).

---

## Plan items

### EP-2026-06-13-Ch01-001 — Strip the chronicle frame from Ch 1's opening

- **From finding:** RV-2026-06-13-002 (RESOLVED 2026-06-13 — author dropped the frame).
- **Severity:** High
- **Writer label:** MUST FIX
- **Planning priority:** Draft-Level
- **Effort:** M
- **Location:** Ch 1 lines 3–25 (the chronicle-frame establishment paragraphs); plus line 75 ("set down"). See full table in `editing-plan/motif-subplans/chronicle-frame-implementation.md` § Strip targets.
- **What to change (per the sub-plan):**
  - **Line 3:** Cut "Gilbert de Vere began the account in the second year of their wandering." Possible recast: "Gilbert de Vere came to the road in the second year of his wandering with Dossi." Or the chapter opens directly on a scene-level beat (the wyrmling, a tavern, Dossi's face). The writer composes.
  - **Line 7:** Cut "the man who set quill to parchment." Possible recast: "Years lay between that boy and the man Gilbert had become."
  - **Line 19 — THE ANCHOR APHORISM:** "Memory was not a scribe, dutiful and patient, scratching truth into parchment by candlelight. Memory was a beggar with a sack full of broken things." **PRESERVE IN SPIRIT.** The technique (denial of an obvious metaphor + truer one) is signature pattern #2 and stays. The *scribal/writing imagery* must change. Illustrative recast: "Memory was not a clerk, dutiful and patient, sorting truth from year to year. Memory was a beggar with a sack full of broken things." The writer composes.
  - **Line 25:** Cut entirely. "Still, Gilbert set quill to parchment." has no place; the chapter moves directly from the "Memory was…" paragraph to the next scene.
  - **Line 55:** Keep if "account" reads as bookkeeping. Recast if it reads as chronicling.
  - **Line 75:** Recast "set down" → "later name with confidence" (illustrative).
- **Why:** The chronicle frame is gone (author decision 2026-06-13); Ch 1's frame-establishment paragraphs must come out cleanly without losing the anchor aphorism's cadence.
- **Risks:** **HIGHEST voice-drift risk in the pass.** The Ch 1 anchor aphorism's *cadence* (the technique) must survive while the *imagery* (scribe, parchment, candlelight) changes. Self-diff against voice fingerprint after every word change. The writer-v2 voice gate will fire hard here.
- **Voice catalog touch:** YES — signature pattern #2 ("Memory was X" construction). PROTECT the *technique*; only the *imagery* changes.
- **World file update:** `world/voice-bible/frame-rules.md` (already updated this pass); confirm post-pass that Ch 1 implementation matches.
- **Dependencies:**
  - Coordinates-with: `chronicle-frame-implementation.md` sub-plan.
- **Audiobook impact:** Yes (the opening reads differently; narrator pacing changes).
- **Campaign-pending touch:** No.

### EP-2026-06-13-Ch01-002 — Cut 30% of single-line aphoristic landings

- **From finding:** RV-2026-06-13-021 (adjacent — Ch 1 has the densest concentration); initial review.
- **Severity:** Medium-Low (per voice protection)
- **Writer label:** CONSIDER
- **Planning priority:** Line-Level
- **Effort:** M
- **Location:** Ch 1 throughout. Anchors: lines 19–25 (the two anchor aphorisms — DO NOT TOUCH); other instances of single-line landings sprinkled through the chapter.
- **What to change:** Identify every isolated single-sentence paragraph in Ch 1. KEEP the two anchor aphorisms ("Such was the memory of men. / Such, perhaps, was mercy." and "Memory was not a scribe… Memory was a beggar."). KEEP "Most beginnings disguised themselves that way." (line ~91 per initial review). Cut roughly 30% of the others — the writer chooses which.
- **Why:** Ch 1's aphoristic density teaches the reader the trick. Five strong uses anchor the voice; the rest become rhythm.
- **Risks:** **HIGHEST voice-drift risk in this pass.** Per voice catalog, aphoristic isolated lines ARE signature. The *count* is what's being audited, not the technique. Every individual removal is suggest-only with author review.
- **Voice catalog touch:** YES — signature pattern #1 + #3 in the catalog. PROTECT the technique; reduce the count.
- **World file update:** None (count audit only).
- **Dependencies:**
  - Conflicts-with: EP-Ch01-001 (some aphorisms may also be frame markers — coordinate).
- **Audiobook impact:** No.
- **Campaign-pending touch:** No.

### EP-2026-06-13-Ch01-003 — Verify Charlie silver-mark Ch 11 vs Ch 12 (no Ch 1 implication)

- **From finding:** G-005 (continuity-ledger update this pass)
- **Severity:** Low
- **Writer label:** CONSIDER
- **Planning priority:** Continuity-Level
- **Effort:** S
- **Location:** Ch 1 — confirm no silver-mark or wing imagery on Charlie that suggests the mark is already named or active.
- **What to change:** Read pass only. If anything in Ch 1's bard-introduction Charlie material reads as silver-mark foreshadowing, leave it (foreshadowing is fine). If anything reads as the mark *named*, that's a continuity break and needs revision.
- **Why:** The continuity ledger update this pass moves Charlie's silver-mark first-appearance from Ch 11 to Ch 12. Confirm Ch 1's Charlie introduction doesn't contradict.
- **Risks:** None (read pass).
- **Voice catalog touch:** No.
- **World file update:** `world/continuity/continuity-ledger.md` — confirm Ch 1 read; mark verified.
- **Dependencies:**
  - Blocks: EP-Ch11-002 (the Ch 11 audit depends on Ch 1's baseline being known).
- **Audiobook impact:** No.
- **Campaign-pending touch:** No.

### EP-2026-06-13-Ch01-004 — Audit "That, more than X" structure (count check)

- **From finding:** G-007 (motif-subplan input)
- **Severity:** Low
- **Writer label:** CONSIDER
- **Planning priority:** Line-Level
- **Effort:** S
- **Location:** Ch 1 — search for "That, more than" pattern.
- **What to change:** Count uses in Ch 1. Feed count to `aphoristic-landings-audit.md`. No prose change in this chapter unless the audit identifies a specific trim.
- **Why:** Per the motif sub-plan, the 13+ uses of "That, more than X, told Gilbert Y" across the manuscript are approaching mannerism. Ch 1's contribution to the count is the baseline.
- **Risks:** None (read pass).
- **Voice catalog touch:** Yes (the structure is signature-adjacent).
- **World file update:** None.
- **Dependencies:**
  - Feeds: `motif-subplans/aphoristic-landings-audit.md`
- **Audiobook impact:** No.
- **Campaign-pending touch:** No.

---

## Risks summary (chapter-wide)

- Ch 1 is the manuscript's voice-establishment chapter. **Every edit risks the manuscript's voice.** The writer should treat this chapter with the highest gate sensitivity.
- The two anchor aphorisms ARE the voice. Touching them is rolling back the manuscript.

## Dependency summary

- ~~Blocked-by: EP-S01 (frame).~~ **RESOLVED 2026-06-13.**
- Blocks: EP-Ch11-002 (silver-mark audit).
- Feeds: `aphoristic-landings-audit.md` motif sub-plan.
- Coordinates-with: `chronicle-frame-implementation.md` sub-plan (Ch 1 is the densest single chapter for that sweep).
