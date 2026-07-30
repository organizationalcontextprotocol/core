'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  walk,
  createFileSystemSubstrate,
  discoveredReport,
  haltStatus,
  HALT_THRESHOLD
} = require('../index.js');
const { baseFixture, writeSubstrate, removeSubstrate } = require('./fixture.js');

function withSubstrate(files, fn) {
  const dir = writeSubstrate(files);
  try {
    return fn(dir, createFileSystemSubstrate(dir));
  } finally {
    removeSubstrate(dir);
  }
}

test('README-as-index: a directory takes its display name and role from README.md', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const tree = walk(substrate, { substrateRoot: dir });

    assert.equal(tree.root.route, '');
    assert.equal(tree.root.displayName, 'Acme Platform');
    assert.equal(tree.root.role, 'org_definition');
    assert.equal(tree.root.entryPoint, 'README.md');

    assert.equal(tree.byRoute['orgs/alpha'].displayName, 'Alpha Co');
    assert.equal(tree.byRoute['notes'].displayName, 'Platform Notes');

    // There is no index.md anywhere in OCP, and README.md never becomes its own node.
    assert.equal(tree.byRoute['README'], undefined);
    assert.equal(tree.byRoute['orgs/alpha/README'], undefined);
    assert.equal(tree.nodes.some((node) => node.route.endsWith('index')), false);
  });
});

test('the repository root is itself an organization (the graph root)', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const tree = walk(substrate, { substrateRoot: dir });
    assert.equal(tree.root.kind, 'org');
    assert.equal(tree.root.orgId, 'acme-platform');
    assert.equal(tree.root.parentOrgId, null);
    assert.equal(tree.root.owningOrg, null);
  });
});

test('classifies substrate dirs, content dirs, orgs, users and kernels', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const tree = walk(substrate, { substrateRoot: dir });
    const kindOf = (route) => tree.byRoute[route].kind;

    assert.equal(kindOf('_system'), 'substrate-dir');
    assert.equal(kindOf('_users'), 'substrate-dir');
    assert.equal(kindOf('_users/ada'), 'user');
    assert.equal(kindOf('_kernels'), 'kernel');
    assert.equal(kindOf('notes'), 'content-dir');
    assert.equal(kindOf('orgs'), 'content-dir');
    assert.equal(kindOf('orgs/alpha'), 'org');
    assert.equal(kindOf('orgs/alpha/orgs/beta'), 'org');
    assert.equal(kindOf('notes/handbook'), 'artifact');
  });
});

test('records org lineage through recursive orgs/<a>/orgs/<b> nesting', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const tree = walk(substrate, { substrateRoot: dir });

    const alpha = tree.byRoute['orgs/alpha'];
    assert.equal(alpha.orgId, 'alpha');
    assert.equal(alpha.parentOrgId, 'acme-platform');
    assert.equal(alpha.owningOrg, 'alpha');

    const beta = tree.byRoute['orgs/alpha/orgs/beta'];
    assert.equal(beta.orgId, 'beta');
    assert.equal(beta.parentOrgId, 'alpha');
    assert.equal(beta.owningOrg, 'beta');

    // The deepest owning org wins for everything beneath it.
    assert.equal(tree.byRoute['orgs/alpha/orgs/beta/notes/deposit-program'].owningOrg, 'beta');
    assert.equal(tree.byRoute['orgs/alpha/notes/playbook'].owningOrg, 'alpha');

    // The graph root's own content belongs to no tenant.
    assert.equal(tree.byRoute['notes/handbook'].owningOrg, null);
    assert.equal(tree.byRoute['_users/ada'].owningOrg, null);
  });
});

test('applies config.exclude and skips dot-prefixed entries', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const tree = walk(substrate, { substrateRoot: dir });
    assert.equal(tree.byRoute['assets'], undefined);
    assert.equal(tree.byRoute['assets/logo-notes'], undefined);
    assert.equal(tree.byRoute['.hidden'], undefined);

    const permissive = walk(substrate, { substrateRoot: dir, exclude: [] });
    assert.ok(permissive.byRoute['assets/logo-notes']);
    assert.equal(permissive.byRoute['.hidden'], undefined);
  });
});

