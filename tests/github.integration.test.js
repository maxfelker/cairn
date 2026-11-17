'use strict';

// Integration tests: the real GitHub adapter, run as a subprocess, against
// the mock gh in tests/fake-gh. They cover provider behavior end to end
// without posting to GitHub.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('types: a feature in a typed repo gets the Feature type and the feature label as backup', () => {
  const gh = fakeGitHub(TYPED);
  const { json } = gh.run('save-item', '--kind', 'feature', '--file', gh.draft('f.md', FEATURE));
  assert.equal(json.via, 'type');
  const [issue] = gh.state().issues;
  assert.equal(issue.type, 'Feature');
  assert.deepEqual(issue.labels, ['feature']);
  assert.deepEqual(gh.state().labels.map((l) => l.name), ['feature']);
});

test('backup label: an update adds a missing kind label and keeps the others', () => {
  const gh = fakeGitHub({
    ...TYPED,
    labels: [{ name: 'priority', color: 'ffffff', description: '' }],
    issues: [{ number: 1, title: 'A player can move the camera with WASD', type: 'Feature', labels: ['priority'] }],
  });
  const { json } = gh.run('save-item', '--kind', 'feature', '--file', gh.draft('f.md', FEATURE));
  assert.equal(json.created, false);
  assert.deepEqual(gh.state().issues[0].labels, ['priority', 'feature']);
});

test('backup label: an item that already has it makes no label call', () => {
  const gh = fakeGitHub({
    ...TYPED,
    labels: [{ name: 'feature', color: '123456', description: 'Ours' }],
    issues: [{ number: 1, title: 'A player can move the camera with WASD', type: 'Feature', labels: ['feature'] }],
  });
  gh.run('save-item', '--kind', 'feature', '--file', gh.draft('f.md', FEATURE));
  assert.equal(gh.state().calls.filter((c) => c.some((a) => a.endsWith('/labels'))).length, 0);
  assert.deepEqual(gh.state().labels, [{ name: 'feature', color: '123456', description: 'Ours' }], 'existing label not recolored');
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

// Parents: features as native sub-issues of their epic.

const WITH_EPIC = {
  ...TYPED,
  labels: [{ name: 'epic' }],
  issues: [{ number: 1, title: 'Trading between settlements', labels: ['epic'] }],
};

test('parent: a new feature is created and linked under its epic by database id', () => {
  const gh = fakeGitHub(WITH_EPIC);
  const { status, json } = gh.run('save-item', '--kind', 'feature', '--parent', '1', '--file', gh.draft('f.md', FEATURE));
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.created, true);
  assert.equal(json.linked, true);
  assert.equal(json.parent, '1');

  const feature = gh.state().issues.find((i) => i.number === 2);
  assert.equal(feature.parent, 1);
  assert.equal(feature.type, 'Feature');
  assert.deepEqual(feature.labels, ['feature']);
  const link = gh.state().calls.find((c) => c.includes('repos/octo/repo/issues/1/sub_issues') && c.includes('POST'));
  assert.ok(link.includes(`sub_issue_id=${feature.id}`), `links by database id ${feature.id}, not number 2: ${link.join(' ')}`);
});

test('parent: saving again updates the child with no duplicate and no second link', () => {
  const gh = fakeGitHub(WITH_EPIC);
  gh.run('save-item', '--kind', 'feature', '--parent', '1', '--file', gh.draft('a.md', FEATURE));
  const { json } = gh.run('save-item', '--kind', 'feature', '--parent', '1', '--file', gh.draft('b.md', `${FEATURE}\nMore.\n`));
  assert.equal(json.created, false);
  assert.equal(json.linked, false);
  assert.equal(gh.state().issues.length, 2);
  assert.match(gh.state().issues[1].body, /More\./);
  const links = gh.state().calls.filter((c) => c.includes('POST') && c.some((a) => a.endsWith('/sub_issues')));
  assert.equal(links.length, 1);
});

test('parent: the same title under a different parent is a separate feature', () => {
  const gh = fakeGitHub({ ...WITH_EPIC, issues: [...WITH_EPIC.issues, { number: 2, title: 'Another epic', labels: ['epic'] }] });
  gh.run('save-item', '--kind', 'feature', '--parent', '1', '--file', gh.draft('a.md', FEATURE));
  const { json } = gh.run('save-item', '--kind', 'feature', '--parent', '2', '--file', gh.draft('b.md', FEATURE));
  assert.equal(json.created, true);
  assert.deepEqual(gh.state().issues.filter((i) => i.type === 'Feature').map((i) => i.parent), [1, 2]);
});

test('parent: an unlinked item left by an interrupted run is linked, not duplicated', () => {
  const gh = fakeGitHub({ ...WITH_EPIC, issues: [...WITH_EPIC.issues, { number: 2, title: 'A player can move the camera with WASD', type: 'Feature' }] });
  const { json } = gh.run('save-item', '--kind', 'feature', '--parent', '1', '--file', gh.draft('f.md', FEATURE));
  assert.equal(json.created, false);
  assert.equal(json.linked, true);
  assert.equal(gh.state().issues.find((i) => i.number === 2).parent, 1);
  assert.equal(gh.state().issues.length, 2);
});

test('parent: a same-title item under another parent is not stolen', () => {
  const gh = fakeGitHub({
    ...WITH_EPIC,
    issues: [...WITH_EPIC.issues, { number: 2, title: 'Other', labels: ['epic'] }, { number: 3, title: 'A player can move the camera with WASD', type: 'Feature', parent: 2 }],
  });
  const { json } = gh.run('save-item', '--kind', 'feature', '--parent', '1', '--file', gh.draft('f.md', FEATURE));
  assert.equal(json.created, true);
  assert.equal(gh.state().issues.find((i) => i.number === 3).parent, 2, 'left where it was');
});

test('parent: TRIAGE is needed to link, and a missing parent changes nothing', () => {
  const gh = fakeGitHub({ ...WITH_EPIC, permission: 'READ' });
  assert.equal(gh.run('save-item', '--kind', 'feature', '--parent', '1', '--file', gh.draft('f.md', FEATURE)).json.code, 'MISSING_PERMISSION');

  const missing = fakeGitHub(WITH_EPIC);
  const { json } = missing.run('save-item', '--kind', 'feature', '--parent', '99', '--file', missing.draft('f.md', FEATURE));
  assert.equal(json.code, 'TARGET_UNAVAILABLE');
  assert.equal(missing.state().issues.length, 1);
  assert.equal(missing.run('save-item', '--kind', 'feature', '--parent', 'abc', '--file', 'x').status, 2);
});

// get-item: read before planning.

test('get-item: returns the body, comments, and children with their kinds', () => {
  const gh = fakeGitHub({
    ...TYPED,
    issues: [
      { number: 1, title: 'Trading', body: 'Why…', labels: ['epic'], comments: [{ author: 'pm', body: 'Include allies?' }, { author: 'octo', body: 'Later.' }] },
      { number: 2, title: 'A player can trade food', type: 'Feature', parent: 1 },
      { number: 3, title: 'A player can see caravans', labels: ['feature'], parent: 1, state: 'CLOSED' },
    ],
  });
  const { status, json } = gh.run('get-item', '--id', '1');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json.item, { id: '1', url: 'https://github.com/octo/repo/issues/1', title: 'Trading', kind: 'epic', state: 'open', body: 'Why…', images: [], parent: null });
  assert.equal(gh.run('get-item', '--id', '2').json.item.parent, '1');
  assert.deepEqual(json.comments.map((c) => [c.author, c.body, c.cairn, c.images]), [['pm', 'Include allies?', false, []], ['octo', 'Later.', false, []]]);
  assert.match(json.comments[0].url, /\/issues\/1#issuecomment-\d+$/);
  assert.deepEqual(json.changes, []);
  assert.deepEqual(json.children, [
    { id: '2', title: 'A player can trade food', kind: 'feature', state: 'open' },
    { id: '3', title: 'A player can see caravans', kind: 'feature', state: 'closed' },
  ]);
});

test('get-item: an item with no children, and a missing item', () => {
  const gh = fakeGitHub({ issues: [{ number: 1, title: 'Loose', type: null }] });
  const { json } = gh.run('get-item', '--id', '1');
  assert.deepEqual(json.children, []);
  assert.equal(json.item.kind, null);
  assert.equal(gh.run('get-item', '--id', '42').json.code, 'TARGET_UNAVAILABLE');
  assert.equal(gh.run('get-item', '--id', 'x').status, 2);
});

// order-children: the children's order is the task order.

function withChildren(numbers) {
  return {
    ...TYPED,
    issues: [{ number: 1, title: 'A player can move the camera', type: 'Feature' }, ...numbers.map((n) => ({ number: n, title: `Task ${n}`, type: 'Task', parent: 1 }))],
  };
}
const childOrder = (gh) => gh.run('get-item', '--id', '1').json.children.map((c) => c.id);
const priorityCalls = (gh) => gh.state().calls.filter((c) => c.some((a) => a.endsWith('/sub_issues/priority')));

test('order-children: moves a prerequisite ahead of the tasks that depend on it', () => {
  const gh = fakeGitHub(withChildren([2, 3, 4]));
  const { status, json } = gh.run('order-children', '--parent', '1', '--ids', '4,2,3');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json.order, ['4', '2', '3']);
  assert.equal(json.moved, 1);
  assert.deepEqual(childOrder(gh), ['4', '2', '3']);
});

