'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const github = require('../skills/cairn/providers/github.js');

const SCRIPT = path.join(__dirname, '..', 'skills', 'cairn', 'providers', 'github.js');

function tempRepo(remotes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [name, url] of Object.entries(remotes)) {
    execFileSync('git', ['remote', 'add', name, url], { cwd: dir });
  }
  return dir;
}

test('parseRemote handles every GitHub URL form', () => {
  const want = { host: 'github.com', owner: 'octo', name: 'repo' };
  for (const url of [
    'git@github.com:octo/repo.git',
    'git@github.com:octo/repo',
    'https://github.com/octo/repo.git',
    'https://github.com/octo/repo',
    'https://github.com/octo/repo/',
    'https://user@github.com/octo/repo.git',
    'ssh://git@github.com/octo/repo.git',
    'git://github.com/octo/repo.git',
    '  git@github.com:octo/repo.git\n',
  ]) {
    assert.deepEqual(github.parseRemote(url), want, url);
  }
});

test('parseRemote keeps other hosts and rejects non owner/name paths', () => {
  assert.equal(github.parseRemote('git@gitlab.com:octo/repo.git').host, 'gitlab.com');
  assert.equal(github.parseRemote('https://dev.azure.com/org/project/_git/repo'), null);
  assert.equal(github.parseRemote('/local/path/repo.git'), null);
  assert.equal(github.parseRemote('file:///tmp/repo'), null);
  assert.equal(github.parseRemote(''), null);
  assert.equal(github.parseRemote(undefined), null);
});

test('target reads the origin remote', () => {
  const cwd = tempRepo({ upstream: 'git@github.com:other/fork.git', origin: 'https://github.com/octo/repo.git' });
  assert.deepEqual(github.target({ cwd }), {
    ok: true, provider: 'github', target: 'octo/repo', owner: 'octo', name: 'repo', remote: 'origin',
  });
});

test('target falls back to the first remote when there is no origin', () => {
  const result = github.target({ cwd: tempRepo({ upstream: 'git@github.com:octo/repo.git' }) });
  assert.equal(result.target, 'octo/repo');
  assert.equal(result.remote, 'upstream');
});

test('target reports each gap with a fix', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
  const cases = [
    [github.target({ cwd: outside }), 'NOT_A_REPO'],
    [github.target({ cwd: tempRepo() }), 'NO_REMOTE'],
    [github.target({ cwd: tempRepo({ origin: 'git@gitlab.com:octo/repo.git' }) }), 'NOT_THIS_PROVIDER'],
    [github.target({ exec: () => ({ ok: false, stdout: '', missing: true }) }), 'GIT_MISSING'],
  ];
  for (const [result, code] of cases) {
    assert.equal(result.code, code);
    assert.ok(result.message && result.fix, `${code} has a message and a fix`);
  }
});

test('CLI target prints the repository from this clone', () => {
  const out = execFileSync(process.execPath, [SCRIPT, 'target'], {
    cwd: tempRepo({ origin: 'git@github.com:octo/repo.git' }),
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(out).target, 'octo/repo');

  const failed = spawnSync(process.execPath, [SCRIPT, 'target'], { cwd: tempRepo(), encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).code, 'NO_REMOTE');
});

// A fake runner: replies to `gh <args...>` with a canned result.
function fakeGh(replies) {
  return (cmd, args) => {
    assert.equal(cmd, 'gh');
    const key = args.slice(0, 2).join(' ');
    const reply = replies[key];
    assert.ok(reply, `unexpected gh call: ${args.join(' ')}`);
    return { ok: true, stderr: '', missing: false, ...reply };
  };
}

const ACCOUNT = {
  state: 'success',
  active: true,
  host: 'github.com',
  login: 'octo',
  tokenSource: '/home/octo/.config/gh/hosts.yml',
  scopes: 'repo, read:org',
  token: 'gho_should_never_appear',
  gitProtocol: 'ssh',
};

test('auth reports the active login and nothing secret', () => {
  const hosts = { 'github.com': [{ ...ACCOUNT, active: false, login: 'old' }, ACCOUNT] };
  const result = github.auth({ exec: fakeGh({ 'auth status': { stdout: JSON.stringify({ hosts }) } }) });
  assert.deepEqual(result, { ok: true, provider: 'github', login: 'octo' });
  assert.doesNotMatch(JSON.stringify(result), /gho_|hosts\.yml|scopes|token/i);
});

test('auth never asks gh to show a token', () => {
  let seen;
  github.auth({ exec: (cmd, args) => { seen = args; return { ok: true, stdout: '{"hosts":{}}' }; } });
  assert.ok(!seen.includes('--show-token') && !seen.includes('-t'));
});

test('auth reports a missing login with a gh auth login fix', () => {
  for (const hosts of [{}, { 'github.com': [] }, { 'github.com': [{ ...ACCOUNT, active: false }] }]) {
    const result = github.auth({ exec: fakeGh({ 'auth status': { stdout: JSON.stringify({ hosts }) } }) });
    assert.equal(result.code, 'NOT_LOGGED_IN');
    assert.match(result.fix, /gh auth login/);
  }
});

test('auth reports a broken login on the active account', () => {
  const hosts = { 'github.com': [{ ...ACCOUNT, state: 'error' }] };
  const result = github.auth({ exec: fakeGh({ 'auth status': { stdout: JSON.stringify({ hosts }) } }) });
  assert.equal(result.code, 'NOT_LOGGED_IN');
  assert.match(result.message, /octo/);
});

test('auth reports a missing or outdated gh', () => {
  assert.equal(github.auth({ exec: () => ({ ok: false, stdout: '', missing: true }) }).code, 'CLI_MISSING');
  const old = github.auth({ exec: () => ({ ok: false, stdout: '', stderr: 'unknown flag: --json', missing: false }) });
  assert.equal(old.code, 'CLI_MISSING');
  assert.match(old.fix, /Update gh/);
});
