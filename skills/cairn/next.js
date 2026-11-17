#!/usr/bin/env node
// Choose the next step for a work item from its state alone. This is
// provider-neutral: it reads a contract `get-item` result, so every provider
// shares it, and the same state always gives the same step. Phrasing and
// judgment stay in the skill.
//
//   node next.js <get-item.json> [--change <get-change.json>]
//                                  (use - to read the get-item result from stdin)
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
//   address-feedback a feature, task, or bug whose open change has feedback
//                   Cairn has not answered (needs --change)
//   continue-change a feature, task, or bug with an open change
//   implement       a task or bug with no open change, or an item with no kind

'use strict';

const fs = require('node:fs');
const architecture = require('./architecture.js');

const PARENT_KINDS = { epic: 'feature', feature: 'task' };

const later = (a, b) => (a || '') > (b || '');
const lastCairn = (comments) => comments.filter((c) => c.cairn).map((c) => c.at).sort().pop() || null;

// Feedback Cairn has not answered yet, read from the record alone:
// - a review thread that is not resolved, whose newest comment is not Cairn's;
// - a comment or review summary on the change, newer than Cairn's last
//   comment there;
// - a comment on the item, made after the change opened and after Cairn's
//   last comment on the item. Earlier discussion was the input to the work.
function unanswered(itemComments, change) {
  const threads = (change.threads || []).filter((t) => !t.resolved && t.comments.length && !t.comments[t.comments.length - 1].cairn);
  const onChange = [...(change.comments || []), ...(change.reviews || [])];
  const changeCursor = lastCairn(change.comments || []);
  const fromChange = onChange.filter((c) => !c.cairn && later(c.at, changeCursor));
  const itemCursor = [lastCairn(itemComments), change.change.opened].filter(Boolean).sort().pop() || null;
  const fromItem = itemComments.filter((c) => !c.cairn && later(c.at, itemCursor));
  return { threads: threads.length, comments: fromChange.length + fromItem.length };
}

function plural(n, word) {
  return `${n} unanswered ${word}${n === 1 ? '' : 's'}`;
}

function nextStep({ item, children = [], changes = [], comments = [] }, change = null) {
  const self = { id: item.id, title: item.title, kind: item.kind };
  const step = (name, reason, target = self) => ({ ok: true, step: name, item: target, reason });
  const ref = (i) => `#${i.id} "${i.title}"`;

  // An open change continues, unless it has feedback to answer first.
  const continueChange = (open) => {
    if (change && change.change && change.change.id === open.id) {
      const u = unanswered(comments, change);
      if (u.threads || u.comments) {
        const parts = [u.threads && plural(u.threads, 'review thread'), u.comments && plural(u.comments, 'comment')].filter(Boolean);
        return step('address-feedback', `#${open.id}, the change for ${ref(item)}, has ${parts.join(' and ')}.`);
      }
    }
    return step('continue-change', `${ref(item)} already has an open change, #${open.id}.`);
  };

  if (item.state === 'closed') return step('done', `${ref(item)} is closed.`);

  const childKind = PARENT_KINDS[item.kind];
  if (childKind) {
    if (children.length === 0) {
      return step('break-down', `${ref(item)} is a ${item.kind} with no ${childKind}s yet.`);
    }
    // A feature is built on one change. Once that change is open, the work
    // continues there, whichever task is next.
    const openChange = item.kind === 'feature' && changes.find((c) => c.state === 'open');
    if (openChange) return continueChange(openChange);

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
  const open = changes.find((c) => c.state === 'open');
  if (open) return continueChange(open);
  return step('implement', `${ref(item)} is an open ${item.kind} with no open change.`);
}

function readResult(file, what) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file === '-' ? 0 : file, 'utf8')) };
  } catch (err) {
    process.stderr.write(`cannot read a ${what} result from ${file}: ${err.message}\n`);
    return { ok: false };
  }
}

function main(argv) {
  const [file, ...rest] = argv;
  const withChange = rest.length === 2 && rest[0] === '--change';
  if (!file || (rest.length && !withChange)) {
    process.stderr.write('usage: next.js <get-item.json> [--change <get-change.json>]   (use - for stdin)\n');
    return 2;
  }
  const read = readResult(file, 'get-item');
  if (!read.ok) return 2;
  const result = read.value;
  let change = null;
  if (withChange) {
    const c = readResult(rest[1], 'get-change');
    if (!c.ok) return 2;
    change = c.value;
  }
  for (const r of [result, change]) {
    if (r && r.ok === false) {
      process.stdout.write(`${JSON.stringify(r)}\n`);
      return 1;
    }
  }
  if (!result || !result.item || !result.item.id) {
    process.stderr.write('the input is not a get-item result: it has no item\n');
    return 2;
  }
  if (change && (!change.change || !change.change.id)) {
    process.stderr.write('the --change input is not a get-change result: it has no change\n');
    return 2;
  }
  process.stdout.write(`${JSON.stringify(nextStep(result, change))}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { nextStep, unanswered };
