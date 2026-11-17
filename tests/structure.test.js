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
    '- [ ] A developer can add a trade API': /"Who it is for" does not name developers/,
    '- [ ] Developers can configure routes': /is not a capability|not a persona/,
    '- [ ] A trade system can balance prices': /names a system part/,
    '- [ ] A player can': /is not a capability/,
  };
  for (const [line, want] of Object.entries(cases)) {
    const text = GOOD.replace('- [ ] A player can see a caravan travel along the road', line);
    assert.match(problemsFor(text), want, line);
  }
});

test('a developer is a persona when the epic is for developers', () => {
  const tool = GOOD
    .replace('Players who manage more than one settlement.', 'Developers who ship game mods.')
    .replace('- [ ] A player can see a caravan travel along the road', '- [ ] A developer can publish a mod to the workshop');
  assert.equal(checkEpic(tool).ok, true);
  assert.equal(checkEpic(tool.replace('A developer can publish', 'A dev can publish')).ok, true, '"dev" too');
  const notForThem = GOOD.replace('- [ ] A player can see a caravan travel along the road', '- [ ] A developer can publish a mod to the workshop');
  assert.match(problemsFor(notForThem), /"Who it is for" does not name developers/);
  assert.match(problemsFor(tool.replace('- [ ] A player can open a trade panel between two settlements', '- [ ] A trade system can balance prices')), /names a system part/, 'system parts are still not personas');
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

// Features

const { checkFeature } = require('../skills/cairn/structure.js');

const FEATURE = `# A player can move the camera with WASD

A player pans the camera across the map by holding W, A, S, or D.

## Expected behavior

- Holding W moves the view north; releasing it stops.
- The camera never leaves the map bounds.

## Acceptance Criteria

- [ ] Set up the terrain scene the camera moves over
- [ ] Add the camera input handler
`;

function featureProblems(text) {
  const result = checkFeature(text);
  assert.equal(result.ok, false, 'expected the feature to be rejected');
  return result.problems.join('\n');
}

test('feature: a well-formed feature passes', () => {
  assert.deepEqual(checkFeature(FEATURE), { ok: true, kind: 'feature', title: 'A player can move the camera with WASD' });
});

test('feature: the title must be one persona capability', () => {
  const cases = {
    'Camera movement': /is not a capability/,
    'A developer can wire up input': /"Who it is for" does not name developers/,
    'A camera system can pan': /names a system part/,
    'A player can move and zoom the camera': /more than one capability/,
    'A player can pan or rotate the camera': /more than one capability/,
  };
  for (const [title, want] of Object.entries(cases)) {
    assert.match(featureProblems(FEATURE.replace('A player can move the camera with WASD', title)), want, title);
  }
});

test('feature: a developer persona passes when its epic is for developers', () => {
  const text = FEATURE.replace('A player can move the camera with WASD', 'A developer can preview a mod in the editor');
  assert.equal(checkFeature(text, { audience: 'Developers who ship game mods.' }).ok, true);
  assert.equal(checkFeature(text, { audience: 'Players who manage settlements.' }).ok, false);
  assert.equal(checkFeature(text).ok, false, 'without the audience, a developer persona is not assumed');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-structure-'));
  const draft = path.join(dir, 'feature.md');
  fs.writeFileSync(draft, text);
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, 'feature', draft, ...args], { encoding: 'utf8' }).status;
  assert.equal(run('--for', 'Developers who ship game mods.'), 0);
  assert.equal(run('--for', 'Players.'), 1);
  assert.equal(run(), 1);
  assert.equal(run('--for'), 2);
  assert.equal(run('--who', 'Developers'), 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, 'epic', draft, '--for', 'Developers'], { encoding: 'utf8' }).status, 2, 'only features take --for');
});

test('feature: "and" between personas is one capability, not two', () => {
  const text = FEATURE.replace('A player can move the camera with WASD', 'A borrower and an owner can see the status of a loan');
  assert.equal(checkFeature(text).ok, true);
});

test('feature: the body opens with prose before any heading', () => {
  assert.match(featureProblems(FEATURE.replace('A player pans the camera across the map by holding W, A, S, or D.\n', '')), /Start the body with plain prose/);
  assert.match(featureProblems(FEATURE.replace('A player pans the camera across the map by holding W, A, S, or D.', '- just a list')), /Start the body with plain prose/);
});

