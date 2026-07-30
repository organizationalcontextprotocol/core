'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { walk, createFileSystemSubstrate, derivePolicy, canView, lookupScope, filterTree } = require('../index.js');
const { baseFixture, orgReadme, note, writeSubstrate, removeSubstrate } = require('./fixture.js');

function withTree(files, fn) {
  const dir = writeSubstrate(files);
  try {
    const tree = walk(createFileSystemSubstrate(dir), { substrateRoot: dir });
    return fn(tree);
  } finally {
    removeSubstrate(dir);
  }
}

test('derivePolicy derives ownership from the path', () => {
  withTree(baseFixture(), (tree) => {
    const policy = derivePolicy(tree);

    assert.equal(policy[''], 'internal');
    assert.equal(policy['notes'], 'internal');
    assert.equal(policy['notes/handbook'], 'internal');
    assert.equal(policy['_system'], 'internal');
    assert.equal(policy['_kernels/initiative'], 'internal');
    assert.equal(policy['_users'], 'platform');
    assert.equal(policy['_users/ada/memberships'], 'platform');

    assert.deepEqual(policy['orgs/alpha'], { org: 'alpha' });
    assert.deepEqual(policy['orgs/alpha/notes/playbook'], { org: 'alpha' });
    assert.deepEqual(policy['orgs/bravo/notes/pricing'], { org: 'bravo' });
  });
});

test('the deepest owning org wins for nested organizations', () => {
  withTree(baseFixture(), (tree) => {
    const policy = derivePolicy(tree);
    assert.deepEqual(policy['orgs/alpha'], { org: 'alpha' });
    assert.deepEqual(policy['orgs/alpha/orgs'], { org: 'alpha' });
    assert.deepEqual(policy['orgs/alpha/orgs/beta'], { org: 'beta' });
    assert.deepEqual(policy['orgs/alpha/orgs/beta/notes/deposit-program'], { org: 'beta' });
  });
});

test('a declared visibility overrides the path-derived scope and cascades to descendants', () => {
  const files = baseFixture();
  files['orgs/alpha/notes/README.md'] = note(
    {
      artifact_type: 'note',
      role: 'notes_index',
      display_name: 'Alpha Notes',
      status: 'active',
      visibility: '[public]'
    },
    'Alpha public notes.'
  );
  withTree(files, (tree) => {
    const policy = derivePolicy(tree);
    assert.deepEqual(policy['orgs/alpha'], { org: 'alpha' });
    assert.equal(policy['orgs/alpha/notes'], 'public');
    // cascaded to the descendant, which declares nothing of its own
    assert.equal(policy['orgs/alpha/notes/playbook'], 'public');
    // and did not leak sideways
    assert.deepEqual(policy['orgs/alpha/orgs/beta/notes/deposit-program'], { org: 'beta' });
  });
});

test('a descendant declaration overrides an inherited cascade', () => {
  const files = baseFixture();
  files['orgs/alpha/notes/README.md'] = note(
    { artifact_type: 'note', display_name: 'Alpha Notes', visibility: '[public]' },
    'Public.'
  );
  files['orgs/alpha/notes/playbook.md'] = note(
    { artifact_type: 'note', display_name: 'Alpha Playbook', visibility: '[platform]' },
    'Staff only.'
  );
  withTree(files, (tree) => {
    const policy = derivePolicy(tree);
    assert.equal(policy['orgs/alpha/notes'], 'public');
    assert.equal(policy['orgs/alpha/notes/playbook'], 'platform');
  });
});

test('an org boundary resets an inherited cascade so one root declaration cannot publish every tenant', () => {
  const files = baseFixture();
  files['README.md'] = orgReadme('acme-platform', 'Acme Platform', null, 'visibility: [public]\n');
  withTree(files, (tree) => {
    const policy = derivePolicy(tree);
    assert.equal(policy[''], 'public');
    assert.equal(policy['notes/handbook'], 'public');
    assert.equal(policy['orgs'], 'public');
    // The tenant subtrees stay tenant-scoped.
    assert.deepEqual(policy['orgs/alpha'], { org: 'alpha' });
    assert.deepEqual(policy['orgs/alpha/notes/playbook'], { org: 'alpha' });
    assert.deepEqual(policy['orgs/alpha/orgs/beta/notes/deposit-program'], { org: 'beta' });
  });
});

test('visibility accepts the canon account: vocabulary and the implemented org: vocabulary', () => {
  const files = baseFixture();
  files['notes/handbook.md'] = note(
    { artifact_type: 'note', display_name: 'Operator Handbook', visibility: '[account:acme-co]' },
    'Body.'
  );
  files['notes/README.md'] = note({ artifact_type: 'note', display_name: 'Platform Notes' }, 'Body.');
  withTree(files, (tree) => {
    const policy = derivePolicy(tree);
    assert.deepEqual(policy['notes/handbook'], { org: 'acme-co' });
  });
});

