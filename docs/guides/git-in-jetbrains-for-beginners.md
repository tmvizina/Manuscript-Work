# Git in JetBrains (Rider) — A Beginner's Guide

*For someone who has never used git and doesn't want to learn the command line.*

## What git actually is

Git is a **save-point system for your files** — like save slots in a video game, but for the whole project at once. Every time you make a "commit," git takes a snapshot of everything. You can look back at any old snapshot, see exactly what changed and when, and restore any file to how it was. Nothing you commit is ever truly lost.

Two more words you'll see constantly:

- **Push** = upload your save-points to GitHub (the online copy). Until you push, your commits exist only on this computer.
- **Pull** = download save-points from GitHub that were made elsewhere (your other computer, or Claude working in the cloud).

That's 90% of git: **commit** (save), **push** (upload), **pull** (download).

## The daily routine (three steps)

### 1. When you sit down: Pull

Click the **blue down-arrow** in the toolbar at the top of Rider (or menu: **Git → Pull**). This grabs anything new from GitHub — for example, work done on the other computer. Do this *before* you start changing things.

### 2. While you work: just work

Edit files normally. Rider quietly tracks every change — you don't have to do anything. Changed files show in a different color in the file list (blue = modified, green = brand new).

### 3. When you finish something: Commit, then Push

1. Open the **Commit** window — the checkmark icon in the left sidebar (or menu: **Git → Commit**).
2. You'll see a list of every file you changed. **Tick the boxes** for the ones that belong together. (You don't have to commit everything at once — it's fine to leave some unticked.)
3. Click any file in the list to see a **before/after view** of exactly what changed. This is the best feature in the whole system — always glance at it.
4. Type a short message describing what you did, in plain English: *"Fixed Chapter 12 opening scene"* or *"Added world notes for the northern factions."* Future-you will read these messages, so make them honest and human.
5. Click the **Commit and Push…** button (the dropdown next to Commit). That saves the snapshot *and* uploads it in one go.

That's it. That's the whole job.

## Branches — the "safe copy" trick

A **branch** is a parallel save-file. You make one when you're about to try something you might regret — a big revision pass, an experiment — so the main version stays untouched until you're happy.

- The branch you're on is shown in the **bottom-right corner** of Rider (it says `main` or a working name like `pass/world-seed-june`).
- Click that name → **New Branch** → give it a name → OK. You're now working on the copy.
- To go back: click the name again, pick the branch you want, choose **Checkout**. Your files instantly change to match that branch. (Nothing is lost — the other branch keeps its own state.)
- When a branch's work is done, it gets **merged** into `main` — in this repo that's usually done through a **pull request** on GitHub, which gives you a chance to review the changes as a whole first. If any of that feels fiddly, it's fine to hand it to Claude.

**Good habit for this repo: don't commit directly on `main`.** Make a branch, commit there, and open a pull request. If the bottom-right corner says `main`, make a branch first.

## Looking at history

Click the **Git** tab at the bottom of Rider (or menu: **Git → Show Git Log**). You'll see every commit ever made — who, when, what message — and clicking one shows exactly which lines changed in which files. This is how you answer "what happened to this chapter last week?"

## Fixing mistakes

- **"I messed up a file and want it back how it was":** right-click the file → **Git → Rollback**. It returns to the last committed version. (This throws away your uncommitted edits to that file — that's the point — so be sure.)
- **"I want to see an old version of a file":** right-click the file → **Git → Show History**, click any date, and you can read or restore that version.
- **"I committed but wrote the wrong message / forgot a file":** in the Commit window there's an **Amend** checkbox — tick it and commit again; it repairs the last commit instead of making a new one. (Only do this if you haven't pushed yet.)

## When scary dialogs appear

- **"Merge conflict"** — you and the other computer changed the same lines, and git wants a human to pick. Rider shows a **Merge** button that opens a three-column view: yours on the left, theirs on the right, result in the middle. Click the arrows to accept the pieces you want. If it's confusing, close it and ask Claude to resolve the conflict — this is a normal thing to hand off.
- **"Push rejected"** — GitHub has commits you don't have yet. Just Pull first, then Push again.
- **Anything else you don't understand** — click Cancel (it's almost always safe), and ask. Git very rarely destroys anything; nearly every mistake is recoverable.

## Cheat sheet

| I want to… | Do this in Rider |
|---|---|
| Get the latest work | Blue down-arrow (Pull) |
| Save my work | Checkmark icon → tick files → message → **Commit and Push** |
| See what I've changed | Commit window — click any file |
| Start something risky | Bottom-right branch name → **New Branch** |
| See the project's history | **Git** tab at the bottom |
| Undo my edits to one file | Right-click file → **Git → Rollback** |
| Panic | Cancel the dialog, ask Claude |
