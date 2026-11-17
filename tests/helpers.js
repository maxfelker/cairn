'use strict';

// Integration-test helpers: run the real provider adapter as a subprocess,
// with the mock gh (tests/fake-gh/gh) first on PATH. Nothing reaches GitHub.
// The clone's origin looks like GitHub, but git fetches from and pushes to a
// local bare repository.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PROVIDERS = path.join(__dirname, '..', 'skills', 'cairn', 'providers');
const FAKE_GH_DIR = path.join(__dirname, 'fake-gh');
const ORIGIN_URL = 'git@github.com:octo/repo.git';
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

const DEFAULT_STATE = {
  repo: 'octo/repo',
  login: 'octo',
  permission: 'WRITE',
  issuesEnabled: true,
  labels: [],
  issues: [],
  calls: [],
};

// Set up a clone of octo/repo at `dir`, with the local bare repository
// standing in for github.com.
function clone(dir, origin) {
  fs.mkdirSync(dir);
  const git = (...args) => execFileSync(REAL_GIT, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Octo');
  git('config', 'user.email', 'octo@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', `url.${origin}.insteadOf`, ORIGIN_URL);
  git('remote', 'add', 'origin', ORIGIN_URL);
  return git;
}

// A temporary clone of octo/repo with one commit on main, a local bare
// repository as its origin, and a mock GitHub seeded with `state`.
function fakeGitHub(state = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-int-'));
  const origin = path.join(root, 'origin.git');
  execFileSync(REAL_GIT, ['init', '-q', '--bare', '-b', 'main', origin]);
  const cwd = path.join(root, 'clone');
  const git = clone(cwd, origin);
  fs.writeFileSync(path.join(cwd, 'README.md'), '# repo\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'Start the repository');
  git('push', '-q', '-u', 'origin', 'main');

  // A git on PATH that records every call, then runs the real git.
  const bin = path.join(root, 'bin');
  const gitLog = path.join(root, 'git.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${gitLog}"\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });

  const stateFile = path.join(root, 'github.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...DEFAULT_STATE, ...state }, null, 2));

  const env = {
    ...process.env,
    PATH: [FAKE_GH_DIR, bin, process.env.PATH].join(path.delimiter),
    FAKE_GH_STATE: stateFile,
    // The mock answers at once, so do not wait between reads of closing links.
    CAIRN_LINK_WAIT_MS: '0',
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  return {
    root,
    cwd,
    env,
    // Run `github.js <args>` and parse its JSON result.
    run(...args) {
      const r = spawnSync(process.execPath, [path.join(PROVIDERS, 'github.js'), ...args], { cwd, env, encoding: 'utf8' });
      let json = null;
      try {
        json = JSON.parse(r.stdout);
      } catch {
        // Wrong usage prints no JSON.
      }
      return { status: r.status, json, stderr: r.stderr };
    },
    // The mock's current state: labels, issues, and every gh call made.
    state() {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    },
    // Run git in the clone and return its output.
    git,
    // Every git call the adapter and the mock gh made, one line each.
    gitCalls() {
      return fs.existsSync(gitLog) ? fs.readFileSync(gitLog, 'utf8').split('\n').filter(Boolean) : [];
    },
    // Commit one file on the current branch.
    commit(name, text, message) {
      fs.writeFileSync(path.join(cwd, name), text);
      git('add', name);
      git('commit', '-q', '-m', message);
    },
    // A second clone of the same origin, as another person's machine.
    // Returns its git runner and directory.
    other() {
      const dir = path.join(root, `other-${fs.readdirSync(root).length}`);
      const g = clone(dir, origin);
      g('fetch', '-q', 'origin');
      g('checkout', '-q', 'main');
      return { git: g, cwd: dir };
    },
    // Write a draft file outside the clone, and return its path.
    draft(name, text) {
      const file = path.join(root, name);
      fs.writeFileSync(file, text);
      return file;
    },
  };
}

module.exports = { fakeGitHub, FAKE_GH_DIR };
