#!/usr/bin/env node
// The next release version: the SemVer rule as one small, tested function, so
// the same history always proposes the same version. Deciding what kind each
// change is stays with the agent; this only applies the rule. It is
// provider-neutral: it reads plain JSON, not a provider's result.
//
//   node release.js next-version <input.json>   (use - for stdin)
//     input   {"since": "<last tag>" | null,
//              "changes": [{"id": "81", "title": "…", "kind": "breaking"|"feature"|"fix"}]}
//     exit 0  {"ok": true, "version", "tag", "bump", "reason", "since"}
//     exit 1  {"ok": false, "problem": "..."}
//   exit 2  wrong usage, or input that is not JSON
//
// From 1.0.0 on, breaking is major, feature is minor, and fix is patch.
// Before 1.0.0, breaking and feature are minor and fix is patch, so nothing
// reaches 1.0.0 by accident: that is a decision, not a bump. With no last
// tag, the first version is 0.1.0. The tag keeps the last tag's `v` prefix.

'use strict';

const fs = require('node:fs');

const KINDS = ['fix', 'feature', 'breaking'];
const INITIAL = '0.1.0';
const SEMVER = /^(v?)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseTag(tag) {
  const m = SEMVER.exec(String(tag).trim());
  if (!m) return null;
  return { prefix: m[1], major: Number(m[2]), minor: Number(m[3]), patch: Number(m[4]) };
}

function describe(change) {
  const title = change.title ? ` "${change.title}"` : '';
  return `${change.id}${title}`;
}

function failure(problem) {
  return { ok: false, problem };
}

// The next version after `since` (a tag, or null for the first release),
// decided by the highest kind among `changes`.
function nextVersion({ since = null, changes = [] } = {}) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return failure(since ? `Nothing to release: no changes since ${since}.` : 'Nothing to release: no changes.');
  }
  const unknown = changes.find((c) => !c || !KINDS.includes(c.kind));
  if (unknown) {
    return failure(`Change ${unknown && unknown.id} has kind "${unknown && unknown.kind}". Use one of: ${KINDS.join(', ')}.`);
  }

  if (since === null || since === undefined || since === '') {
    return {
      ok: true, version: INITIAL, tag: `v${INITIAL}`, bump: 'initial', since: null,
      reason: `There is no earlier release, so the first version is ${INITIAL}.`,
    };
  }

  const last = parseTag(since);
  if (!last) {
    return failure(`The last tag "${since}" is not a SemVer version such as v1.2.3, so the next version cannot be worked out from it.`);
  }

  const decider = changes.reduce((top, c) => (KINDS.indexOf(c.kind) > KINDS.indexOf(top.kind) ? c : top));
  const stable = last.major >= 1;
  let bump;
  let version;
  let rule;
  if (decider.kind === 'breaking' && stable) {
    bump = 'major';
    version = `${last.major + 1}.0.0`;
    rule = 'a breaking change raises the major version';
  } else if (decider.kind === 'fix') {
    bump = 'patch';
    version = `${last.major}.${last.minor}.${last.patch + 1}`;
    rule = 'only fixes raise the patch version';
  } else {
    bump = 'minor';
    version = `${last.major}.${last.minor + 1}.0`;
    rule = decider.kind === 'breaking'
      ? 'before 1.0.0 a breaking change raises the minor version'
      : 'a new feature raises the minor version';
  }
  return {
    ok: true, version, tag: `${last.prefix}${version}`, bump, since,
    reason: `Change ${describe(decider)} is ${decider.kind === 'fix' ? 'a fix' : decider.kind === 'feature' ? 'a feature' : 'breaking'}, and ${rule}.`,
  };
}

function main(argv) {
  const [command, file, ...rest] = argv;
  if (command !== 'next-version' || !file || rest.length) {
    process.stderr.write('usage: release.js next-version <input.json>   (use - for stdin)\n');
    return 2;
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(file === '-' ? 0 : file, 'utf8'));
  } catch (err) {
    process.stderr.write(`cannot read JSON from ${file}: ${err.message}\n`);
    return 2;
  }
  const result = nextVersion(input || {});
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { KINDS, INITIAL, parseTag, nextVersion };
