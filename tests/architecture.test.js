'use strict';

// Unit tests for the provider-neutral architecture status and draft check.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'skills', 'cairn', 'architecture.js');
const { MARKER, titleHash, coversLine, status, check } = require(SCRIPT);

const feature = (id, title = `Feature ${id}`, state = 'open') => ({ id, title, kind: 'feature', state });
const FEATURES = [feature('2', 'A player can move the camera'), feature('3', 'A player can zoom'), feature('4', 'A player can see the minimap', 'closed')];
const archComment = (covers) => ({ author: 'octo', body: `Architecture\n\n${covers}\n\n${MARKER}` });
const epic = (comments, children = FEATURES) => ({ ok: true, item: { id: '1', title: 'Epic', kind: 'epic', state: 'open' }, comments, children });

test('titleHash is short and stable, and ignores surrounding space', () => {
  assert.match(titleHash('A player can zoom'), /^[0-9a-f]{8}$/);
  assert.equal(titleHash('A player can zoom'), titleHash('  A player can zoom '));
  assert.notEqual(titleHash('A player can zoom'), titleHash('A player can zoom in'));
});

test('missing: no comment carries the architecture marker', () => {
  const r = status(epic([{ author: 'octo', body: 'Looks good <!-- cairn key=feature-complete-2 -->' }]));
  assert.equal(r.status, 'missing');
  assert.deepEqual(r.uncovered.map((f) => f.id), ['2', '3'], 'closed features are not expected');
  assert.equal(r.covers, coversLine([FEATURES[0], FEATURES[1]]));
  assert.equal(r.comment, null);
});

test('current: every open feature is covered as titled', () => {
  const r = status(epic([archComment(coversLine([FEATURES[0], FEATURES[1]]))]));
  assert.equal(r.status, 'current');
  assert.match(r.reason, /every open feature \(2\)/);
  assert.match(r.comment.body, /Architecture/);
});

test('current: a feature closed after the architecture was written does not make it stale', () => {
  const r = status(epic([archComment(coversLine(FEATURES))]));
  assert.equal(r.status, 'current');
});

test('stale: a new open feature is not covered', () => {
  const children = [...FEATURES, feature('9', 'A player can save the map')];
  const r = status(epic([archComment(coversLine([FEATURES[0], FEATURES[1]]))], children));
  assert.equal(r.status, 'stale');
  assert.deepEqual(r.uncovered.map((f) => f.id), ['9']);
  assert.match(r.reason, /does not cover #9 "A player can save the map"/);
  assert.match(r.covers, /9:/, 'the covers line to paste includes the new feature');
});

test('stale: a covered feature was renamed', () => {
  const children = [feature('2', 'A player can pan the camera'), FEATURES[1]];
  const r = status(epic([archComment(coversLine([FEATURES[0], FEATURES[1]]))], children));
  assert.equal(r.status, 'stale');
  assert.deepEqual(r.renamed.map((f) => f.id), ['2']);
  assert.match(r.reason, /#2 "A player can pan the camera" was renamed/);
});

test('stale: an architecture comment with no covers line covers nothing', () => {
  const r = status(epic([{ author: 'octo', body: `Old notes\n\n${MARKER}` }]));
  assert.equal(r.status, 'stale');
  assert.deepEqual(r.uncovered.map((f) => f.id), ['2', '3']);
});

const DRAFT = `One shared camera rig, built first.

## Shared foundation

The terrain scene and camera rig.

## Decisions

- One input handler for all camera moves: zoom reuses it.

## Interfaces

- \`CameraRig.pan(dx, dy)\` and \`CameraRig.zoom(dz)\`.

## Build order

1. #2, which builds the rig.
2. #3, which depends on it.

## Trade-offs

A single rig is less flexible than separate cameras, but simpler.

## Open questions

None.

${coversLine([FEATURES[0], FEATURES[1]])}
`;

test('check: a complete draft passes', () => {
  assert.deepEqual(check(DRAFT), { ok: true });
});

test('check: every missing or empty section is reported', () => {
  const r = check(DRAFT.replace('## Interfaces', '## Notes').replace('A single rig is less flexible than separate cameras, but simpler.', ''));
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join('\n'), /Missing the "Interfaces" section/);
  assert.match(r.problems.join('\n'), /"Trade-offs" section is empty/);
});

test('check: the covers line is required, once, and lists features', () => {
  const without = DRAFT.replace(/<!-- cairn covers=.* -->\n/, '');
  assert.match(check(without).problems.join('\n'), /no covers line/);
  assert.match(check(`${DRAFT}\n${coversLine([FEATURES[0]])}\n`).problems.join('\n'), /more than one covers line/);
  assert.match(check(`${without}<!-- cairn covers= -->\n`).problems.join('\n'), /lists no features/);
});

test('CLI: status and check, with exit codes 0, 1, and 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-arch-'));
  const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  const st = run('status', write('epic.json', JSON.stringify(epic([]))));
  assert.equal(st.status, 0);
  assert.equal(JSON.parse(st.stdout).status, 'missing');

  const failed = run('status', write('failed.json', JSON.stringify({ ok: false, code: 'TARGET_UNAVAILABLE' })));
  assert.equal(failed.status, 1, 'a failed get-item passes through');

  assert.equal(run('check', write('good.md', DRAFT)).status, 0);
  assert.equal(run('check', write('bad.md', 'nothing')).status, 1);

  const task = { ok: true, item: { id: '5', title: 'Task', kind: 'task', state: 'open' }, comments: [], children: [] };
  for (const args of [[], ['status'], ['plan', write('x.md', DRAFT)], ['status', write('task.json', JSON.stringify(task))], ['status', write('notjson.json', 'nope')], ['check', path.join(dir, 'missing.md')]]) {
    assert.equal(run(...args).status, 2, args.join(' '));
  }
});

test('architecture.js stays provider-neutral', () => {
  assert.doesNotMatch(fs.readFileSync(SCRIPT, 'utf8'), /github|gitlab|jira|azure|\bgh\b|pull request/i);
});
