'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArtifact, ARTIFACT_TYPES } = require('../index.js');

test('parses the canonical universal frontmatter vocabulary', () => {
  const artifact = parseArtifact(
    [
      '---',
      'artifact_type: note',
      'role: capture',
      'display_name: Inbound Capture',
      'status: active',
      'tenant: acme',
      'trust_tier: 2                     # unvetted; captured from an external source',
      'visibility: [account:acme-co]     # scope of who/what may retrieve this',
      'tags: [inbound, triage]',
      '---',
      '',
      'Body text.'
    ].join('\n'),
    { path: 'orgs/acme/notes/capture.md' }
  );

  assert.equal(artifact.artifactType, 'note');
  assert.equal(artifact.role, 'capture');
  assert.equal(artifact.displayName, 'Inbound Capture');
  assert.equal(artifact.status, 'active');
  assert.equal(artifact.tenant, 'acme');
  assert.equal(artifact.trustTier, 2);
  assert.deepEqual(artifact.visibility, ['account:acme-co']);
  assert.deepEqual(artifact.tags, ['inbound', 'triage']);
  assert.equal(artifact.slug, 'orgs/acme/notes/capture');
  assert.equal(artifact.body, 'Body text.');
  assert.deepEqual(artifact.problems, []);
});

test('strips a UTF-8 BOM and tolerates CRLF line endings', () => {
  const source = '﻿---\r\nartifact_type: note\r\ndisplay_name: CRLF Note\r\n---\r\n\r\n# Heading\r\n';
  const artifact = parseArtifact(source, { path: 'notes/crlf.md' });
  assert.equal(artifact.artifactType, 'note');
  assert.equal(artifact.displayName, 'CRLF Note');
  assert.equal(artifact.body, '# Heading\n');
});

test('parses quoted scalars, booleans, numbers, null and inline arrays', () => {
  const artifact = parseArtifact(
    [
      '---',
      'artifact_type: note',
      'display_name: "Quoted: with a colon"',
      "single: 'kept verbatim'",
      'flag: true',
      'off: false',
      'count: 42',
      'ratio: 1.5',
      'parent_org_id: null',
      'tags: [a, "b, c", d]',
      '---',
      ''
    ].join('\n'),
    { path: 'notes/scalars.md' }
  );

  assert.equal(artifact.displayName, 'Quoted: with a colon');
  assert.equal(artifact.frontmatter.single, 'kept verbatim');
  assert.equal(artifact.frontmatter.flag, true);
  assert.equal(artifact.frontmatter.off, false);
  assert.equal(artifact.frontmatter.count, 42);
  assert.equal(artifact.frontmatter.ratio, 1.5);
  assert.equal(artifact.frontmatter.parent_org_id, null);
  assert.deepEqual(artifact.frontmatter.tags, ['a', 'b, c', 'd']);
});

test('parses block lists, list-of-maps (members:) and nested maps (settings:)', () => {
  const artifact = parseArtifact(
    [
      '---',
      'artifact_type: note',
      'role: org_definition',
      'display_name: Acme',
      'members:',
      '  - user_id: ada',
      '    role: admin',
      '  - user_id: grace',
      '    role: member',
      'settings:',
      '  timezone: America/New_York',
      '  default_language: en',
      'references:',
      '  - ADR-020',
      '  - ADR-026',
      'metadata:',
      '  services: [cold_email_outbound]',
      '  nested:',
      '    deep: value',
      '---',
      ''
    ].join('\n'),
    { path: 'orgs/acme/README.md' }
  );

  assert.deepEqual(artifact.frontmatter.members, [
    { user_id: 'ada', role: 'admin' },
    { user_id: 'grace', role: 'member' }
  ]);
  assert.deepEqual(artifact.frontmatter.settings, {
    timezone: 'America/New_York',
    default_language: 'en'
  });
  assert.deepEqual(artifact.frontmatter.references, ['ADR-020', 'ADR-026']);
  assert.deepEqual(artifact.frontmatter.metadata, {
    services: ['cold_email_outbound'],
    nested: { deep: 'value' }
  });
});

test('preserves unknown keys verbatim (the metadata/role extension dimensions)', () => {
  const artifact = parseArtifact(
    ['---', 'artifact_type: prompt', 'document_id: DOC-1', 'inherited_by: [alpha]', 'journey_stage: awareness', '---', ''].join(
      '\n'
    ),
    { path: 'prompts/x.md' }
  );
  assert.equal(artifact.frontmatter.document_id, 'DOC-1');
  assert.deepEqual(artifact.frontmatter.inherited_by, ['alpha']);
  assert.equal(artifact.frontmatter.journey_stage, 'awareness');
});

