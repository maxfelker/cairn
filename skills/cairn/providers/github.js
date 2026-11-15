#!/usr/bin/env node
// GitHub provider adapter. It implements contract.md over `git` and `gh`,
// using the user's existing `gh` login.

'use strict';

const { KINDS, run, fail, gitRemote, readDraft, flags, cli } = require('./lib.js');

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

// Fallback labels for repositories without a matching issue type. Colors apply
// only when Cairn creates the label. An existing label is never changed.
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
// if the repository has one, otherwise a label. Labels are the fallback.
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

// Create a work item, or update the open one of the same kind and title.
function saveItem({ exec = run, cwd, kind, file } = {}) {
  const draft = readDraft(file);
  if (!draft.ok) return draft;

  const t = target({ exec, cwd });
  if (!t.ok) return t;
  const repo = t.target;
  const ctx = { exec, cwd };

  for (const action of ['create-item', 'label']) {
    const a = access({ exec, cwd, repo, action });
    if (!a.ok) return a;
  }

  const spec = kindSpec(kind, issueTypes(ctx, repo));
  if (spec.via === 'label') {
    const label = ensureLabel({ exec, repo, kind });
    if (!label.ok) return label;
  }

  const open = openOfKind(ctx, repo, spec);
  if (!open.ok) return failed(open, `listing ${kind} issues`);
  const existing = open.data.find((i) => i.title.trim() === draft.title.trim());

  const res = existing
    ? api(ctx, ['-X', 'PATCH', `repos/${repo}/issues/${existing.number}`], { body: draft.body })
    : api(ctx, ['-X', 'POST', `repos/${repo}/issues`], {
      title: draft.title,
      body: draft.body,
      ...(spec.via === 'type' ? { type: spec.type } : { labels: [spec.label] }),
    });
  if (!res.ok) return failed(res, existing ? `updating #${existing.number}` : `creating the ${kind}`);

  return { ok: true, provider: PROVIDER, kind, via: spec.via, created: !existing, item: toItem(res.data) };
}

function listItemsArgs(args) {
  const f = flags(args, ['kind']);
  if (!f || !KINDS.includes(f.kind)) return null;
  return listItems({ kind: f.kind });
}

function saveItemArgs(args) {
  const f = flags(args, ['kind', 'file']);
  if (!f || !f.kind || !f.file || !KINDS.includes(f.kind)) return null;
  return saveItem({ kind: f.kind, file: f.file });
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
  'list-items': listItemsArgs,
  'save-item': saveItemArgs,
};

if (require.main === module) {
  process.exitCode = cli(commands, process.argv.slice(2));
}

module.exports = { name: PROVIDER, commands, actions: ACTIONS, kinds: KIND_LABELS, parseRemote, target, auth, access, check, listItems, saveItem };
