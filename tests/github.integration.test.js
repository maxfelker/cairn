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

const EPIC = `# Players can trade between settlements

## Why

Settlements starve while others hoard food.
`;

test('save-item: the first save creates the label and the item', () => {
  const gh = fakeGitHub();
  const { status, json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('epic.md', EPIC));
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json, {
    ok: true,
    provider: 'github',
    kind: 'epic',
    via: 'label',
    created: true,
    item: { id: '1', url: 'https://github.com/octo/repo/issues/1', title: 'Players can trade between settlements' },
  });

  const { issues, labels } = gh.state();
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].labels, ['epic']);
  assert.equal(issues[0].title, 'Players can trade between settlements');
  assert.match(issues[0].body, /^## Why\n\nSettlements starve/);
  assert.doesNotMatch(issues[0].body, /^# Players/, 'the title line is not repeated in the body');
  assert.deepEqual(labels.map((l) => l.name), ['epic']);
});

test('save-item: saving the same title again updates instead of duplicating', () => {
  const gh = fakeGitHub();
  gh.run('save-item', '--kind', 'epic', '--file', gh.draft('v1.md', EPIC));
  const { json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('v2.md', `${EPIC}\nRevised.\n`));
  assert.equal(json.created, false);
  assert.equal(json.item.id, '1');

  const { issues } = gh.state();
  assert.equal(issues.length, 1, 'no duplicate epic');
  assert.match(issues[0].body, /Revised\./);
});

test('save-item: an existing label keeps its color and description', () => {
  const gh = fakeGitHub({ labels: [{ name: 'epic', color: 'ff0000', description: 'Ours' }] });
  assert.equal(gh.run('save-item', '--kind', 'epic', '--file', gh.draft('e.md', EPIC)).status, 0);
  assert.deepEqual(gh.state().labels, [{ name: 'epic', color: 'ff0000', description: 'Ours' }]);
  const creates = gh.state().calls.filter((c) => c[0] === 'label');
  assert.ok(creates.every((c) => !c.includes('--force')), 'never uses --force');
});

test('save-item: a similar but different title creates a new item', () => {
  const gh = fakeGitHub();
  gh.run('save-item', '--kind', 'epic', '--file', gh.draft('a.md', EPIC));
  const { json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('b.md', EPIC.replace('settlements', 'settlements and allies')));
  assert.equal(json.created, true);
  assert.equal(gh.state().issues.length, 2);
});

test('save-item: an item of another kind with the same title is not reused', () => {
  const gh = fakeGitHub({
    labels: [{ name: 'feature', color: '0E8A16', description: '' }],
    issues: [{ number: 7, title: 'Players can trade between settlements', body: '', labels: ['feature'], state: 'OPEN', url: 'https://github.com/octo/repo/issues/7' }],
  });
  const { json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('e.md', EPIC));
  assert.equal(json.created, true);
  assert.equal(json.item.id, '8');
});

test('save-item: a closed epic with the same title is not reopened or edited', () => {
  const gh = fakeGitHub({
    labels: [{ name: 'epic', color: '3E4B9E', description: '' }],
    issues: [{ number: 3, title: 'Players can trade between settlements', body: 'old', labels: ['epic'], state: 'CLOSED', url: 'https://github.com/octo/repo/issues/3' }],
  });
  const { json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('e.md', EPIC));
  assert.equal(json.created, true);
  assert.equal(gh.state().issues.find((i) => i.number === 3).body, 'old');
});

test('save-item: READ access stops before any change', () => {
  const gh = fakeGitHub({ permission: 'READ' });
  const { status, json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('e.md', EPIC));
  assert.equal(status, 1);
  assert.equal(json.code, 'MISSING_PERMISSION');
  assert.match(json.message, /labeling issues needs TRIAGE/);
  const { issues, labels, calls } = gh.state();
  assert.equal(issues.length + labels.length, 0);
  assert.ok(calls.every((c) => ['auth', 'repo'].includes(c[0])), 'only read-only calls were made');
});

test('save-item: issues turned off stops before any change', () => {
  const gh = fakeGitHub({ issuesEnabled: false });
  const { json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('e.md', EPIC));
  assert.equal(json.code, 'FEATURE_DISABLED');
  assert.equal(gh.state().labels.length, 0);
});

test('save-item: a bad draft or bad arguments change nothing', () => {
  const gh = fakeGitHub();
  assert.equal(gh.run('save-item', '--kind', 'epic', '--file', gh.draft('x.md', 'no title\n')).json.code, 'INVALID_DRAFT');
  assert.equal(gh.run('save-item', '--kind', 'epic', '--file', '/nope/missing.md').json.code, 'INVALID_DRAFT');
  for (const args of [[], ['--kind', 'saga', '--file', 'x'], ['--kind', 'epic'], ['--file', 'x', '--kind', 'epic', '--extra', 'y']]) {
    assert.equal(gh.run('save-item', ...args).status, 2, args.join(' '));
  }
  assert.equal(gh.state().calls.length, 0, 'no gh calls at all');
});

