---
description: The publisher's gate — read the ENTIRE manuscript, render one verdict: GREENLIGHT or RETURN FOR REVISION with scoped review assignments
argument-hint: "[scope — e.g. 'Book 1', 'the prequel', or a manuscript path]"
---

Launch the `publishing-executive` agent via the Agent tool (subagent_type: publishing-executive). If the agent type is not available on this machine, read `.claude/agents/publishing-executive.md` in this repo and follow its instructions directly.

The last gate before "ship it": reads the whole book in order, judges at altitude only (premise, structure, pacing, arcs, stakes, theme, payoff, voice, reader-noticeable continuity, market/audiobook readiness), and writes a Publisher's Verdict Memo to `reviews/`. A RETURN hands prioritized review assignments back to `/book-reviewer-v2` (→ `/manuscript-editing-planner-v2` → `/manuscript-writer-v2`), then the revised book comes back for re-verdict. Never line-edits.

Request: $ARGUMENTS
