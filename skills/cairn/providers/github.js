#!/usr/bin/env node
// GitHub provider adapter. It implements contract.md over `git` and `gh`,
// using the user's existing `gh` login.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { KINDS, BASE, git, currentBranch, gitMessage, sleep, run, fail, gitRemote, readDraft, readBody, flags, cli, matchItems } = require('./lib.js');

const PROVIDER = 'github';
const HOST = 'github.com';

// Parse a git remote URL into { host, owner, name }, or null if it is not an
// owner/name remote. Handles scp-style (git@host:o/r.git) and URL forms
// (https://, ssh://, git://), with or without .git and trailing slashes.
function parseRemote(url) {
  if (typeof url !== 'string') return null;
  const value = url.trim();
  let host;
  let repoPath;

  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(value);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null;
    host = parsed.hostname;
    repoPath = parsed.pathname;
  }

  const parts = repoPath.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').split('/');
  if (parts.length !== 2 || parts.some((p) => !p)) return null;
  return { host: host.toLowerCase(), owner: parts[0], name: parts[1] };
}

function target({ exec = run, cwd } = {}) {
  const remote = gitRemote({ exec, cwd });
  if (!remote.ok) return remote;

  const parsed = parseRemote(remote.url);
  if (!parsed || parsed.host !== HOST) {
    return fail(
      'NOT_THIS_PROVIDER',
      `The ${remote.remote} remote (${remote.url}) is not a ${HOST} repository.`,
      `Use a ${HOST} remote, for example: git remote set-url ${remote.remote} git@github.com:OWNER/REPO.git`,
    );
  }
  return {
    ok: true,
    provider: PROVIDER,
    target: `${parsed.owner}/${parsed.name}`,
    owner: parsed.owner,
    name: parsed.name,
    remote: remote.remote,
  };
}

const LOGIN_FIX = 'Run gh auth login (in Claude Code, type: ! gh auth login), then ask again.';

// Is gh logged in to github.com? `gh auth status --json` exits 0 either way,
// so read the active account's state. Only login and state are read.
// Tokens, token sources, and scopes are never copied into the result.
function auth({ exec = run } = {}) {
  const r = exec('gh', ['auth', 'status', '--json', 'hosts', '--hostname', HOST]);
  if (r.missing) {
    return fail('CLI_MISSING', 'The GitHub CLI (gh) is not installed.', 'Install it from https://cli.github.com, then run gh auth login.');
  }
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return fail('CLI_MISSING', 'This version of the GitHub CLI cannot report login status as JSON.', 'Update gh from https://cli.github.com.');
  }
  const accounts = (data && data.hosts && data.hosts[HOST]) || [];
  const active = accounts.find((a) => a.active);
  if (!active) {
    return fail('NOT_LOGGED_IN', `gh is not logged in to ${HOST}.`, LOGIN_FIX);
  }
  if (active.state !== 'success') {
    return fail('NOT_LOGGED_IN', `The gh login for ${active.login} on ${HOST} is not working (${active.state}).`, LOGIN_FIX);
  }
  return { ok: true, provider: PROVIDER, login: active.login };
}

// GitHub repository roles, lowest first.
const LEVELS = ['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'];

// The lowest role each contract action needs, and whether it needs issues
// turned on. Add a row only when a feature needs it, and test every row.
const ACTIONS = {
  comment: { level: 'READ', doing: 'commenting' },
  'create-item': { level: 'READ', issues: true, doing: 'creating issues' },
  label: { level: 'TRIAGE', issues: true, doing: 'labeling issues' },
  'link-child': { level: 'TRIAGE', issues: true, doing: 'linking sub-issues' },
  push: { level: 'WRITE', doing: 'pushing a branch' },
  'propose-change': { level: 'WRITE', doing: 'opening a pull request' },
};

function rank(level) {
  return LEVELS.indexOf(level);
}

// What may the user do on the repository? With `action`, check that one
// action before Cairn attempts it, and name the gap in plain language.
function access({ exec = run, cwd, repo, action } = {}) {
  if (action !== undefined && !ACTIONS[action]) {
    return fail('UNKNOWN_ACTION', `The GitHub provider does not know the action "${action}".`, `Use one of: ${Object.keys(ACTIONS).join(', ')}.`);
  }
  if (!repo) {
    const t = target({ exec, cwd });
    if (!t.ok) return t;
    repo = t.target;
  }

  const r = exec('gh', ['repo', 'view', repo, '--json', 'nameWithOwner,viewerPermission,hasIssuesEnabled'], { cwd });
  if (r.missing) {
    return fail('CLI_MISSING', 'The GitHub CLI (gh) is not installed.', 'Install it from https://cli.github.com, then run gh auth login.');
  }
  if (!r.ok) {
    if (/gh auth login/.test(r.stderr)) return fail('NOT_LOGGED_IN', `gh is not logged in to ${HOST}.`, LOGIN_FIX);
    return fail(
      'TARGET_UNAVAILABLE',
      `${repo} was not found, or your gh account cannot see it.`,
      `Check the remote URL, or ask an owner of ${repo} for access.`,
    );
  }

  const data = JSON.parse(r.stdout);
  const permission = LEVELS.includes(data.viewerPermission) ? data.viewerPermission : 'NONE';
  const issues = data.hasIssuesEnabled === true;
  const can = (a) => rank(permission) >= rank(ACTIONS[a].level) && (!ACTIONS[a].issues || issues);
  const allowed = Object.keys(ACTIONS).filter(can);

  if (action !== undefined && !can(action)) {
    const need = ACTIONS[action];
    if (need.issues && !issues) {
      return fail('FEATURE_DISABLED', `Issues are turned off for ${data.nameWithOwner}, so ${need.doing} is not possible.`, `A repository admin can turn on Issues in ${data.nameWithOwner}'s Settings → General → Features.`);
    }
    return fail(
      'MISSING_PERMISSION',
      `You have ${permission} access to ${data.nameWithOwner}; ${need.doing} needs ${need.level}.`,
      `Ask a repository admin for ${need.level} access to ${data.nameWithOwner}.`,
    );
  }

  return { ok: true, provider: PROVIDER, target: data.nameWithOwner, permission, issues, allowed };
}

// Everything the setup check needs, in one call. A failed step leaves the
// steps after it with that same failure, instead of extra calls that fail
// the same way.
function check({ exec = run, cwd } = {}) {
  const t = target({ exec, cwd });
  const a = auth({ exec });
  let acc;
  if (!t.ok) acc = t;
  else if (!a.ok) acc = a;
  else acc = access({ exec, cwd, repo: t.target });

  const first = [t, a, acc].find((r) => !r.ok);
  const head = first
    ? { ok: false, code: first.code, message: first.message, fix: first.fix }
    : { ok: true, provider: PROVIDER };
  return { ...head, target: t, auth: a, access: acc };
}

