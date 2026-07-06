// Naive-pull worker: keyword-grep the corpus, rank files, pull WHOLE files as context.
// This is the baseline a RAG replaces — the token cost of each answer is the full file.
'use strict';
const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');

const {q, k, root} = workerData;

const SPECS = [
  ['world', 'world', ['.md']],
  ['book-1', 'chapters', ['.txt']],
  ['book-2', path.join('book-2', 'chapters'), ['.txt']],
  ['prequel', path.join('prequel-novella', 'chapters'), ['.txt']],
];

const STOP = new Set(('the and was were with that this from have had his her she him they them what who where when ' +
  'how why does did not for are you its one all their there into out about which been being over under after ' +
  'before while then than but also can could would should will shall may might must a an of in on at to is it as ' +
  'by or be we i do no so up if').split(' '));

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const t0 = Date.now();
const terms = [...new Set((q.toLowerCase().match(/[a-z0-9']+/g) || []).filter((t) => t.length >= 3 && !STOP.has(t)))];
const phrase = q.trim().toLowerCase();

const hits = [];
for (const [book, rel, exts] of SPECS) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) continue;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!exts.includes(path.extname(e.name).toLowerCase())) continue;
      const content = fs.readFileSync(p, 'utf8');
      const lower = content.toLowerCase();
      let occurrences = 0;
      let matched = 0;
      let firstIdx = Infinity;
      for (const t of terms) {
        const re = new RegExp('\\b' + escapeRe(t) + '\\b', 'g');
        const m = lower.match(re);
        if (m && m.length) {
          matched += 1;
          occurrences += m.length;
          const i = lower.search(re);
          if (i >= 0 && i < firstIdx) firstIdx = i;
        }
      }
      let score = occurrences;
      if (phrase.length > 4 && lower.includes(phrase)) {
        score += 25;
        const i = lower.indexOf(phrase);
        if (i < firstIdx) firstIdx = i;
      }
      if (terms.length) score *= matched / terms.length; // reward covering more distinct terms
      if (score > 0) {
        hits.push({book, source: path.relative(root, p).split(path.sep).join('/'), title: path.basename(e.name, path.extname(e.name)), score, matched, occurrences, firstIdx, content});
      }
    }
  }
}

hits.sort((a, b) => b.score - a.score);
const top = hits.slice(0, k).map((h) => {
  const at = h.firstIdx === Infinity ? 0 : h.firstIdx;
  const start = Math.max(0, at - 160);
  const snippet = (start > 0 ? '…' : '') + h.content.slice(start, at + 240).replace(/\s+/g, ' ').trim() + '…';
  return {
    source: h.source,
    book: h.book,
    title: h.title,
    score: Math.round(h.score * 100) / 100,
    matchedTerms: h.matched,
    termCount: terms.length,
    occurrences: h.occurrences,
    snippet,
    content: h.content, // whole file = the context a naive pull feeds the model
  };
});

parentPort.postMessage({latency_ms: Date.now() - t0, scanned: hits.length, terms, results: top});
