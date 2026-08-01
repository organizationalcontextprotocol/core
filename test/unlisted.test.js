'use strict';

// The `unlisted` value and the predicate split (0.5.0).
//
// `unlisted` is the first visibility value whose AUTHORIZATION answer and
// DISCOVERABILITY answer differ: reachable by anyone holding the address, never
// enumerated. One predicate cannot answer both questions, so this file pins both
// sides of the split and both silent failure modes it prevents:
//
//   canView used on an enumeration surface  -> unlisted pages land in llms.txt
//   isListed used on the gate               -> the legitimate bearer gets a 403
//
// Falsifier numbering matches the 0.5.0 release directive.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  walk,
  createFileSystemSubstrate,
  parseVisibility,
  canView,
  isListed,
  filterTree,
  scopedCorpus,
  llmsText,
  project,
  conformance,
  derivePolicy,
  lookupScope,
  openGrants,
  haltStatus
} = require('../index.js');
const { baseFixture, note, writeSubstrate, removeSubstrate } = require('./fixture.js');

const ANON = { isPlatformAdmin: false, orgs: [] };
const ADMIN = { isPlatformAdmin: true, orgs: [] };
const ALPHA = { isPlatformAdmin: false, orgs: ['alpha'] };

// A substrate carrying one unlisted page inside a public subtree, so that the page is
// reachable-but-not-listed rather than merely out of scope.
function unlistedFixture() {
  const files = baseFixture();
  files['notes/README.md'] = note(
    {
      artifact_type: 'note',
      role: 'notes_index',
      display_name: 'Platform Notes',
      status: 'active',
      visibility: '[public]'
    },
    'Root org notes.'
  );
  files['notes/secret-briefing.md'] = note(
    {
      artifact_type: 'note',
      role: 'sop',
      display_name: 'Bearer Briefing',
      status: 'active',
      visibility: '[unlisted]'
    },
    'Reachable by address, never enumerated.'
  );
  return files;
}

function withSubstrate(files, fn) {
  const dir = writeSubstrate(files);
  try {
    return fn(walk(createFileSystemSubstrate(dir), { substrateRoot: dir }), dir);
  } finally {
    removeSubstrate(dir);
  }
}

/* ---------------------------------------------------------------- *
 * 1-2. parseVisibility
 * ---------------------------------------------------------------- */

test('F1: parseVisibility recognizes `unlisted` as a bare token', () => {
  assert.equal(parseVisibility('unlisted'), 'unlisted');
  assert.equal(parseVisibility(['unlisted']), 'unlisted');
});

test('F2: multiple audiences resolve to the most restrictive, order-independent', () => {
  assert.equal(parseVisibility(['public', 'unlisted']), 'unlisted');
  assert.equal(parseVisibility(['unlisted', 'public']), 'unlisted');
});

test('F2b: the restrictiveness ladder is total and order-independent', () => {
  assert.equal(parseVisibility(['public', 'internal']), 'internal');
  assert.equal(parseVisibility(['internal', 'public']), 'internal');
  assert.equal(parseVisibility(['unlisted', 'internal']), 'internal');
  assert.deepEqual(parseVisibility(['internal', 'org:acme']), { org: 'acme' });
  assert.deepEqual(parseVisibility(['org:acme', 'internal']), { org: 'acme' });
  assert.equal(parseVisibility(['org:acme', 'platform']), 'platform');
  assert.equal(parseVisibility(['platform', 'org:acme']), 'platform');
});

test('F2c: two different org tokens fail closed to platform', () => {
  assert.equal(parseVisibility(['org:acme', 'org:other']), 'platform');
  assert.equal(parseVisibility(['org:other', 'org:acme']), 'platform');
  // The same org twice is not a conflict.
  assert.deepEqual(parseVisibility(['org:acme', 'account:acme']), { org: 'acme' });
});

