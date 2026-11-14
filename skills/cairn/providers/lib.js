// Shared plumbing for provider adapters. contract.md is the human-readable
// contract; CODES and ACTIONS are the machine-readable copy, and
// tests/contract.test.js keeps the two in sync.

'use strict';

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
];

const ACTIONS = ['comment', 'create-item', 'label', 'link-child', 'push', 'propose-change'];

const COMMANDS = ['target', 'auth', 'access', 'check'];

// Run a command without a shell and never throw. `missing` means the binary
// is not on PATH.
function run(cmd, args, { cwd, env } = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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
  const url = exec('git', ['remote', 'get-url', remote], { cwd }).stdout.trim();
  return { ok: true, remote, url };
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

module.exports = { CODES, ACTIONS, COMMANDS, run, fail, gitRemote, cli };
