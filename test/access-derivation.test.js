'use strict';

// The access-derivation ruling, ADR-020 section 14.7 R1 through R4 (0.6.0).
//
// R1  reach is the ancestor relation; ancestors of a grant render as structural stubs
// R2  the protocol kernel (_kernels, _adrs, _system at the root) is `public` by derivation
// R3  the substrate root is an org: root README/AGENTS/content dirs take the graph-root
//     org's scope, read from the root README's `org_id`, failing closed to `platform`
// R4  nothing derives to `internal` any more; it survives only by declaration
//
// Falsifier numbering matches the 0.6.0 release directive. Falsifier 6 is the corrected
// form: the directive wrote "anonymous / openGrants()" as though they were the same
// posture, and they are opposites. Anonymous is `{orgs: []}`. `openGrants()` is the
// everything-public adapter and is pinned separately, unchanged, in 6b.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  walk,
  createFileSystemSubstrate,
  defineConfig,
  canView,
  isListed,
  filterTree,
  scopedCorpus,
  llmsText,
  project,
  conformance,
  derivePolicy,
  lookupScope,
  openGrants
} = require('../index.js');
const { baseFixture, note, orgReadme, writeSubstrate, removeSubstrate } = require('./fixture.js');

const ANON = { isPlatformAdmin: false, orgs: [] };
const ADMIN = { isPlatformAdmin: true, orgs: [] };
const BETA = { isPlatformAdmin: false, orgs: ['beta'] };
const FAKE = { isPlatformAdmin: false, orgs: ['not-a-real-org'] };

// The base fixture is already shaped like the reference substrate: a graph-root org
// (`acme-platform`) carrying the substrate dirs, a child org `alpha`, and `beta` nested
// beneath it at orgs/alpha/orgs/beta. `beta` is the client that could not reach its own
// wiki before R1. `_adrs/` and `AGENTS.md` are added here rather than to the shared
// fixture so that other suites' node counts do not move.
function fixture(extra) {
  return Object.assign(
    baseFixture(),
    {
      'AGENTS.md': note(
        { artifact_type: 'note', role: 'agent_guide', display_name: 'Agent Guide', status: 'active' },
        'How agents operate here.'
      ),
      '_adrs/README.md': note(
        { artifact_type: 'note', role: 'adr_index', display_name: 'Protocol ADRs', status: 'active' },
        'Promoted protocol ADRs.'
      ),
      '_adrs/ADR-001-substrate.md': note(
        { artifact_type: 'adr', role: 'decision', display_name: 'ADR-001 Substrate', status: 'active' },
        'Protocol-tier decision.'
      )
    },
    extra || {}
  );
}

function build(files) {
  const dir = writeSubstrate(files || fixture());
  const tree = walk(createFileSystemSubstrate(dir), defineConfig({ substrateRoot: dir }));
  return { dir, tree, policy: derivePolicy(tree) };
}

function routesOf(list) {
  return list.map((n) => n.route).sort();
}

// ---------------------------------------------------------------------------
// Falsifier 1: the client reaches its own subtree at all. This is the whole point.
// ---------------------------------------------------------------------------

