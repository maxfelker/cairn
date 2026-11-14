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

const commands = {
  target: (args) => (args.length ? null : target()),
  auth: (args) => (args.length ? null : auth()),
};

if (require.main === module) {
  process.exitCode = cli(commands, process.argv.slice(2));
}

module.exports = { name: PROVIDER, commands, parseRemote, target, auth };
