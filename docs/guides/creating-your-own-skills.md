# Creating Your Own Claude Skills

A skill is nothing more than **a folder with a `SKILL.md` file in it** — a set of written instructions Claude reads when a matching task comes up. Everything in this repo's `skills/` folder (the dramaturg, the lector, the writer, the chunker) is exactly that. If you can describe a job in writing, you can make a skill for it.

## When to make a skill

Make one when you notice yourself **re-explaining the same job** to Claude across sessions:

- "Deepen my rough outline, but don't invent answers to open questions" → that became `outline-enhancer`.
- "Chunk this chapter the way we always do, 1500–1800 chars, never splitting sentences" → that became `audiobook-text-prep-chunker`.
- "Take my handwritten notes and file them into the world folder" → that became `world-notes-seeder`.

The pattern: **repeated task + specific rules you'd otherwise repeat = skill.**

## Anatomy of a skill

```
skills/my-new-skill/
├── SKILL.md          ← required — the instructions
├── reference/        ← optional — extra docs Claude reads only when needed
├── templates/        ← optional — output templates to copy from
└── scripts/          ← optional — Python/shell scripts the skill runs
```

`SKILL.md` starts with a **frontmatter block** (the part between `---` lines), then the instructions:

```markdown
---
name: my-new-skill
description: One or two sentences saying WHAT it does and WHEN to use it.
  This is the ONLY part Claude sees before deciding to use the skill —
  write it like a good book-jacket blurb. Include the words you'd
  actually say when asking for it. Also say what it does NOT do.
argument-hint: "[what to type after the command]"
---

# My New Skill

You are the [role]. Your job is to [job].

## Workflow
1. First, read ...
2. Then, produce ...

## Hard rules
1. Never ...
2. Always ...
```

## The three things that make a skill good

1. **The description is the trigger.** Claude reads only the description when deciding whether the skill applies. Put the phrases you'd naturally say into it ("seed the world folder", "here are my handwritten notes"). If a skill isn't firing when it should, the fix is almost always a better description.
2. **Keep `SKILL.md` under ~500 lines.** If it grows past that, move detail into `reference/` files and tell the skill when to read them ("For the full grading rubric, read `reference/grading.md`"). Claude then loads detail only when needed — this is called progressive disclosure.
3. **Write hard rules for the failure modes you've seen.** The best lines in this repo's skills came from things going wrong once: "never guess at handwriting," "mark it campaign-pending rather than inventing an answer," "never broadly rewrite." When a skill misbehaves, add a rule.

## Step-by-step: making one

1. Create the folder and file:
   ```bash
   mkdir -p ~/.claude/skills/my-new-skill
   ```
   Then ask Claude: *"Create a skill at `~/.claude/skills/my-new-skill/SKILL.md` that does X, following the format of `skills/world-notes-seeder/SKILL.md`."* (There's also a built-in `skill-creator` skill that will interview you and build it properly.)
2. Start a fresh Claude Code session and try it on a real task.
3. When it gets something wrong, edit `SKILL.md` — usually adding a rule or example — and try again. Skills improve by iteration, not by up-front perfection.
4. When it works, copy it into the repo and commit, so it's versioned and reaches your other machines:
   ```bash
   cp -R ~/.claude/skills/my-new-skill ~/RiderProjects/Manuscript-Work/skills/
   ```
5. Optionally give it a slash command: create `.claude/commands/my-new-skill.md` in the repo, copying the format of any existing file there (a description, then "Invoke the `my-new-skill` skill…", then `Request: $ARGUMENTS`).

## Ideas shaped like this pipeline's needs

- **session-notes-to-canon** — after a D&D session, intake what happened at the table and resolve the matching campaign-pending items in `world/`.
- **blurb-writer** — back-cover copy and shop descriptions grounded in `world/` without spoilers.
- **continuity-quizzer** — quizzes *you* on canon before you draft, to catch drift early.
- **sample-pack-refresher** — regenerates the `samples/` artifacts whenever a skill's output format changes, so the documented contract never goes stale.

## Rules of thumb

- One skill = one job. A skill that reviews *and* rewrites will do both badly — that's why the lector and the writer are separate stages here.
- Say what the skill must NOT do. The "does NOT" sentences in the descriptions prevent the wrong skill from firing.
- Steal from your own shelf: every skill in `skills/` is a working example. Copy the closest one and adapt.
