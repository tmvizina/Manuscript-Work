# Claude Bridge — running claude in an IDE terminal so the app can reach it

The Book Writer app runs your skills by calling the `claude` CLI in **headless
mode** (`claude -p`). But the app usually lives inside Docker, and containers
have no Claude login — your authentication lives in `~/.claude` on this Mac,
and it is deliberately **never mounted into any container**.

The bridge closes that gap: a tiny server you run **on your machine, in a
terminal**, that accepts run requests from the app and spawns `claude` locally
— with this repo as the working directory, so every skill and slash command
resolves exactly as it does when you use claude yourself.

```
browser ──► app (docker :8321) ──► bridge (your terminal :8412) ──► claude -p
```

## Starting it (once per work session)

1. In Rider (or any IDE), open the built-in **Terminal** at this repo's root.
2. Run:

   ```sh
   node bridge/claude-bridge.js
   ```

3. You should see:

   ```
   claude-bridge listening on :8412  (cwd for runs: …/Manuscript-Work)
   claude: 2.1.201 (Claude Code)
   ```

4. Check the top bar of the app — the **bridge** dot turns green within ~30
   seconds (or refresh). The Run buttons on every skill page are now enabled.

**Keep this terminal open while you work.** Closing it (or stopping the
process with `Ctrl-C`) ends the bridge; runs in flight are killed, and the Run
buttons disable until you start it again.

## Verifying it by hand

```sh
curl localhost:8412/health
# {"ok":true,"version":"2.1.201 (Claude Code)","cwd":"…/Manuscript-Work"}
```

## Permission modes

Every skill page has a permission-mode picker that maps straight to
`claude --permission-mode`:

- **acceptEdits** (default) — claude may create and edit files in this repo
  without asking. Right for normal pipeline runs (the writer writing chapters,
  the seeder updating `world/`).
- **default** — edits require pre-approval, which headless runs can't grant;
  claude will work read-only and report instead of editing. Use it when you
  want analysis without changes.
- **plan** — read-only planning mode: claude explores and produces a plan,
  touching nothing.

## Troubleshooting

- **Bridge dot stays red** — is the terminal still open? Does
  `curl localhost:8412/health` answer? If the app runs in Docker on Linux,
  make sure the compose file's `extra_hosts: host.docker.internal:host-gateway`
  line is intact.
- **`claude: NOT FOUND` at startup** — the IDE terminal may not load your
  login shell's PATH. Run `which claude` in the same terminal; if empty, start
  the terminal shell fresh (`zsh -l`) or add the claude install dir to PATH.
- **Runs hang then time out** — a run that needs permission for something
  outside the repo can't ask in headless mode. Re-run with `acceptEdits`, or
  perform that step manually in an interactive claude session.
- **Port already in use** — something else owns :8412. Start the bridge with
  another port (`PORT=8413 node bridge/claude-bridge.js`) and point the app at
  it (`CLAUDE_BRIDGE_URL=http://host.docker.internal:8413` in the compose
  environment).
- **Security note** — the bridge listens on all interfaces so Docker can reach
  it. On a shared network, set a token: start the bridge with
  `BRIDGE_TOKEN=<secret> node bridge/claude-bridge.js` and put the same value
  in `.env` as `BRIDGE_TOKEN=` before `docker compose up`.