test('F1: a client granted only the nested org reaches every page of its own subtree', () => {
  const { dir, tree } = build();
  try {
    const corpus = scopedCorpus(tree, BETA);
    const own = routesOf(corpus.pages.filter((p) => p.route.startsWith('orgs/alpha/orgs/beta')));
    assert.deepEqual(own, [
      'orgs/alpha/orgs/beta',
      'orgs/alpha/orgs/beta/notes',
      'orgs/alpha/orgs/beta/notes/deposit-program'
    ]);
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 2: the ancestor is a stub. Listed so it can be traversed, not viewable
// because there is no page. This is the predicate split's third distinct use, and it
// points the OPPOSITE way from `unlisted`.
// ---------------------------------------------------------------------------

test('F2: the ancestor org is present as a stub, isListed true and canView false', () => {
  const { dir, tree, policy } = build();
  try {
    const filtered = filterTree(tree, BETA);
    const ancestor = filtered.byRoute['orgs/alpha'];
    assert.ok(ancestor, 'the ancestor org must be retained so the client can traverse to its own subtree');
    assert.equal(ancestor.stub, true, 'it must be retained as a stub, not as a page');

    const scope = lookupScope(policy, 'orgs/alpha');
    assert.equal(isListed(BETA, scope), false, 'the ancestor scope itself is not listed for this viewer');
    assert.equal(canView(BETA, scope), false, 'and it is certainly not viewable');

    // The whole chain down to the grant is retained, all as stubs.
    for (const route of ['', 'orgs', 'orgs/alpha', 'orgs/alpha/orgs']) {
      assert.equal(filtered.byRoute[route].stub, true, `${route || '<root>'} must be a stub`);
    }
  } finally {
    removeSubstrate(dir);
  }
});

test('F2b: a stub carries no body, no metadata, and no display name', () => {
  const { dir, tree } = build();
  try {
    const stub = filterTree(tree, BETA).byRoute['orgs/alpha'];
    for (const field of ['body', 'frontmatter', 'displayName', 'artifactType', 'role', 'tags', 'links', 'visibility']) {
      assert.equal(stub[field], undefined, `a stub must not carry \`${field}\``);
    }
    assert.deepEqual(Object.keys(stub).sort(), ['children', 'kind', 'name', 'path', 'route', 'stub']);
  } finally {
    removeSubstrate(dir);
  }
});

test('F2c: a stub never becomes a page in any projection', () => {
  const { dir, tree } = build();
  try {
    const corpus = scopedCorpus(tree, BETA);
    assert.equal(
      corpus.pages.some((p) => p.route === 'orgs/alpha'),
      false,
      'the stub must not appear in corpus.pages'
    );
    assert.equal(corpus.text.includes('Alpha secret sauce'), false);
    assert.equal(llmsText(corpus).includes('/orgs/alpha)'), false, 'the stub must not be linked in llms.txt');
    // It DOES appear in the navigation tree, or the descendant is unreachable.
    const flat = JSON.stringify(project(corpus.tree));
    assert.ok(flat.includes('orgs/alpha/orgs/beta'), 'the granted descendant must be navigable');
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 3: siblings of the path stay invisible. A stub is a corridor, not a door.
// ---------------------------------------------------------------------------

test('F3: a sibling org is absent from tree, policy, corpus, and llms.txt', () => {
  const { dir, tree } = build();
  try {
    const filtered = filterTree(tree, BETA);
    const corpus = scopedCorpus(tree, BETA);
    assert.equal(filtered.byRoute['orgs/bravo'], undefined, 'absent from the tree');
    assert.equal(
      Object.keys(filtered.policy).some((r) => r.startsWith('orgs/bravo')),
      false,
      'absent from the scoped policy map'
    );
    assert.equal(corpus.pages.some((p) => p.route.startsWith('orgs/bravo')), false, 'absent from the corpus');
    assert.equal(llmsText(corpus).includes('bravo'), false, 'absent from llms.txt');
    assert.equal(corpus.text.includes('Bravo confidential pricing'), false);
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 4: traversal is not readability. The stub must not open the parent.
// ---------------------------------------------------------------------------

test('F4: zero non-ancestor pages of the parent org are reachable by the child', () => {
  const { dir, tree } = build();
  try {
    const corpus = scopedCorpus(tree, BETA);
    const parentPages = corpus.pages.filter(
      (p) => p.route.startsWith('orgs/alpha') && !p.route.startsWith('orgs/alpha/orgs/beta')
    );
    assert.deepEqual(routesOf(parentPages), [], 'the parent org exposes no page to its nested child');
    assert.equal(corpus.text.includes('Alpha secret sauce'), false);
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 5: a fabricated org grant. Before R2/R3 this read every `internal` node,
// because `internal` asked only whether the grants named ANY org.
// ---------------------------------------------------------------------------

test('F5: a fabricated org grant reaches the kernel only, with zero org and zero root content', () => {
  const { dir, tree } = build();
  try {
    const corpus = scopedCorpus(tree, FAKE);
    const routes = routesOf(corpus.pages);
    assert.ok(routes.length > 0, 'the kernel is public, so something is reachable');
    for (const route of routes) {
      assert.ok(
        /^(_kernels|_adrs|_system)(\/|$)/.test(route),
        `a fabricated grant reached ${route}, which is not protocol kernel`
      );
    }
    assert.equal(routes.includes(''), false, 'no root README');
    assert.equal(routes.includes('AGENTS'), false, 'no AGENTS');
    assert.equal(routes.some((r) => r.startsWith('notes')), false, 'no root content dir');
    assert.equal(routes.some((r) => r.startsWith('_users')), false, 'no _users');
    assert.equal(routes.some((r) => r.startsWith('orgs')), false, 'no org content');
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 6 (corrected): anonymous. Identical reach to F5, which is the point:
// after R2 and R3 nothing derives to `internal`, so holding a fabricated org grant
// buys exactly nothing over holding none at all.
// ---------------------------------------------------------------------------

test('F6: an anonymous viewer reaches the kernel and no root, org, or user content', () => {
  const { dir, tree } = build();
  try {
    const anon = routesOf(scopedCorpus(tree, ANON).pages);
    assert.ok(anon.length > 0);
    for (const route of anon) assert.ok(/^(_kernels|_adrs|_system)(\/|$)/.test(route), `anonymous reached ${route}`);
    assert.equal(anon.includes(''), false);
    assert.equal(anon.includes('AGENTS'), false);
    assert.equal(anon.some((r) => r.startsWith('_users')), false);
    assert.deepEqual(anon, routesOf(scopedCorpus(tree, FAKE).pages), 'a fabricated grant buys nothing over anonymity');
  } finally {
    removeSubstrate(dir);
  }
});

test('F6b: openGrants() is unchanged and still reaches everything except platform', () => {
  const { dir, tree } = build();
  try {
    const corpus = scopedCorpus(tree, openGrants().resolve());
    const routes = routesOf(corpus.pages);
    assert.ok(routes.includes('orgs/alpha/notes/playbook'), 'the open posture reaches org content');
    assert.ok(routes.includes(''), 'and root content');
    assert.equal(routes.some((r) => r.startsWith('_users')), false, 'but never _users, which decides authorization');
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 7: R3's fail-closed clause. Without `org_id` the root cannot be attributed
// to an organization, so its content must not fall back to something weaker.
// ---------------------------------------------------------------------------

test('F7: a root README with no org_id fails root content closed to platform', () => {
  const files = fixture({
    'README.md': note({ artifact_type: 'note', display_name: 'Nameless Root', status: 'active' }, 'No org_id here.')
  });
  const { dir, tree, policy } = build(files);
  try {
    assert.equal(lookupScope(policy, ''), 'platform');
    assert.equal(lookupScope(policy, 'notes'), 'platform');
    assert.equal(lookupScope(policy, 'notes/handbook'), 'platform');
    assert.equal(lookupScope(policy, 'AGENTS'), 'platform');
    // The kernel is unaffected: it is machinery, not the root org's content.
    assert.equal(lookupScope(policy, '_kernels'), 'public');
    assert.equal(lookupScope(policy, '_system/artifact-types'), 'public');

    const anon = routesOf(scopedCorpus(tree, ANON).pages);
    assert.equal(anon.some((r) => r === '' || r.startsWith('notes')), false, 'root content is not anonymous-readable');
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 8: the misplacement guard. Under R3 a stray root entry is a SCOPING error,
// not a tidiness one, because it silently takes the graph-root org's scope.
// ---------------------------------------------------------------------------

test('F8: conformance warns once for a stray root directory and names where it belongs', () => {
  const files = fixture({
    'sops/README.md': note({ artifact_type: 'note', role: 'notes_index', display_name: 'Stray SOPs' }, 'Misplaced.')
  });
  const { dir, tree } = build(files);
  try {
    const report = conformance(tree);
    const hits = report.problems.filter((p) => p.code === 'root-entry-misplaced');
    assert.equal(hits.length, 1, 'exactly one warning, naming the stray entry');
    assert.equal(hits[0].severity, 'warning');
    assert.ok(hits[0].path.startsWith('sops'), 'the warning names the offending entry');
    assert.ok(/orgs\//.test(hits[0].message), 'and suggests the likely correct location');
  } finally {
    removeSubstrate(dir);
  }
});

test('F8b: a conformant root produces no misplacement warning', () => {
  const { dir, tree } = build();
  try {
    const hits = conformance(tree).problems.filter((p) => p.code === 'root-entry-misplaced');
    assert.deepEqual(hits, []);
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 9: the platform admin is the cascade's limiting case at the root, and
// `isListed` still exempts nobody from `unlisted`.
// ---------------------------------------------------------------------------

test('F9: a platform admin reaches everything, and unlisted still exempts nobody', () => {
  const files = fixture({
    'orgs/bravo/notes/beta-invite.md': note(
      { artifact_type: 'note', display_name: 'Bravo Invite', status: 'active', visibility: 'unlisted' },
      'Bearer-only.'
    )
  });
  const { dir, tree, policy } = build(files);
  try {
    const filtered = filterTree(tree, ADMIN);
    assert.equal(filtered.nodes.some((n) => n.stub === true), false, 'an admin sees no stubs; everything is readable');
    assert.ok(filtered.byRoute['orgs/bravo/notes/pricing'], 'admin reaches every tenant');
    assert.ok(filtered.byRoute['_users/ada/memberships'], 'and the platform tier');

    const unlistedScope = lookupScope(policy, 'orgs/bravo/notes/beta-invite');
    assert.equal(canView(ADMIN, unlistedScope), true, 'an admin may fetch the bearer page');
    assert.equal(isListed(ADMIN, unlistedScope), false, 'but it is enumerated for nobody');
    assert.equal(filtered.byRoute['orgs/bravo/notes/beta-invite'], undefined);
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// Falsifier 10: the whole-substrate invariants still hold under the new derivation.
// ---------------------------------------------------------------------------

test('F10: count parity holds and every node resolves to a ruled scope', () => {
  const { dir, tree, policy } = build();
  try {
    assert.deepEqual(tree.discovered, [], 'a clean fixture discovers nothing');

    const seen = {};
    for (const node of tree.nodes) {
      const scope = lookupScope(policy, node.route);
      const key = typeof scope === 'string' ? scope : `org:${scope.org}`;
      seen[key] = (seen[key] || 0) + 1;
    }
    // R4: after R2 and R3 nothing DERIVES to internal.
    assert.equal(seen.internal, undefined, 'nothing derives to internal any more');
    assert.ok(seen.public > 0, 'the kernel derives public');
    assert.ok(seen.platform > 0, '_users still derives platform');
    assert.ok(seen['org:acme-platform'] > 0, 'root content takes the graph-root org scope');
    assert.ok(seen['org:alpha'] > 0 && seen['org:beta'] > 0);
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// R4's trust boundary, and the guard that makes the port/grants confusion loud.
// DISCOVERED #79: failing closed is not the same as failing loud.
// ---------------------------------------------------------------------------

test('a GrantsPort passed where Grants is expected throws and names .resolve()', () => {
  const { dir, tree } = build();
  try {
    const port = openGrants();
    for (const call of [
      () => canView(port, 'public'),
      () => isListed(port, 'public'),
      () => filterTree(tree, port),
      () => scopedCorpus(tree, port)
    ]) {
      assert.throws(call, (err) => {
        assert.ok(err instanceof TypeError);
        assert.match(err.message, /\.resolve\(/);
        return true;
      });
    }
  } finally {
    removeSubstrate(dir);
  }
});

test('the guard does not fire on ordinary grants, including the empty and open shapes', () => {
  const { dir, tree } = build();
  try {
    assert.doesNotThrow(() => scopedCorpus(tree, ANON));
    assert.doesNotThrow(() => scopedCorpus(tree, ADMIN));
    assert.doesNotThrow(() => scopedCorpus(tree, openGrants().resolve()));
    assert.doesNotThrow(() => scopedCorpus(tree, undefined));
    assert.doesNotThrow(() => scopedCorpus(tree, null));
    // An object that carries reach fields AND a resolve method is a grants object with
    // an extra property, not a port. Do not punish it.
    assert.doesNotThrow(() => canView({ isPlatformAdmin: false, orgs: [], resolve() {} }, 'public'));
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// R2's boundary: `_users` is the one substrate dir that is not kernel.
// ---------------------------------------------------------------------------

test('R2: the kernel is public but _users stays platform', () => {
  const { dir, policy } = build();
  try {
    for (const route of ['_kernels', '_kernels/initiative', '_adrs', '_adrs/ADR-001-substrate', '_system']) {
      assert.equal(lookupScope(policy, route), 'public', `${route} must derive public`);
    }
    for (const route of ['_users', '_users/ada', '_users/ada/memberships']) {
      assert.equal(lookupScope(policy, route), 'platform', `${route} must stay platform`);
    }
  } finally {
    removeSubstrate(dir);
  }
});

test('R3: root README, AGENTS, and root content dirs take the graph-root org scope', () => {
  const { dir, policy } = build();
  try {
    for (const route of ['', 'AGENTS', 'notes', 'notes/handbook']) {
      assert.deepEqual(lookupScope(policy, route), { org: 'acme-platform' }, `${route || '<root>'} scope`);
    }
    // `orgs/` is a content dir but its subtree is governed by the org rule, so the
    // folder node itself must not be attributed to the graph-root org's content.
    assert.deepEqual(lookupScope(policy, 'orgs/alpha'), { org: 'alpha' });
  } finally {
    removeSubstrate(dir);
  }
});

test('R3: the graph-root org holder reaches root content but not the nested tenants', () => {
  const { dir, tree } = build();
  try {
    const routes = routesOf(scopedCorpus(tree, { isPlatformAdmin: false, orgs: ['acme-platform'] }).pages);
    assert.ok(routes.includes(''), 'the root README is the graph-root org own definition');
    assert.ok(routes.includes('notes/handbook'));
    assert.equal(routes.some((r) => r.startsWith('orgs/alpha')), false, 'no downward cascade without admin');
    assert.equal(routes.some((r) => r.startsWith('_users')), false);
  } finally {
    removeSubstrate(dir);
  }
});

// ---------------------------------------------------------------------------
// The Directionality Invariant, restated as a test. ADR-010 section 8.5.
// ---------------------------------------------------------------------------

test('the Directionality Invariant holds: no principal reads an ancestor content', () => {
  const { dir, tree } = build();
  try {
    const corpus = scopedCorpus(tree, BETA);
    for (const page of corpus.pages) {
      assert.ok(
        page.route.startsWith('orgs/alpha/orgs/beta') || /^(_kernels|_adrs|_system)(\/|$)/.test(page.route),
        `beta reached ${page.route}, which is neither its own subtree nor protocol kernel`
      );
    }
  } finally {
    removeSubstrate(dir);
  }
});
