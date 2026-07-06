#!/usr/bin/env node
// claude-bridge: run `claude -p` on the host for the Book Writer app.
//
// The app (usually inside docker, where no claude auth exists) POSTs a prompt
// here; this bridge spawns the claude CLI with cwd = this repo's root so the
// repo's skills and slash commands resolve, and relays claude's stream-json
// output back as chunked NDJSON. Closing the request socket kills the run.
//
// Cross-machine: resolves the claude executable WINDOWS-FIRST (claude.cmd /
// claude.exe in the usual install spots), falling back to the mac/unix
// `claude` only when no Windows install is found. The prompt is passed via
// stdin, so Windows .cmd quoting is never an issue.
//
//   node bridge/claude-bridge.js            # port 8412
//   PORT=9000 BRIDGE_TOKEN=secret node bridge/claude-bridge.js
//   BRIDGE_ALLOW_CURL=0 …                   # don't pre-allow Bash(curl:*)
//
//   GET  /health -> {ok, version, claude, cwd}
//   POST /run    {prompt, cwd?, permissionMode?, extraDirs?, partial?}
//                -> NDJSON stream: claude stream-json lines verbatim,
//                   then {"type":"bridge_done","exit_code":N}
'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {spawn, execFile} = require('node:child_process');

const PORT = Number(process.env.PORT || 8412);
const TOKEN = process.env.BRIDGE_TOKEN || '';
const REPO_ROOT = path.resolve(__dirname, '..');
// RAG-aware skills look up canon via `curl` against the app's RAG endpoint;
// headless runs can't answer permission prompts, so pre-allow curl for
// bridge-spawned runs. Set BRIDGE_ALLOW_CURL=0 to turn this off.
const ALLOW_CURL = process.env.BRIDGE_ALLOW_CURL !== '0';
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan']);
if (process.env.BRIDGE_ALLOW_BYPASS === '1') PERMISSION_MODES.add('bypassPermissions');

// ---- claude executable resolution: Windows candidates first, mac fallback ----
function claudeCandidates() {
  const c = [];
  const home = process.env.USERPROFILE || '';
  const appData = process.env.APPDATA || (home ? path.join(home, 'AppData', 'Roaming') : '');
  const localAppData = process.env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '');
  if (appData) c.push(path.join(appData, 'npm', 'claude.cmd'));
  if (home) c.push(path.join(home, '.local', 'bin', 'claude.exe'));
  if (localAppData) c.push(path.join(localAppData, 'Programs', 'claude', 'claude.exe'));
  c.push('claude.cmd', 'claude.exe'); // Windows PATH
  c.push('claude'); // mac/unix fallback
  return c.filter((p) => !path.isAbsolute(p) || fs.existsSync(p));
}

let claudeCmd = null;
let claudeVersion = null;

function probeClaude(cb) {
  const tryNext = (list) => {
    if (!list.length) {
      claudeCmd = null;
      claudeVersion = null;
      return cb && cb(new Error('claude not found'));
    }
    const [cand, ...rest] = list;
    execFile(cand, ['--version'], {timeout: 15000, shell: cand.endsWith('.cmd')}, (err, stdout) => {
      if (err) return tryNext(rest);
      claudeCmd = cand;
      claudeVersion = String(stdout).trim();
      cb && cb(null);
    });
  };
  tryNext(claudeCandidates());
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function sendJson(res, code, obj) {
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

function handleRun(req, res, body) {
  let parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch {
    return sendJson(res, 400, {error: 'invalid JSON body'});
  }
  const prompt = String(parsed.prompt || '').trim();
  if (!prompt) return sendJson(res, 400, {error: 'missing prompt'});
  if (!claudeCmd) return sendJson(res, 503, {error: 'claude not found on this machine — is it installed?'});

  const mode = String(parsed.permissionMode || 'acceptEdits');
  if (!PERMISSION_MODES.has(mode)) {
    return sendJson(res, 400, {error: `permissionMode must be one of: ${[...PERMISSION_MODES].join(', ')}`});
  }
  const cwd = parsed.cwd ? path.resolve(String(parsed.cwd)) : REPO_ROOT;

  // Prompt goes via stdin (`claude -p` reads it when no positional prompt is
  // given) — no quoting issues on Windows .cmd shims, no argv length limits.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode];
  if (ALLOW_CURL) args.push('--allowedTools', 'Bash(curl:*)');
  if (parsed.partial) args.push('--include-partial-messages');
  for (const dir of Array.isArray(parsed.extraDirs) ? parsed.extraDirs : []) {
    args.push('--add-dir', path.resolve(String(dir)));
  }

  const child = spawn(claudeCmd, args, {cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: claudeCmd.endsWith('.cmd')});
  child.stdin.write(prompt);
  child.stdin.end();
  console.log(`[run] pid=${child.pid} mode=${mode} cwd=${cwd} prompt=${prompt.slice(0, 120).replace(/\n/g, ' ')}`);

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });

  let stderrTail = '';
  child.stdout.on('data', (d) => res.write(d)); // claude emits newline-delimited JSON already
  child.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  child.on('error', (e) => {
    res.write(JSON.stringify({type: 'bridge_error', error: `spawn failed: ${e.message} (claude: ${claudeCmd})`}) + '\n');
    res.end();
  });
  child.on('close', (code) => {
    res.write(JSON.stringify({type: 'bridge_done', exit_code: code, stderr_tail: code ? stderrTail : undefined}) + '\n');
    res.end();
    console.log(`[run] pid=${child.pid} done exit=${code}`);
  });

  // App-side cancel = client dropping the connection. (res 'close' fires on
  // premature disconnect; req 'close' would fire as soon as the POST body is
  // read, which is immediately.)
  res.on('close', () => {
    if (child.exitCode === null && !child.killed) {
      console.log(`[run] pid=${child.pid} request closed -> SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5000).unref();
    }
  });
}

const server = http.createServer((req, res) => {
  if (!authorized(req)) return sendJson(res, 401, {error: 'unauthorized'});
  if (req.method === 'GET' && req.url === '/health') {
    const reply = () =>
      sendJson(res, claudeVersion ? 200 : 503, {ok: !!claudeVersion, version: claudeVersion, claude: claudeCmd, cwd: REPO_ROOT});
    return claudeVersion ? reply() : probeClaude(reply);
  }
  if (req.method === 'POST' && req.url === '/run') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1 << 20) req.destroy();
    });
    req.on('end', () => handleRun(req, res, body));
    return;
  }
  sendJson(res, 404, {error: 'not found'});
});

server.requestTimeout = 0; // runs take minutes; the app owns timeouts
server.headersTimeout = 60000;

probeClaude((err) => {
  if (err) console.warn('[bridge] warning: claude not found (tried Windows installs, then PATH) — /health reports not-ok until it is');
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`claude-bridge listening on :${PORT}  (cwd for runs: ${REPO_ROOT}${TOKEN ? ', token auth ON' : ''}${ALLOW_CURL ? ', curl pre-allowed for RAG lookups' : ''})`);
    console.log(`claude: ${claudeVersion ? `${claudeVersion} via ${claudeCmd}` : 'NOT FOUND'}`);
  });
});
