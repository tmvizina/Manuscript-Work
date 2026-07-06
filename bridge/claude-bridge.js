#!/usr/bin/env node
// claude-bridge: run `claude -p` on the host for the Book Writer app.
//
// The app (usually inside docker, where no claude auth exists) POSTs a prompt
// here; this bridge spawns the claude CLI with cwd = this repo's root so the
// repo's skills and slash commands resolve, and relays claude's stream-json
// output back as chunked NDJSON. Closing the request socket kills the run.
//
//   node bridge/claude-bridge.js            # port 8412
//   PORT=9000 BRIDGE_TOKEN=secret node bridge/claude-bridge.js
//
//   GET  /health -> {ok, version, cwd}
//   POST /run    {prompt, cwd?, permissionMode?, extraDirs?, partial?}
//                -> NDJSON stream: claude stream-json lines verbatim,
//                   then {"type":"bridge_done","exit_code":N}
'use strict';
const http = require('node:http');
const path = require('node:path');
const {spawn, execFile} = require('node:child_process');

const PORT = Number(process.env.PORT || 8412);
const TOKEN = process.env.BRIDGE_TOKEN || '';
const REPO_ROOT = path.resolve(__dirname, '..');
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan']);
if (process.env.BRIDGE_ALLOW_BYPASS === '1') PERMISSION_MODES.add('bypassPermissions');

let claudeVersion = null;
function probeClaude(cb) {
  execFile('claude', ['--version'], {timeout: 15000}, (err, stdout) => {
    claudeVersion = err ? null : String(stdout).trim();
    cb && cb(err);
  });
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8'});
  res.end(body);
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

  const mode = String(parsed.permissionMode || 'acceptEdits');
  if (!PERMISSION_MODES.has(mode)) {
    return sendJson(res, 400, {error: `permissionMode must be one of: ${[...PERMISSION_MODES].join(', ')}`});
  }
  const cwd = parsed.cwd ? path.resolve(String(parsed.cwd)) : REPO_ROOT;

  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', mode];
  if (parsed.partial) args.push('--include-partial-messages');
  for (const dir of Array.isArray(parsed.extraDirs) ? parsed.extraDirs : []) {
    args.push('--add-dir', path.resolve(String(dir)));
  }

  const child = spawn('claude', args, {cwd, stdio: ['ignore', 'pipe', 'pipe']});
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
    res.write(JSON.stringify({type: 'bridge_error', error: `spawn failed: ${e.message} (is claude on PATH?)`}) + '\n');
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
    const reply = () => sendJson(res, claudeVersion ? 200 : 503, {ok: !!claudeVersion, version: claudeVersion, cwd: REPO_ROOT});
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
  if (err) console.warn('[bridge] warning: `claude` not found on PATH — /health will report not-ok until it is');
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`claude-bridge listening on :${PORT}  (cwd for runs: ${REPO_ROOT}${TOKEN ? ', token auth ON' : ''})`);
    console.log(`claude: ${claudeVersion || 'NOT FOUND'}`);
  });
});
