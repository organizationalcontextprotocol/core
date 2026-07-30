'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { walk, createFileSystemSubstrate, conformance } = require('../index.js');
const { baseFixture, note, writeSubstrate, removeSubstrate } = require('./fixture.js');

function check(files) {
  const dir = writeSubstrate(files);
  try {
    return conformance(walk(createFileSystemSubstrate(dir), { substrateRoot: dir }));
  } finally {
    removeSubstrate(dir);
  }
}

function codes(result) {
  return result.problems.map((problem) => problem.code);
}

test('a conformant substrate passes with no problems', () => {
  const result = check(baseFixture());
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('a directory without a README.md is an error (P20)', () => {
  const files = baseFixture();
  delete files['orgs/bravo/notes/README.md'];
  const result = check(files);
  assert.equal(result.ok, false);
  const problem = result.problems.find((item) => item.code === 'missing-readme');
  assert.ok(problem);
  assert.equal(problem.route, 'orgs/bravo/notes');
  assert.equal(problem.severity, 'error');
});

test('an artifact_type outside the closed five is an error (P16)', () => {
  const files = baseFixture();
  files['notes/handbook.md'] = note(
    { artifact_type: 'projection_definition', display_name: 'Retired Type' },
    'Body.'
  );
  const result = check(files);
  assert.equal(result.ok, false);
  const problem = result.problems.find((item) => item.code === 'unknown-artifact-type');
  assert.ok(problem);
  assert.equal(problem.path, 'notes/handbook.md');
});

test('an artifact with no frontmatter is an error (P17)', () => {
  const files = baseFixture();
  files['notes/handbook.md'] = '# Just a heading\n\nNo frontmatter at all.\n';
  const result = check(files);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('missing-frontmatter'));
});

test('a retired org_type field is a warning naming the retirement date', () => {
  const files = baseFixture();
  files['orgs/bravo/README.md'] = files['orgs/bravo/README.md'].replace(
    'tenant: acme\n',
    'tenant: acme\norg_type: account\n'
  );
  const result = check(files);
  const problem = result.problems.find((item) => item.code === 'retired-org-type-field');
  assert.ok(problem);
  assert.equal(problem.severity, 'warning');
  assert.match(problem.message, /2026-07-21/);
  // A warning alone does not fail conformance.
  assert.equal(result.ok, true);
});

test('an org README missing org_id, display_name or parent_org_id is an error', () => {
  const files = baseFixture();
  files['orgs/bravo/README.md'] = [
    '---',
    'artifact_type: note',
    'role: org_definition',
    'status: active',
    '---',
    '',
    '# Bravo Ltd',
    '',
    '## Core Canon',
    '',
    'None declared yet.',
    ''
  ].join('\n');
  const result = check(files);
  assert.equal(result.ok, false);
  const found = codes(result);
  assert.ok(found.includes('org-missing-org-id'));
  assert.ok(found.includes('org-missing-display-name'));
  assert.ok(found.includes('org-missing-parent-org-id'));
});

test('an org README without a Core Canon block is an error (P20)', () => {
  const files = baseFixture();
  files['orgs/bravo/README.md'] = [
    '---',
    'artifact_type: note',
    'role: org_definition',
    'org_id: bravo',
    'display_name: Bravo Ltd',
    'parent_org_id: acme-platform',
    '---',
    '',
    '# Bravo Ltd',
    '',
    'No canon block here.',
    ''
  ].join('\n');
  const result = check(files);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('org-missing-core-canon'));
});

test('the explicit empty Core Canon state is conformant', () => {
  const result = check(baseFixture());
  assert.equal(codes(result).includes('org-missing-core-canon'), false);
});

test('conformance rejects anything that is not a tree', () => {
  assert.throws(() => conformance(null), TypeError);
  assert.throws(() => conformance({ nodes: [] }), TypeError);
});