test('order-children: unlisted children keep their order after the listed ones', () => {
  const gh = fakeGitHub(withChildren([2, 3, 4, 5]));
  gh.run('order-children', '--parent', '1', '--ids', '5,3');
  assert.deepEqual(childOrder(gh), ['5', '3', '2', '4']);
});

test('order-children: an order that is already right makes no calls', () => {
  const gh = fakeGitHub(withChildren([2, 3, 4]));
  const { json } = gh.run('order-children', '--parent', '1', '--ids', '2,3,4');
  assert.equal(json.moved, 0);
  assert.equal(priorityCalls(gh).length, 0);
});

test('order-children: uses database ids, not issue numbers', () => {
  const gh = fakeGitHub(withChildren([2, 3]));
  gh.run('order-children', '--parent', '1', '--ids', '3,2');
  const [call] = priorityCalls(gh);
  assert.ok(call, 'a reprioritize call was made');
  assert.deepEqual(childOrder(gh), ['3', '2'], 'the mock only accepts database ids, so this order proves they were used');
});

test('order-children: a non-child changes nothing, and bad arguments are usage errors', () => {
  const gh = fakeGitHub(withChildren([2, 3]));
  const { json } = gh.run('order-children', '--parent', '1', '--ids', '3,9');
  assert.equal(json.code, 'TARGET_UNAVAILABLE');
  assert.match(json.message, /#9/);
  assert.equal(priorityCalls(gh).length, 0);
  for (const args of [['--parent', '1'], ['--parent', '1', '--ids', '2,,3'], ['--parent', '1', '--ids', '2,2'], ['--parent', 'x', '--ids', '2']]) {
    assert.equal(gh.run('order-children', ...args).status, 2, args.join(' '));
  }
});

test('order-children: needs TRIAGE', () => {
  const gh = fakeGitHub({ ...withChildren([2, 3]), permission: 'READ' });
  assert.equal(gh.run('order-children', '--parent', '1', '--ids', '3,2').json.code, 'MISSING_PERMISSION');
});

// comment: Cairn's comments carry a hidden marker; keyed ones update in place.

test('comment: a new comment ends with the Cairn marker', () => {
  const gh = fakeGitHub({ issues: [{ number: 1, title: 'Epic', labels: ['epic'] }] });
  const { status, json } = gh.run('comment', '--on', '1', '--file', gh.draft('c.md', 'Hello.\n\n'));
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.created, true);
  assert.match(json.comment.url, /issues\/1#issuecomment-\d+$/);
  assert.equal(gh.state().issues[0].comments[0].body, 'Hello.\n\n<!-- cairn -->');
});

test('comment: the same key updates instead of duplicating, and a new key adds', () => {
  const gh = fakeGitHub({ issues: [{ number: 1, title: 'Epic', labels: ['epic'] }] });
  gh.run('comment', '--on', '1', '--key', 'feature-complete-2', '--file', gh.draft('a.md', 'v1'));
  const again = gh.run('comment', '--on', '1', '--key', 'feature-complete-2', '--file', gh.draft('b.md', 'v2')).json;
  assert.equal(again.created, false);
  assert.equal(again.changed, true);
  const same = gh.run('comment', '--on', '1', '--key', 'feature-complete-2', '--file', gh.draft('c.md', 'v2')).json;
  assert.equal(same.changed, false, 'identical text makes no change');
  gh.run('comment', '--on', '1', '--key', 'feature-complete-3', '--file', gh.draft('d.md', 'other'));
  assert.deepEqual(gh.state().issues[0].comments.map((c) => c.body), [
    'v2\n\n<!-- cairn key=feature-complete-2 -->',
    'other\n\n<!-- cairn key=feature-complete-3 -->',
  ]);
});

test('comment: a human comment that quotes the marker inline is never edited', () => {
  const gh = fakeGitHub({
    issues: [{ number: 1, title: 'Epic', comments: [{ author: 'pm', body: 'Why does Cairn add `<!-- cairn key=k -->` here?' }] }],
  });
  const { json } = gh.run('comment', '--on', '1', '--key', 'k', '--file', gh.draft('a.md', 'Cairn summary'));
  assert.equal(json.created, true);
  assert.equal(gh.state().issues[0].comments[0].body, 'Why does Cairn add `<!-- cairn key=k -->` here?');
});

test('comment: READ access can comment; a missing item and bad input change nothing', () => {
  const gh = fakeGitHub({ permission: 'READ', issues: [{ number: 1, title: 'Epic' }] });
  assert.equal(gh.run('comment', '--on', '1', '--file', gh.draft('a.md', 'hi')).status, 0);
  assert.equal(gh.run('comment', '--on', '9', '--file', gh.draft('b.md', 'hi')).json.code, 'TARGET_UNAVAILABLE');
  assert.equal(gh.run('comment', '--on', '1', '--file', gh.draft('c.md', '  \n')).json.code, 'INVALID_DRAFT');
  for (const args of [['--on', '1'], ['--on', 'x', '--file', 'f'], ['--on', '1', '--file', 'f', '--key', 'bad key']]) {
    assert.equal(gh.run('comment', ...args).status, 2, args.join(' '));
  }
  assert.equal(gh.state().issues[0].comments.length, 1);
});

test('get-item: reports the changes that close an item, merged or not', () => {
  const gh = fakeGitHub({
    issues: [{ number: 1, title: 'Feature' }, { number: 2, title: 'Task' }],
    pulls: [
      { number: 10, state: 'MERGED', closes: [1, 2] },
      { number: 11, state: 'OPEN', closes: [1] },
      { number: 12, state: 'CLOSED', closes: [3] },
    ],
  });
  assert.deepEqual(gh.run('get-item', '--id', '1').json.changes, [
    { id: '10', url: 'https://github.com/octo/repo/pull/10', state: 'merged' },
    { id: '11', url: 'https://github.com/octo/repo/pull/11', state: 'open' },
  ]);
  assert.deepEqual(gh.run('get-item', '--id', '2').json.changes.map((c) => c.id), ['10']);
});

// find-item: what the user said, resolved to an item.

const FIND = {
  ...TYPED,
  issues: [
    { number: 1, title: 'Players can explore the map', labels: ['epic'] },
    { number: 2, title: 'A player can move the camera with WASD', type: 'Feature', parent: 1 },
    { number: 3, title: 'A player can zoom the camera', type: 'Feature', parent: 1 },
    { number: 4, title: 'Add the camera input handler', type: 'Task', parent: 2 },
    { number: 5, title: 'A player can see the minimap', type: 'Feature', parent: 1, state: 'CLOSED' },
    { number: 6, title: 'Move the camera with WASD', pull: true },
  ],
};
const found = (json) => json.matches.map((m) => m.id);

test('find-item: a number, #number, or same-repo link is one exact match', () => {
  const gh = fakeGitHub(FIND);
  for (const query of ['2', '#2', 'https://github.com/octo/repo/issues/2', 'https://github.com/Octo/Repo/issues/2/']) {
    const { status, json } = gh.run('find-item', '--query', query);
    assert.equal(status, 0, `${query}: ${JSON.stringify(json)}`);
    assert.equal(json.exact, true, query);
    assert.deepEqual(json.matches, [
      { id: '2', title: 'A player can move the camera with WASD', kind: 'feature', state: 'open', url: 'https://github.com/octo/repo/issues/2' },
    ], query);
  }
});

test('find-item: a closed item referenced by number is still found', () => {
  const { json } = fakeGitHub(FIND).run('find-item', '--query', '#5');
  assert.equal(json.exact, true);
  assert.equal(json.matches[0].state, 'closed');
});

test('find-item: a link to another repository or host is not this provider', () => {
  const gh = fakeGitHub(FIND);
  for (const query of ['https://github.com/other/repo/issues/2', 'https://gitlab.com/octo/repo/-/issues/2']) {
    const { status, json } = gh.run('find-item', '--query', query);
    assert.equal(status, 1);
    assert.equal(json.code, 'NOT_THIS_PROVIDER', query);
  }
  assert.equal(gh.run('find-item', '--query', 'https://github.com/octo/repo/pull/7').json.code, 'TARGET_UNAVAILABLE');
});

test('find-item: a pull request number is not a work item', () => {
  const gh = fakeGitHub(FIND);
  for (const query of ['6', '#6', 'https://github.com/octo/repo/issues/6']) {
    const { status, json } = gh.run('find-item', '--query', query);
    assert.equal(status, 1, query);
    assert.equal(json.code, 'TARGET_UNAVAILABLE', query);
    assert.match(json.message, /pull request/, query);
  }
  assert.deepEqual(found(gh.run('find-item', '--query', 'move the camera with WASD').json), ['2'], 'descriptions skip pull requests');
});

test('find-item: a description with one strong match resolves to it', () => {
  const { json } = fakeGitHub(FIND).run('find-item', '--query', 'the camera feature with WASD');
  assert.equal(json.exact, true);
  assert.deepEqual(found(json), ['2']);
});

test('find-item: an ambiguous description returns the candidates', () => {
  const { json } = fakeGitHub(FIND).run('find-item', '--query', 'the camera feature');
  assert.equal(json.exact, false);
  assert.deepEqual(found(json), ['2', '3']);
});

test('find-item: no match, a missing number, closed items, and bad input', () => {
  const gh = fakeGitHub(FIND);
  assert.deepEqual(gh.run('find-item', '--query', 'inventory').json.matches, []);
  assert.deepEqual(found(gh.run('find-item', '--query', 'minimap').json), [], 'descriptions match open items only');
  assert.equal(gh.run('find-item', '--query', '#42').json.code, 'TARGET_UNAVAILABLE');
  assert.equal(gh.run('find-item').status, 2);
  assert.equal(gh.run('find-item', '--query', '  ').status, 2);
});

// The architecture comment: posted with its key, read back through get-item.

test('architecture: a keyed comment posted on the epic reads back as current, and stale after a new feature', () => {
  const { coversLine, status } = require('../skills/cairn/architecture.js');
  const gh = fakeGitHub({
    ...TYPED,
    issues: [
      { number: 1, title: 'Players can explore the map', labels: ['epic'] },
      { number: 2, title: 'A player can move the camera with WASD', type: 'Feature', parent: 1 },
      { number: 3, title: 'A player can zoom the camera', type: 'Feature', parent: 1 },
    ],
  });
  const epic = () => gh.run('get-item', '--id', '1').json;
  assert.equal(status(epic()).status, 'missing');

  const draft = `One camera rig.\n\n## Shared foundation\n\nThe rig.\n\n## Decisions\n\nOne rig.\n\n## Interfaces\n\nNone.\n\n## Build order\n\n#2, then #3.\n\n## Trade-offs\n\nNone.\n\n## Open questions\n\nNone.\n\n${status(epic()).covers}\n`;
  const posted = gh.run('comment', '--on', '1', '--key', 'architecture', '--file', gh.draft('arch.md', draft));
  assert.equal(posted.json.created, true);
  assert.equal(status(epic()).status, 'current');

  const again = gh.run('comment', '--on', '1', '--key', 'architecture', '--file', gh.draft('arch.md', draft.replace('One rig.', 'One rig, shared.')));
  assert.equal(again.json.created, false, 're-running updates the same comment');
  assert.equal(gh.state().issues[0].comments.length, 1);

  const s = gh.state();
  s.issues.push({ number: 4, id: 9004, title: 'A player can save the map', body: '', state: 'OPEN', labels: [], type: 'Feature', parent: 1, comments: [] });
  fs.writeFileSync(path.join(gh.root, 'github.json'), JSON.stringify(s));
  const after = status(epic());
  assert.equal(after.status, 'stale');
  assert.deepEqual(after.uncovered.map((f) => f.id), ['4']);
  assert.equal(coversLine(after.features), after.covers);
});

// --- Changes: start-change, push-change, save-change ---

const FEATURE_8 = { number: 8, title: 'Players can zoom', labels: ['feature'] };
const TASKS_8 = [
  { number: 21, title: 'Add the zoom keys', labels: ['task'], parent: 8 },
  { number: 22, title: 'Clamp the zoom range', labels: ['task'], parent: 8 },
  { number: 23, title: 'An old task', labels: ['task'], parent: 8, state: 'CLOSED' },
];
const changeRepo = (state = {}) => fakeGitHub({ issues: [FEATURE_8, ...TASKS_8, { number: 14, title: 'Another feature', labels: ['feature'] }], ...state });
const branchOf = (gh) => gh.git('branch', '--show-current').trim();
const remoteBranches = (gh) => gh.git('ls-remote', '--heads', 'origin').split('\n').filter(Boolean).map((l) => l.split('refs/heads/')[1]).sort();

test('start-change: a first run creates a linked branch from the latest main', () => {
  const gh = changeRepo();
  // Someone else lands a commit on main after this clone last fetched.
  const other = gh.other();
  fs.writeFileSync(path.join(other.cwd, 'NEW.md'), 'new\n');
  other.git('add', 'NEW.md');
  other.git('commit', '-q', '-m', 'Land something on main');
  other.git('push', '-q', 'origin', 'main');
  const latest = other.git('rev-parse', 'HEAD').trim();

  const { status, json } = gh.run('start-change', '--for', '8');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json, { ok: true, provider: 'github', branch: '8-players-can-zoom', created: true, linked: true });
  assert.equal(branchOf(gh), '8-players-can-zoom');
  assert.equal(gh.git('rev-parse', 'HEAD').trim(), latest, 'the branch starts from the latest main');
  assert.deepEqual(gh.state().linkedBranches, { 8: ['8-players-can-zoom'] });
});