test('F2d: single-token and unrecognized behavior is unchanged', () => {
  assert.equal(parseVisibility('public'), 'public');
  assert.equal(parseVisibility('platform'), 'platform');
  assert.equal(parseVisibility(['publik']), null);
  assert.equal(parseVisibility([]), null);
  assert.equal(parseVisibility(undefined), null);
  // An unrecognized token alongside a recognized one does not suppress the recognized one.
  assert.equal(parseVisibility(['publik', 'internal']), 'internal');
});

test('the four org prefixes stay accepted aliases and all normalize to one shape', () => {
  for (const prefix of ['org', 'account', 'tenant', 'agency']) {
    assert.deepEqual(parseVisibility([`${prefix}:acme`]), { org: 'acme' }, `${prefix}: must normalize`);
  }
});

/* ---------------------------------------------------------------- *
 * 3-5. the predicate split
 * ---------------------------------------------------------------- */

test('F3: isListed(openGrants) is false for unlisted', () => {
  assert.equal(isListed(openGrants().resolve(), 'unlisted'), false);
});

test('F4: isListed exempts nobody, platform admins included', () => {
  assert.equal(isListed({ isPlatformAdmin: true }, 'unlisted'), false);
  assert.equal(isListed(ADMIN, 'unlisted'), false);
  assert.equal(isListed(ANON, 'unlisted'), false);
  assert.equal(isListed(ALPHA, 'unlisted'), false);
});

test('F5: canView allows unlisted for every viewer, including the anonymous bearer', () => {
  assert.equal(canView({}, 'unlisted'), true);
  assert.equal(canView(ANON, 'unlisted'), true);
  assert.equal(canView(ALPHA, 'unlisted'), true);
  assert.equal(canView(ADMIN, 'unlisted'), true);
});

test('the two predicates agree on every scope that is not unlisted', () => {
  const scopes = ['public', 'internal', 'platform', { org: 'alpha' }, { org: 'bravo' }];
  for (const grants of [ANON, ALPHA, ADMIN, openGrants().resolve()]) {
    for (const scope of scopes) {
      assert.equal(
        isListed(grants, scope),
        canView(grants, scope),
        `predicates must agree on ${JSON.stringify(scope)} for ${JSON.stringify(grants)}`
      );
    }
  }
});

/* ---------------------------------------------------------------- *
 * 6-7. enumeration surfaces
 * ---------------------------------------------------------------- */

test('F6: llmsText over a corpus containing an unlisted page omits it', () => {
  withSubstrate(unlistedFixture(), (tree) => {
    for (const grants of [ANON, ADMIN, openGrants().resolve()]) {
      const text = llmsText(scopedCorpus(tree, grants));
      assert.ok(!text.includes('Bearer Briefing'), 'unlisted display name must not appear in llms.txt');
      assert.ok(!text.includes('secret-briefing'), 'unlisted route must not appear in llms.txt');
    }
  });
});

test('F7: filterTree drops the unlisted route from nodes, byRoute, policy and discovered', () => {
  withSubstrate(unlistedFixture(), (tree) => {
    const filtered = filterTree(tree, ADMIN);
    const route = 'notes/secret-briefing';
    assert.ok(!filtered.nodes.some((n) => n.route === route), 'absent from nodes');
    assert.ok(!Object.prototype.hasOwnProperty.call(filtered.byRoute, route), 'absent from byRoute');
    assert.ok(!Object.prototype.hasOwnProperty.call(filtered.policy, route), 'absent from policy');
    assert.ok(!JSON.stringify(filtered.discovered).includes('secret-briefing'), 'absent from discovered');
  });
});

test('the unlisted page is still AUTHORIZED at the gate, which is the whole point', () => {
  withSubstrate(unlistedFixture(), (tree) => {
    const policy = derivePolicy(tree);
    const scope = lookupScope(policy, 'notes/secret-briefing');
    assert.equal(scope, 'unlisted', 'policy must resolve the declared value, not a path default');
    assert.equal(canView(ANON, scope), true, 'an anonymous bearer may fetch it');
    assert.equal(isListed(ANON, scope), false, 'and may never discover it');
  });
});

