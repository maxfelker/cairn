#!/usr/bin/env node
// GitHub provider adapter. It implements contract.md over `git` and `gh`,
// using the user's existing `gh` login.

'use strict';

const { KINDS, run, fail, gitRemote, readDraft, readBody, flags, cli, matchItems } = require('./lib.js');

const PROVIDER = 'github';
const HOST = 'github.com';

// Parse a git remote URL into { host, owner, name }, or null if it is not an
// owner/name remote. Handles scp-style (git@host:o/r.git) and URL forms
// (https://, ssh://, git://), with or without .git and trailing slashes.
function parseRemote(url) {
  if (typeof url !== 'string') return null;
  const value = url.trim();
  let host;
  let path;

  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(value);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    host = scp[1];
    path = scp[2];
  } else {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  }

  const parts = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').split('/');
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

// GET every page of a list endpoint.
function apiList(ctx, path) {
  const res = api(ctx, ['--paginate', '--slurp', path]);
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

  const issue = api(ctx, [`repos/${repo}/issues/${id}`]);
  if (!issue.ok) {
    if (issue.result) return issue.result;
    return fail('TARGET_UNAVAILABLE', `#${id} was not found in ${repo}, or your gh account cannot see it.`, 'Check the item number.');
  }
  const comments = apiList(ctx, `repos/${repo}/issues/${id}/comments?per_page=100`);
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
    item: { ...toItem(i), kind: kindOf(i), state: i.state, body: i.body || '', parent: parent.ok ? String(parent.data.number) : null },
    comments: comments.data.map((c) => ({ author: c.user && c.user.login, body: c.body })),
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
};

if (require.main === module) {
  process.exitCode = cli(commands, process.argv.slice(2));
}

module.exports = { name: PROVIDER, commands, marker, comment, actions: ACTIONS, kinds: KIND_LABELS, parseRemote, target, auth, access, check, findItem, getItem, listItems, orderChildren, saveItem };
