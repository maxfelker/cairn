'use strict';

// Every provider adapter in skills/cairn/providers/ must pass these tests.
// A new provider needs no changes here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DIR = path.join(__dirname, '..', 'skills', 'cairn', 'providers');
const { CODES, ACTIONS, COMMANDS, fail } = require(path.join(DIR, 'lib.js'));

const providers = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.js') && f !== 'lib.js')
  .map((f) => ({ file: path.join(DIR, f), mod: require(path.join(DIR, f)) }));

// Backticked names in the first column of a contract.md section's table.
function tableNames(section) {
  const md = fs.readFileSync(path.join(DIR, 'contract.md'), 'utf8');
  const body = md.split(/^## /m).find((s) => s.startsWith(section));
  assert.ok(body, `contract.md has a ${section} section`);
  return body.split('\n')
    .filter((line) => line.startsWith('| `'))
    .flatMap((line) => line.split('|')[1].match(/`([^`\s]+)/g).map((m) => m.slice(1)));
}

test('contract.md and lib.js agree on codes, actions, and commands', () => {
  assert.deepEqual(tableNames('Codes').sort(), [...CODES].sort());
  assert.deepEqual(tableNames('Actions').sort(), [...ACTIONS].sort());
  assert.deepEqual(tableNames('Commands').sort(), [...COMMANDS].sort());
});

test('fail() only accepts contract codes', () => {
  assert.throws(() => fail('MADE_UP', 'm', 'f'));
  assert.deepEqual(fail('NO_REMOTE', 'm', 'f'), { ok: false, code: 'NO_REMOTE', message: 'm', fix: 'f' });
});

test('at least one provider exists', () => {
  assert.ok(providers.length > 0);
});

for (const { file, mod } of providers) {
  const base = path.basename(file, '.js');

  test(`${base}: exports a name, a guidance file, and only contract commands`, () => {
    assert.equal(mod.name, base);
    assert.ok(fs.existsSync(path.join(DIR, `${base}.md`)), `${base}.md exists`);
    for (const name of Object.keys(mod.commands)) {
      assert.ok(COMMANDS.includes(name), `${name} is a contract command`);
    }
  });

  test(`${base}: wrong usage exits 2 with no JSON`, () => {
    const r = spawnSync(process.execPath, [file, 'not-a-command'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
  });

  // With nothing on PATH, every command must fail cleanly with a contract
  // result: no stack trace, no network, no hanging prompt.
  test(`${base}: every command returns a contract result with no tools installed`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-contract-'));
    const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-path-'));
    for (const name of Object.keys(mod.commands)) {
      const r = spawnSync(process.execPath, [file, name], {
        cwd,
        encoding: 'utf8',
        env: { PATH: emptyPath, HOME: cwd },
        timeout: 10000,
      });
      assert.equal(r.status, 1, `${name} exits 1: ${r.stderr}`);
      const result = JSON.parse(r.stdout);
      assert.equal(result.ok, false, name);
      assert.ok(CODES.includes(result.code), `${name} returns a contract code, got ${result.code}`);
      assert.equal(typeof result.message, 'string');
      assert.equal(typeof result.fix, 'string');
    }
  });
}