test('canView honours every RequiredScope variant', () => {
  const anon = { isPlatformAdmin: false, orgs: [] };
  const alpha = { isPlatformAdmin: false, orgs: ['alpha'] };
  const admin = { isPlatformAdmin: true, orgs: [] };

  assert.equal(canView(anon, 'public'), true);
  assert.equal(canView(alpha, 'public'), true);
  assert.equal(canView(admin, 'public'), true);

  assert.equal(canView(anon, 'internal'), false);
  assert.equal(canView(alpha, 'internal'), true);
  assert.equal(canView(admin, 'internal'), true);

  assert.equal(canView(anon, 'platform'), false);
  assert.equal(canView(alpha, 'platform'), false);
  assert.equal(canView(admin, 'platform'), true);

  assert.equal(canView(alpha, { org: 'alpha' }), true);
  assert.equal(canView(alpha, { org: 'bravo' }), false);
  assert.equal(canView(admin, { org: 'bravo' }), true);
  assert.equal(canView(anon, { org: 'alpha' }), false);

  // Unknown or malformed scopes fail closed.
  assert.equal(canView(alpha, 'nonsense'), false);
  assert.equal(canView(alpha, undefined), false);
  assert.equal(canView(undefined, 'public'), true);
});

test('org grants never cascade: reaching alpha does not reach its child org beta', () => {
  withTree(baseFixture(), (tree) => {
    const policy = derivePolicy(tree);
    const alpha = { isPlatformAdmin: false, orgs: ['alpha'] };
    assert.equal(canView(alpha, lookupScope(policy, 'orgs/alpha/notes/playbook')), true);
    assert.equal(canView(alpha, lookupScope(policy, 'orgs/alpha/orgs/beta/notes/deposit-program')), false);

    // The identity provider flattens the downward-admin cascade before ocp-core sees it.
    const alphaAdmin = { isPlatformAdmin: false, orgs: ['alpha', 'beta'] };
    assert.equal(canView(alphaAdmin, lookupScope(policy, 'orgs/alpha/orgs/beta/notes/deposit-program')), true);
  });
});

test('lookupScope resolves by nearest prefix and fails closed on unknown routes', () => {
  withTree(baseFixture(), (tree) => {
    const policy = derivePolicy(tree);
    assert.deepEqual(lookupScope(policy, 'orgs/alpha/notes/playbook'), { org: 'alpha' });
    // A route that was never walked still resolves to its nearest known ancestor.
    assert.deepEqual(lookupScope(policy, 'orgs/alpha/notes/does-not-exist'), { org: 'alpha' });
    assert.deepEqual(lookupScope(policy, '/orgs/alpha/'), { org: 'alpha' });
    // Nothing above the root: platform-only, never public.
    assert.equal(lookupScope({}, 'anything/at/all'), 'platform');
  });
});

test('filterTree prunes at the first invisible ancestor', () => {
  withTree(baseFixture(), (tree) => {
    const filtered = filterTree(tree, { isPlatformAdmin: false, orgs: ['alpha'] });
    const routes = filtered.nodes.map((node) => node.route);
    assert.ok(routes.includes(''));
    assert.ok(routes.includes('orgs/alpha'));
    assert.ok(routes.includes('orgs/alpha/notes/playbook'));
    assert.equal(routes.includes('orgs/bravo'), false);
    assert.equal(routes.includes('orgs/alpha/orgs/beta'), false);
    // _users is platform-scoped, so a non-admin never enumerates memberships.
    assert.equal(routes.includes('_users'), false);
    assert.equal(routes.includes('_users/ada/memberships'), false);
  });
});

// Documented limitation (README "Known limitation", grounding F-016). Pruning at the
// first invisible ancestor means a nested tenant needs reach to every org on its path.
// This test exists to lock the documented behavior, not to bless it.
test('a nested tenant granted only its own org sees none of its own content', () => {
  withTree(baseFixture(), (tree) => {
    const betaOnly = filterTree(tree, { isPlatformAdmin: false, orgs: ['beta'] });
    // The walk is cut at orgs/alpha, which requires { org: 'alpha' }.
    assert.equal(betaOnly.nodes.some((node) => node.route.includes('beta')), false);
    assert.equal(betaOnly.byRoute['orgs/alpha'], undefined);
    // Shared root-org content is still reachable, which is why this fails quietly.
    assert.ok(betaOnly.byRoute['notes/handbook']);

    const withAncestor = filterTree(tree, { isPlatformAdmin: false, orgs: ['alpha', 'beta'] });
    const routes = withAncestor.nodes.map((node) => node.route);
    assert.ok(routes.includes('orgs/alpha/orgs/beta/notes/deposit-program'));
    // Still no sibling leakage.
    assert.equal(routes.some((route) => route.startsWith('orgs/bravo')), false);
  });
});

test('a platform admin sees the whole tree; a viewer with no reach sees nothing', () => {
  withTree(baseFixture(), (tree) => {
    const all = filterTree(tree, { isPlatformAdmin: true, orgs: [] });
    assert.equal(all.nodes.length, tree.nodes.length);

    const none = filterTree(tree, { isPlatformAdmin: false, orgs: [] });
    assert.equal(none.root, null);
    assert.equal(none.nodes.length, 0);
  });
});