test('start-change: a second run reuses the branch, from main or from a fresh clone', () => {
  const gh = changeRepo();
  gh.run('start-change', '--for', '8');
  assert.deepEqual(gh.run('start-change', '--for', '8').json, { ok: true, provider: 'github', branch: '8-players-can-zoom', created: false, linked: true });

  gh.git('checkout', '-q', 'main');
  assert.equal(gh.run('start-change', '--for', '8').json.created, false);
  assert.equal(branchOf(gh), '8-players-can-zoom');

  // A clone that never had the branch finds it on the remote.
  gh.git('checkout', '-q', 'main');
  gh.git('branch', '-D', '8-players-can-zoom');
  assert.equal(gh.run('start-change', '--for', '8').json.created, false);
  assert.equal(branchOf(gh), '8-players-can-zoom');
  assert.deepEqual(remoteBranches(gh), ['8-players-can-zoom', 'main'], 'never a second branch');
  assert.equal(gh.state().calls.filter((c) => c[0] === 'issue' && c[1] === 'develop' && !c.includes('--list')).length, 1);
});

test('start-change: --partial creates a plain branch and links nothing', () => {
  const gh = changeRepo();
  const { status, json } = gh.run('start-change', '--for', '8', '--partial', 'zoom-keys');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json, { ok: true, provider: 'github', branch: '8-zoom-keys', created: true, linked: false });
  assert.equal(branchOf(gh), '8-zoom-keys');
  assert.deepEqual(gh.state().linkedBranches, {});
  assert.equal(gh.state().calls.some((c) => c[0] === 'issue'), false, 'no gh issue develop call');

  gh.git('checkout', '-q', 'main');
  assert.equal(gh.run('start-change', '--for', '8', '--partial', 'zoom-keys').json.created, false);
  assert.equal(branchOf(gh), '8-zoom-keys');
});

