// Shared plumbing for provider adapters. contract.md is the human-readable
// contract; CODES and ACTIONS are the machine-readable copy, and
// tests/contract.test.js keeps the two in sync.

'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const CODES = [
  'GIT_MISSING',
  'NOT_A_REPO',
  'NO_REMOTE',
  'NOT_THIS_PROVIDER',
  'CLI_MISSING',
  'NOT_LOGGED_IN',
  'TARGET_UNAVAILABLE',
  'MISSING_PERMISSION',
  'FEATURE_DISABLED',
  'UNKNOWN_ACTION',
  'INVALID_DRAFT',
  'DIRTY_TREE',
  'NOT_ON_CHANGE',
  'NOT_PUSHED',
  'CLOSES_MISMATCH',
  'INSIDE_REPO',
  'NOT_APPROVED',
  'PROTECTED',
  'PROVIDER_ERROR',
];

const ACTIONS = ['comment', 'create-item', 'label', 'link-child', 'push', 'propose-change', 'merge'];

const COMMANDS = ['target', 'auth', 'access', 'check', 'comment', 'find-item', 'get-item', 'list-items', 'order-children', 'save-item', 'start-change', 'push-change', 'save-change', 'get-change', 'get-image', 'reply', 'merge-change', 'list-changes'];

const KINDS = ['epic', 'feature', 'task', 'bug'];

// Run a command without a shell and never throw. `missing` means the binary
// is not on PATH.
function run(cmd, args, { cwd, env, input } = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      env,
      input,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', missing: false };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || ''),
      missing: err.code === 'ENOENT',
    };
  }
}

function fail(code, message, fix) {
  if (!CODES.includes(code)) throw new Error(`Unknown contract code: ${code}`);
  return { ok: false, code, message, fix };
}

// Find the remote this clone pushes to: origin, or the first remote. The
// result is shared by every provider whose work lives in a git host.
function gitRemote({ exec = run, cwd } = {}) {
  const inside = exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
  if (inside.missing) {
    return fail('GIT_MISSING', 'git is not installed.', 'Install Git from https://git-scm.com/downloads.');
  }
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return fail('NOT_A_REPO', 'This directory is not inside a git clone.', 'cd into a clone of the repository, or clone it first.');
  }
  const remotes = exec('git', ['remote'], { cwd }).stdout.split('\n').map((r) => r.trim()).filter(Boolean);
  if (remotes.length === 0) {
    return fail('NO_REMOTE', 'This clone has no git remote.', 'git remote add origin <repository-url>');
  }
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  // Read the URL as configured. `git remote get-url` would apply the user's
  // url.<base>.insteadOf rewrites, which can hide the provider's host.
  const url = exec('git', ['config', '--get', `remote.${remote}.url`], { cwd }).stdout.trim();
  return { ok: true, remote, url };
}

// Read a draft: one Markdown file whose first line is `# <title>`. The rest
// is the body. `-` reads the draft from stdin. Adapters never write drafts.
function readDraft(file) {
  let text;
  try {
    text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (err) {
    return fail('INVALID_DRAFT', `Cannot read the draft ${file}: ${err.code || err.message}.`, 'Write the draft to a file and pass its path.');
  }
  const m = /^\s*#\s+(.+?)\s*\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n') + '\n');
  if (!m) {
    return fail('INVALID_DRAFT', 'The draft does not start with a "# <title>" line.', 'Put the title on the first line as "# <title>".');
  }
  return { ok: true, title: m[1], body: m[2].trim() + '\n' };
}

// Read a comment or other plain body from a file, or `-` for stdin.
function readBody(file) {
  let text;
  try {
    text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (err) {
    return fail('INVALID_DRAFT', `Cannot read ${file}: ${err.code || err.message}.`, 'Write the text to a file, or pass it on stdin with -.');
  }
  if (!text.trim()) return fail('INVALID_DRAFT', 'The text is empty.', 'Pass the comment text to send.');
  return { ok: true, text: text.replace(/\s+$/, '') };
}

// Words that say nothing about which item the user means, such as the
// phrasing around a reference ("pick up the next task on …").
const FILLER = new Set([
  'a', 'an', 'the', 'on', 'of', 'for', 'to', 'in', 'into', 'and', 'or', 'with', 'by', 'at', 'from',
  'can', 'is', 'it', 'this', 'that', 'my', 'our', 'me', 'please', 'next', 'pick', 'up', 'work',
  'continue', 'start', 'item', 'issue', 'ticket', 'one',
]);

// Lowercase content words, with a plain plural "s" dropped so "features"
// matches "feature".
function words(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

// Match a plain description against items ({id, title, kind, ...}) by the
// words their titles share with it, best match first. A kind word in the
// description ("the camera feature") keeps only items of that kind, when
// any match. `exact` is true when one item matches better than every other,
// and then it is the only match returned. Otherwise up to `limit`
// candidates come back, for the user to choose from.
function matchItems(query, items, limit = 5) {
  const terms = [...new Set(words(query))];
  const kinds = terms.filter((w) => KINDS.includes(w));
  const wanted = terms.filter((w) => !KINDS.includes(w));
  if (wanted.length === 0) return { matches: [], exact: false };

  let scored = items
    .map((item) => {
      const title = new Set(words(item.title));
      return { item, score: wanted.filter((w) => title.has(w)).length };
    })
    .filter((s) => s.score > 0);
  if (kinds.length && scored.some((s) => kinds.includes(s.item.kind))) {
    scored = scored.filter((s) => kinds.includes(s.item.kind));
  }
  scored.sort((a, b) => b.score - a.score || Number(a.item.id) - Number(b.item.id));

  const exact = scored.length > 0 && (scored.length === 1 || scored[0].score > scored[1].score);
  return { matches: scored.slice(0, exact ? 1 : limit).map((s) => s.item), exact };
}

// Parse `--name value` pairs. Returns null on anything unexpected, which the
// CLI reports as wrong usage.
function flags(args, names) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = /^--([a-z-]+)$/.exec(args[i]);
    if (!name || !names.includes(name[1]) || args[i + 1] === undefined || name[1] in out) return null;
    out[name[1]] = args[i + 1];
  }
  return out;
}

// The branch every change starts from and is proposed into.
const BASE = 'main';

// Run git in the clone. Shared by the change commands of every provider
// whose work lives in a git host.
function git({ exec = run, cwd }, args) {
  return exec('git', args, { cwd });
}

function currentBranch(ctx) {
  return git(ctx, ['branch', '--show-current']).stdout.trim();
}

// The line of git's output that says what went wrong.
function gitMessage(r) {
  const lines = `${r.stderr}\n${r.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(fatal|error):|\[rejected\]|\[remote rejected\]/.test(l)) || lines[0] || 'no details';
}

// Pause between reads of a value the provider computes a moment after a
// write. Synchronous, because every command is.
function sleep(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Run an adapter's command table as a CLI. Each handler takes the remaining
// argv and returns a result, or null for wrong usage.
function cli(commands, argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const [name, ...rest] = argv;
  const usage = `usage: <provider>.js <${Object.keys(commands).join('|')}> [args]\n`;
  const handler = commands[name];
  const result = handler ? handler(rest) : null;
  if (!result) {
    stderr.write(usage);
    return 2;
  }
  stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

module.exports = { CODES, ACTIONS, COMMANDS, KINDS, BASE, git, currentBranch, gitMessage, sleep, run, fail, gitRemote, readDraft, readBody, flags, cli, words, matchItems };
