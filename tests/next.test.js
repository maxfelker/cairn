'use strict';

// Unit tests for the provider-neutral next-step rules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'skills', 'cairn', 'next.js');
const { nextStep } = require(SCRIPT);
const { MARKER, coversLine } = require('../skills/cairn/architecture.js');

const item = (kind, extra = {}) => ({ id: '1', title: 'Item', kind, state: 'open', ...extra });
const child = (id, state = 'open', kind = 'task') => ({ id, title: `Child ${id}`, kind, state });
const step = (state) => nextStep(state).step;

test('a closed item is done, whatever its kind', () => {
  for (const kind of ['epic', 'feature', 'task', 'bug', null]) {
    assert.equal(step({ item: item(kind, { state: 'closed' }), children: [child('2')] }), 'done', String(kind));
  }
});

test('an epic or feature with no children is broken down', () => {
  assert.equal(step({ item: item('epic') }), 'break-down');
  const r = nextStep({ item: item('feature'), children: [] });
  assert.equal(r.step, 'break-down');
  assert.match(r.reason, /no tasks/);
  assert.match(nextStep({ item: item('epic') }).reason, /no features/);
});

// A current architecture for these children, as a get-item comment.
const architected = (children) => [{ author: 'octo', body: `Architecture\n\n${coversLine(children.filter((c) => c.state !== 'closed'))}\n\n${MARKER}` }];

test('an epic or feature with open children works on the first open one, in order', () => {
  const children = [child('7', 'closed'), child('4'), child('3')];
  for (const kind of ['epic', 'feature']) {
    const r = nextStep({ item: item(kind), children, comments: architected(children) });
    assert.equal(r.step, 'work-on-child', kind);
    assert.deepEqual(r.item, { id: '4', title: 'Child 4', kind: 'task' }, 'the first open child, not the lowest id');
    assert.match(r.reason, /2 of 3 open/);
  }
});

