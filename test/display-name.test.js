'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArtifact } = require('../index.js');

// Grounding F-008: OCP names the human-readable key `display_name`. A schema that
// requires `title` drops 271 of 322 files in the reference substrate. `title` is
// tolerated (Postel's law) but never required.

test('display_name wins over title', () => {
  const artifact = parseArtifact(
    '---\nartifact_type: note\ndisplay_name: Canonical Name\ntitle: Legacy Name\n---\n\n# Heading Name\n',
    { path: 'notes/x.md' }
  );
  assert.equal(artifact.displayName, 'Canonical Name');
});

test('title is accepted when display_name is absent', () => {
  const artifact = parseArtifact('---\nartifact_type: note\ntitle: Legacy Name\n---\n\n# Heading Name\n', {
    path: 'notes/x.md'
  });
  assert.equal(artifact.displayName, 'Legacy Name');
});

test('falls back to the first H1 outside fenced code', () => {
  const artifact = parseArtifact('---\nartifact_type: note\n---\n\n# Heading Name\n\nBody.\n', {
    path: 'notes/x.md'
  });
  assert.equal(artifact.displayName, 'Heading Name');
});

test('an H1 inside a fenced code block is skipped', () => {
  const artifact = parseArtifact(
    ['---', 'artifact_type: note', '---', '', '```md', '# Not The Title', '```', '', '# Real Title', ''].join('\n'),
    { path: 'notes/x.md' }
  );
  assert.equal(artifact.displayName, 'Real Title');
});

test('an H1 inside a tilde-fenced block is skipped too', () => {
  const artifact = parseArtifact(
    ['---', 'artifact_type: note', '---', '', '~~~', '# Not The Title', '~~~', '', '# Real Title', ''].join('\n'),
    { path: 'notes/x.md' }
  );
  assert.equal(artifact.displayName, 'Real Title');
});

test('falls back to a humanized final path segment when nothing else is declared', () => {
  const artifact = parseArtifact('---\nartifact_type: note\n---\n\nNo heading here.\n', {
    path: 'orgs/alpha/notes/sdr-qualification-flow.md'
  });
  assert.equal(artifact.displayName, 'Sdr Qualification Flow');
});

test('a README with nothing declared falls back without inventing a folder name', () => {
  const artifact = parseArtifact('---\nartifact_type: note\n---\n\nNo heading.\n', { path: 'orgs/alpha/README.md' });
  assert.equal(artifact.slug, 'orgs/alpha');
  assert.equal(artifact.displayName, 'Alpha');
});

test('the graph-root README resolves to a stable fallback', () => {
  const artifact = parseArtifact('---\nartifact_type: note\n---\n\nNo heading.\n', { path: 'README.md' });
  assert.equal(artifact.slug, '');
  assert.equal(artifact.displayName, 'README');
});

test('an empty display_name does not shadow the rest of the chain', () => {
  const artifact = parseArtifact('---\nartifact_type: note\ndisplay_name:\n---\n\n# Heading Name\n', {
    path: 'notes/x.md'
  });
  assert.equal(artifact.displayName, 'Heading Name');
});