test('start-change: a dirty tree on another branch fails with DIRTY_TREE and changes nothing', () => {
  const gh = changeRepo();
  fs.writeFileSync(path.join(gh.cwd, 'notes.txt'), 'mine\n');
  fs.writeFileSync(path.join(gh.cwd, 'README.md'), '# repo\n\nedited\n');
  const { status, json } = gh.run('start-change', '--for', '8');
  assert.equal(status, 1);
  assert.equal(json.code, 'DIRTY_TREE');
  assert.match(json.fix, /Cairn does not stash or discard/);
  assert.equal(branchOf(gh), 'main');
  assert.equal(fs.readFileSync(path.join(gh.cwd, 'notes.txt'), 'utf8'), 'mine\n');
  assert.match(fs.readFileSync(path.join(gh.cwd, 'README.md'), 'utf8'), /edited/);
  assert.deepEqual(remoteBranches(gh), ['main']);
  assert.equal(gh.git('stash', 'list'), '', 'nothing was stashed');
  assert.equal(gh.gitCalls().some((c) => /^(stash|reset|clean|checkout|restore)\b/.test(c)), false);
});

test('start-change: a dirty tree on the item\'s own branch is allowed', () => {
  const gh = changeRepo();
  gh.run('start-change', '--for', '8');
  fs.writeFileSync(path.join(gh.cwd, 'zoom.js'), '// in progress\n');
  const { status, json } = gh.run('start-change', '--for', '8');
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.created, false);
  assert.equal(fs.readFileSync(path.join(gh.cwd, 'zoom.js'), 'utf8'), '// in progress\n');
});