// Kind labels: the backup on typed items, and the only marker where no type
// exists. Colors apply only when Cairn creates the label. An existing label is
// never changed.
const KIND_LABELS = {
  bug: { color: 'D73A4A', description: 'Something is not working' },
  epic: { color: '3E4B9E', description: 'Why the work exists and what success looks like' },
  feature: { color: '0E8A16', description: 'A capability a persona gains' },
  task: { color: 'C5DEF5', description: 'An engineering step that delivers a feature' },
};

function providerError(what, r) {
  const detail = (r.stderr || r.stdout || '').trim().split('\n')[0] || 'no details';
  return fail('PROVIDER_ERROR', `GitHub rejected ${what}: ${detail}`, 'Check the message above, then try again.');
}

// Run `gh api` and parse its JSON. `body` is sent as the JSON request body.
function api({ exec, cwd }, args, body) {
  const full = ['api', ...args];
  if (body !== undefined) full.push('--input', '-');
  const r = exec('gh', full, { cwd, input: body === undefined ? undefined : JSON.stringify(body) });
  if (r.missing) return { ok: false, result: fail('CLI_MISSING', 'The GitHub CLI (gh) is not installed.', 'Install it from https://cli.github.com, then run gh auth login.') };
  if (!r.ok) {
    if (/gh auth login/.test(r.stderr)) return { ok: false, result: fail('NOT_LOGGED_IN', `gh is not logged in to ${HOST}.`, LOGIN_FIX) };
    return { ok: false, r };
  }
  return { ok: true, data: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

// GET every page of a list endpoint. `extra` adds flags, such as a header.
function apiList(ctx, url, extra = []) {
  const res = api(ctx, ['--paginate', '--slurp', ...extra, url]);
  if (res.ok) res.data = res.data.flat();
  return res;
}

// The repository's enabled issue type names. Empty when the repository has
// none, or when the GitHub host doesn't support issue types.
function issueTypes(ctx, repo) {
  const [owner, name] = repo.split('/');
  const query = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { issueTypes(first: 50) { nodes { name isEnabled } } } }';
  const res = api(ctx, ['graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`]);
  const nodes = res.ok && res.data && res.data.data && res.data.data.repository && res.data.data.repository.issueTypes
    ? res.data.data.repository.issueTypes.nodes
    : [];
  return nodes.filter((n) => n.isEnabled).map((n) => n.name);
}

// How a kind is recorded on GitHub: the native issue type with the same name
// if the repository has one, with the kind label as a backup. Without a type,
// the label alone.
function kindSpec(kind, types) {
  const type = types.find((t) => t.toLowerCase() === kind);
  return type ? { via: 'type', type, label: kind } : { via: 'label', label: kind };
}

// Create the label, or confirm it exists. Uses no --force, which would
// overwrite an existing label's color and description.
function ensureLabel({ exec, repo, kind }) {
  const { color, description } = KIND_LABELS[kind];
  const r = exec('gh', ['label', 'create', kind, '--repo', repo, '--color', color, '--description', description]);
  if (r.ok || /already exists/.test(r.stderr)) return { ok: true };
  return providerError(`creating the "${kind}" label`, r);
}

function toItem(issue) {
  return { id: String(issue.number), url: issue.html_url, title: issue.title };
}

// Open issues of one kind, oldest first. In a repository with types this
// matches the type OR the legacy label, so older label-only issues are found.
// Uses the issue listing, not search, because GitHub's search index lags
// behind new issues.
function openOfKind(ctx, repo, spec) {
  const queries = [`labels=${encodeURIComponent(spec.label)}`];
  if (spec.via === 'type') queries.unshift(`type=${encodeURIComponent(spec.type)}`);
  const byNumber = new Map();
  for (const q of queries) {
    const res = apiList(ctx, `repos/${repo}/issues?state=open&per_page=100&${q}`);
    if (!res.ok) return res;
    for (const issue of res.data) {
      if (!issue.pull_request) byNumber.set(issue.number, issue);
    }
  }
  return { ok: true, data: [...byNumber.values()].sort((a, b) => a.number - b.number) };
}

function failed(res, what) {
  return res.result || providerError(what, res.r);
}

// Open items of one kind, oldest first.
function listItems({ exec = run, cwd, kind } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const ctx = { exec, cwd };
  const spec = kindSpec(kind, issueTypes(ctx, t.target));
  const res = openOfKind(ctx, t.target, spec);
  if (!res.ok) return failed(res, `listing ${kind} issues`);
  return { ok: true, provider: PROVIDER, kind, via: spec.via, items: res.data.map(toItem) };
}

function isKind(issue, spec) {
  return (spec.via === 'type' && issue.type && issue.type.name === spec.type)
    || issue.labels.some((l) => (typeof l === 'string' ? l : l.name) === spec.label);
}

const sameTitle = (a, b) => a.trim() === b.trim();

// Find the existing item to update. With a parent, look among the parent's
// open children of this kind. Then look for an orphan of this kind with
// the same title and no parent, such as one left by a run that stopped
// before linking.
function findExisting(ctx, repo, spec, title, parent) {
  if (parent) {
    const kids = apiList(ctx, `repos/${repo}/issues/${parent}/sub_issues?per_page=100`);
    if (!kids.ok) return kids;
    const child = kids.data.find((i) => i.state === 'open' && isKind(i, spec) && sameTitle(i.title, title));
    if (child) return { ok: true, issue: child, linked: true };
  }
  const open = openOfKind(ctx, repo, spec);
  if (!open.ok) return open;
  for (const issue of open.data.filter((i) => sameTitle(i.title, title))) {
    if (!parent) return { ok: true, issue, linked: false };
    const p = api(ctx, [`repos/${repo}/issues/${issue.number}/parent`]);
    if (!p.ok && p.r && /404|Not Found/.test(p.r.stderr)) return { ok: true, issue, linked: false };
  }
  return { ok: true, issue: null, linked: false };
}

// Link a child under a parent. GitHub's sub_issue_id is the child's
// database id, not its issue number. An existing link counts as success.
function linkChild(ctx, repo, parent, child) {
  const res = api(ctx, ['-X', 'POST', `repos/${repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${child.id}`]);
  if (res.ok || (res.r && /duplicate sub-issues/.test(res.r.stderr))) return { ok: true };
  return failed(res, `linking #${child.number} under #${parent}`);
}

// Create a work item, or update the open one of the same kind and title.
// With `parent`, the item is a child of that item: duplicates are matched
// among its children, and a new item is linked under it.
function saveItem({ exec = run, cwd, kind, file, parent } = {}) {
  const draft = readDraft(file);
  if (!draft.ok) return draft;

  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  for (const action of parent ? ['create-item', 'label', 'link-child'] : ['create-item', 'label']) {
    const a = access({ exec, cwd, repo, action });
    if (!a.ok) return a;
  }

  if (parent) {
    const p = api(ctx, [`repos/${repo}/issues/${parent}`]);
    if (!p.ok) {
      if (p.result) return p.result;
      return fail('TARGET_UNAVAILABLE', `Parent #${parent} was not found in ${repo}.`, 'Check the parent item number.');
    }
  }

  // The type is the kind where one exists. The label is always set too,
  // as a backup that any tool or filter can read.
  const spec = kindSpec(kind, issueTypes(ctx, repo));
  const label = ensureLabel({ exec, repo, kind });
  if (!label.ok) return label;

  const found = findExisting(ctx, repo, spec, draft.title, parent);
  if (!found.ok) return failed(found, `listing ${kind} issues`);
  const existing = found.issue;

  const res = existing
    ? api(ctx, ['-X', 'PATCH', `repos/${repo}/issues/${existing.number}`], { body: draft.body })
    : api(ctx, ['-X', 'POST', `repos/${repo}/issues`], {
      title: draft.title,
      body: draft.body,
      labels: [spec.label],
      ...(spec.via === 'type' ? { type: spec.type } : {}),
    });
  if (!res.ok) return failed(res, existing ? `updating #${existing.number}` : `creating the ${kind}`);

  // An existing item missing the backup label gets it added. POST adds to
  // the label set, whereas PATCH with labels would replace it.
  if (existing && !existing.labels.some((l) => (typeof l === 'string' ? l : l.name) === spec.label)) {
    const add = api(ctx, ['-X', 'POST', `repos/${repo}/issues/${existing.number}/labels`], { labels: [spec.label] });
    if (!add.ok) return failed(add, `labeling #${existing.number}`);
  }

  const result = { ok: true, provider: PROVIDER, kind, via: spec.via, created: !existing, item: toItem(res.data) };
  if (parent) {
    const link = found.linked ? { ok: true } : linkChild(ctx, repo, parent, res.data);
    if (!link.ok) return link;
    result.parent = String(parent);
    result.linked = !found.linked;
  }
  return result;
}

// The contract kind of an issue: its type if that names a kind, otherwise
// a legacy kind label, otherwise null.
function kindOf(issue) {
  const type = issue.type && issue.type.name.toLowerCase();
  if (KINDS.includes(type)) return type;
  const label = issue.labels.map((l) => (typeof l === 'string' ? l : l.name)).find((l) => KINDS.includes(l));
  return label || null;
}

// The pull requests that close an issue, merged or not: the contract's
// "changes". Only GraphQL exposes this link.
function closingChanges(ctx, repo, id) {
  const [owner, name] = repo.split('/');
  const query = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { closedByPullRequestsReferences(first: 50, includeClosedPrs: true) { nodes { number url state } } } } }';
  const res = api(ctx, ['graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${id}`]);
  if (!res.ok) return res;
  const nodes = res.data.data.repository.issue.closedByPullRequestsReferences.nodes;
  return { ok: true, data: nodes.map((n) => ({ id: String(n.number), url: n.url, state: n.state.toLowerCase() })) };
}

// One item, with its comments, children, parent, and closing changes, for
// reading before planning or summarizing.
function getItem({ exec = run, cwd, id } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  const issue = api(ctx, ['-H', FULL, `repos/${repo}/issues/${id}`]);
  if (!issue.ok) {
    if (issue.result) return issue.result;
    return fail('TARGET_UNAVAILABLE', `#${id} was not found in ${repo}, or your gh account cannot see it.`, 'Check the item number.');
  }
  const comments = apiList(ctx, `repos/${repo}/issues/${id}/comments?per_page=100`, ['-H', FULL]);
  if (!comments.ok) return failed(comments, `reading comments on #${id}`);
  const children = apiList(ctx, `repos/${repo}/issues/${id}/sub_issues?per_page=100`);
  if (!children.ok) return failed(children, `reading sub-issues of #${id}`);
  const parent = api(ctx, [`repos/${repo}/issues/${id}/parent`]);
  if (!parent.ok && !(parent.r && /404/.test(parent.r.stderr))) return failed(parent, `reading the parent of #${id}`);
  const changes = closingChanges(ctx, repo, id);
  if (!changes.ok) return failed(changes, `reading the pull requests that close #${id}`);

  const i = issue.data;
  return {
    ok: true,
    provider: PROVIDER,
    item: { ...toItem(i), kind: kindOf(i), state: i.state, body: i.body || '', images: imagesOf(i.body_html), parent: parent.ok ? String(parent.data.number) : null },
    comments: comments.data.map((c) => ({ id: String(c.id), author: c.user && c.user.login, body: c.body, url: c.html_url, cairn: isCairn(c.body), images: imagesOf(c.body_html) })),
    children: children.data.map((c) => ({ id: String(c.number), title: c.title, kind: kindOf(c), state: c.state })),
    changes: changes.data,
  };
}

// The fields find-item reports for each match.
function toMatch(issue) {
  return { id: String(issue.number), title: issue.title, kind: kindOf(issue), state: issue.state, url: issue.html_url };
}

// Turn what the user said into an item in this repository: a number
// ("42" or "#42"), an issue URL, or a plain description matched against
// open issue titles. Reads the open issue listing rather than search,
// because GitHub's search index lags behind new issues.
function findItem({ exec = run, cwd, query } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };
  const text = query.trim();
  const done = (matches, exact) => ({ ok: true, provider: PROVIDER, query: text, matches, exact });

  let id = (/^#?(\d+)$/.exec(text) || [])[1];
  if (!id && /^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      url = null;
    }
    const parts = url ? url.pathname.replace(/^\/+|\/+$/g, '').split('/') : [];
    const there = url && url.hostname.toLowerCase() === HOST && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    if (!there || there.toLowerCase() !== repo.toLowerCase()) {
      return fail(
        'NOT_THIS_PROVIDER',
        `${text} is not in ${repo}, the repository this clone works on.`,
        `Give an item in ${repo}, or run Cairn from a clone of the repository that link points to.`,
      );
    }
    if (parts.length !== 4 || parts[2] !== 'issues' || !/^\d+$/.test(parts[3])) {
      return fail('TARGET_UNAVAILABLE', `${text} is not a link to an issue in ${repo}.`, `Link to an issue, such as https://${HOST}/${repo}/issues/42.`);
    }
    id = parts[3];
  }

  if (id) {
    const issue = api(ctx, [`repos/${repo}/issues/${id}`]);
    if (!issue.ok) {
      if (issue.result) return issue.result;
      return fail('TARGET_UNAVAILABLE', `#${id} was not found in ${repo}, or your gh account cannot see it.`, 'Check the item number.');
    }
    if (issue.data.pull_request) {
      return fail(
        'TARGET_UNAVAILABLE',
        `#${id} is a pull request, not a work item.`,
        'Name the issue it delivers, or ask to address the feedback on the pull request.',
      );
    }
    return done([toMatch(issue.data)], true);
  }

  const open = apiList(ctx, `repos/${repo}/issues?state=open&per_page=100`);
  if (!open.ok) return failed(open, 'listing open issues');
  const { matches, exact } = matchItems(text, open.data.filter((i) => !i.pull_request).map(toMatch));
  return done(matches, exact);
}

function findItemArgs(args) {
  const f = flags(args, ['query']);
  if (!f || !f.query || !f.query.trim()) return null;
  return findItem({ query: f.query });
}

function getItemArgs(args) {
  const f = flags(args, ['id']);
  if (!f || !/^\d+$/.test(f.id || '')) return null;
  return getItem({ id: f.id });
}

// Put the listed children first, in that order. Unlisted children keep
// their relative order after them. Moves only children that are out of
// place, using GitHub's native reprioritize endpoint with database ids.
function orderChildren({ exec = run, cwd, parent, ids } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  const a = access({ exec, cwd, repo, action: 'link-child' });
  if (!a.ok) return a;

  const kids = apiList(ctx, `repos/${repo}/issues/${parent}/sub_issues?per_page=100`);
  if (!kids.ok) {
    if (kids.result) return kids.result;
    return fail('TARGET_UNAVAILABLE', `#${parent} was not found in ${repo}.`, 'Check the parent item number.');
  }
  const byNumber = new Map(kids.data.map((k) => [String(k.number), k]));
  const missing = ids.filter((id) => !byNumber.has(id));
  if (missing.length) {
    return fail('TARGET_UNAVAILABLE', `Not children of #${parent}: ${missing.map((m) => `#${m}`).join(', ')}.`, `Link them under #${parent} first, or leave them out of the order.`);
  }

  const current = kids.data.map((k) => String(k.number));
  const desired = [...ids, ...current.filter((n) => !ids.includes(n))];
  const order = [...current];
  let moved = 0;
  for (let i = 0; i < desired.length; i += 1) {
    if (order[i] === desired[i]) continue;
    const child = byNumber.get(desired[i]);
    const anchor = i === 0 ? { before_id: byNumber.get(order[0]).id } : { after_id: byNumber.get(desired[i - 1]).id };
    const res = api(ctx, ['-X', 'PATCH', `repos/${repo}/issues/${parent}/sub_issues/priority`], { sub_issue_id: child.id, ...anchor });
    if (!res.ok) return failed(res, `moving #${desired[i]} under #${parent}`);
    order.splice(order.indexOf(desired[i]), 1);
    order.splice(i, 0, desired[i]);
    moved += 1;
  }
  return { ok: true, provider: PROVIDER, parent: String(parent), order: desired, moved };
}

function orderChildrenArgs(args) {
  const f = flags(args, ['parent', 'ids']);
  if (!f || !/^\d+$/.test(f.parent || '') || !/^\d+(,\d+)*$/.test(f.ids || '')) return null;
  const ids = f.ids.split(',');
  if (new Set(ids).size !== ids.length) return null;
  return orderChildren({ parent: f.parent, ids });
}

// Every Cairn comment ends with a hidden marker, so people and tools can tell
// it is Cairn's. A keyed marker makes a comment updatable: posting with the
// same key edits that comment instead of adding another.
function marker(key) {
  return key ? `<!-- cairn key=${key} -->` : '<!-- cairn -->';
}

function comment({ exec = run, cwd, id, file, key } = {}) {
  const body = readBody(file);
  if (!body.ok) return body;

  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  const a = access({ exec, cwd, repo, action: 'comment' });
  if (!a.ok) return a;

  const issue = api(ctx, [`repos/${repo}/issues/${id}`]);
  if (!issue.ok) {
    if (issue.result) return issue.result;
    return fail('TARGET_UNAVAILABLE', `#${id} was not found in ${repo}.`, 'Check the item number.');
  }

  const mark = marker(key);
  const text = `${body.text}\n\n${mark}`;

  let existing = null;
  if (key) {
    const list = apiList(ctx, `repos/${repo}/issues/${id}/comments?per_page=100`);
    if (!list.ok) return failed(list, `reading comments on #${id}`);
    existing = list.data.find((c) => (c.body || '').split('\n').some((line) => line.trim() === mark)) || null;
  }

  const toComment = (c) => ({ id: String(c.id), url: c.html_url });
  if (existing && existing.body === text) {
    return { ok: true, provider: PROVIDER, comment: toComment(existing), created: false, changed: false };
  }
  const res = existing
    ? api(ctx, ['-X', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`], { body: text })
    : api(ctx, ['-X', 'POST', `repos/${repo}/issues/${id}/comments`], { body: text });
  if (!res.ok) return failed(res, existing ? `updating a comment on #${id}` : `commenting on #${id}`);
  return { ok: true, provider: PROVIDER, comment: toComment(res.data), created: !existing, changed: true };
}

function commentArgs(args) {
  const f = flags(args, ['on', 'file', 'key']);
  if (!f || !/^\d+$/.test(f.on || '') || !f.file) return null;
  if (f.key !== undefined && !/^[a-z0-9][a-z0-9._-]*$/i.test(f.key)) return null;
  return comment({ id: f.on, file: f.file, key: f.key });
}

// --- Changes: a branch, its pushed commits, and the pull request for it ---

const NOT_ON_CHANGE_FIX = 'Start a change first: run start-change --for <item>.';

// Fail unless the clone is on a change branch. Cairn never commits to,
// pushes, or proposes the base branch itself.
function changeBranch(ctx, doing) {
  const branch = currentBranch(ctx);
  if (!branch) return fail('NOT_ON_CHANGE', `The clone is not on a branch, so there is nothing to ${doing}.`, NOT_ON_CHANGE_FIX);
  if (branch === BASE) return fail('NOT_ON_CHANGE', `The clone is on ${BASE}. Cairn does not ${doing} ${BASE}.`, NOT_ON_CHANGE_FIX);
  return { ok: true, branch };
}

function gitFailed(what, r, fix = 'Check the message above, then try again.') {
  return fail('PROVIDER_ERROR', `git could not ${what}: ${gitMessage(r)}`, fix);
}

// The commit a branch points to on the remote, or null when it is not there.
function remoteHead(ctx, remote, branch) {
  const r = git(ctx, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  if (!r.ok) return { ok: false, r };
  return { ok: true, sha: r.stdout.trim().split(/\s+/)[0] || null };
}

// Start the work on an item, or go back to it: one branch per item, made
// from the latest base branch. The branch is linked to the item, which
// makes GitHub close the item when the pull request merges. With `partial`,
// the change delivers only part of the item, so the branch is plain and
// named `<id>-<partial>`. A dirty working tree is refused, never stashed.
function startChange({ exec = run, cwd, id, partial } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  const a = access({ exec, cwd, repo, action: 'push' });
  if (!a.ok) return a;

  const issue = api(ctx, [`repos/${repo}/issues/${id}`]);
  if (!issue.ok) {
    if (issue.result) return issue.result;
    return fail('TARGET_UNAVAILABLE', `#${id} was not found in ${repo}, or your gh account cannot see it.`, 'Check the item number.');
  }
  if (issue.data.pull_request) {
    return fail('TARGET_UNAVAILABLE', `#${id} is a pull request, not a work item.`, 'Name the issue the change is for.');
  }

  // The branch this item already has, if any.
  let branch = null;
  if (partial) {
    branch = `${id}-${partial}`;
  } else {
    const listed = exec('gh', ['issue', 'develop', '--list', String(id), '--repo', repo], { cwd });
    if (!listed.ok) return providerError(`listing the branches linked to #${id}`, listed);
    branch = listed.stdout.split('\n').map((l) => l.split('\t')[0].trim()).filter(Boolean)[0] || null;
  }
  const done = (created) => ({ ok: true, provider: PROVIDER, branch, created, linked: !partial });

  const current = currentBranch(ctx);
  if (branch && current === branch) return done(false);

  if (git(ctx, ['status', '--porcelain']).stdout.trim()) {
    return fail(
      'DIRTY_TREE',
      `The working tree has changes that are not committed, and the clone is on ${current || 'no branch'}, not on the branch for #${id}.`,
      'Commit, stash, or discard those changes yourself, then ask again. Cairn does not stash or discard them for you.',
    );
  }

  const fetched = git(ctx, ['fetch', t.remote, BASE]);
  if (!fetched.ok) return gitFailed(`fetch ${BASE} from ${t.remote}`, fetched);

  if (branch) {
    let r;
    if (git(ctx, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok) {
      r = git(ctx, ['checkout', branch]);
    } else if (git(ctx, ['fetch', t.remote, branch]).ok) {
      r = git(ctx, ['checkout', '-b', branch, '--track', `${t.remote}/${branch}`]);
    } else if (partial) {
      r = git(ctx, ['checkout', '-b', branch, '--no-track', `${t.remote}/${BASE}`]);
      if (!r.ok) return gitFailed(`create the branch ${branch}`, r);
      return done(true);
    } else {
      return fail('PROVIDER_ERROR', `#${id} is linked to the branch ${branch}, but that branch is not in this clone or on ${t.remote}.`, `Remove ${branch} under Development on #${id}, then ask again.`);
    }
    if (!r.ok) return gitFailed(`switch to the branch ${branch}`, r);
    return done(false);
  }

  const made = exec('gh', ['issue', 'develop', String(id), '--repo', repo, '--base', BASE, '--checkout'], { cwd });
  if (!made.ok) return providerError(`creating a branch for #${id}`, made);
  branch = currentBranch(ctx);
  return done(true);
}

// Push the current change branch. Never the base branch, and never with
// force: a push the remote rejects is reported, not retried.
function pushChange({ exec = run, cwd } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const ctx = { exec, cwd };

  const a = access({ exec, cwd, repo: t.target, action: 'push' });
  if (!a.ok) return a;

  const on = changeBranch(ctx, 'push');
  if (!on.ok) return on;
  const { branch } = on;

  const remote = remoteHead(ctx, t.remote, branch);
  if (!remote.ok) return gitFailed(`read ${branch} on ${t.remote}`, remote.r);
  const head = git(ctx, ['rev-parse', 'HEAD']).stdout.trim();
  if (remote.sha && remote.sha === head) return { ok: true, provider: PROVIDER, branch, pushed: false };

  const pushed = git(ctx, ['push', '-u', t.remote, 'HEAD']);
  if (!pushed.ok) {
    const rejected = /rejected|fetch first|non-fast-forward/.test(pushed.stderr);
    return gitFailed(
      `push ${branch}`,
      pushed,
      rejected
        ? `${t.remote} has commits on ${branch} that this clone does not. Pull them into the branch first, then push again. Cairn never force-pushes.`
        : undefined,
    );
  }
  return { ok: true, provider: PROVIDER, branch, pushed: true };
}

// The lines that end a pull request description and say what it delivers.
// The command writes them, so the links are the same every time.
const LINK_LINE = /^(?:Closes #\d+|Part of #\d+\.?)$/;

function withLinks(body, id, partial, closes) {
  const lines = body.replace(/\s+$/, '').split('\n');
  while (lines.length && (lines[lines.length - 1].trim() === '' || LINK_LINE.test(lines[lines.length - 1].trim()))) lines.pop();
  const closing = closes.map((n) => `Closes #${n}`).join('\n');
  const links = partial ? [`Part of #${id}.`, closing].filter(Boolean).join('\n\n') : closing;
  return `${lines.join('\n')}\n\n${links}\n`;
}

// How long to wait between reads of a pull request's closing links, which
// GitHub works out a moment after the description is saved.
const LINK_WAIT_MS = Number(process.env.CAIRN_LINK_WAIT_MS || 2000);

// Put the current branch up for review: open its pull request, or update
// the one already open. By default the change closes the item and its open
// children. With `partial`, it is part of the item and closes only `closes`.
// Afterwards, check that GitHub will close exactly those items on merge.
function saveChange({ exec = run, cwd, id, file, partial = false, closes = [] } = {}) {
  const draft = readDraft(file);
  if (!draft.ok) return draft;

  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  const a = access({ exec, cwd, repo, action: 'propose-change' });
  if (!a.ok) return a;

  const on = changeBranch(ctx, 'open a change for');
  if (!on.ok) return on;
  const { branch } = on;

  const remote = remoteHead(ctx, t.remote, branch);
  if (!remote.ok) return gitFailed(`read ${branch} on ${t.remote}`, remote.r);
  if (!remote.sha) {
    return fail('NOT_PUSHED', `The branch ${branch} is not on ${t.remote} yet, so there is nothing to review.`, 'Push it first: run push-change.');
  }

  const issue = api(ctx, [`repos/${repo}/issues/${id}`]);
  if (!issue.ok) {
    if (issue.result) return issue.result;
    return fail('TARGET_UNAVAILABLE', `#${id} was not found in ${repo}, or your gh account cannot see it.`, 'Check the item number.');
  }

  let wanted = closes.map(String);
  if (!partial) {
    const kids = apiList(ctx, `repos/${repo}/issues/${id}/sub_issues?per_page=100`);
    if (!kids.ok) return failed(kids, `reading sub-issues of #${id}`);
    wanted = [String(id), ...kids.data.filter((k) => k.state === 'open').map((k) => String(k.number))];
  }
  const body = withLinks(draft.body, id, partial, wanted);

  const list = exec('gh', ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number,url'], { cwd });
  if (!list.ok) return providerError(`listing pull requests for ${branch}`, list);
  const existing = JSON.parse(list.stdout)[0] || null;

  let change;
  if (existing) {
    const r = exec('gh', ['pr', 'edit', String(existing.number), '--repo', repo, '--title', draft.title, '--body-file', '-'], { cwd, input: body });
    if (!r.ok) return providerError(`updating pull request #${existing.number}`, r);
    change = { id: String(existing.number), url: existing.url };
  } else {
    const r = exec('gh', ['pr', 'create', '--repo', repo, '--base', BASE, '--head', branch, '--title', draft.title, '--body-file', '-'], { cwd, input: body });
    if (!r.ok) return providerError(`opening a pull request for ${branch}`, r);
    const url = r.stdout.trim().split('\n').pop().trim();
    const number = (/\/pull\/(\d+)/.exec(url) || [])[1];
    if (!number) return fail('PROVIDER_ERROR', `GitHub opened a pull request for ${branch}, but did not report its number.`, 'Find it with gh pr list, then save again.');
    change = { id: number, url };
  }

  // What will merging close? Read it back, because a closing word in the
  // description or a linked branch can add an item nobody asked for.
  let got = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) sleep(LINK_WAIT_MS);
    const view = exec('gh', ['pr', 'view', change.id, '--repo', repo, '--json', 'closingIssuesReferences'], { cwd });
    if (!view.ok) return providerError(`reading what pull request #${change.id} closes`, view);
    got = JSON.parse(view.stdout).closingIssuesReferences.map((i) => String(i.number));
    if (got.length === wanted.length && wanted.every((n) => got.includes(n))) {
      return { ok: true, provider: PROVIDER, change, created: !existing, closes: wanted };
    }
  }
  const refs = (ids) => ids.map((n) => `#${n}`).join(', ');
  const extra = got.filter((n) => !wanted.includes(n));
  const missing = wanted.filter((n) => !got.includes(n));
  const result = extra.length
    ? fail(
      'CLOSES_MISMATCH',
      `Merging pull request #${change.id} would also close ${refs(extra)}, which this change does not deliver.`,
      `Reword any "closes", "fixes", or "resolves" before ${refs(extra)} in the description and save again. If the description has none, remove ${refs(extra)} under Development on the pull request's page.`,
    )
    : fail(
      'CLOSES_MISMATCH',
      `Merging pull request #${change.id} would not close ${refs(missing)}.`,
      `Check that ${refs(missing)} is an open issue in ${repo}, then save again.`,
    );
  return { ...result, change, closes: got };
}

// Is this comment Cairn's? It is when a line is the plain or keyed marker.
const MARKER_LINE = /^<!-- cairn(?: key=\S+)? -->$/;
function isCairn(body) {
  return (body || '').split('\n').some((line) => MARKER_LINE.test(line.trim()));
}

// One check in the contract's words: passed, failed, or pending. GitHub
// reports check runs (status and conclusion) and commit statuses (state).
const PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
function checkRun(c) {
  let state;
  if (c.status !== undefined) state = c.status !== 'COMPLETED' ? 'pending' : PASSED.includes(c.conclusion) ? 'passed' : 'failed';
  else state = c.state === 'SUCCESS' ? 'passed' : ['PENDING', 'EXPECTED'].includes(c.state) ? 'pending' : 'failed';
  return { name: c.name || c.context, state };
}

// All checks, with one overall state: failed if any failed, pending if any
// is still running, passed when all passed, none when there are no checks.
function checksOf(rollup) {
  const runs = (rollup || []).map(checkRun);
  const has = (s) => runs.some((r) => r.state === s);
  const state = !runs.length ? 'none' : has('failed') ? 'failed' : has('pending') ? 'pending' : 'passed';
  return { state, runs };
}

const lower = (v) => (v ? String(v).toLowerCase() : null);

// Turn a failed `gh` call into a contract result.
function ghFailed(r, what, notFound) {
  if (r.missing) return fail('CLI_MISSING', 'The GitHub CLI (gh) is not installed.', 'Install it from https://cli.github.com, then run gh auth login.');
  if (/gh auth login/.test(r.stderr)) return fail('NOT_LOGGED_IN', `gh is not logged in to ${HOST}.`, LOGIN_FIX);
  if (notFound && /Could not resolve to a PullRequest/.test(r.stderr)) return notFound;
  return providerError(what, r);
}

const REVIEW_QUERY = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { pending: reviews(states: PENDING, first: 1) { totalCount } reviews(states: [COMMENTED, APPROVED, CHANGES_REQUESTED, DISMISSED], first: 100) { nodes { databaseId author { login } state body bodyHTML url } } comments(first: 100) { nodes { databaseId author { login } body bodyHTML url } } reviewThreads(first: 100) { nodes { id isResolved isOutdated path line comments(first: 100) { nodes { databaseId author { login } body bodyHTML url } } } } } } }';

// One comment in the contract's shape, from GraphQL. `body` is the
// Markdown, which keeps Cairn's hidden marker; `bodyHTML` is GitHub's
// rendering, which has the downloadable image URLs.
function graphComment(c) {
  return {
    id: String(c.databaseId),
    author: c.author && c.author.login,
    body: c.body,
    url: c.url,
    cairn: isCairn(c.body),
    images: imagesOf(c.bodyHTML),
  };
}

// Everything review and readiness depend on, read once: the change, its
// checks, its review state, whether it can merge, how far it is behind the
// base branch, and its review threads. Values are GitHub's own; GitHub's
// merge rules are not reimplemented here.
function getChange({ exec = run, cwd, id } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };
  const notFound = fail('TARGET_UNAVAILABLE', `Pull request #${id} was not found in ${repo}, or your gh account cannot see it.`, 'Check the change number.');

  const fields = 'number,url,state,headRefName,closingIssuesReferences,statusCheckRollup,reviewDecision,mergeable,mergeStateStatus';
  const view = exec('gh', ['pr', 'view', String(id), '--repo', repo, '--json', fields], { cwd });
  if (!view.ok) return ghFailed(view, `reading pull request #${id}`, notFound);
  const pr = JSON.parse(view.stdout);

  // Review threads and a pending review exist only in GraphQL. A pending
  // review is visible only to its author, so any pending review found is
  // the current user's.
  const [owner, name] = repo.split('/');
  const res = api(ctx, ['graphql', '-f', `query=${REVIEW_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${id}`]);
  if (!res.ok) return failed(res, `reading the review threads of pull request #${id}`);
  const p = res.data.data.repository.pullRequest;

  // How many base-branch commits the branch lacks. Only an open change has
  // a branch to compare.
  let behind = null;
  if (pr.state === 'OPEN') {
    const cmp = api(ctx, [`repos/${repo}/compare/${BASE}...${encodeURIComponent(pr.headRefName)}`]);
    if (!cmp.ok) return failed(cmp, `comparing ${pr.headRefName} with ${BASE}`);
    behind = cmp.data.behind_by;
  }

  return {
    ok: true,
    provider: PROVIDER,
    change: {
      id: String(pr.number),
      url: pr.url,
      state: lower(pr.state),
      branch: pr.headRefName,
      closes: pr.closingIssuesReferences.map((i) => String(i.number)),
    },
    checks: checksOf(pr.statusCheckRollup),
    review: { decision: lower(pr.reviewDecision), pending: p.pending.totalCount > 0 },
    mergeable: lower(pr.mergeable),
    mergeState: lower(pr.mergeStateStatus),
    behind,
    // A review's own summary, when it has one. Its line comments are in
    // `threads`.
    reviews: p.reviews.nodes.filter((r) => (r.body || '').trim()).map((r) => ({ ...graphComment(r), state: lower(r.state) })),
    // The pull request's conversation, outside any review.
    comments: p.comments.nodes.map(graphComment),
    threads: p.reviewThreads.nodes.map((th) => ({
      id: th.id,
      resolved: th.isResolved,
      outdated: th.isOutdated,
      path: th.path,
      line: th.line,
      comments: th.comments.nodes.map(graphComment),
    })),
  };
}

const THREAD_QUERY = 'query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { id isResolved pullRequest { number repository { nameWithOwner } } comments(last: 1) { nodes { databaseId url body } } } } }';
const REPLY_MUTATION = 'mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { databaseId url } } }';

// Reply inside one review thread, so the answer stays next to the feedback.
// The reply ends with Cairn's marker, which is how a later run knows the
// thread is answered. It never resolves the thread or dismisses a review:
// that stays with the reviewer. Sending the same reply twice posts it once.
function reply({ exec = run, cwd, thread, file } = {}) {
  const body = readBody(file);
  if (!body.ok) return body;

  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  const a = access({ exec, cwd, repo, action: 'comment' });
  if (!a.ok) return a;

  // Read the thread first: it must be a review thread in this repository.
  const notFound = fail('TARGET_UNAVAILABLE', `Review thread ${thread} was not found in ${repo}.`, 'Use a thread id from get-change.');
  const found = api(ctx, ['graphql', '-f', `query=${THREAD_QUERY}`, '-f', `id=${thread}`]);
  if (!found.ok) {
    if (found.result) return found.result;
    if (/Could not resolve to a node/.test(found.r.stderr)) return notFound;
    return failed(found, `reading review thread ${thread}`);
  }
  const th = found.data.data.node;
  if (!th || !th.pullRequest || th.pullRequest.repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()) return notFound;

  const text = `${body.text}\n\n${marker()}`;
  const toComment = (c) => ({ id: String(c.databaseId), url: c.url });
  const last = th.comments.nodes[0];
  if (last && last.body === text) {
    return { ok: true, provider: PROVIDER, comment: toComment(last), change: String(th.pullRequest.number), created: false };
  }

  const res = api(ctx, ['graphql', '-f', `query=${REPLY_MUTATION}`, '-f', `id=${thread}`, '-f', `body=${text}`]);
  if (!res.ok) return failed(res, `replying in review thread ${thread}`);
  const c = res.data.data.addPullRequestReviewThreadReply.comment;
  return { ok: true, provider: PROVIDER, comment: toComment(c), change: String(th.pullRequest.number), created: true };
}

function replyArgs(args) {
  const f = flags(args, ['on', 'file']);
  if (!f || !/^[A-Za-z0-9_=-]+$/.test(f.on || '') || !f.file) return null;
  return reply({ thread: f.on, file: f.file });
}

// --- Images attached to items and comments ---

// The media type that adds `body_html` to REST results. GitHub's rendering
// carries a signed, short-lived URL for each attached image, which
// downloads with no token, even in a private repository. The Markdown's
// `user-attachments` URL would need the user's token.
const FULL = 'Accept: application/vnd.github.full+json';

const ENTITIES = { amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' };
const unescape = (s) => s.replace(/&(amp|quot|#39|lt|gt);/g, (_, e) => ENTITIES[e]);

// The images in a rendered body, in order and without repeats: `url` to
// download and `alt` text.
function imagesOf(html) {
  const seen = new Set();
  const images = [];
  for (const [tag] of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    const attr = (name) => {
      const m = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag);
      return m ? unescape(m[1]) : '';
    };
    const url = attr('src');
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    images.push({ url, alt: attr('alt') });
  }
  return images;
}

// Where `get-image` may download from: GitHub's image hosts only. Tests set
// CAIRN_IMAGE_HOSTS to a local server instead.
function imageHostAllowed(u) {
  const test = (process.env.CAIRN_IMAGE_HOSTS || '').split(',').filter(Boolean);
  if (test.length) return test.includes(u.hostname) && /^https?:$/.test(u.protocol);
  if (u.protocol !== 'https:') return false;
  return u.hostname.endsWith('.githubusercontent.com') || (u.hostname === 'github.com' && u.pathname.startsWith('/user-attachments/'));
}

const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };

// Download in a child process, because every command is synchronous and
// fetch is not. It prints one JSON line and never throws.
const DOWNLOAD = `
const fs = require('node:fs');
const [url, file, max] = process.argv.slice(1);
const say = (o) => process.stdout.write(JSON.stringify(o));
(async () => {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok) return say({ status: res.status });
  if (!type.startsWith('image/')) return say({ status: res.status, type });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > Number(max)) return say({ status: res.status, type, tooBig: buf.length });
  fs.writeFileSync(file, buf);
  say({ status: res.status, type, bytes: buf.length });
})().catch((e) => say({ error: String((e.cause && e.cause.code) || e.name || e.message) }));
`;

// The real path of `dir`, or of its nearest folder that exists.
function realish(dir) {
  const rest = [];
  let at = dir;
  while (!fs.existsSync(at) && path.dirname(at) !== at) {
    rest.unshift(path.basename(at));
    at = path.dirname(at);
  }
  return path.join(fs.realpathSync(at), ...rest);
}

// Download one image attached on GitHub into a folder outside the
// repository, so the agent can look at it. GitHub stays the image's source
// of truth: a folder inside the working tree is refused, so a downloaded
// image is never committed by accident.
function getImage({ exec = run, cwd, url, out } = {}) {
  const t = target({ exec, cwd });
  if (!t.ok) return t;

  let u;
  try {
    u = new URL(url);
  } catch {
    u = null;
  }
  if (!u || !imageHostAllowed(u)) {
    return fail('NOT_THIS_PROVIDER', `${url} is not an image attached on GitHub.`, 'Pass an image URL from the images list that get-item or get-change returned.');
  }

  const top = git({ exec, cwd }, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return gitFailed('find the top of the clone', top);
  const repoDir = fs.realpathSync(top.stdout.trim());
  const dir = realish(path.resolve(cwd || process.cwd(), out));
  if (dir === repoDir || dir.startsWith(repoDir + path.sep)) {
    return fail('INSIDE_REPO', `${out} is inside the repository, where a downloaded image could be committed.`, 'Pass a temporary folder outside the repository, such as the session scratchpad.');
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return fail('PROVIDER_ERROR', `Cannot create the folder ${dir}: ${err.code || err.message}.`, 'Pass a folder you can write to.');
  }

  const name = path.basename(u.pathname).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'image';
  let file = path.join(dir, name);
  const r = exec(process.execPath, ['-e', DOWNLOAD, u.href, file, String(IMAGE_MAX_BYTES)]);
  let got;
  try {
    got = JSON.parse(r.stdout);
  } catch {
    got = { error: (r.stderr || 'no output').trim().split('\n')[0] };
  }
  const again = 'Image links expire a few minutes after they are read. Read the item or change again, then download right away.';
  if (got.error) return fail('PROVIDER_ERROR', `The image could not be downloaded: ${got.error}.`, again);
  if (got.status >= 400) return fail('PROVIDER_ERROR', `GitHub answered ${got.status} for the image.`, again);
  if (got.tooBig) return fail('PROVIDER_ERROR', `The image is ${got.tooBig} bytes, more than the ${IMAGE_MAX_BYTES} Cairn downloads.`, 'Open it on GitHub instead.');
  if (!got.bytes) return fail('PROVIDER_ERROR', `The link returned ${got.type || 'something'} that is not an image.`, again);

  // Give the file the extension its type says, when the URL had none.
  const ext = IMAGE_EXT[got.type];
  if (ext && path.extname(file).toLowerCase() !== ext && !(ext === '.jpg' && /\.jpe?g$/i.test(file))) {
    fs.renameSync(file, file + ext);
    file += ext;
  }
  return { ok: true, provider: PROVIDER, path: file, type: got.type, bytes: got.bytes };
}

function getImageArgs(args) {
  const f = flags(args, ['url', 'out']);
  if (!f || !f.url || !f.out) return null;
  return getImage({ url: f.url, out: f.out });
}

function getChangeArgs(args) {
  const f = flags(args, ['id']);
  if (!f || !/^\d+$/.test(f.id || '')) return null;
  return getChange({ id: f.id });
}

function startChangeArgs(args) {
  const f = flags(args, ['for', 'partial']);
  if (!f || !/^\d+$/.test(f.for || '')) return null;
  if (f.partial !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(f.partial)) return null;
  return startChange({ id: f.for, partial: f.partial });
}

// `--partial` takes no value here, so take it out before reading the pairs.
function saveChangeArgs(args) {
  const partial = args.includes('--partial');
  const f = flags(args.filter((a) => a !== '--partial'), ['for', 'file', 'closes']);
  if (!f || !/^\d+$/.test(f.for || '') || !f.file) return null;
  if (f.closes !== undefined && (!partial || !/^\d+(,\d+)*$/.test(f.closes))) return null;
  return saveChange({ id: f.for, file: f.file, partial, closes: f.closes ? f.closes.split(',') : [] });
}

function listItemsArgs(args) {
  const f = flags(args, ['kind']);
  if (!f || !KINDS.includes(f.kind)) return null;
  return listItems({ kind: f.kind });
}

function saveItemArgs(args) {
  const f = flags(args, ['kind', 'file', 'parent']);
  if (!f || !f.kind || !f.file || !KINDS.includes(f.kind)) return null;
  if (f.parent !== undefined && !/^\d+$/.test(f.parent)) return null;
  return saveItem({ kind: f.kind, file: f.file, parent: f.parent });
}

function accessArgs(args) {
  if (args.length === 0) return access();
  if (args.length === 2 && args[0] === '--for') return access({ action: args[1] });
  return null;
}

const commands = {
  target: (args) => (args.length ? null : target()),
  auth: (args) => (args.length ? null : auth()),
  access: accessArgs,
  check: (args) => (args.length ? null : check()),
  comment: commentArgs,
  'find-item': findItemArgs,
  'get-item': getItemArgs,
  'list-items': listItemsArgs,
  'order-children': orderChildrenArgs,
  'save-item': saveItemArgs,
  'start-change': startChangeArgs,
  'push-change': (args) => (args.length ? null : pushChange()),
  'save-change': saveChangeArgs,
  'get-change': getChangeArgs,
  'get-image': getImageArgs,
  reply: replyArgs,
};

if (require.main === module) {
  process.exitCode = cli(commands, process.argv.slice(2));
}

module.exports = { name: PROVIDER, commands, marker, comment, actions: ACTIONS, kinds: KIND_LABELS, parseRemote, target, auth, access, check, findItem, getItem, listItems, orderChildren, saveItem, startChange, pushChange, saveChange, getChange, getImage, reply, imagesOf, isCairn, checksOf, withLinks };