test('an epic with open features and no current architecture records one first', () => {
  const children = [child('2', 'closed', 'feature'), child('3', 'open', 'feature')];
  const missing = nextStep({ item: item('epic'), children });
  assert.equal(missing.step, 'architect');
  assert.deepEqual(missing.item, { id: '1', title: 'Item', kind: 'epic' });
  assert.match(missing.reason, /no architecture/);

  const added = [...children, child('5', 'open', 'feature')];
  const stale = nextStep({ item: item('epic'), children: added, comments: architected(children) });
  assert.equal(stale.step, 'architect');
  assert.match(stale.reason, /does not cover #5/);

  assert.equal(step({ item: item('epic'), children, comments: architected(children) }), 'work-on-child');
  assert.equal(step({ item: item('feature'), children: [child('8')] }), 'work-on-child', 'a feature never needs its own architecture');
});

test('a feature whose children are all closed is finished', () => {
  assert.equal(step({ item: item('feature'), children: [child('2', 'closed'), child('3', 'closed')] }), 'finish-feature');
});

test('an epic whose features are all closed is ready to release', () => {
  assert.equal(step({ item: item('epic'), children: [child('2', 'closed', 'feature')] }), 'release');
});

test('a task or bug with an open change continues it', () => {
  for (const kind of ['task', 'bug']) {
    const r = nextStep({ item: item(kind), changes: [{ id: '9', state: 'merged' }, { id: '10', state: 'open' }] });
    assert.equal(r.step, 'continue-change', kind);
    assert.match(r.reason, /#10/);
  }
});

test('a feature with an open change continues it, whatever its tasks say', () => {
  const tasks = [child('2', 'closed'), child('3', 'open')];
  const r = nextStep({ item: item('feature'), children: tasks, changes: [{ id: '9', state: 'merged' }, { id: '10', state: 'open' }] });
  assert.equal(r.step, 'continue-change');
  assert.match(r.reason, /#10/);
  assert.deepEqual(r.item, { id: '1', title: 'Item', kind: 'feature' }, 'the item stays the feature');

  const allDone = nextStep({ item: item('feature'), children: [child('2', 'closed')], changes: [{ id: '10', state: 'open' }] });
  assert.equal(allDone.step, 'continue-change', 'the change still has to merge');
});

test('a feature with only merged or closed changes follows its tasks', () => {
  const past = [{ id: '9', state: 'merged' }, { id: '10', state: 'closed' }];
  assert.equal(step({ item: item('feature'), children: [child('2', 'closed'), child('3', 'open')], changes: past }), 'work-on-child');
  assert.equal(step({ item: item('feature'), children: [child('2', 'closed')], changes: past }), 'finish-feature');
  assert.equal(step({ item: item('feature'), children: [], changes: [{ id: '10', state: 'open' }] }), 'break-down', 'no tasks still comes first');
  assert.equal(step({ item: { ...item('feature'), state: 'closed' }, children: [child('2', 'open')], changes: [{ id: '10', state: 'open' }] }), 'done');
});

test('an epic ignores changes', () => {
  const r = nextStep({ item: item('epic'), children: [child('2', 'closed', 'feature')], changes: [{ id: '10', state: 'open' }] });
  assert.equal(r.step, 'release');
});

test('a task or bug with no open change is implemented', () => {
  for (const kind of ['task', 'bug']) {
    assert.equal(step({ item: item(kind), changes: [] }), 'implement', kind);
    assert.equal(step({ item: item(kind), changes: [{ id: '9', state: 'closed' }] }), 'implement', kind);
  }
});

test('an item with no kind is implemented, with a reason naming the missing kind', () => {
  const r = nextStep({ item: item(null), changes: [{ id: '10', state: 'open' }] });
  assert.equal(r.step, 'implement');
  assert.match(r.reason, /no kind/);
});

test('the step names the item it applies to', () => {
  assert.deepEqual(nextStep({ item: item('task') }).item, { id: '1', title: 'Item', kind: 'task' });
});

test('CLI: reads a get-item result, passes failures through, rejects bad input', () => {
  const run = (input, ...args) => spawnSync(process.execPath, [SCRIPT, ...(args.length ? args : ['-'])], { input, encoding: 'utf8' });

  const ok = run(JSON.stringify({ ok: true, item: item('epic'), comments: [], children: [], changes: [] }));
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).step, 'break-down');

  const failure = { ok: false, code: 'TARGET_UNAVAILABLE', message: 'm', fix: 'f' };
  const passed = run(JSON.stringify(failure));
  assert.equal(passed.status, 1);
  assert.deepEqual(JSON.parse(passed.stdout), failure);

  assert.equal(run('not json').status, 2);
  assert.equal(run('{"ok": true}').status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2);
});

test('next.js stays provider-neutral', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /github|gitlab|jira|azure|\bgh\b|pull request|issue/i);
});

// address-feedback: an open change with feedback Cairn has not answered.

const T = (m) => `2026-03-01T10:${String(m).padStart(2, '0')}:00Z`;
const withChange = (kind = 'feature') => ({ item: item(kind), children: [child('2')], changes: [{ id: '30', state: 'open' }] });
const changeResult = (extra = {}) => ({ ok: true, change: { id: '30', state: 'open', opened: T(0) }, threads: [], comments: [], reviews: [], ...extra });
const c = (author, m, cairn = false) => ({ author, at: T(m), cairn, body: cairn ? 'Done.\n\n<!-- cairn -->' : 'Hm.' });