test('start-change: missing push access fails before any branch is made', () => {
  const gh = changeRepo({ permission: 'TRIAGE' });
  const { status, json } = gh.run('start-change', '--for', '8');
  assert.equal(status, 1);
  assert.equal(json.code, 'MISSING_PERMISSION');
  assert.equal(branchOf(gh), 'main');
  assert.deepEqual(remoteBranches(gh), ['main']);
});

test('start-change: an unknown item, a pull request, and wrong usage are refused', () => {
  const gh = changeRepo({ issues: [FEATURE_8, { number: 30, title: 'A pull request', pull: true }] });
  assert.equal(gh.run('start-change', '--for', '99').json.code, 'TARGET_UNAVAILABLE');
  assert.equal(gh.run('start-change', '--for', '30').json.code, 'TARGET_UNAVAILABLE');
  assert.equal(gh.run('start-change').status, 2);
  assert.equal(gh.run('start-change', '--for', '8', '--partial', 'Not A Slug').status, 2);
  assert.equal(branchOf(gh), 'main');
});

test('push-change: pushes new commits, then reports nothing new', () => {
  const gh = changeRepo();
  gh.run('start-change', '--for', '8', '--partial', 'zoom-keys');
  gh.commit('zoom.js', '// zoom\n', 'Add the zoom keys');

  const first = gh.run('push-change');
  assert.equal(first.status, 0, JSON.stringify(first.json));
  assert.deepEqual(first.json, { ok: true, provider: 'github', branch: '8-zoom-keys', pushed: true });
  assert.equal(gh.git('ls-remote', '--heads', 'origin', '8-zoom-keys').split(/\s/)[0], gh.git('rev-parse', 'HEAD').trim());
  assert.equal(gh.git('rev-parse', '--abbrev-ref', '@{upstream}').trim(), 'origin/8-zoom-keys', 'the upstream is set');

  assert.deepEqual(gh.run('push-change').json, { ok: true, provider: 'github', branch: '8-zoom-keys', pushed: false });

  gh.commit('zoom.js', '// zoom, clamped\n', 'Clamp the zoom range');
  assert.equal(gh.run('push-change').json.pushed, true);
});

test('push-change: main is refused and nothing is pushed', () => {
  const gh = changeRepo();
  gh.commit('oops.js', '// oops\n', 'A commit on main');
  const before = gh.git('ls-remote', '--heads', 'origin', 'main');
  const { status, json } = gh.run('push-change');
  assert.equal(status, 1);
  assert.equal(json.code, 'NOT_ON_CHANGE');
  assert.match(json.fix, /start-change/);
  assert.equal(gh.git('ls-remote', '--heads', 'origin', 'main'), before);
  assert.equal(gh.gitCalls().some((c) => c.startsWith('push')), false);
  assert.equal(gh.run('push-change', '--force').status, 2, 'it takes no arguments');
});

test('push-change: a rejected push is reported, never forced', () => {
  const gh = changeRepo();
  gh.run('start-change', '--for', '8');
  gh.commit('zoom.js', '// mine\n', 'My commit');

  // Someone else pushes to the same branch first.
  const other = gh.other();
  other.git('checkout', '-q', '-b', '8-players-can-zoom', 'origin/8-players-can-zoom');
  fs.writeFileSync(path.join(other.cwd, 'theirs.js'), '// theirs\n');
  other.git('add', 'theirs.js');
  other.git('commit', '-q', '-m', 'Their commit');
  other.git('push', '-q', 'origin', '8-players-can-zoom');
  const theirs = other.git('rev-parse', 'HEAD').trim();

  const { status, json } = gh.run('push-change');
  assert.equal(status, 1);
  assert.equal(json.code, 'PROVIDER_ERROR');
  assert.match(json.message, /rejected/);
  assert.match(json.fix, /Pull them into the branch first.*never force-pushes/);
  assert.equal(gh.git('ls-remote', '--heads', 'origin', '8-players-can-zoom').split(/\s/)[0], theirs, 'the remote branch is unchanged');
});

