'use strict';

// Integration tests: the real GitHub adapter, run as a subprocess, against
// the mock gh in tests/fake-gh. They cover provider behavior end to end
// without posting to GitHub.

const test = require('node:test');
const assert = require('node:assert/strict');

const { fakeGitHub } = require('./helpers.js');

test('check: logged in with WRITE access', () => {
  const gh = fakeGitHub();
  const { status, json } = gh.run('check');
  assert.equal(status, 0);
  assert.equal(json.target.target, 'octo/repo');
  assert.equal(json.auth.login, 'octo');
  assert.equal(json.access.permission, 'WRITE');
  assert.ok(json.access.allowed.includes('push'));
});

test('check: logged out stops at auth with a login fix', () => {
  const gh = fakeGitHub({ login: null });
  const { status, json } = gh.run('check');
  assert.equal(status, 1);
  assert.equal(json.code, 'NOT_LOGGED_IN');
  assert.match(json.fix, /gh auth login/);
  assert.equal(gh.state().calls.filter((c) => c[0] === 'repo').length, 0, 'no repo lookup while logged out');
});

test('check: READ access lists what it allows', () => {
  const gh = fakeGitHub({ permission: 'READ' });
  const { json } = gh.run('check');
  assert.deepEqual(json.access.allowed, ['comment', 'create-item']);
  assert.equal(gh.run('access', '--for', 'push').json.code, 'MISSING_PERMISSION');
});

test('the mock gh rejects commands it does not model', () => {
  const gh = fakeGitHub();
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('gh', ['pr', 'merge', '1'], { env: gh.env, encoding: 'utf8' });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /unsupported command/);
});
