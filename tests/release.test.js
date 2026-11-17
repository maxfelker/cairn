'use strict';

// Unit tests for the provider-neutral SemVer rule.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'skills', 'cairn', 'release.js');
const { nextVersion } = require(SCRIPT);

const change = (id, kind, title) => ({ id, kind, ...(title ? { title } : {}) });

test('from 1.0.0 on, breaking is major, feature is minor, and fix is patch', () => {
  assert.equal(nextVersion({ since: 'v1.2.3', changes: [change('1', 'breaking')] }).tag, 'v2.0.0');
  assert.equal(nextVersion({ since: 'v1.2.3', changes: [change('1', 'feature')] }).tag, 'v1.3.0');
  assert.equal(nextVersion({ since: 'v1.2.3', changes: [change('1', 'fix')] }).tag, 'v1.2.4');
});

test('before 1.0.0, breaking and feature are minor and fix is patch', () => {
  const breaking = nextVersion({ since: 'v0.3.1', changes: [change('7', 'breaking', 'Rename the command')] });
  assert.equal(breaking.tag, 'v0.4.0');
  assert.equal(breaking.bump, 'minor');
  assert.match(breaking.reason, /before 1\.0\.0/);
  assert.equal(nextVersion({ since: 'v0.3.1', changes: [change('1', 'feature')] }).tag, 'v0.4.0');
  assert.equal(nextVersion({ since: 'v0.3.1', changes: [change('1', 'fix')] }).tag, 'v0.3.2');
});

test('with no earlier tag, the first version is 0.1.0', () => {
  const r = nextVersion({ since: null, changes: [change('1', 'breaking')] });
  assert.deepEqual([r.version, r.tag, r.bump], ['0.1.0', 'v0.1.0', 'initial']);
  assert.match(r.reason, /no earlier release/);
});

test('the tag keeps the last tag\'s prefix', () => {
  const r = nextVersion({ since: '1.2.3', changes: [change('1', 'feature')] });
  assert.deepEqual([r.version, r.tag], ['1.3.0', '1.3.0']);
});

test('the highest kind wins when changes mix, and the reason names it', () => {
  const r = nextVersion({
    since: 'v1.0.0',
    changes: [change('81', 'fix'), change('82', 'feature', 'Prepare a release'), change('83', 'fix')],
  });
  assert.equal(r.tag, 'v1.1.0');
  assert.equal(r.bump, 'minor');
  assert.match(r.reason, /82 "Prepare a release" is a feature/);
});

test('a last tag that is not SemVer fails with a clear message', () => {
  const r = nextVersion({ since: 'release-2024', changes: [change('1', 'fix')] });
  assert.equal(r.ok, false);
  assert.match(r.problem, /"release-2024" is not a SemVer version/);
});

test('no changes since the last tag is nothing to release', () => {
  const r = nextVersion({ since: 'v1.0.0', changes: [] });
  assert.equal(r.ok, false);
  assert.match(r.problem, /Nothing to release/);
});

test('an unknown kind fails', () => {
  const r = nextVersion({ since: 'v1.0.0', changes: [change('5', 'chore')] });
  assert.equal(r.ok, false);
  assert.match(r.problem, /Change 5 has kind "chore"/);
});

test('the command reads stdin and exits by result', () => {
  const ok = spawnSync(process.execPath, [SCRIPT, 'next-version', '-'], {
    input: JSON.stringify({ since: 'v0.1.0', changes: [change('1', 'fix')] }),
  });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).tag, 'v0.1.1');

  const none = spawnSync(process.execPath, [SCRIPT, 'next-version', '-'], { input: '{"since":"v0.1.0","changes":[]}' });
  assert.equal(none.status, 1);

  const usage = spawnSync(process.execPath, [SCRIPT, 'bump']);
  assert.equal(usage.status, 2);
});
