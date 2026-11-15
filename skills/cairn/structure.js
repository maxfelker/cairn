#!/usr/bin/env node
// Structure checks for the work items Cairn writes. These are provider-neutral:
// they read a Markdown draft and say whether its shape is right, before any
// provider sees it.
//
// A draft is one Markdown file. The first line is `# <title>`, and the rest is
// the body.
//
//   node structure.js <kind> <draft.md>   (use - to read the draft from stdin)
//   exit 0  {"ok": true, "kind": "...", "title": "..."}
//   exit 1  {"ok": false, "kind": "...", "problems": ["..."]}
//   exit 2  wrong usage

'use strict';

const fs = require('node:fs');

// Required epic sections, in reading order. Headings match without regard to
// case, using any of the listed names.
const EPIC_SECTIONS = [
  { key: 'why', label: 'Why', names: ['why', 'why it matters', 'why this matters'] },
  { key: 'who', label: 'Who it is for', names: ['who it is for', 'who this is for', 'who'] },
  { key: 'in', label: 'In scope', names: ['in scope', 'scope'] },
  { key: 'out', label: 'Out of scope', names: ['out of scope', 'non-goals'] },
  { key: 'success', label: 'What success looks like', names: ['what success looks like', 'success'] },
  { key: 'criteria', label: 'Acceptance Criteria', names: ['acceptance criteria'] },
];

// Personas experience a capability. Builders and system parts do not.
const NOT_PERSONAS = /^(developers?|devs?)$/i;
const SYSTEM_WORDS = /\b(system|component|module|service|manager|framework|foundation|infrastructure|pipeline|backend|api)\b/i;

function normalize(heading) {
  return heading.toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();
}

// Split a draft into its title and its `## ` sections.
function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const titleMatch = first >= 0 ? /^#\s+(.+?)\s*$/.exec(lines[first]) : null;
  const sections = [];
  let current = null;
  for (const line of lines.slice(first + 1)) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = { heading: h[1], name: normalize(h[1]), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return { title: titleMatch ? titleMatch[1] : null, sections };
}

// Check one acceptance criterion. Returns a problem string, or null.
function criterionProblem(item) {
  const m = /^an?\s+(.+?)\s+can\s+(\S.*)$/i.exec(item);
  if (!m) {
    return `Acceptance criterion "${item}" is not a capability. Write it as "A <persona> can <do or perceive something>".`;
  }
  const persona = m[1];
  if (NOT_PERSONAS.test(persona)) {
    return `Acceptance criterion "${item}" uses "${persona}" as the persona. A developer is not a persona: name who experiences the capability, or move this work to a task.`;
  }
  if (SYSTEM_WORDS.test(persona)) {
    return `Acceptance criterion "${item}" names a system part ("${persona}") as the persona. Name the person or actor who experiences it.`;
  }
  return null;
}

function checkEpic(text) {
  const problems = [];
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
    const items = criteria.lines
      .map((l) => /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(l))
      .filter(Boolean)
      .map((m) => m[1]);
    if (items.length === 0) {
      problems.push('"Acceptance Criteria" has no items. List each capability as "- [ ] A <persona> can …".');
    }
    for (const item of items) {
      const problem = criterionProblem(item);
      if (problem) problems.push(problem);
    }
  }

  return problems.length
    ? { ok: false, kind: 'epic', problems }
    : { ok: true, kind: 'epic', title };
}

const CHECKS = { epic: checkEpic };

function main(argv) {
  const [kind, file, ...rest] = argv;
  if (!CHECKS[kind] || !file || rest.length) {
    process.stderr.write(`usage: structure.js <${Object.keys(CHECKS).join('|')}> <draft.md>\n`);
    return 2;
  }
  let text;
  try {
    text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (err) {
    process.stderr.write(`cannot read ${file}: ${err.message}\n`);
    return 2;
  }
  const result = CHECKS[kind](text);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { parse, checkEpic, criterionProblem, EPIC_SECTIONS };
