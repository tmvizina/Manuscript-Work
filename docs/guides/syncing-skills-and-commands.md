# Syncing Skills and Commands Across Machines

You work on more than one computer, and Claude Code looks for skills and commands in a few different places. This guide explains where everything lives and how to keep it all in sync — the short version is: **the repo is the suitcase; each machine unpacks it.**

## The three places things live

| Location | What it is | Travels with the repo? |
|---|---|---|
| `skills/` (in this repo) | The **versioned master copies** of every skill. This is the source of truth for sharing between machines. | ✅ Yes — it's just files in git |
| `.claude/commands/` (in this repo) | The slash commands. Claude Code picks these up **automatically** on any machine, as soon as the repo is cloned/pulled. Zero installation. | ✅ Yes |
| `~/.claude/skills/` (on each machine) | The **live, installed** skills for that computer. This is what Claude Code actually loads when a skill triggers. | ❌ No — per machine |

There is also `~/.claude/commands/` (personal commands on each machine). Those are for commands you want everywhere regardless of which project you're in. Project-specific ones belong in the repo.

## The golden rule

> **Edit the live copy in `~/.claude/skills/`, then copy it into the repo's `skills/` folder and commit.**
> The repo's copy is for versioning and moving between machines; the `~/.claude/skills/` copy is what actually runs.

(Why both? Claude Code loads skills from `~/.claude/skills/`, not from arbitrary repo folders. The repo copy makes the skill survive machine changes, get history in git, and install cleanly on the next computer.)

## Everyday sync recipes

### After editing a skill locally (push it into the repo)

```bash
cp -R ~/.claude/skills/world-notes-seeder/ \
      ~/RiderProjects/Manuscript-Work/skills/world-notes-seeder/
```

Then commit and push (in Rider: Commit tool window → tick the files → Commit and Push — see the git guide).

### Setting up a new machine from the repo

Pull the repo first, then copy every skill from `skills/` into the live folder:

```bash
# from the repo root
for d in skills/*/; do
  cp -R "$d" ~/.claude/skills/"$(basename "$d")"/
done
```

Commands need **no step at all** — `.claude/commands/` works the moment the repo is on disk.

### Checking whether the two copies have drifted

```bash
diff -r ~/.claude/skills/world-notes-seeder \
        ~/RiderProjects/Manuscript-Work/skills/world-notes-seeder
```

No output = perfectly in sync.

## What syncs automatically vs. what doesn't

- **Automatic (via git pull):** everything in the repo — `skills/`, `.claude/commands/`, `README.md`, `samples/`, these guides.
- **Manual (the copy step above):** getting `skills/` into `~/.claude/skills/` on each machine, and pushing live-skill edits back into `skills/`.
- **Never synced:** `~/.claude/settings.json`, API keys, machine-specific paths. Each machine keeps its own.

## Gotchas

1. **Editing only the repo copy does nothing until you copy it live.** If a skill "isn't picking up your changes," check that `~/.claude/skills/<name>/SKILL.md` actually has the edit.
2. **Editing only the live copy means other machines never see it.** If it matters, push it into `skills/` and commit.
3. **Duplicate command names:** if `~/.claude/commands/foo.md` and the repo's `.claude/commands/foo.md` both exist, both appear in the `/` menu, labeled by source. Delete the personal one if the project one supersedes it.
4. **Restart the Claude Code session** (or start a new conversation) after installing new skills — the skill list is read at session start.
5. **Sibling repos may carry their own copies of shared skills** (this ecosystem was split from one POC tree). When you improve a skill that exists in more than one repo, decide which repo owns it and sync the others from there — don't let three copies drift three ways.
