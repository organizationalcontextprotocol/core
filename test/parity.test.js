'use strict';

// The count-parity invariant and every contributor to it.
//
// This file exists because the invariant was wrong three times in one release cycle and
// the suite said nothing each time. A throwing assertion is itself a new failure mode,
// and it has to be tested at least as hard as the failure it detects: otherwise a silent
// drop has been traded for a loud crash, which is worse when the assertion is the thing
// that is wrong.
//
// The three contributors, each of which the assertion has been wrong about in turn:
//   1. a file that cannot be read or parsed   (kind 'file',      filesSeen +1)
//   2. a directory that cannot be listed      (kind 'directory', filesSeen +0)
//   3. a symlink loop                         (kind 'directory', filesSeen +0)
//
// The invariant is DIRECTIONAL. `filesSeen > accounted` is a drop and throws. The other
// direction is an accounting artifact and is recorded, never thrown.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { walk, createFileSystemSubstrate, haltStatus } = require('../index.js');
const { baseFixture, note, writeSubstrate, removeSubstrate } = require('./fixture.js');

function withSubstrate(files, fn, mutate) {
  const dir = writeSubstrate(files);
  /** @type {string[]} */
  const chmodded = [];
  const denyDir = (rel) => {
    const target = path.join(dir, rel);
    fs.chmodSync(target, 0o000);
    chmodded.push(target);
  };
  try {
    if (mutate) mutate(dir, denyDir);
    return fn(walk(createFileSystemSubstrate(dir), { substrateRoot: dir }), dir);
  } finally {
    // Restore before cleanup, or rmSync cannot descend into what we just denied.
    for (const target of chmodded) {
      try {
        fs.chmodSync(target, 0o755);
      } catch {
        /* best effort */
      }
    }
    removeSubstrate(dir);
  }
}

/** The identity the walk asserts, recomputed here so the test does not trust the source. */
function accounting(tree) {
  const rendered = tree.nodes.filter((n) => n.kind === 'artifact' || n.entryPoint !== null).length;
  const fileFailures = tree.discovered.filter((e) => e.kind !== 'directory').length;
  return { filesSeen: tree.stats.filesSeen, rendered, fileFailures, accounted: rendered + fileFailures };
}

test('contributor 1: a file that cannot be READ is recorded as kind file and keeps parity', () => {
  // Note the failure mode chosen. `parseArtifact` is deliberately lenient and never
  // throws: malformed frontmatter yields a `problems` entry on a parsed artifact, not a
  // discovered entry. So the only way to reach a kind-'file' failure through the
  // filesystem port is an I/O error, and a dangling symlink named *.md is the portable
  // way to produce one: it lists as a file and ENOENTs on read.
  withSubstrate(
    baseFixture(),
    (tree) => {
      const failures = tree.discovered.filter((e) => e.path.endsWith('dangling.md'));
      assert.equal(failures.length, 1, 'the unreadable file is recorded');
      assert.equal(failures[0].kind, 'file', 'a file failure must declare kind file');
      assert.match(failures[0].reason, /read failed/);
      const a = accounting(tree);
      assert.equal(a.filesSeen, a.accounted, 'a file failure is counted on both sides');
    },
    (dir) => fs.symlinkSync('does-not-exist.md', path.join(dir, 'notes', 'dangling.md'))
  );
});

test('contributor 2: a directory that cannot be listed is kind directory and does not abort', () => {
  const files = baseFixture();
  withSubstrate(
    files,
    (tree) => {
      const failures = tree.discovered.filter((e) => e.reason.includes('directory listing failed'));
      assert.equal(failures.length, 1, 'the unlistable directory is recorded');
      assert.equal(failures[0].kind, 'directory', 'a listing failure must declare kind directory');
      assert.ok(tree.nodes.length > 0, 'the walk continued');
    },
    (dir, denyDir) => denyDir(path.join('orgs', 'bravo', 'notes'))
  );
});

