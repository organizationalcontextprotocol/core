'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pkg = require('../package.json');
const { baseFixture, writeSubstrate, removeSubstrate } = require('./fixture.js');

const CLI = path.join(__dirname, '..', 'cli.js');

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...options });
}

function withSubstrate(files, fn) {
  const dir = writeSubstrate(files);
  try {
    return fn(dir);
  } finally {
    removeSubstrate(dir);
  }
}

test('validate exits 0 on a conformant substrate and says OK', () => {
  withSubstrate(baseFixture(), (dir) => {
    const result = runCli(['validate', dir]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^OK — \d+ file\(s\) walked, 0 error\(s\)/m);
  });
});

test('validate exits 1 and names the problem when a README is missing', () => {
  const files = baseFixture();
  delete files['orgs/bravo/notes/README.md'];
  withSubstrate(files, (dir) => {
    const result = runCli(['validate', dir]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /missing-readme/);
    assert.match(result.stdout, /orgs\/bravo\/notes/);
    assert.match(result.stdout, /^FAIL — /m);
    assert.match(result.stdout, /re-run/);
  });
});

test('validate reports a file with no frontmatter as an error', () => {
  const files = baseFixture();
  files['notes/handbook.md'] = '# Just a heading\n\nNo frontmatter at all.\n';
  withSubstrate(files, (dir) => {
    const result = runCli(['validate', dir]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /missing-frontmatter/);
  });
});

test('--json emits a machine-readable result', () => {
  withSubstrate(baseFixture(), (dir) => {
    const result = runCli(['validate', dir, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.errors.length, 0);
    assert.ok(parsed.filesSeen > 0);
    assert.ok(Array.isArray(parsed.unreadable));
  });
});

test('--json carries the failing problems when the substrate is broken', () => {
  const files = baseFixture();
  delete files['orgs/bravo/notes/README.md'];
  withSubstrate(files, (dir) => {
    const result = runCli(['validate', dir, '--json']);
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.errors.some((problem) => problem.code === 'missing-readme'));
  });
});

test('validate defaults to the current directory', () => {
  withSubstrate(baseFixture(), (dir) => {
    const result = runCli(['validate'], { cwd: dir });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^OK/m);
  });
});

test('a missing target directory is a one-line usage error, not a stack trace', () => {
  const result = runCli(['validate', '/nonexistent/definitely-not-here']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not exist/);
  assert.ok(!result.stderr.includes('at '), 'no stack trace on usage errors');
});

test('an unknown command is rejected with a usage hint', () => {
  const result = runCli(['frobnicate']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command/);
  assert.match(result.stderr, /--help/);
});

test('no arguments prints usage to stderr and exits 1', () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: ocp-core validate/);
  assert.equal(result.stdout, '');
});

test('-h exits 0 with usage on stdout; -v prints the exact version', () => {
  const help = runCli(['-h']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: ocp-core validate/);
  assert.match(help.stdout, /ocp\.wiki/);

  const version = runCli(['-v']);
  assert.equal(version.status, 0);
  assert.equal(version.stdout, `${pkg.version}\n`);
});
