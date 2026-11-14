#!/usr/bin/env node
// GitHub provider adapter. It implements contract.md over `git` and `gh`,
// using the user's existing `gh` login.

'use strict';

const { run, fail, gitRemote, cli } = require('./lib.js');

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

function accessArgs(args) {
  if (args.length === 0) return access();
  if (args.length === 2 && args[0] === '--for') return access({ action: args[1] });
  return null;
}

const commands = {
  target: (args) => (args.length ? null : target()),
  auth: (args) => (args.length ? null : auth()),
  access: accessArgs,
};

if (require.main === module) {
  process.exitCode = cli(commands, process.argv.slice(2));
}

module.exports = { name: PROVIDER, commands, actions: ACTIONS, parseRemote, target, auth, access };
