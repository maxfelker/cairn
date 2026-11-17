#!/usr/bin/env node
// Choose the next step for a work item from its state alone. This is
// provider-neutral: it reads a contract `get-item` result, so every provider
// shares it, and the same state always gives the same step. Phrasing and
// judgment stay in the skill.
//
//   node next.js <get-item.json>   (use - to read it from stdin)
//   exit 0  {"ok": true, "step": "...", "item": {id, title, kind}, "reason": "..."}
//   exit 1  the get-item result itself, when it was a failure
//   exit 2  wrong usage, or input that is not a get-item result
//
// Steps:
//   done            the item is closed
//   break-down      an epic with no features, or a feature with no tasks
//   architect       an epic with open features and no current architecture
//   work-on-child   an epic or feature with open children and no open change:
//                   the first child, in order
//   finish-feature  a feature whose children are all closed
//   release         an epic whose features are all closed
//   continue-change a feature, task, or bug with an open change
//   implement       a task or bug with no open change, or an item with no kind

'use strict';

const fs = require('node:fs');
const architecture = require('./architecture.js');

const PARENT_KINDS = { epic: 'feature', feature: 'task' };

function nextStep({ item, children = [], changes = [], comments = [] }) {
  const self = { id: item.id, title: item.title, kind: item.kind };
  const step = (name, reason, target = self) => ({ ok: true, step: name, item: target, reason });
  const ref = (i) => `#${i.id} "${i.title}"`;

  if (item.state === 'closed') return step('done', `${ref(item)} is closed.`);

  const childKind = PARENT_KINDS[item.kind];
  if (childKind) {
    if (children.length === 0) {
      return step('break-down', `${ref(item)} is a ${item.kind} with no ${childKind}s yet.`);
    }
    // A feature is built on one change. Once that change is open, the work
    // continues there, whichever task is next.
    const openChange = item.kind === 'feature' && changes.find((c) => c.state === 'open');
    if (openChange) return step('continue-change', `${ref(item)} already has an open change, #${openChange.id}.`);

    const open = children.find((c) => c.state !== 'closed');
    if (open && item.kind === 'epic') {
      const arch = architecture.status({ comments, children });
      if (arch.status !== 'current') return step('architect', arch.reason);
    }
    if (open) {
      const left = children.filter((c) => c.state !== 'closed').length;
      return step(
        'work-on-child',
        `${ref(open)} is the first open ${open.kind || 'child'} of ${ref(item)} (${left} of ${children.length} open).`,
        { id: open.id, title: open.title, kind: open.kind },
      );
    }
    if (item.kind === 'feature') {
      return step('finish-feature', `Every task of ${ref(item)} is closed (${children.length}).`);
    }
    return step('release', `Every feature of ${ref(item)} is closed (${children.length}).`);
  }

  if (!item.kind) {
    return step('implement', `${ref(item)} has no kind, so it is treated as a single piece of work. Give it a kind to be sure.`);
  }
  const change = changes.find((c) => c.state === 'open');
  if (change) return step('continue-change', `${ref(item)} already has an open change, #${change.id}.`);
  return step('implement', `${ref(item)} is an open ${item.kind} with no open change.`);
}

function main(argv) {
  const [file, ...rest] = argv;
  if (!file || rest.length) {
    process.stderr.write('usage: next.js <get-item.json>   (use - for stdin)\n');
    return 2;
  }
  let result;
  try {
    result = JSON.parse(fs.readFileSync(file === '-' ? 0 : file, 'utf8'));
  } catch (err) {
    process.stderr.write(`cannot read a get-item result from ${file}: ${err.message}\n`);
    return 2;
  }
  if (result && result.ok === false) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 1;
  }
  if (!result || !result.item || !result.item.id) {
    process.stderr.write('the input is not a get-item result: it has no item\n');
    return 2;
  }
  process.stdout.write(`${JSON.stringify(nextStep(result))}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { nextStep };
