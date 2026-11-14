'use strict';

// Integration-test helpers: run the real provider adapter as a subprocess,
// with the mock gh (tests/fake-gh/gh) first on PATH. Nothing reaches GitHub.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PROVIDERS = path.join(__dirname, '..', 'skills', 'cairn', 'providers');
const FAKE_GH_DIR = path.join(__dirname, 'fake-gh');

const DEFAULT_STATE = {
  repo: 'octo/repo',
  login: 'octo',
  permission: 'WRITE',
  issuesEnabled: true,
  labels: [],
  issues: [],
  calls: [],
};

// A temporary clone of octo/repo, plus a mock GitHub seeded with `state`.
function fakeGitHub(state = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-int-'));
  const cwd = path.join(root, 'clone');
  fs.mkdirSync(cwd);
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:octo/repo.git'], { cwd });

  const stateFile = path.join(root, 'github.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...DEFAULT_STATE, ...state }, null, 2));

  const env = {
    ...process.env,
    PATH: `${FAKE_GH_DIR}${path.delimiter}${process.env.PATH}`,
    FAKE_GH_STATE: stateFile,
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
    // Write a draft file outside the clone, and return its path.
    draft(name, text) {
      const file = path.join(root, name);
      fs.writeFileSync(file, text);
      return file;
    },
  };
}

module.exports = { fakeGitHub, FAKE_GH_DIR };
