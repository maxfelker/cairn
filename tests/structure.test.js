'use strict';

// Unit tests for the provider-neutral structure checks. No provider and no
// network: these only check the shape of a generated draft.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { checkEpic, parse } = require('../skills/cairn/structure.js');

const SCRIPT = path.join(__dirname, '..', 'skills', 'cairn', 'structure.js');

const GOOD = `# Players can trade resources between settlements

## Why

Settlements run short of food while others hoard it, and players quit when they cannot fix that.

## Who it is for

Players who manage more than one settlement.

## In scope

Trading food, wood, and stone between a player's own settlements.

## Out of scope

Trading with other players.

## What success looks like

A player can rescue a starving settlement without restarting the map.

## Acceptance Criteria

- [ ] A player can open a trade panel between two settlements
- [ ] A player can see a caravan travel along the road
- [x] An enemy raider can intercept a caravan
`;

function problemsFor(text) {
  const result = checkEpic(text);
  assert.equal(result.ok, false, 'expected the draft to be rejected');
  return result.problems.join('\n');
}

test('a well-formed epic passes', () => {
  assert.deepEqual(checkEpic(GOOD), {
    ok: true, kind: 'epic', title: 'Players can trade resources between settlements',
  });
});

test('headings match without regard to case or alternate names', () => {
  const text = GOOD
    .replace('## Why', '## WHY THIS MATTERS')
    .replace('## Who it is for', '## who')
    .replace('## Out of scope', '## Non-goals')
    .replace('## Acceptance Criteria', '## acceptance criteria');
  assert.equal(checkEpic(text).ok, true);
});

test('a missing title is reported', () => {
  assert.match(problemsFor(GOOD.replace(/^# .*\n/, '')), /must start with a "# <title>"/);
});

test('each missing section is reported by name', () => {
  for (const heading of ['Why', 'Who it is for', 'In scope', 'Out of scope', 'What success looks like', 'Acceptance Criteria']) {
    const without = GOOD.replace(new RegExp(`## ${heading}\\n`), '## Notes\n');
    assert.match(problemsFor(without), new RegExp(`Missing the "${heading}" section`), heading);
  }
});

test('an empty prose section is reported', () => {
  const text = GOOD.replace('Trading with other players.', '');
  assert.match(problemsFor(text), /"Out of scope" section is empty/);
});

test('acceptance criteria must be the last section', () => {
  assert.match(problemsFor(`${GOOD}\n## Notes\n\nMore.\n`), /must be the last section/);
});

test('acceptance criteria need at least one item', () => {
  const text = GOOD.replace(/## Acceptance Criteria\n[\s\S]*$/, '## Acceptance Criteria\n\nTBD\n');
  assert.match(problemsFor(text), /has no items/);
});

test('criteria must be persona capabilities', () => {
  const cases = {
    '- [ ] Trade panel': /is not a capability/,
    '- [ ] Caravan system': /is not a capability/,
    '- [ ] A developer can add a trade API': /A developer is not a persona/,
    '- [ ] Developers can configure routes': /is not a capability|not a persona/,
    '- [ ] A trade system can balance prices': /names a system part/,
    '- [ ] A player can': /is not a capability/,
  };
  for (const [line, want] of Object.entries(cases)) {
    const text = GOOD.replace('- [ ] A player can see a caravan travel along the road', line);
    assert.match(problemsFor(text), want, line);
  }
});

test('every problem is reported, not just the first', () => {
  const result = checkEpic('# Title\n\n## Why\n\nBecause.\n');
  assert.equal(result.problems.length, 5);
});

test('parse reads the title and sections', () => {
  const { title, sections } = parse('\n# T\n\n## A\none\n## B ##\ntwo\n');
  assert.equal(title, 'T');
  assert.deepEqual(sections.map((s) => s.heading), ['A', 'B']);
});

test('CLI exit codes: 0 valid, 1 problems, 2 usage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-structure-'));
  const good = path.join(dir, 'good.md');
  const bad = path.join(dir, 'bad.md');
  fs.writeFileSync(good, GOOD);
  fs.writeFileSync(bad, '# Only a title\n');

  const ok = spawnSync(process.execPath, [SCRIPT, 'epic', good], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).ok, true);

  const failed = spawnSync(process.execPath, [SCRIPT, 'epic', bad], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.ok(JSON.parse(failed.stdout).problems.length > 0);

  for (const args of [[], ['epic'], ['saga', good], ['epic', path.join(dir, 'missing.md')]]) {
    assert.equal(spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }).status, 2, args.join(' '));
  }
});

test('structure.js stays provider-neutral', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /github|gitlab|jira|azure|\bgh\b|pull request/i);
});