test('an unlisted page that fails to parse does not name itself in DISCOVERED output', () => {
  const files = unlistedFixture();
  // A file whose frontmatter cannot parse, sitting at an unlisted route.
  files['notes/secret-broken.md'] = '---\nvisibility: [unlisted]\n  bad: : :\n---\n\nbody\n';
  withSubstrate(files, (tree) => {
    const filtered = filterTree(tree, ADMIN);
    assert.ok(
      !JSON.stringify(filtered.discovered).includes('secret-broken'),
      'a failed unlisted file must not surface its path through the scoped discovered list'
    );
  });
});

/* ---------------------------------------------------------------- *
 * 8-9. project() refuses ungranted input
 * ---------------------------------------------------------------- */

test('F8: project() throws on a raw OcpTree', () => {
  withSubstrate(baseFixture(), (tree) => {
    assert.throws(() => project(tree), TypeError);
    assert.throws(() => project(tree), /filterTree|scopedCorpus/);
  });
});

test('F9: project() accepts the output of filterTree and of scopedCorpus', () => {
  withSubstrate(baseFixture(), (tree) => {
    const filtered = filterTree(tree, ADMIN);
    const pageTree = project(filtered);
    assert.equal(typeof pageTree.name, 'string');
    assert.ok(Array.isArray(pageTree.children));

    const corpus = scopedCorpus(tree, ADMIN);
    const fromCorpus = project(corpus.tree);
    assert.ok(Array.isArray(fromCorpus.children));
  });
});

test('project() over a filtered tree cannot emit an unlisted page', () => {
  withSubstrate(unlistedFixture(), (tree) => {
    const serialized = JSON.stringify(project(filterTree(tree, ADMIN)));
    assert.ok(!serialized.includes('Bearer Briefing'));
    assert.ok(!serialized.includes('secret-briefing'));
  });
});

/* ---------------------------------------------------------------- *
 * 10. openGrants posture
 * ---------------------------------------------------------------- */

test('F10: openGrants does not reach platform scope', () => {
  const open = openGrants().resolve();
  assert.equal(canView(open, 'platform'), false);
  assert.equal(isListed(open, 'platform'), false);
});

test('openGrants is an explicit open posture, not a platform-admin identity claim', () => {
  const open = openGrants().resolve();
  assert.equal(open.isPlatformAdmin, false, 'must not impersonate staff');
  assert.equal(open.open, true, 'must declare the open posture explicitly');
  // It still does its job for everything that is not platform or unlisted.
  assert.equal(canView(open, 'public'), true);
  assert.equal(canView(open, 'internal'), true);
  assert.equal(canView(open, { org: 'anything' }), true);
  assert.equal(isListed(open, 'internal'), true);
});

test('open mode does not enumerate _users membership declarations', () => {
  withSubstrate(baseFixture(), (tree) => {
    const corpus = scopedCorpus(tree, openGrants().resolve());
    const routes = corpus.pages.map((p) => p.route);
    assert.ok(
      !routes.some((r) => r.startsWith('_users')),
      'platform-scoped membership material must not be reachable merely because auth is off'
    );
  });
});

/* ---------------------------------------------------------------- *
 * 11-12. conformance diagnostics
 * ---------------------------------------------------------------- */

function conformanceOver(files) {
  const dir = writeSubstrate(files);
  try {
    return conformance(walk(createFileSystemSubstrate(dir), { substrateRoot: dir }));
  } finally {
    removeSubstrate(dir);
  }
}

test('F11: an unrecognized visibility token is a conformance error', () => {
  const files = baseFixture();
  files['notes/typo.md'] = note(
    { artifact_type: 'note', display_name: 'Typo Note', status: 'active', visibility: '[publik]' },
    'body'
  );
  const result = conformanceOver(files);
  const hits = result.problems.filter((p) => p.code === 'visibility-unrecognized-token');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'error');
  assert.match(hits[0].message, /publik/);
  assert.match(hits[0].message, /path-derived/);
  assert.equal(result.ok, false);
});