test('contributor 3: a symlink loop is recorded, declares kind directory, and does not throw', () => {
  // The 0.5.0 regression, pinned. This push site was missed when `kind` was introduced,
  // so the loop counted as a file failure while filesSeen never moved, and walk() threw
  // on any substrate containing a symlink loop.
  const files = baseFixture();
  withSubstrate(
    files,
    (tree) => {
      const loops = tree.discovered.filter((e) => e.reason.includes('symlink loop'));
      assert.equal(loops.length, 1, 'the loop is recorded exactly once');
      assert.equal(loops[0].kind, 'directory', 'a symlink loop must declare kind directory');
      assert.equal(haltStatus(tree).halt, false, 'a single loop is not a halt condition');
    },
    // Isolated deliberately: this test is about the loop alone. Stacking the other two
    // contributors here pushes the failure rate over the 10% halt threshold, which is
    // correct behavior and would make this assertion test the wrong thing.
    (dir) => fs.symlinkSync('..', path.join(dir, 'notes', 'loop'))
  );
});

test('a substrate with a symlink loop walks without throwing at all', () => {
  // The narrowest possible statement of the regression: the entry point must not throw.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-core-loop-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      '---\nartifact_type: note\nrole: org_definition\norg_id: t\ndisplay_name: T\nparent_org_id: null\n---\n\n# T\n\n## Core Canon\n\nNone declared yet.\n'
    );
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'README.md'), note({ artifact_type: 'note', display_name: 'Sub' }, 'body'));
    fs.symlinkSync('..', path.join(dir, 'sub', 'loop'));
    assert.doesNotThrow(() => walk(createFileSystemSubstrate(dir), { substrateRoot: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the invariant is directional: over-accounting is recorded, never thrown', () => {
  // A directory-kind entry adds to discovered without adding to filesSeen. Under the old
  // equality that was a throw; under the directional form it is not a drop and must not be.
  const files = baseFixture();
  withSubstrate(
    files,
    (tree) => {
      const a = accounting(tree);
      assert.ok(a.filesSeen >= a.accounted, 'never under-accounted, which is the only fatal direction');
      assert.ok(tree.discovered.some((e) => e.kind === 'directory'), 'the artifact is present and benign');
    },
    (dir, denyDir) => {
      fs.symlinkSync('..', path.join(dir, 'notes', 'loop'));
      fs.symlinkSync('does-not-exist.md', path.join(dir, 'notes', 'dangling.md'));
      denyDir(path.join('orgs', 'bravo', 'notes'));
    }
  );
});

test('parity holds across every contributor combined', () => {
  withSubstrate(
    baseFixture(),
    (tree) => {
      const a = accounting(tree);
      assert.ok(a.filesSeen >= a.accounted, 'no silent drop with all three contributors present');
      const kinds = new Set(tree.discovered.map((e) => e.kind));
      assert.ok(kinds.has('file'), 'file failure present');
      assert.ok(kinds.has('directory'), 'directory-level failure present');
      assert.ok(!kinds.has(undefined), 'EVERY discovered entry declares a kind');
    },
    (dir, denyDir) => {
      fs.symlinkSync('..', path.join(dir, 'notes', 'loop'));
      fs.symlinkSync('does-not-exist.md', path.join(dir, 'notes', 'dangling.md'));
      denyDir(path.join('orgs', 'bravo', 'notes'));
    }
  );
});

test('every discovered entry declares a kind, on any substrate', () => {
  // The general form of the regression: an entry without a kind is counted as a file
  // failure, and a push site that forgets one is how this broke. Guards future sites.
  withSubstrate(
    baseFixture(),
    (tree) => {
      for (const entry of tree.discovered) {
        assert.ok(
          entry.kind === 'file' || entry.kind === 'directory',
          `discovered entry for ${entry.path} must declare kind file or directory, got ${entry.kind}`
        );
      }
    },
    (dir, denyDir) => {
      fs.symlinkSync('..', path.join(dir, 'notes', 'loop'));
      fs.symlinkSync('does-not-exist.md', path.join(dir, 'notes', 'dangling.md'));
      denyDir(path.join('orgs', 'bravo', 'notes'));
    }
  );
});