test('never throws on hostile or malformed input', () => {
  const hostile = [
    '---\nartifact_type: note\n__proto__: {"polluted": true}\n---\n',
    '---\n\t\t: : :\n- orphan\n  stray\n---\n',
    '---\nunterminated: yes\n\nbody without a closing fence\n',
    '---\nmembers:\n---\n',
    '',
    '---\n---\n',
    '```\n---\nnot: frontmatter\n---\n```\n'
  ];
  for (const source of hostile) {
    assert.doesNotThrow(() => parseArtifact(source, { path: 'notes/hostile.md' }));
  }
  parseArtifact('---\nartifact_type: note\n__proto__: {"a":1}\n---\n', { path: 'n.md' });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);

  assert.doesNotThrow(() => parseArtifact(null, { path: 'notes/null.md' }));
  const fromNull = parseArtifact(null, { path: 'notes/null.md' });
  assert.equal(fromNull.problems.some((p) => p.code === 'unreadable-source'), true);
});

test('records an unterminated frontmatter block as a warning rather than throwing', () => {
  const artifact = parseArtifact('---\nartifact_type: note\n\nbody\n', { path: 'notes/open.md' });
  assert.equal(artifact.problems.some((p) => p.code === 'unterminated-frontmatter'), true);
  assert.equal(artifact.problems.some((p) => p.severity === 'error'), false);
});

test('records an unknown artifact_type instead of silently dropping the file (P16, F-008)', () => {
  const artifact = parseArtifact('---\nartifact_type: projection_definition\n---\n', { path: 'notes/x.md' });
  assert.equal(artifact.artifactType, 'projection_definition');
  const problem = artifact.problems.find((p) => p.code === 'unknown-artifact-type');
  assert.ok(problem);
  assert.equal(problem.severity, 'error');
  assert.equal(ARTIFACT_TYPES.includes('projection_definition'), false);
});

test('records a missing frontmatter block as an error (P17)', () => {
  const artifact = parseArtifact('# Just a heading\n', { path: 'notes/bare.md' });
  assert.equal(artifact.problems.some((p) => p.code === 'missing-frontmatter' && p.severity === 'error'), true);
});

test('flags the retired org_type field with its retirement date', () => {
  const artifact = parseArtifact('---\nartifact_type: note\norg_type: platform\n---\n', { path: 'README.md' });
  const problem = artifact.problems.find((p) => p.code === 'retired-org-type-field');
  assert.ok(problem);
  assert.equal(problem.severity, 'warning');
  assert.match(problem.message, /2026-07-21/);
});

test('extracts wikilinks but ignores fenced code blocks and inline code spans', () => {
  const body = [
    '---',
    'artifact_type: note',
    '---',
    '',
    'See [[handbook]] and [[orgs/alpha/notes/playbook|the playbook]].',
    '',
    'Inline `[[not-a-link]]` stays code.',
    '',
    '```md',
    '[[also-not-a-link]]',
    '```'
  ].join('\n');
  const artifact = parseArtifact(body, { path: 'notes/links.md' });
  assert.deepEqual(
    artifact.links.map((link) => link.target),
    ['handbook', 'orgs/alpha/notes/playbook']
  );
  assert.equal(artifact.links[1].display, 'the playbook');
  assert.equal(artifact.links[0].display, null);
});

test('a wikilink in a markdown table drops the escaped-pipe backslash', () => {
  // Inside a table cell a literal `|` must be written `\|`, so a piped wikilink
  // arrives as [[target\|display]]. The backslash is table syntax, not a target.
  const source = [
    '---',
    'artifact_type: note',
    '---',
    '',
    '| Metric | Source |',
    '| --- | --- |',
    '| Coverage | [[notes/README\\|notes/]] |',
    '',
    'And outside a table: [[notes/README|notes/]].',
    ''
  ].join('\n');
  const doc = parseArtifact(source, { path: 'x.md', slug: 'x' });
  assert.deepEqual(
    doc.links.map((link) => link.target),
    ['notes/README', 'notes/README']
  );
  assert.deepEqual(
    doc.links.map((link) => link.display),
    ['notes/', 'notes/']
  );
});
