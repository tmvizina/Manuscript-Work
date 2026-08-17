# Installing Book Writer

This is the plain-language guide for people installing Book Writer from someone
they know. If you are preparing a release, you want
[the release-owner guide](windows-first-time-install.md) instead.

You do not need Docker, WSL, Node.js, a developer setup, or administrator
rights. Book Writer installs into your own user account.

## Before you start

Make sure the installer file came **directly from the person who made it** — in
person, or through an account of theirs you already trust. This matters more
than any warning Windows shows you, because it is the only real check here. If
the file arrived some other way, from a stranger, from a search result, or as an
unexpected attachment, stop and ask them first.

The file is named like `Book Writer-0.1.0-x64.exe`.

## Windows will warn you. This is expected.

When you run the installer, Windows shows a blue box saying:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.

**This is normal for this app, and it is not a virus warning.**

Here is what is actually happening. Commercial software is stamped with a paid
certificate that tells Windows who published it. Book Writer is a personal
project shared with family, and it does not have one, so Windows genuinely does
not know who wrote it. It shows the same message for any unsigned program.
Windows is telling you "I don't recognize this publisher," not "I found
something malicious."

To continue:

1. Click **More info** — a line appears showing the file name.
2. Click **Run anyway**.

That's it. You will only do this once.

> **A note on that advice.** Clicking through this warning is safe *here* because
> you got the file from someone you know and trust. It is not a habit to carry
> elsewhere. For anything you downloaded yourself, that blue screen deserves to
> be taken seriously.

## Installing

1. Run the installer.
2. Keep the suggested location unless you have a reason to change it.
3. Finish the wizard.
4. Open **Book Writer** from the Start menu.

You should not be asked for an administrator password. If you are, something is
different from the normal setup — check with whoever sent you the file.

## Setting up the AI assistant

Book Writer does the writing work by talking to a separate AI program on your
computer — either **Claude Code** or **Codex**. You need one of them.

1. Open **Provider Setup** in Book Writer.
2. Pick Claude or Codex.
3. If it's already on your computer, click **Rescan** and you're done.
4. If it isn't, Book Writer shows you the official instructions for installing
   it. Book Writer will not download or install it behind your back.
5. Click **Sign in**. A terminal window opens — that window belongs to Claude or
   Codex, not to Book Writer. Sign in there, then close it normally.
6. Back in Book Writer, the provider should say **Ready**.

**Book Writer never asks you to type a password, API key, or login code into
it.** If something inside Book Writer ever asks you for one, don't type it — that
isn't how this works, and it's worth reporting.

Signing in needs an internet connection, and so does actually using the AI.

## Your manuscript

Book Writer does not move, copy, or take over your book. You point it at a
folder, and your writing stays exactly where it is.

Two separate things live in two places:

- **Your manuscript** — the folder you chose. This is your actual book.
- **Book Writer's own data** — settings, history, and its database, kept under
  `%APPDATA%\Book Writer`.

**Back up your manuscript folder the way you would any other important
writing.** Book Writer keeps backups of its own database, but that is not a
backup of your book. If you already keep your writing in Dropbox, OneDrive,
iCloud, or Git, you are fine — keep doing that.

## If something goes wrong

**The app won't start.** Restart your computer and try once more. If it still
won't open, tell the person who sent it to you — there are log files under
`%APPDATA%\Book Writer\logs` that will help them, and you can send those.

**It says my provider isn't found.** Claude or Codex needs to be installed for
the *same Windows account* you're using. If you just installed it, close Book
Writer completely, reopen it, and click **Rescan**.

**It's asking me to sign in again.** That's normal from time to time. Click
**Sign in** and finish in the terminal window that opens.

**Something looks broken or empty.** Click **Refresh**. If you edited chapter
files outside Book Writer, it may not have noticed yet.

When reporting a problem, the useful details are: what you clicked, what it
said, and roughly when. You do not need to send your manuscript.

## Uninstalling

Uninstall from Windows Settings → Apps as usual.

By default this **keeps your Book Writer data**, so reinstalling later picks up
where you left off. The uninstaller also offers a **Remove all local Book Writer
data** checkbox, which is off unless you tick it deliberately.

**Either way, your manuscript folder is never touched.** Uninstalling Book
Writer cannot delete your book.
