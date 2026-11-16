'use strict';

// Unit tests for the provider-neutral title matcher behind find-item.

const test = require('node:test');
const assert = require('node:assert/strict');

const { words, matchItems } = require('../skills/cairn/providers/lib.js');

const ITEMS = [
  { id: '2', title: 'A player can move the camera with WASD', kind: 'feature' },
  { id: '3', title: 'A player can zoom the camera', kind: 'feature' },
  { id: '4', title: 'Add the camera input handler', kind: 'task' },
  { id: '5', title: 'A trader can publish a release of their goods', kind: 'feature' },
];
const ids = (r) => r.matches.map((m) => m.id);

test('words: drops filler and plain plurals, keeps content words', () => {
  assert.deepEqual(words('Pick up the next task on the Camera features'), ['task', 'camera', 'feature']);
  assert.deepEqual(words('access class'), ['access', 'class'], 'a double s is not a plural');
});

test('matchItems: one strong match is exact and the only one returned', () => {
  const r = matchItems('zoom camera', ITEMS);
  assert.equal(r.exact, true);
  assert.deepEqual(ids(r), ['3']);
});

test('matchItems: several equal matches are candidates, best first, by id', () => {
  const r = matchItems('the camera', ITEMS);
  assert.equal(r.exact, false);
  assert.deepEqual(ids(r), ['2', '3', '4']);
});

test('matchItems: a kind word keeps only items of that kind', () => {
  assert.deepEqual(ids(matchItems('the camera task', ITEMS)), ['4']);
  assert.equal(matchItems('the camera task', ITEMS).exact, true);
  assert.deepEqual(ids(matchItems('the camera features', ITEMS)), ['2', '3']);
});

test('matchItems: a kind word with no item of that kind is ignored', () => {
  assert.deepEqual(ids(matchItems('the release epic', ITEMS)), ['5']);
});

test('matchItems: no shared words, or only filler, matches nothing', () => {
  assert.deepEqual(matchItems('inventory', ITEMS), { matches: [], exact: false });
  assert.deepEqual(matchItems('the next task', ITEMS), { matches: [], exact: false });
});

test('matchItems: returns at most the limit', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), title: `Camera ${i}`, kind: 'task' }));
  assert.equal(matchItems('camera', many).matches.length, 5);
  assert.equal(matchItems('camera', many, 3).matches.length, 3);
});