test('list-items: lists open items of one kind, oldest first', () => {
  const issue = (number, title, labels, state = 'OPEN') => ({ number, title, body: '', labels, state, url: `https://github.com/octo/repo/issues/${number}` });
  const gh = fakeGitHub({
    labels: [{ name: 'epic' }, { name: 'feature' }],
    issues: [issue(5, 'B', ['epic']), issue(2, 'A', ['epic']), issue(3, 'F', ['feature']), issue(4, 'Old', ['epic'], 'CLOSED')],
  });
  const { status, json } = gh.run('list-items', '--kind', 'epic');
  assert.equal(status, 0);
  assert.deepEqual(json.items.map((i) => [i.id, i.title]), [['2', 'A'], ['5', 'B']]);
  assert.equal(gh.run('list-items', '--kind', 'saga').status, 2);
});

test('save-item: reads the draft from stdin with --file -', () => {
  const gh = fakeGitHub();
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const script = path.join(__dirname, '..', 'skills', 'cairn', 'providers', 'github.js');
  const r = spawnSync(process.execPath, [script, 'save-item', '--kind', 'epic', '--file', '-'], { cwd: gh.cwd, env: gh.env, input: EPIC, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(gh.state().issues[0].title, 'Players can trade between settlements');
});

// Issue types: GitHub's native kinds. Labels are the fallback.

const TYPED = { issueTypes: ['Task', 'Bug', 'Feature'] };
const FEATURE = '# A player can move the camera with WASD\n\nThe camera pans when a player holds W, A, S, or D.\n';

test('types: a feature in a typed repo gets the Feature type and no label', () => {
  const gh = fakeGitHub(TYPED);
  const { json } = gh.run('save-item', '--kind', 'feature', '--file', gh.draft('f.md', FEATURE));
  assert.equal(json.via, 'type');
  const [issue] = gh.state().issues;
  assert.equal(issue.type, 'Feature');
  assert.deepEqual(issue.labels, []);
  assert.equal(gh.state().labels.length, 0, 'no label created');
});

test('types: bug and task use their types too', () => {
  const gh = fakeGitHub(TYPED);
  gh.run('save-item', '--kind', 'bug', '--file', gh.draft('b.md', '# Camera jitters at the map edge\n\nSteps…\n'));
  gh.run('save-item', '--kind', 'task', '--file', gh.draft('t.md', '# Add the camera input handler\n\nDo it.\n'));
  assert.deepEqual(gh.state().issues.map((i) => i.type), ['Bug', 'Task']);
});

test('types: an epic falls back to a label when there is no Epic type', () => {
  const gh = fakeGitHub(TYPED);
  const { json } = gh.run('save-item', '--kind', 'epic', '--file', gh.draft('e.md', EPIC));
  assert.equal(json.via, 'label');
  assert.deepEqual(gh.state().issues[0].labels, ['epic']);
  assert.equal(gh.state().issues[0].type, null);
});

test('types: an org Epic type is used when it exists', () => {
  const gh = fakeGitHub({ issueTypes: ['Epic', 'Feature'] });
  assert.equal(gh.run('save-item', '--kind', 'epic', '--file', gh.draft('e.md', EPIC)).json.via, 'type');
  assert.equal(gh.state().issues[0].type, 'Epic');
});

test('types: an untyped repo uses labels for every kind', () => {
  const gh = fakeGitHub({ issueTypes: [] });
  const { json } = gh.run('save-item', '--kind', 'feature', '--file', gh.draft('f.md', FEATURE));
  assert.equal(json.via, 'label');
  assert.deepEqual(gh.state().issues[0].labels, ['feature']);
});

test('types: a host without issue types falls back to labels', () => {
  const gh = fakeGitHub({ issueTypes: null });
  const { status, json } = gh.run('save-item', '--kind', 'feature', '--file', gh.draft('f.md', FEATURE));
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.via, 'label');
});

test('types: a legacy label-only feature is found, not duplicated', () => {
  const gh = fakeGitHub({
    ...TYPED,
    labels: [{ name: 'feature' }],
    issues: [{ number: 2, title: 'A player can move the camera with WASD', labels: ['feature'] }],
  });
  const { json } = gh.run('save-item', '--kind', 'feature', '--file', gh.draft('f.md', FEATURE));
  assert.equal(json.created, false);
  assert.equal(json.item.id, '2');
  assert.equal(gh.state().issues.length, 1);

  const listed = gh.run('list-items', '--kind', 'feature').json;
  assert.deepEqual(listed.items.map((i) => i.id), ['2']);
});

test('types: list-items merges typed and labeled items without repeats', () => {
  const gh = fakeGitHub({
    ...TYPED,
    issues: [
      { number: 1, title: 'Typed', type: 'Feature' },
      { number: 2, title: 'Labeled', labels: ['feature'] },
      { number: 3, title: 'Both', type: 'Feature', labels: ['feature'] },
      { number: 4, title: 'A task', type: 'Task' },
    ],
  });
  assert.deepEqual(gh.run('list-items', '--kind', 'feature').json.items.map((i) => i.title), ['Typed', 'Labeled', 'Both']);
});