test('push-change: no git call uses force, and missing access pushes nothing', () => {
  const gh = changeRepo();
  gh.run('start-change', '--for', '8');
  gh.commit('zoom.js', '// zoom\n', 'Add zoom');
  gh.run('push-change');
  gh.run('push-change');
  const pushes = gh.gitCalls().filter((c) => c.startsWith('push'));
  assert.ok(pushes.length > 0);
  for (const call of gh.gitCalls()) assert.doesNotMatch(call, /(^|\s)(--force\S*|-f|\+\S+)(\s|$)/, call);

  const readOnly = changeRepo({ permission: 'READ' });
  readOnly.git('checkout', '-q', '-b', 'some-branch');
  assert.equal(readOnly.run('push-change').json.code, 'MISSING_PERMISSION');
  assert.equal(readOnly.gitCalls().some((c) => c.startsWith('push')), false);
});

const CHANGE = `# Let players zoom the map

## What changed

Players can zoom with the plus and minus keys.

## How it was validated

The unit tests pass.
`;

// A pushed branch for #8 with one commit, ready for save-change.
function pushedChange(state, ...startArgs) {
  const gh = changeRepo(state);
  gh.run('start-change', '--for', '8', ...startArgs);
  gh.commit('zoom.js', '// zoom\n', 'Add zoom');
  gh.run('push-change');
  return gh;
}

test('save-change: a first run opens one change that closes the item and its open tasks', () => {
  const gh = pushedChange();
  const { status, json } = gh.run('save-change', '--for', '8', '--file', gh.draft('change.md', CHANGE));
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json, {
    ok: true, provider: 'github', change: { id: '24', url: 'https://github.com/octo/repo/pull/24' }, created: true, closes: ['8', '21', '22'],
  });
  const [pull] = gh.state().pulls;
  assert.equal(pull.title, 'Let players zoom the map');
  assert.equal(pull.base, 'main');
  assert.equal(pull.head, '8-players-can-zoom');
  assert.match(pull.body, /^## What changed/);
  assert.ok(pull.body.endsWith('The unit tests pass.\n\nCloses #8\nCloses #21\nCloses #22\n'), pull.body);
  assert.doesNotMatch(pull.body, /#23/, 'a closed task is not closed again');

  // get-item now reports the open change, which is how a fresh session finds it.
  assert.deepEqual(gh.run('get-item', '--id', '8').json.changes, [{ id: '24', url: 'https://github.com/octo/repo/pull/24', state: 'open' }]);
});

test('save-change: a second run updates the change, with no second change and no doubled links', () => {
  const gh = pushedChange();
  gh.run('save-change', '--for', '8', '--file', gh.draft('change.md', CHANGE));
  const again = gh.state().pulls[0].body.replace('The unit tests pass.', 'The unit and integration tests pass.');
  const { status, json } = gh.run('save-change', '--for', '8', '--file', gh.draft('change2.md', `# Let players zoom the map smoothly\n\n${again}`));
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.created, false);
  assert.equal(json.change.id, '24');
  const { pulls } = gh.state();
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].title, 'Let players zoom the map smoothly');
  assert.ok(pulls[0].body.endsWith('The unit and integration tests pass.\n\nCloses #8\nCloses #21\nCloses #22\n'), pulls[0].body);
  assert.equal(pulls[0].body.match(/Closes #8\b/g).length, 1);
});

test('save-change: --partial writes Part of for the item and closes only the listed ids', () => {
  const gh = pushedChange({}, '--partial', 'zoom-keys');
  const { status, json } = gh.run('save-change', '--for', '8', '--file', gh.draft('change.md', CHANGE), '--partial', '--closes', '21');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json.closes, ['21']);
  assert.ok(gh.state().pulls[0].body.endsWith('The unit tests pass.\n\nPart of #8.\n\nCloses #21\n'), gh.state().pulls[0].body);
  assert.deepEqual(gh.run('get-item', '--id', '8').json.changes, [], 'the feature is not closed by a partial change');

  const none = pushedChange({}, '--partial', 'notes');
  const r = none.run('save-change', '--for', '8', '--file', none.draft('change.md', CHANGE), '--partial');
  assert.equal(r.status, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.closes, []);
  assert.ok(none.state().pulls[0].body.endsWith('The unit tests pass.\n\nPart of #8.\n'));
});

