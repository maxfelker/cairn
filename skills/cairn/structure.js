#!/usr/bin/env node
// Structure checks for the work items Cairn writes. These are provider-neutral:
// they read a Markdown draft and say whether its shape is right, before any
// provider sees it.
//
// A draft is one Markdown file. The first line is `# <title>`, and the rest is
// the body.
//
//   node structure.js <kind> <draft.md>   (use - to read the draft from stdin)
//   node structure.js feature <draft.md> --for <the epic's persona names>
//   node structure.js comment <draft.md>   a comment has no "# <title>" line
//   node structure.js change <draft.md>    the description of a change for review
//   exit 0  {"ok": true, "kind": "...", "title": "...", "warnings": ["..."]}
//           "warnings" appears only when a draft may be written for the wrong
//           reader. A warning never blocks: only the author knows the audience.
//   exit 1  {"ok": false, "kind": "...", "problems": ["..."]}
//   exit 2  wrong usage

'use strict';

const fs = require('node:fs');

// Required epic sections, in reading order. Headings match without regard to
// case, using any of the listed names.
const EPIC_SECTIONS = [
  { key: 'why', label: 'Why', names: ['why', 'why it matters', 'why this matters'] },
  // Epics written before the Personas table keep their prose section.
  { key: 'who', label: 'Personas', names: ['personas', 'who it is for', 'who this is for', 'who'] },
  { key: 'in', label: 'In scope', names: ['in scope', 'scope'] },
  { key: 'out', label: 'Out of scope', names: ['out of scope', 'non-goals'] },
  { key: 'success', label: 'What success looks like', names: ['what success looks like', 'success'] },
  { key: 'criteria', label: 'Acceptance Criteria', names: ['acceptance criteria'] },
];

// Capabilities are written for whoever uses the product. A draft that talks
// about the people building it, or names a technical part as its actor, may
// have lost sight of that reader. These words can be right, as in a developer
// tool or a product delivered through a package manager, so they only warn.
const BUILDERS = /\b(developers?|devs?|engineers?|programmers?)\b/i;
const TECHNICAL_ACTORS = /\b(system|component|module|framework|foundation|infrastructure|pipeline|backend|api)\b/i;

function normalize(heading) {
  return heading.toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();
}

// Split a draft into its title and its `## ` sections.
function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const titleMatch = first >= 0 ? /^#\s+(.+?)\s*$/.exec(lines[first]) : null;
  const sections = [];
  const intro = [];
  let current = null;
  for (const line of lines.slice(first + 1)) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = { heading: h[1], name: normalize(h[1]), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  return { title: titleMatch ? titleMatch[1] : null, intro, sections };
}