test('feature: expected behavior and acceptance criteria are required', () => {
  assert.match(featureProblems(FEATURE.replace('## Expected behavior', '## Notes')), /Missing the "Expected behavior" section/);
  assert.match(featureProblems(FEATURE.replace(/## Expected behavior\n\n- Holding.*\n- The camera.*\n/, '## Expected behavior\n\n')), /"Expected behavior" section is empty/);
  assert.match(featureProblems(FEATURE.replace(/## Acceptance Criteria[\s\S]*$/, '')), /Missing the "Acceptance Criteria" section/);
  assert.match(featureProblems(FEATURE.replace(/## Acceptance Criteria\n[\s\S]*$/, '## Acceptance Criteria\n\nLater.\n')), /has no items/);
  // Unlike an epic, a feature may have sections after its criteria, such as Tasks.
  assert.equal(checkFeature(`${FEATURE}\n## Tasks\n\n- [ ] #14\n`).ok, true);
});

test('feature: task criteria are free text or references', () => {
  const text = FEATURE.replace('- [ ] Add the camera input handler', '- [ ] #14\n- [ ] CAM-7');
  assert.equal(checkFeature(text).ok, true);
});

// Epics after decomposition

test('epic: acceptance criteria may be references to child items', () => {
  const text = GOOD.replace(/## Acceptance Criteria\n[\s\S]*$/, '## Acceptance Criteria\n\n- [ ] #2\n- [x] #3\n- [ ] TRADE-12\n');
  assert.equal(checkEpic(text).ok, true);
  const mixed = GOOD.replace('- [ ] A player can see a caravan travel along the road', '- [ ] #2 and more');
  assert.equal(checkEpic(mixed).ok, false, 'a reference with extra text is not a bare reference');
});

test('CLI checks features', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-structure-'));
  const file = path.join(dir, 'f.md');
  fs.writeFileSync(file, FEATURE);
  assert.equal(spawnSync(process.execPath, [SCRIPT, 'feature', file], { encoding: 'utf8' }).status, 0);
  const viaStdin = spawnSync(process.execPath, [SCRIPT, 'feature', '-'], { input: '# Camera\n', encoding: 'utf8' });
  assert.equal(viaStdin.status, 1);
});

// Tasks

const { checkTask } = require('../skills/cairn/structure.js');

const TASK = `# Add the camera input handler

Read W, A, S, and D each frame and pan the camera, so the movement feature has its first working step.

## Implementation guidance

- Reuse the engine's input map; no new input library.

## Validation

- Unit test: holding W for one second moves the camera north by the configured speed.

## Done when

- [ ] Holding W, A, S, or D pans the camera.
`;

function taskProblems(text) {
  const result = checkTask(text);
  assert.equal(result.ok, false, 'expected the task to be rejected');
  return result.problems.join('\n');
}

test('task: a well-formed task passes', () => {
  assert.deepEqual(checkTask(TASK), { ok: true, kind: 'task', title: 'Add the camera input handler' });
});

test('task: the title is an engineering step, not a capability', () => {
  assert.match(taskProblems(TASK.replace('Add the camera input handler', 'A player can move the camera')), /is a persona capability, which makes it a feature/);
  assert.match(taskProblems(TASK.replace('Add the camera input handler', 'The camera input handler')), /should name an action/);
  assert.match(taskProblems(TASK.replace(/^# .*\n/, '')), /must start with a "# <title>"/);
});

test('task: the body opens with prose', () => {
  assert.match(taskProblems(TASK.replace(/Read W, A, S.*\n/, '')), /Start the body with plain prose/);
});

test('task: guidance, validation, and done criteria are required', () => {
  for (const heading of ['Implementation guidance', 'Validation', 'Done when']) {
    assert.match(taskProblems(TASK.replace(`## ${heading}`, '## Notes')), new RegExp(`Missing the "${heading}" section`), heading);
  }
  assert.match(taskProblems(TASK.replace('- Reuse the engine\'s input map; no new input library.', '')), /"Implementation guidance" section is empty/);
  assert.match(taskProblems(TASK.replace('- [ ] Holding W, A, S, or D pans the camera.', 'When it works.')), /needs at least one checklist item/);
});

test('task: alternate headings are accepted', () => {
  const text = TASK.replace('## Implementation guidance', '## How').replace('## Validation', '## Testing').replace('## Done when', '## Definition of done');
  assert.equal(checkTask(text).ok, true);
});

// Comments

const { checkComment } = require('../skills/cairn/structure.js');

const commentProblems = (text) => {
  const result = checkComment(text);
  assert.equal(result.ok, false, `expected the comment to be rejected: ${text}`);
  return result.problems.join('\n');
};

test('comment: each kind passes in its shape', () => {
  const good = {
    decision: '**Decision:** One camera module owns the view.\n\nPan and zoom must share one edge rule, and two modules would each need a copy of it.',
    question: '**Question:** Should the minimap be its own feature?',
    blocked: '**Blocked:** The branch cannot be pushed until the login has WRITE access.\n\nThe push was refused. A repository admin can grant the access.',
  };
  for (const [kind, text] of Object.entries(good)) {
    assert.deepEqual(checkComment(text), { ok: true, kind: 'comment', comment: kind }, kind);
  }
  assert.equal(checkComment('\n\n**decision:** lower case kind.\n\nIt reads the same.').ok, true, 'the kind ignores case and leading blank lines');
});

test('comment: the first line names a known kind and gives the bottom line', () => {
  assert.match(commentProblems('Pushed the camera module.'), /Start the comment with its kind/);
  assert.match(commentProblems('**Note:** Pushed it.'), /Start the comment with its kind/);
  assert.match(commentProblems('**Progress:** The camera module is pushed.'), /the kind is Decision, Question, Blocked/, 'progress is not a comment kind');
  assert.match(commentProblems('**Question:**\n\nWhich zoom range?'), /Put the bottom line on the first line/);
  assert.match(commentProblems(''), /Start the comment with its kind/);
});

test('comment: a decision says why, and a blocker says what is needed', () => {
  assert.match(commentProblems('**Decision:** One camera module.'), /A decision needs more than its first line\. After the first line, say why/);
  assert.match(commentProblems('**Blocked:** Push refused.\n\n'), /A blocked needs more than its first line\. .*what is needed to continue/);
});

test('comment: the body is prose, with no labeled lines', () => {
  assert.match(commentProblems('**Decision:** One camera module.\n\n**Why:** it is simpler.'), /Write "\*\*Why:\*\* it is simpler\." as a sentence, not a labeled line/);
  assert.match(commentProblems('**Blocked:** Push refused.\n\n**Needed:** WRITE access.'), /not a labeled line/);
  assert.equal(checkComment('**Question:** Is the check required?\n\nThe **validate** job is green.').ok, true, 'bold inside a sentence is fine');
});

test('comment: a sentence has at most 25 words', () => {
  const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
  assert.equal(checkComment(`**Question:** ${words(25)}.`).ok, true);
  assert.match(commentProblems(`**Question:** ${words(26)}.`), /Split this sentence\. It has 26 words, and the limit is 25/);
  assert.match(commentProblems(`**Question:** Is it pushed?\n\n${words(30)}. Short one.`), /It has 30 words/);
  assert.equal(checkComment(`**Question:** Is it pushed?\n\n${words(20)}. ${words(20)}.`).ok, true, 'two short sentences pass');
  assert.equal(checkComment(`**Question:** Is it pushed?\n\n- ${words(15)}\n- ${words(15)}`).ok, true, 'each list item is its own sentence');
  assert.equal(checkComment(`**Question:** Is it pushed?\n\n${words(24)} \`${words(10)}\`.`).ok, true, 'a code span counts as one word');
});

test('comment: the CLI checks a comment with exit codes 0, 1, and 2', () => {
  const run = (input, ...args) => spawnSync(process.execPath, [SCRIPT, 'comment', '-', ...args], { input, encoding: 'utf8' });
  const ok = run('**Question:** Which zoom range?');
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).comment, 'question');
  assert.equal(run('Just text').status, 1);
  assert.equal(run('**Question:** Which zoom range?', '--for', 'Players').status, 2, 'only features take --for');
});
