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

// Rewritten for ADR-020 §14.7 R2 and R3 (0.6.0). Every assertion below previously read
// `internal`, which `canView` grants to any viewer holding any org at all, real or not.
// The protocol kernel is now `public` by derivation and the root's own content takes the
// graph-root organization's scope.
test('derivePolicy derives ownership from the path', () => {
  withTree(baseFixture(), (tree) => {
    const policy = derivePolicy(tree);

    // R3: the substrate root is an org, and this content is that org's content.
    assert.deepEqual(policy[''], { org: 'acme-platform' });
    assert.deepEqual(policy['notes'], { org: 'acme-platform' });
    assert.deepEqual(policy['notes/handbook'], { org: 'acme-platform' });
    // R2: protocol machinery, scaffolded identically into every substrate.
    assert.equal(policy['_system'], 'public');
    assert.equal(policy['_kernels/initiative'], 'public');
    // The one substrate dir that is not kernel: it decides authorization.
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

// This test previously locked the OPPOSITE assertion, under the title "a nested tenant
// granted only its own org sees none of its own content", and its own comment said it
// existed to lock the documented behavior rather than to bless it. ADR-020 §14.7 R1
// resolved the question it was holding open: reach is the ancestor relation, so the
// ancestor is retained as a structural stub and the tenant reaches its own subtree.
test('a nested tenant granted only its own org reaches its own content through ancestor stubs', () => {
  withTree(baseFixture(), (tree) => {
    const betaOnly = filterTree(tree, { isPlatformAdmin: false, orgs: ['beta'] });

    // Its own subtree is reachable. This is what R1 exists for.
    assert.ok(betaOnly.byRoute['orgs/alpha/orgs/beta/notes/deposit-program']);

    // The ancestor on the path is retained, but only as a corridor.
    assert.equal(betaOnly.byRoute['orgs/alpha'].stub, true);
    assert.equal(betaOnly.byRoute['orgs/alpha'].body, undefined);
    assert.equal(betaOnly.byRoute['orgs/alpha/notes/playbook'], undefined, 'no parent content');

    // R3: root-org content is NOT shared any more. It belongs to the graph-root org.
    assert.equal(betaOnly.byRoute['notes/handbook'], undefined);

    // Siblings of the path stay invisible at every altitude.
    const routes = betaOnly.nodes.map((node) => node.route);
    assert.equal(routes.some((route) => route.startsWith('orgs/bravo')), false);

    // Holding the ancestor grant too turns the stub into a real page.
    const withAncestor = filterTree(tree, { isPlatformAdmin: false, orgs: ['alpha', 'beta'] });
    assert.ok(withAncestor.byRoute['orgs/alpha/orgs/beta/notes/deposit-program']);
    assert.notEqual(withAncestor.byRoute['orgs/alpha'].stub, true);
    assert.equal(withAncestor.nodes.some((node) => node.route.startsWith('orgs/bravo')), false);
  });
});

test('a platform admin sees the whole tree; an ungranted viewer sees only the kernel', () => {
  withTree(baseFixture(), (tree) => {
    const all = filterTree(tree, { isPlatformAdmin: true, orgs: [] });
    assert.equal(all.nodes.length, tree.nodes.length);
    assert.equal(all.nodes.some((node) => node.stub === true), false, 'an admin sees no stubs');

    // Before R2 this saw literally nothing. The protocol kernel is now public by
    // derivation, so an ungranted viewer reaches the machinery and nothing else: no root
    // content, no org content, no `_users`.
    const none = filterTree(tree, { isPlatformAdmin: false, orgs: [] });
    assert.ok(none.root, 'the root is retained as a stub so the kernel is navigable');
    assert.equal(none.root.stub, true);
    const readable = none.nodes.filter((node) => node.stub !== true).map((node) => node.route);
    assert.ok(readable.length > 0);
    for (const route of readable) {
      assert.match(route, /^(_kernels|_system)(\/|$)/, `an ungranted viewer reached ${route}`);
    }
  });
});