test('save-change: a change that would close an item not asked for fails and names it', () => {
  // A linked branch: the #66 mistake. The branch is linked to #8, but the change is a slice.
  const linked = pushedChange();
  const a = linked.run('save-change', '--for', '8', '--file', linked.draft('change.md', CHANGE), '--partial', '--closes', '21');
  assert.equal(a.status, 1);
  assert.equal(a.json.code, 'CLOSES_MISMATCH');
  assert.match(a.json.message, /would also close #8/);
  assert.match(a.json.fix, /under Development/);
  assert.deepEqual(a.json.closes, ['8', '21']);
  assert.equal(a.json.change.id, '24', 'the change is named, so it can be fixed');

  // A closing word in the prose: the #72 mistake.
  const prose = pushedChange({}, '--partial', 'zoom-keys');
  const b = prose.run('save-change', '--for', '8', '--file', prose.draft('change.md', `${CHANGE}\nMerging the old branch would have closed #14 too early.\n`), '--partial', '--closes', '21');
  assert.equal(b.status, 1);
  assert.equal(b.json.code, 'CLOSES_MISMATCH');
  assert.match(b.json.message, /would also close #14/);

  // An id that is not an issue here cannot be closed.
  const missing = pushedChange({}, '--partial', 'zoom-keys');
  const c = missing.run('save-change', '--for', '8', '--file', missing.draft('change.md', CHANGE), '--partial', '--closes', '21,99');
  assert.equal(c.json.code, 'CLOSES_MISMATCH');
  assert.match(c.json.message, /would not close #99/);
});

test('save-change: an unpushed branch, main, and missing access are refused before anything is opened', () => {
  const unpushed = changeRepo();
  unpushed.run('start-change', '--for', '8', '--partial', 'zoom-keys');
  const a = unpushed.run('save-change', '--for', '8', '--file', unpushed.draft('change.md', CHANGE));
  assert.equal(a.json.code, 'NOT_PUSHED');
  assert.match(a.json.fix, /push-change/);

  const onMain = changeRepo();
  assert.equal(onMain.run('save-change', '--for', '8', '--file', onMain.draft('change.md', CHANGE)).json.code, 'NOT_ON_CHANGE');

  const readOnly = pushedChange();
  fs.writeFileSync(path.join(readOnly.root, 'github.json'), JSON.stringify({ ...readOnly.state(), permission: 'TRIAGE' }));
  assert.equal(readOnly.run('save-change', '--for', '8', '--file', readOnly.draft('change.md', CHANGE)).json.code, 'MISSING_PERMISSION');

  for (const gh of [unpushed, onMain, readOnly]) {
    assert.equal(gh.state().pulls.length, 0);
    assert.equal(gh.state().calls.some((c) => c[0] === 'pr'), false);
  }
  assert.equal(onMain.run('save-change', '--for', '8', '--file', 'x.md', '--closes', '21').status, 2, '--closes needs --partial');
  assert.equal(onMain.run('save-change', '--for', '8', '--file', onMain.draft('bad.md', 'No title\n')).json.code, 'INVALID_DRAFT');
});

// A feature #8 with one open pull request, #30, from its linked branch.
function changeFor(pull = {}) {
  return fakeGitHub({
    issues: [{ number: 8, title: 'Let players zoom the map', type: 'Feature', labels: ['feature'] }],
    issueTypes: ['Feature', 'Task'],
    linkedBranches: { 8: ['8-zoom'] },
    pulls: [{ number: 30, state: 'OPEN', head: '8-zoom', title: 'Zoom', body: 'Zoom.\n\nCloses #8\n', ...pull }],
  });
}

test('get-change: a ready change with passing checks, an approval, and no threads', () => {
  const gh = changeFor({
    checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', context: 'ci/lint', state: 'SUCCESS' }],
    reviewDecision: 'APPROVED',
  });
  const { status, json } = gh.run('get-change', '--id', '30');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json, {
    ok: true,
    provider: 'github',
    change: { id: '30', url: 'https://github.com/octo/repo/pull/30', state: 'open', branch: '8-zoom', closes: ['8'] },
    checks: { state: 'passed', runs: [{ name: 'test', state: 'passed' }, { name: 'ci/lint', state: 'passed' }] },
    review: { decision: 'approved', pending: false },
    mergeable: 'mergeable',
    mergeState: 'clean',
    behind: 0,
    reviews: [],
    comments: [],
    threads: [],
  });
});

test('get-change: failing and pending checks, and resolved, outdated, and open threads', () => {
  const gh = changeFor({
    checks: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null },
    ],
    reviewDecision: 'CHANGES_REQUESTED',
    threads: [
      { id: 'T1', resolved: true, path: 'map.js', line: 4, comments: [{ id: 501, author: 'rev', body: 'Rename this.' }] },
      { id: 'T2', outdated: true, path: 'map.js', line: null, comments: [{ id: 502, author: 'rev', body: 'Old line.' }] },
      { id: 'T3', path: 'zoom.js', line: 12, comments: [{ id: 503, author: 'rev', body: 'Clamp the zoom?' }, { id: 504, author: 'octo', body: 'Done in abc123.\n\n<!-- cairn -->' }] },
    ],
  });
  const { status, json } = gh.run('get-change', '--id', '30');
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.checks.state, 'failed');
  assert.deepEqual(json.checks.runs.map((r) => r.state), ['failed', 'pending']);
  assert.equal(json.review.decision, 'changes_requested');
  assert.deepEqual(json.threads.map((t) => [t.id, t.resolved, t.outdated]), [['T1', true, false], ['T2', false, true], ['T3', false, false]]);
  const t3 = json.threads[2];
  assert.equal(t3.path, 'zoom.js');
  assert.equal(t3.line, 12);
  assert.deepEqual(t3.comments.map((c) => [c.id, c.author, c.cairn]), [['503', 'rev', false], ['504', 'octo', true]]);
  assert.match(t3.comments[0].url, /\/pull\/30#discussion_r503$/);
});

test('get-change: pending checks only give pending, and no checks give none', () => {
  const pending = changeFor({ checks: [{ __typename: 'StatusContext', context: 'ci', state: 'PENDING' }] });
  assert.equal(pending.run('get-change', '--id', '30').json.checks.state, 'pending');
  assert.deepEqual(changeFor().run('get-change', '--id', '30').json.checks, { state: 'none', runs: [] });
});

test('get-change: a change behind main, and a change with conflicts', () => {
  const behind = changeFor({ behind: 3, mergeState: 'BEHIND' });
  const a = behind.run('get-change', '--id', '30').json;
  assert.equal(a.behind, 3);
  assert.equal(a.mergeState, 'behind');

  const conflict = changeFor({ mergeable: 'CONFLICTING', mergeState: 'DIRTY' });
  const b = conflict.run('get-change', '--id', '30').json;
  assert.equal(b.mergeable, 'conflicting');
  assert.equal(b.mergeState, 'dirty');
});

test('get-change: a pending review by the current user is reported', () => {
  const gh = changeFor({ pendingReview: true });
  assert.equal(gh.run('get-change', '--id', '30').json.review.pending, true);
});

test('get-change: a merged change has no branch comparison', () => {
  const gh = changeFor({ state: 'MERGED' });
  const { status, json } = gh.run('get-change', '--id', '30');
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.change.state, 'merged');
  assert.equal(json.behind, null);
  assert.equal(gh.state().calls.filter((c) => c[0] === 'api' && /compare/.test(c.join(' '))).length, 0);
});

test('get-change: an unknown change and wrong usage are refused', () => {
  const gh = changeFor();
  const { status, json } = gh.run('get-change', '--id', '99');
  assert.equal(status, 1);
  assert.equal(json.code, 'TARGET_UNAVAILABLE');
  assert.equal(gh.run('get-change').status, 2);
  assert.equal(gh.run('get-change', '--id', 'abc').status, 2);
});