// A reference to a child item, such as `#12` or `ABC-123`. After an epic is
// broken down, its criteria become references to its features.
const ITEM_REF = /^(#\d+|[A-Z][A-Z0-9]+-\d+)$/;

// Check the shape of one capability statement: "A <persona> can
// <capability>". `what` names it in messages. Returns a problem string, or null.
function capabilityProblem(text, what) {
  if (!/^an?\s+.+?\s+can\s+\S/i.test(text)) {
    return `${what} "${text}" is not a capability. Write it as "A <persona> can <do or perceive something>".`;
  }
  return null;
}

// Say when a well-shaped capability may be written for the people building
// the product instead of its users. `audience` names the epic's personas,
// when known. Returns a warning string, or null.
function capabilityWarning(text, what, audience = '') {
  const m = /^an?\s+(.+?)\s+can\s+(\S.*)$/i.exec(text);
  if (!m || BUILDERS.test(audience)) return null;
  const builder = BUILDERS.exec(text);
  if (builder) {
    return `${what} "${text}" mentions "${builder[0]}", but the epic's personas do not. Keep it only if they are the product's users.`;
  }
  const actor = TECHNICAL_ACTORS.exec(m[1]);
  if (actor) {
    return `${what} "${text}" has a technical actor ("${m[1]}"). Keep it only if that is who experiences the capability.`;
  }
  return null;
}

// Check one epic acceptance criterion. Returns a problem string, or null.
function criterionProblem(item) {
  if (ITEM_REF.test(item)) return null;
  return capabilityProblem(item, 'Acceptance criterion');
}

function criterionWarning(item, audience = '') {
  if (ITEM_REF.test(item)) return null;
  return capabilityWarning(item, 'Acceptance criterion', audience);
}

// A passing result, with its warnings when there are any.
function passed(kind, title, warnings) {
  return warnings.length ? { ok: true, kind, title, warnings } : { ok: true, kind, title };
}

// Cells of one Markdown table row, or null when the line is not a row.
function tableCells(line) {
  const row = line.trim();
  if (!row.startsWith('|')) return null;
  return row.replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

// Read a Personas table: a "Persona" column, then "Jobs to be done".
function personaTable(section) {
  const rows = section.lines.map(tableCells).filter(Boolean);
  const header = rows[0] ? rows[0].map((c) => c.toLowerCase()) : [];
  if (header.length !== 2 || header[0] !== 'persona' || header[1] !== 'jobs to be done') {
    return { problem: 'The "Personas" section must be a table with the columns "Persona" and "Jobs to be done".' };
  }
  const people = rows.slice(2).filter((r) => r.some((c) => c !== ''));
  if (people.length === 0) {
    return { problem: 'The "Personas" table has no rows. Add one row for each persona.' };
  }
  if (people.some((r) => r.length !== 2 || !r[0] || !r[1])) {
    return { problem: 'Each row of the "Personas" table needs a persona and its jobs to be done.' };
  }
  return { names: people.map((r) => r[0]).join(', ') };
}

function listItems(section) {
  return section.lines
    .map((l) => /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => m[1]);
}

const FEATURE_SECTIONS = [
  { key: 'behavior', label: 'Expected behavior', names: ['expected behavior', 'expected behaviour', 'behavior', 'behaviour'] },
  { key: 'criteria', label: 'Acceptance Criteria', names: ['acceptance criteria'] },
];

// A feature is one capability a persona gains. Its title is the capability
// statement, its body opens with plain prose restating it, and it lists the
// expected behavior and its acceptance criteria (the tasks that deliver it).
// `audience` names its epic's personas.
function checkFeature(text, { audience = '' } = {}) {
  const problems = [];
  const warnings = [];
  const { title, intro, sections } = parse(text);

  if (!title) {
    problems.push('The draft must start with a "# <title>" line.');
  } else {
    const problem = capabilityProblem(title, 'The title');
    const warning = capabilityWarning(title, 'The title', audience);
    if (warning) warnings.push(warning);
    if (problem) problems.push(problem);
    else if (/\b(and|or)\b/i.test(title.replace(/^an?\s+.+?\s+can\s+/i, ''))) {
      problems.push(`The title "${title}" has more than one capability ("and" or "or"). Split it into separate features.`);
    }
  }

  if (!intro.some((l) => l.trim() !== '' && !/^\s*([-*]|\d+\.)\s/.test(l))) {
    problems.push('Start the body with plain prose that restates the capability, before any heading.');
  }

  const found = {};
  for (const want of FEATURE_SECTIONS) {
    const section = sections.find((sec) => want.names.includes(sec.name));
    if (!section) problems.push(`Missing the "${want.label}" section. Add a "## ${want.label}" heading.`);
    else found[want.key] = section;
  }
  if (found.behavior && !found.behavior.lines.some((l) => l.trim() !== '')) {
    problems.push('The "Expected behavior" section is empty. Describe what the persona sees when it works.');
  }
  if (found.criteria) {
    if (listItems(found.criteria).length === 0) {
      problems.push('"Acceptance Criteria" has no items. List the tasks that deliver the capability, one per line.');
    }
  }

  return problems.length
    ? { ok: false, kind: 'feature', problems }
    : passed('feature', title, warnings);
}

const TASK_SECTIONS = [
  { key: 'guidance', label: 'Implementation guidance', names: ['implementation guidance', 'implementation', 'guidance', 'how'] },
  { key: 'validation', label: 'Validation', names: ['validation', 'how to validate', 'testing'] },
  { key: 'done', label: 'Done when', names: ['done when', 'done criteria', 'definition of done', 'done'] },
];

// A task is one engineering step behind a feature: the "how". Its title is
// an action, not a persona capability. Its body says what to do, how to
// validate it, and when it is done.
function checkTask(text) {
  const problems = [];
  const { title, intro, sections } = parse(text);

  if (!title) {
    problems.push('The draft must start with a "# <title>" line.');
  } else if (/^an?\s+.+?\s+can\s+/i.test(title)) {
    problems.push(`The title "${title}" is a persona capability, which makes it a feature. Name the engineering step instead, such as "Add …", or propose it as a feature.`);
  } else if (/^(a|an|the)\s/i.test(title)) {
    problems.push(`The title "${title}" should name an action. Start it with a verb, such as "Add …" or "Move …".`);
  }

  if (!intro.some((l) => l.trim() !== '' && !/^\s*([-*]|\d+\.)\s/.test(l))) {
    problems.push('Start the body with plain prose saying what this step does and why, before any heading.');
  }

  for (const want of TASK_SECTIONS) {
    const section = sections.find((sec) => want.names.includes(sec.name));
    if (!section) {
      problems.push(`Missing the "${want.label}" section. Add a "## ${want.label}" heading.`);
    } else if (want.key === 'done') {
      if (!section.lines.some((l) => /^\s*[-*]\s+\[[ xX]\]\s+\S/.test(l))) {
        problems.push('"Done when" needs at least one checklist item, such as "- [ ] …".');
      }
    } else if (!section.lines.some((l) => l.trim() !== '')) {
      problems.push(`The "${section.heading}" section is empty.`);
    }
  }

  return problems.length
    ? { ok: false, kind: 'task', problems }
    : { ok: true, kind: 'task', title };
}

function checkEpic(text) {
  const problems = [];
  const warnings = [];
  const { title, sections } = parse(text);

  if (!title) problems.push('The draft must start with a "# <title>" line.');

  const found = {};
  for (const want of EPIC_SECTIONS) {
    const section = sections.find((s) => want.names.includes(s.name));
    if (!section) {
      problems.push(`Missing the "${want.label}" section. Add a "## ${want.label}" heading.`);
      continue;
    }
    found[want.key] = section;
    if (want.key !== 'criteria' && !section.lines.some((l) => l.trim() !== '')) {
      problems.push(`The "${section.heading}" section is empty. Explain it in plain prose.`);
    }
  }

  const criteria = found.criteria;
  if (criteria) {
    if (sections[sections.length - 1] !== criteria) {
      problems.push('"Acceptance Criteria" must be the last section.');
    }
    const items = listItems(criteria);
    if (items.length === 0) {
      problems.push('"Acceptance Criteria" has no items. List each capability as "- [ ] A <persona> can …".');
    }
    let audience = found.who ? found.who.lines.join('\n') : '';
    if (found.who && found.who.name === 'personas' && audience.trim()) {
      const table = personaTable(found.who);
      if (table.problem) problems.push(table.problem);
      else audience = table.names;
    }
    for (const item of items) {
      const problem = criterionProblem(item);
      if (problem) problems.push(problem);
      const warning = criterionWarning(item, audience);
      if (warning) warnings.push(warning);
    }
  }

  return problems.length
    ? { ok: false, kind: 'epic', problems }
    : passed('epic', title, warnings);
}

// A comment is one of three kinds, named on its first line as
// "**<Kind>:** <the bottom line>". The rest is plain prose: short sentences
// and no labeled lines. A decision goes on to say why, and a blocker goes on
// to say what is needed to continue.
// Progress has no kind: it is reported once, by the feature-completed summary.
const COMMENT_KINDS = ['Decision', 'Question', 'Blocked'];
const COMMENT_NEEDS = {
  Decision: 'After the first line, say why in a sentence or two.',
  Blocked: 'After the first line, say what failed and what is needed to continue.',
};
const MAX_SENTENCE_WORDS = 25;

// Sentences of a comment, for the length check. Code spans and links count
// as one word each, and each list item is its own sentence.
function sentences(text) {
  return text
    .replace(/`[^`]*`/g, 'code')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function checkComment(text) {
  const problems = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trim() !== '');
  const first = at === -1 ? '' : lines[at].trim();
  const rest = at === -1 ? [] : lines.slice(at + 1);
  const m = /^\*\*([A-Za-z]+):\*\*\s*(.*)$/.exec(first);
  const kind = m && COMMENT_KINDS.find((k) => k.toLowerCase() === m[1].toLowerCase());

  if (!m || !kind) {
    problems.push(`Start the comment with its kind: "**<Kind>:** <the bottom line>", where the kind is ${COMMENT_KINDS.join(', ')}.`);
  } else {
    if (!m[2].trim()) problems.push(`Put the bottom line on the first line, after "**${kind}:**".`);
    if (COMMENT_NEEDS[kind] && !rest.some((l) => l.trim() !== '')) {
      problems.push(`A ${kind.toLowerCase()} needs more than its first line. ${COMMENT_NEEDS[kind]}`);
    }
    const label = rest.find((l) => /^\*\*[^*]+:\*\*/.test(l.trim()));
    if (label) problems.push(`Write "${label.trim().slice(0, 40)}" as a sentence, not a labeled line. Only the kind on the first line is a label.`);
    const body = [m[2], ...rest].join('\n');
    for (const s of sentences(body)) {
      const words = s.split(' ').length;
      if (words > MAX_SENTENCE_WORDS) {
        problems.push(`Split this sentence. It has ${words} words, and the limit is ${MAX_SENTENCE_WORDS}: "${s.slice(0, 60)}…"`);
      }
    }
  }

  return problems.length
    ? { ok: false, kind: 'comment', problems }
    : { ok: true, kind: 'comment', comment: kind.toLowerCase() };
}

// The description of a change for review. It opens with the bottom line in
// plain prose, for a reader who stops there. The detail follows, then how a
// person or an agent can test the change and what they should see.
const CHANGE_SECTIONS = [
  { key: 'what', label: 'What changed', names: ['what changed'], required: true },
  { key: 'highlights', label: 'Highlights', names: ['highlights'], required: false },
  { key: 'test', label: 'How to test', names: ['how to test', 'how to test it'], required: true },
  { key: 'validated', label: 'How it was validated', names: ['how it was validated', 'validation'], required: true },
  { key: 'tradeoffs', label: 'Trade-offs and follow-up', names: ['trade-offs and follow-up', 'tradeoffs and follow-up', 'trade-offs and follow-ups', 'trade-offs'], required: true },
];
const MAX_OPENING_SENTENCES = 4;
const LIST_LINE = /^\s*(?:[-*+]|\d+\.)\s/;
const withoutCode = (lines) => lines.join('\n').replace(/```[\s\S]*?```/g, '');

function longSentences(text, where) {
  return sentences(text)
    .filter((s) => s.split(' ').length > MAX_SENTENCE_WORDS)
    .map((s) => `Split this sentence in ${where}. It has ${s.split(' ').length} words, and the limit is ${MAX_SENTENCE_WORDS}: "${s.slice(0, 60)}…"`);
}

function checkChange(text) {
  const problems = [];
  const { title, intro, sections } = parse(text);
  if (!title) problems.push('Start the draft with "# <title>": a short statement of what the change does.');

  const opening = intro.filter((l) => l.trim() !== '');
  if (opening.length === 0) {
    problems.push('Open with the bottom line, before any heading: one to three plain sentences on what the change does for the person who uses it.');
  } else if (opening.some((l) => LIST_LINE.test(l) || /^\s*[|>#]/.test(l))) {
    problems.push('Write the opening as plain sentences, not as a list, a table, or a quote.');
  } else {
    const count = sentences(opening.join('\n')).length;
    if (count > MAX_OPENING_SENTENCES) problems.push(`Shorten the opening. It has ${count} sentences, and the limit is ${MAX_OPENING_SENTENCES}. Move the detail under "## What changed".`);
    problems.push(...longSentences(opening.join('\n'), 'the opening'));
  }

  const found = {};
  let last = -1;
  for (const spec of CHANGE_SECTIONS) {
    const at = sections.findIndex((sec) => spec.names.includes(sec.name));
    if (at === -1) {
      if (spec.required) problems.push(`Add a "## ${spec.label}" section.`);
      continue;
    }
    if (at < last) problems.push(`Move "## ${spec.label}" so the sections are in this order: ${CHANGE_SECTIONS.map((c) => c.label).join(', ')}.`);
    last = Math.max(last, at);
    found[spec.key] = sections[at];
    if (!sections[at].lines.some((l) => l.trim() !== '')) problems.push(`"## ${spec.label}" is empty.`);
  }

  if (found.what) {
    const first = found.what.lines.find((l) => l.trim() !== '') || '';
    if (LIST_LINE.test(first) || /^\s*\|/.test(first)) {
      problems.push('Start "## What changed" with a paragraph that explains the change in terms a user understands. Keep lists for "## Highlights".');
    }
    problems.push(...longSentences(withoutCode(found.what.lines), '"## What changed"'));
  }
  if (found.highlights && !found.highlights.lines.some((l) => LIST_LINE.test(l))) {
    problems.push('Write "## Highlights" as a short list: one line for each thing worth knowing.');
  }
  if (found.test && !/```[\s\S]*?```|!\[[^\]]*\]\([^)]+\)|<img\s/.test(found.test.lines.join('\n'))) {
    problems.push('Show how to test the change in "## How to test": the commands to run and the result to expect, in a code block. For a change people see, add a screenshot.');
  }

  return problems.length
    ? { ok: false, kind: 'change', problems }
    : { ok: true, kind: 'change', title };
}

const CHECKS = { epic: checkEpic, feature: checkFeature, task: checkTask, comment: checkComment, change: checkChange };

function main(argv) {
  const [kind, file, ...rest] = argv;
  const audience = kind === 'feature' && rest.length === 2 && rest[0] === '--for' ? rest[1] : null;
  if (!CHECKS[kind] || !file || (rest.length && audience === null)) {
    process.stderr.write(`usage: structure.js <${Object.keys(CHECKS).join('|')}> <draft.md>   (feature also takes --for <the epic's persona names>)\n`);
    return 2;
  }
  let text;
  try {
    text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (err) {
    process.stderr.write(`cannot read ${file}: ${err.message}\n`);
    return 2;
  }
  const result = CHECKS[kind](text, { audience: audience || '' });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { parse, checkEpic, checkFeature, checkTask, checkComment, checkChange, COMMENT_KINDS, CHANGE_SECTIONS, criterionProblem, EPIC_SECTIONS, FEATURE_SECTIONS, TASK_SECTIONS };