test('an open thread with a reviewer comment last gives address-feedback, for a feature and a task', () => {
  const threads = [{ id: 'T1', resolved: false, outdated: false, comments: [c('rev', 5)] }];
  for (const kind of ['feature', 'task', 'bug']) {
    const r = nextStep(withChange(kind), changeResult({ threads }));
    assert.equal(r.step, 'address-feedback', kind);
    assert.match(r.reason, /^#30, the change for .* has 1 unanswered review thread\.$/);
  }
});

test('a thread with Cairn\'s reply last, or resolved, keeps continue-change', () => {
  const answered = [{ id: 'T1', resolved: false, comments: [c('rev', 5), c('octo', 6, true)] }];
  assert.equal(nextStep(withChange(), changeResult({ threads: answered })).step, 'continue-change');
  const resolved = [{ id: 'T1', resolved: true, outdated: true, comments: [c('rev', 5)] }];
  assert.equal(nextStep(withChange(), changeResult({ threads: resolved })).step, 'continue-change');
  const outdatedOpen = [{ id: 'T1', resolved: false, outdated: true, comments: [c('rev', 5)] }];
  assert.equal(nextStep(withChange(), changeResult({ threads: outdatedOpen })).step, 'address-feedback', 'an outdated thread that is still open still counts');
});

test('a reviewer follow-up after Cairn\'s reply makes the thread unanswered again', () => {
  const threads = [{ id: 'T1', resolved: false, comments: [c('rev', 5), c('octo', 6, true), c('rev', 7)] }];
  assert.equal(nextStep(withChange(), changeResult({ threads })).step, 'address-feedback');
});

test('comments and review summaries on the change count until Cairn comments after them', () => {
  const before = changeResult({ comments: [c('pm', 3)], reviews: [{ ...c('rev', 4), state: 'changes_requested' }] });
  const r = nextStep(withChange(), before);
  assert.equal(r.step, 'address-feedback');
  assert.match(r.reason, /2 unanswered comments/);
  const after = changeResult({ comments: [c('pm', 3), c('octo', 9, true)], reviews: [{ ...c('rev', 4), state: 'changes_requested' }] });
  assert.equal(nextStep(withChange(), after).step, 'continue-change');
});

test('item comments count only after the change opened and after Cairn\'s last item comment', () => {
  const state = (comments) => ({ ...withChange(), comments });
  const opened = changeResult({ change: { id: '30', state: 'open', opened: T(10) } });
  assert.equal(nextStep(state([c('pm', 5)]), opened).step, 'continue-change', 'planning talk before the change is not feedback');
  assert.equal(nextStep(state([c('pm', 15)]), opened).step, 'address-feedback');
  assert.equal(nextStep(state([c('pm', 15), c('octo', 16, true)]), opened).step, 'continue-change');
});

test('both kinds are named in the reason', () => {
  const r = nextStep(withChange(), changeResult({ threads: [{ id: 'T1', resolved: false, comments: [c('rev', 5)] }, { id: 'T2', resolved: false, comments: [c('rev', 6)] }], comments: [c('pm', 7)] }));
  assert.match(r.reason, /2 unanswered review threads and 1 unanswered comment\.$/);
});

test('without a change result, or for another change, routing is as before', () => {
  const threads = [{ id: 'T1', resolved: false, comments: [c('rev', 5)] }];
  assert.equal(nextStep(withChange()).step, 'continue-change');
  const other = changeResult({ change: { id: '99', state: 'open', opened: T(0) }, threads });
  assert.equal(nextStep(withChange(), other).step, 'continue-change');
  assert.equal(nextStep({ item: item('feature'), children: [child('2')] }, changeResult({ threads })).step, 'work-on-child', 'no open change: the change result is not used');
});

test('CLI: --change reads a get-change result, and rejects bad input', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cairn-next-'));
  const itemFile = path.join(dir, 'item.json');
  const changeFile = path.join(dir, 'change.json');
  fs.writeFileSync(itemFile, JSON.stringify({ ok: true, ...withChange() }));
  fs.writeFileSync(changeFile, JSON.stringify(changeResult({ threads: [{ id: 'T1', resolved: false, comments: [c('rev', 5)] }] })));
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  const ok = run(itemFile, '--change', changeFile);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).step, 'address-feedback');

  fs.writeFileSync(changeFile, JSON.stringify({ ok: false, code: 'TARGET_UNAVAILABLE', message: 'm', fix: 'f' }));
  const failed = run(itemFile, '--change', changeFile);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).code, 'TARGET_UNAVAILABLE');

  fs.writeFileSync(changeFile, JSON.stringify({ ok: true }));
  assert.equal(run(itemFile, '--change', changeFile).status, 2);
  assert.equal(run(itemFile, '--change').status, 2);
  assert.equal(run(itemFile, '--other', changeFile).status, 2);
});