test('get-change: it only reads', () => {
  const gh = changeFor({ threads: [{ id: 'T1', comments: [{ id: 501, author: 'rev', body: 'Hm.' }] }] });
  gh.run('get-change', '--id', '30');
  const writes = gh.state().calls.filter((c) => c.includes('-X') || ['create', 'edit', 'merge'].includes(c[1]));
  assert.deepEqual(writes, []);
});

// Images: GitHub's rendering gives each attached image a signed URL.

const SHOT = '<img width="10" height="10" alt="zoom bug" src="https://github.com/user-attachments/assets/abc-123" />';

test('get-item: the item and its comments list their attached images', () => {
  const gh = fakeGitHub({
    issues: [{
      number: 1,
      title: 'Zoom',
      body: `It jumps.\n\n${SHOT}`,
      comments: [
        { author: 'rev', body: 'Two shots:\n\n![before](https://github.com/user-attachments/assets/b1)\n![after](https://github.com/user-attachments/assets/b2)' },
        { author: 'octo', body: 'Fixed.\n\n<!-- cairn -->' },
      ],
    }],
  });
  const { status, json } = gh.run('get-item', '--id', '1');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json.item.images, [{ url: 'https://private-user-images.githubusercontent.com/1/abc-123.png?jwt=fake&v=1', alt: 'zoom bug' }]);
  assert.deepEqual(json.comments[0].images.map((i) => i.alt), ['before', 'after']);
  assert.deepEqual(json.comments[1].images, []);
  assert.equal(json.comments[1].cairn, true, 'the marker is read from the Markdown, which keeps it');
  assert.ok(json.item.body.includes('user-attachments'), 'the body stays the Markdown');
});

test('get-change: conversation comments, review summaries, and thread comments list their images', () => {
  const gh = changeFor({
    comments: [{ id: 701, author: 'pm', body: `Make it look like this.\n\n${SHOT}` }],
    reviews: [
      { id: 801, author: 'rev', state: 'CHANGES_REQUESTED', body: 'See the line notes.' },
      { id: 802, author: 'rev', state: 'COMMENTED', body: '' },
    ],
    threads: [{ id: 'T1', path: 'zoom.js', line: 3, comments: [{ id: 901, author: 'rev', body: `Off by one?\n\n${SHOT}` }] }],
  });
  const { status, json } = gh.run('get-change', '--id', '30');
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json.comments.map((c) => [c.id, c.author, c.images.length]), [['701', 'pm', 1]]);
  assert.match(json.comments[0].url, /#issuecomment-701$/);
  assert.deepEqual(json.reviews.map((r) => [r.id, r.state, r.body]), [['801', 'changes_requested', 'See the line notes.']], 'a review with no summary is left out');
  assert.deepEqual(json.threads[0].comments[0].images, [{ url: 'https://private-user-images.githubusercontent.com/1/abc-123.png?jwt=fake&v=1', alt: 'zoom bug' }]);
});

// get-image runs a download in a child process, so these tests serve images
// from a local server and run the adapter asynchronously.

const http = require('node:http');
const os = require('node:os');
const { spawn } = require('node:child_process');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function withServer(fn) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/shot')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<p>not an image</p>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

function runAsync(gh, ...args) {
  return new Promise((resolve) => {
    const env = { ...gh.env, CAIRN_IMAGE_HOSTS: '127.0.0.1' };
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'skills', 'cairn', 'providers', 'github.js'), ...args], { cwd: gh.cwd, env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (status) => resolve({ status, json: out ? JSON.parse(out) : null }));
  });
}

test('get-image: downloads an image outside the repository, and gives it an extension', async () => {
  const gh = fakeGitHub();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-img-'));
  await withServer(async (base) => {
    const { status, json } = await runAsync(gh, 'get-image', '--url', `${base}/shot?jwt=x`, '--out', path.join(out, 'new'));
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.type, 'image/png');
    assert.equal(json.bytes, PNG.length);
    assert.equal(json.path, path.join(fs.realpathSync(out), 'new', 'shot.png'));
    assert.deepEqual(fs.readFileSync(json.path), PNG);
  });
});

test('get-image: a folder inside the repository is refused before anything is downloaded', async () => {
  const gh = fakeGitHub();
  await withServer(async (base) => {
    for (const out of ['.', 'shots', path.join(gh.cwd, 'deep', 'er')]) {
      const { status, json } = await runAsync(gh, 'get-image', '--url', `${base}/shot`, '--out', out);
      assert.equal(status, 1);
      assert.equal(json.code, 'INSIDE_REPO', out);
    }
  });
  assert.equal(fs.existsSync(path.join(gh.cwd, 'shots')), false, 'no folder is made inside the repository');
  assert.deepEqual(gh.git('status', '--porcelain'), '');
});

test('get-image: an expired link, a page that is not an image, and a host that is not GitHub', async () => {
  const gh = fakeGitHub();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-img-'));
  await withServer(async (base) => {
    const expired = await runAsync(gh, 'get-image', '--url', `${base}/gone`, '--out', out);
    assert.equal(expired.json.code, 'PROVIDER_ERROR');
    assert.match(expired.json.fix, /expire/);
    const page = await runAsync(gh, 'get-image', '--url', `${base}/page`, '--out', out);
    assert.equal(page.json.code, 'PROVIDER_ERROR');
    assert.match(page.json.message, /not an image/);
  });
  assert.deepEqual(fs.readdirSync(out), [], 'nothing is saved');
  const elsewhere = gh.run('get-image', '--url', 'https://example.com/x.png', '--out', out);
  assert.equal(elsewhere.json.code, 'NOT_THIS_PROVIDER');
  const plain = gh.run('get-image', '--url', 'http://private-user-images.githubusercontent.com/1/x.png', '--out', out);
  assert.equal(plain.json.code, 'NOT_THIS_PROVIDER', 'only https from GitHub');
  assert.equal(gh.run('get-image', '--url', 'x').status, 2);
});