test('applies config.displayOverrides by route', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const tree = walk(substrate, {
      substrateRoot: dir,
      displayOverrides: { 'orgs/alpha': 'Alpha (renamed)', 'notes/handbook': 'The Handbook' }
    });
    assert.equal(tree.byRoute['orgs/alpha'].displayName, 'Alpha (renamed)');
    assert.equal(tree.byRoute['notes/handbook'].displayName, 'The Handbook');
  });
});

test('a clean substrate walks with zero discovered failures', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const tree = walk(substrate, { substrateRoot: dir });
    assert.deepEqual(tree.discovered, []);
    const status = haltStatus(tree);
    assert.equal(status.failed, 0);
    assert.equal(status.halt, false);
    assert.equal(status.threshold, HALT_THRESHOLD);
    assert.match(discoveredReport(tree), /No files failed to parse\./);
  });
});

test('fail-soft (D12): an unreadable file lands in discovered[] and never aborts the walk', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const brokenPath = 'orgs/alpha/notes/broken.md';
    const failing = {
      kind: 'failing',
      read(relPath) {
        if (relPath === brokenPath) throw new Error('simulated I/O failure');
        return substrate.read(relPath);
      },
      list(relDir) {
        const entries = substrate.list(relDir);
        if (relDir === 'orgs/alpha/notes') entries.push({ name: 'broken.md', type: 'file' });
        return entries;
      },
      sha() {
        return substrate.sha();
      }
    };

    const tree = walk(failing, { substrateRoot: dir });

    assert.equal(tree.discovered.length, 1);
    assert.equal(tree.discovered[0].path, brokenPath);
    assert.match(tree.discovered[0].reason, /simulated I\/O failure/);

    // The walk completed: siblings and the rest of the tree are still present.
    assert.ok(tree.byRoute['orgs/alpha/notes/playbook']);
    assert.ok(tree.byRoute['orgs/alpha/orgs/beta/notes/deposit-program']);
    assert.equal(tree.byRoute['orgs/alpha/notes/broken'], undefined);

    const report = discoveredReport(tree);
    assert.match(report, /# DISCOVERED\.md/);
    assert.match(report, /orgs\/alpha\/notes\/broken\.md/);
    assert.match(report, /simulated I\/O failure/);

    const status = haltStatus(tree);
    assert.equal(status.failed, 1);
    assert.ok(status.filesSeen > 10);
    assert.equal(status.halt, false);
  });
});

test('haltStatus reports HALT when the failure rate exceeds the threshold', () => {
  withSubstrate(
    {
      'README.md': '---\nartifact_type: note\nrole: org_definition\n---\n\n# Root\n\n## Core Canon\n\nNone declared yet.\n',
      'notes/README.md': '---\nartifact_type: note\n---\n\n# Notes\n'
    },
    (dir, substrate) => {
      const failing = {
        read(relPath) {
          if (relPath.startsWith('notes/')) throw new Error('nope');
          return substrate.read(relPath);
        },
        list(relDir) {
          return substrate.list(relDir);
        }
      };
      const tree = walk(failing, { substrateRoot: dir });
      const status = haltStatus(tree);
      assert.equal(status.failed, 1);
      assert.equal(status.filesSeen, 2);
      assert.equal(status.rate, 0.5);
      assert.equal(status.halt, true);
      assert.match(discoveredReport(tree), /Status: HALT/);
    }
  );
});

test('a directory listing failure is recorded and does not abort the walk', () => {
  withSubstrate(baseFixture(), (dir, substrate) => {
    const failing = {
      read: (relPath) => substrate.read(relPath),
      list(relDir) {
        if (relDir === 'orgs/bravo/notes') throw new Error('EACCES');
        return substrate.list(relDir);
      }
    };
    const tree = walk(failing, { substrateRoot: dir });
    assert.equal(tree.discovered.some((item) => item.path === 'orgs/bravo/notes'), true);
    assert.ok(tree.byRoute['orgs/alpha']);
  });
});

test('walk rejects anything that is not a SubstratePort', () => {
  assert.throws(() => walk({}, {}), TypeError);
  assert.throws(() => walk(null, {}), TypeError);
});
