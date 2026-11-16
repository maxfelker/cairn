#!/usr/bin/env node
// An epic's solution architecture: one keyed Cairn comment on the epic that
// records the shared foundation, decisions, interfaces, build order,
// trade-offs, and open questions for all of its features. This is
// provider-neutral: it reads contract results and Markdown drafts.
//
//   node architecture.js status <get-item.json>   (use - for stdin)
//     exit 0  {"ok": true, "status": "missing"|"stale"|"current", "reason",
//              "features", "uncovered", "renamed", "covers", "comment"}
//     exit 1  the get-item result itself, when it was a failure
//   node architecture.js check <draft.md>          (use - for stdin)
//     exit 0  {"ok": true}
//     exit 1  {"ok": false, "problems": ["..."]}
//   exit 2  wrong usage, or input that is not what the command reads
//
// Coverage is a hidden line in the comment, `<!-- cairn covers=<id>:<hash>,… -->`,
// listing each open feature it was written for with a short hash of that
// feature's title. The architecture is stale when an open feature is not
// listed, or a listed feature has been renamed. Body edits do not count:
// breaking a feature into tasks rewrites its body.

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const KEY = 'architecture';
const MARKER = `<!-- cairn key=${KEY} -->`;
const COVERS = /^<!--\s*cairn\s+covers=([^\s]*)\s*-->$/;

const SECTIONS = [
  { label: 'Shared foundation', names: ['shared foundation', 'shared substrate', 'foundation'] },
  { label: 'Decisions', names: ['decisions', 'design decisions', 'key decisions'] },
  { label: 'Interfaces', names: ['interfaces'] },
  { label: 'Build order', names: ['build order', 'order', 'dependencies'] },
  { label: 'Trade-offs', names: ['trade-offs', 'tradeoffs', 'trade offs'] },
  { label: 'Open questions', names: ['open questions', 'questions'] },
];

// A short, stable fingerprint of a feature title.
function titleHash(title) {
  return crypto.createHash('sha256').update(String(title).trim()).digest('hex').slice(0, 8);
}

function lines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

// The `id -> hash` pairs from a covers line, or null when there is none.
function readCovers(body) {
  for (const line of lines(body)) {
    const m = COVERS.exec(line.trim());
    if (m) {
      return new Map(m[1].split(',').filter(Boolean).map((pair) => {
        const [id, hash = ''] = pair.split(':');
        return [id, hash];
      }));
    }
  }
  return null;
}

function coversLine(features) {
  return `<!-- cairn covers=${features.map((f) => `${f.id}:${titleHash(f.title)}`).join(',')} -->`;
}

// Is the epic's architecture missing, stale, or current? `result` is a
// get-item result for the epic. Every child of an epic is one of its
// features. Closed features never make it stale: they are already built.
function status({ comments = [], children = [] }) {
  const open = children.filter((c) => c.state !== 'closed');
  const features = open.map((c) => ({ id: c.id, title: c.title }));
  const covers = coversLine(features);
  const ref = (f) => `#${f.id} "${f.title}"`;
  const found = comments.find((c) => lines(c.body).some((l) => l.trim() === MARKER));
  const base = { ok: true, features, covers };

  if (!found) {
    return { ...base, status: 'missing', reason: 'The epic has no architecture yet.', uncovered: features, renamed: [], comment: null };
  }
  const listed = readCovers(found.body) || new Map();
  const uncovered = features.filter((f) => !listed.has(f.id));
  const renamed = features.filter((f) => listed.has(f.id) && listed.get(f.id) !== titleHash(f.title));
  const comment = { body: found.body };

  if (uncovered.length || renamed.length) {
    const parts = [];
    if (uncovered.length) parts.push(`it does not cover ${uncovered.map(ref).join(', ')}`);
    if (renamed.length) parts.push(`${renamed.map(ref).join(', ')} ${renamed.length === 1 ? 'was' : 'were'} renamed since it was written`);
    return { ...base, status: 'stale', reason: `The architecture is stale: ${parts.join(', and ')}.`, uncovered, renamed, comment };
  }
  return { ...base, status: 'current', reason: `The architecture covers every open feature (${features.length}).`, uncovered: [], renamed: [], comment };
}

function normalize(heading) {
  return heading.toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();
}

// Check an architecture draft: every section present and non-empty, and one
// covers line. Lists every problem, not just the first.
function check(text) {
  const problems = [];
  const sections = [];
  let current = null;
  for (const line of lines(text)) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = { heading: h[1], name: normalize(h[1]), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  for (const want of SECTIONS) {
    const section = sections.find((s) => want.names.includes(s.name));
    if (!section) {
      problems.push(`Missing the "${want.label}" section. Add a "## ${want.label}" heading.`);
    } else if (!section.lines.some((l) => l.trim() !== '' && !COVERS.test(l.trim()))) {
      problems.push(`The "${section.heading}" section is empty. Write "None" if there is nothing to say.`);
    }
  }
  const covers = lines(text).filter((l) => COVERS.test(l.trim()));
  if (covers.length !== 1) {
    problems.push(covers.length
      ? 'The draft has more than one covers line. Keep only the one from `architecture.js status`.'
      : 'The draft has no covers line. Paste the `covers` line from `architecture.js status` at the end.');
  } else if (readCovers(covers[0]).size === 0) {
    problems.push('The covers line lists no features. Break the epic into features first.');
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

function read(file) {
  return fs.readFileSync(file === '-' ? 0 : file, 'utf8');
}

function main(argv) {
  const [command, file, ...rest] = argv;
  if (!['status', 'check'].includes(command) || !file || rest.length) {
    process.stderr.write('usage: architecture.js status <get-item.json> | check <draft.md>   (use - for stdin)\n');
    return 2;
  }
  let text;
  try {
    text = read(file);
  } catch (err) {
    process.stderr.write(`cannot read ${file}: ${err.message}\n`);
    return 2;
  }

  if (command === 'check') {
    const result = check(text);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    process.stderr.write(`cannot read a get-item result from ${file}: ${err.message}\n`);
    return 2;
  }
  if (result && result.ok === false) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 1;
  }
  if (!result || !result.item || result.item.kind !== 'epic') {
    process.stderr.write('the input is not a get-item result for an epic\n');
    return 2;
  }
  process.stdout.write(`${JSON.stringify(status(result))}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { KEY, MARKER, SECTIONS, titleHash, coversLine, readCovers, status, check };
