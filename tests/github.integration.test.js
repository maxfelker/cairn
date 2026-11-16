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
  assert.deepEqual(json.item, { id: '1', url: 'https://github.com/octo/repo/issues/1', title: 'Trading', kind: 'epic', state: 'open', body: 'Why…', parent: null });
  assert.equal(gh.run('get-item', '--id', '2').json.item.parent, '1');
  assert.deepEqual(json.comments, [{ author: 'pm', body: 'Include allies?' }, { author: 'octo', body: 'Later.' }]);
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
