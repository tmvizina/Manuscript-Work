# Nonfiction Books and the Knowledge Base

Book Writer supports two kinds of project. A **fantasy** project treats
`world/` as invented canon. A **nonfiction** project treats the same folder as a
**Knowledge Base**: a record of what the author actually knows, did, and can
stand behind.

The difference is not cosmetic. It changes what the workflows are allowed to do
with a gap in the material.

## Choosing the profile

Pick the profile when you import the manuscript folder:

- **Import Fantasy Book** — narrative mode, canon claims.
- **Import Fly & Night Fishing Book** — practical-narrative mode, experience-led
  claims, and a Knowledge Base scaffold.

The choice is written to `.book-writer/project.json` inside the manuscript
folder, so it travels with the book rather than living in the app. Importing is
non-destructive: missing scaffolding is created, and existing files are never
overwritten.

The folder stays physically named `world/` under both profiles. Only the label
changes, to "Knowledge Base". That keeps every tool, path, and workflow
identical across profiles instead of forking the pipeline in two.

## What the Knowledge Base holds

| Folder | Holds |
| --- | --- |
| `author/` | Voice, expertise, and the claims the author will and will not make |
| `audience/` | Who the reader is and what they should be able to do afterwards |
| `topics/` | The topic map, with prerequisites and the chapters that teach each one |
| `techniques/` | How something is actually done |
| `equipment/` | Gear, rigs, and preferences |
| `species/` | Quarry and behaviour |
| `conditions/` | Weather, water, season, light |
| `places/` | Waters and access |
| `people/` | Guides, interviewees, companions |
| `stories/` | The anecdote ledger — real events, attributed |
| `safety-and-regulations/` | Safety, legal, and access claims requiring verification |
| `terminology/` | The glossary and regional alternatives |
| `claims/` | Every factual assertion the book makes |
| `sources/` | Where each claim came from |
| `continuity/` | Decisions that must stay consistent across chapters |
| `_intake/` | Raw notes archived after seeding |

## Stable IDs

Four ledgers use stable IDs that must never be casually renumbered, the same
discipline `CHAR-NNN` and `THR-NNN` follow on the fantasy side:

- `TOP-NNN` — topics
- `ANE-NNN` — anecdotes in the story ledger
- `CLM-NNN` — claims
- `SRC-NNN` — sources

Cross-references between chapters, reviews, and editing plans depend on these
staying put.

## The two rules that differ from fiction

**Experience is attributed, never invented.** In a fantasy project, an unknown
detail can be resolved by deciding it. Here it cannot. Every entry in the story
ledger is labelled as firsthand observation, recollection, interview account, or
open question — and an open question stays open until the author answers it. If
a workflow needs an event that did not happen, the correct output is a question,
not prose.

**Safety and regulation claims are dated and jurisdictional.** Fishing
regulations, access rules, licensing, weather hazards, and anything that could
get a reader hurt or fined belong in the verification ledger with four fields:
jurisdiction, source, checked date, and verification status. These claims expire.
A statement that was true last season may be wrong now, and the ledger is what
makes that reviewable rather than invisible.

Keep personal experience and general advice distinct in the claims ledger.
"This is how I fish it" and "this is how it should be fished" carry very
different burdens of proof.

## Working order

1. **World Notes Seeder** — point it at raw field notes, trip logs, or interview
   transcripts. It proposes Knowledge Base entries and surfaces what it could not
   resolve. Review those before accepting; do not let an uncertain memory become
   a verified claim. Raw material is archived under `_intake/`.
2. **Outline Enhancer** — develop the book's shape from the topic map, so the
   teaching order respects prerequisites.
3. **Story Arc Reviewer** — the human checkpoint. Confirm audience, scope,
   coverage, and omissions before drafting.
4. **Manuscript Planner**, then **Manuscript Writer v2** — chapter briefs, then
   draft.
5. **Book Reviewer v2** → **Manuscript Editing Planner v2** → **Manuscript
   Writer v2** for revision passes.

Throughout, keep correctness, continuity, safety, and sourcing fixes separate
from optional stylistic suggestions. A voice preference and an out-of-date
regulation are not the same class of problem and should not arrive in the same
list.

## A practical starting point

For a fly and night fishing book, seed the Knowledge Base with the author's
field notes, memorable trips, equipment preferences, night-fishing procedures,
local knowledge, and the provenance of any interviews or photographs. Then work
the safety and regulations ledger deliberately, because that is the material
most likely to be both wrong and consequential.
