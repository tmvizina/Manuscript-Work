#!/usr/bin/env node
// Canon-query server: POST /api/query fans a question out to two parallel workers —
// a persistent ChromaDB RAG worker (python child) and a naive keyword worker
// (worker thread that pulls whole files) — and reports token cost for each answer.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {Worker} = require('node:worker_threads');

const RAG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(RAG_DIR, '..');
const PY = path.join(RAG_DIR, '.venv', 'bin', 'python');
const PORT = Number(process.env.PORT || 3123);

let countTokens;
let TOKENIZER;
try {
  ({countTokens} = require('gpt-tokenizer'));
  TOKENIZER = 'cl100k_base via gpt-tokenizer';
} catch {
  countTokens = (s) => Math.max(1, Math.ceil(s.length / 4));
  TOKENIZER = 'chars/4 estimate (gpt-tokenizer not installed)';
}

// ---------- persistent RAG worker (python child, model stays warm) ----------
let ragProc = null;
let ragStatus = null;
let nextId = 1;
const pending = new Map();

function startRagWorker() {
  ragProc = spawn(PY, [path.join(RAG_DIR, 'rag_worker.py')], {cwd: RAG_DIR, stdio: ['pipe', 'pipe', 'inherit']});
  let buf = '';
  ragProc.stdout.setEncoding('utf8');
  ragProc.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.id != null && pending.has(obj.id)) {
        const p = pending.get(obj.id);
        pending.delete(obj.id);
        clearTimeout(p.timer);
        p.resolve(obj);
      } else {
        ragStatus = obj;
        console.log('[rag worker]', line);
      }
    }
  });
  ragProc.on('exit', (code) => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`rag worker exited (${code})`));
    }
    pending.clear();
    ragProc = null;
  });
}

function ragQuery(q, k) {
  if (!ragProc) startRagWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('rag worker timeout (120s)'));
    }, 120000);
    pending.set(id, {resolve, reject, timer});
    ragProc.stdin.write(JSON.stringify({id, q, k}) + '\n');
  });
}

// ---------- naive worker (fresh worker thread per query) ----------
function naiveQuery(q, k) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'naive-worker.js'), {workerData: {q, k, root: REPO_ROOT}});
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error('naive worker timeout (60s)'));
    }, 60000);
    w.once('message', (m) => {
      clearTimeout(timer);
      resolve(m);
      w.terminate();
    });
    w.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function timed(fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    return {ok: true, latency_ms: Date.now() - t0, value};
  } catch (e) {
    return {ok: false, latency_ms: Date.now() - t0, error: String((e && e.message) || e)};
  }
}

function shapeRag(r) {
  if (!r.ok) return {ok: false, error: r.error, latency_ms: r.latency_ms, total_tokens: 0, results: []};
  const v = r.value;
  if (v.ok === false) return {ok: false, error: v.error, latency_ms: r.latency_ms, total_tokens: 0, results: []};
  const results = (v.results || []).map((x) => ({
    source: x.source,
    book: x.book,
    title: x.title,
    heading: x.heading,
    chunk: x.chunk,
    score: x.score,
    distance: x.distance,
    text: x.text,
    tokens: countTokens(x.text),
  }));
  return {
    ok: true,
    latency_ms: r.latency_ms,
    results,
    total_tokens: results.reduce((a, b) => a + b.tokens, 0),
  };
}

function shapeNaive(r) {
  if (!r.ok) return {ok: false, error: r.error, latency_ms: r.latency_ms, total_tokens: 0, results: []};
  const results = (r.value.results || []).map((x) => ({
    source: x.source,
    book: x.book,
    title: x.title,
    score: x.score,
    matched_terms: x.matchedTerms,
    term_count: x.termCount,
    occurrences: x.occurrences,
    snippet: x.snippet,
    tokens: countTokens(x.content), // cost of the whole pulled file
  }));
  return {
    ok: true,
    latency_ms: r.latency_ms,
    terms: r.value.terms,
    results,
    total_tokens: results.reduce((a, b) => a + b.tokens, 0),
  };
}

// ---------- http ----------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/stats') {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({rag: ragStatus, tokenizer: TOKENIZER}));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/query') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const q = String(parsed.q || '').trim();
        if (!q) throw new Error('empty query');
        const k = Math.min(Math.max(parseInt(parsed.k, 10) || 5, 1), 20);
        const [ragRaw, naiveRaw] = await Promise.all([
          timed(() => ragQuery(q, k)),
          timed(() => naiveQuery(q, k)),
        ]);
        const rag = shapeRag(ragRaw);
        const naive = shapeNaive(naiveRaw);
        const savings = rag.ok && naive.ok && naive.total_tokens > 0 ? 1 - rag.total_tokens / naive.total_tokens : null;
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({q, k, tokenizer: TOKENIZER, rag, naive, savings}));
      } catch (e) {
        res.writeHead(400, {'content-type': 'application/json'});
        res.end(JSON.stringify({error: String((e && e.message) || e)}));
      }
    });
    return;
  }
  res.writeHead(404, {'content-type': 'text/plain'});
  res.end('not found');
});

startRagWorker();
server.listen(PORT, () => {
  console.log(`Canon query server -> http://localhost:${PORT}  (tokenizer: ${TOKENIZER})`);
});