test('F12: a non-canonical prefix warns, and the policy still resolves', () => {
  const files = baseFixture();
  files['notes/aliased.md'] = note(
    { artifact_type: 'note', display_name: 'Aliased Note', status: 'active', visibility: '[account:acme]' },
    'body'
  );
  const dir = writeSubstrate(files);
  try {
    const tree = walk(createFileSystemSubstrate(dir), { substrateRoot: dir });
    const result = conformance(tree);
    const hits = result.problems.filter((p) => p.code === 'visibility-non-canonical-prefix');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, 'warning');
    assert.match(hits[0].message, /org:/);

    const policy = derivePolicy(tree);
    assert.deepEqual(lookupScope(policy, 'notes/aliased'), { org: 'acme' }, 'alias must still resolve');
  } finally {
    removeSubstrate(dir);
  }
});

test('multiple audiences is a conformance error naming the tokens', () => {
  const files = baseFixture();
  files['notes/two-audiences.md'] = note(
    { artifact_type: 'note', display_name: 'Two Audiences', status: 'active', visibility: '[public, unlisted]' },
    'body'
  );
  const result = conformanceOver(files);
  const hits = result.problems.filter((p) => p.code === 'visibility-multiple-audiences');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'error');
});

test('a conformant single-value visibility emits no visibility diagnostic', () => {
  const files = baseFixture();
  files['notes/fine.md'] = note(
    { artifact_type: 'note', display_name: 'Fine Note', status: 'active', visibility: '[unlisted]' },
    'body'
  );
  const result = conformanceOver(files);
  assert.equal(result.problems.filter((p) => p.code.startsWith('visibility-')).length, 0);
});

/* ---------------------------------------------------------------- *
 * 13. count parity
 * ---------------------------------------------------------------- */

test('F13: count parity holds on the reference fixture', () => {
  withSubstrate(baseFixture(), (tree) => {
    const rendered =
      tree.nodes.filter((n) => n.kind === 'artifact').length +
      tree.nodes.filter((n) => n.kind !== 'artifact' && n.entryPoint !== null).length;
    assert.equal(
      tree.stats.filesSeen,
      rendered + tree.discovered.length,
      'every file walked is served as a page, served as a directory landing, or recorded as a failure'
    );
    assert.equal(haltStatus(tree).halt, false);
  });
});

test('count parity holds when files fail to parse', () => {
  const files = baseFixture();
  files['notes/broken.md'] = '---\nartifact_type: note\n  : : bad\n---\n\nbody\n';
  withSubstrate(files, (tree) => {
    const rendered =
      tree.nodes.filter((n) => n.kind === 'artifact').length +
      tree.nodes.filter((n) => n.kind !== 'artifact' && n.entryPoint !== null).length;
    assert.equal(tree.stats.filesSeen, rendered + tree.discovered.length);
  });
});

test('the naive identity is false, which is why the assertion counts directory landings', () => {
  // Guards the exact mistake a future contributor will make: a directory README becomes
  // that directory node's entryPoint, never a separate artifact node, so
  // `artifacts + discovered` leaves a residual equal to the number of such directories.
  withSubstrate(baseFixture(), (tree) => {
    const artifacts = tree.nodes.filter((n) => n.kind === 'artifact').length;
    const landings = tree.nodes.filter((n) => n.kind !== 'artifact' && n.entryPoint !== null).length;
    assert.ok(landings > 0, 'fixture must contain directory landings for this to be meaningful');
    assert.notEqual(
      tree.stats.filesSeen,
      artifacts + tree.discovered.length,
      'if this ever passes, the naive identity became true and the assertion form should be revisited'
    );
  });
});
