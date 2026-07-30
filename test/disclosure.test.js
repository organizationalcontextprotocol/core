'use strict';

// THE disclosure test. scopedCorpus is the single chokepoint every read surface must
// route through (plan D6). If this file fails, a deployed multi-tenant renderer leaks
// one client's documents to another.

const test = require('node:test');
const assert = require('node:assert/strict');
const { walk, createFileSystemSubstrate, scopedCorpus, llmsText, project } = require('../index.js');
const { baseFixture, writeSubstrate, removeSubstrate } = require('./fixture.js');

function withTree(fn) {
  const dir = writeSubstrate(baseFixture());
  try {
    return fn(walk(createFileSystemSubstrate(dir), { substrateRoot: dir }));
  } finally {
    removeSubstrate(dir);
  }
}

const ALPHA = { isPlatformAdmin: false, orgs: ['alpha'] };
const BRAVO = { isPlatformAdmin: false, orgs: ['bravo'] };
const ADMIN = { isPlatformAdmin: true, orgs: [] };
const ANON = { isPlatformAdmin: false, orgs: [] };

test('a viewer scoped to alpha sees zero of bravo routes, titles, or text', () => {
  withTree((tree) => {
    const corpus = scopedCorpus(tree, ALPHA);
    const routes = corpus.pages.map((page) => page.route);
    const names = corpus.pages.map((page) => page.displayName);

    assert.ok(routes.includes('orgs/alpha/notes/playbook'));

    // Routes
    assert.equal(routes.some((route) => route.startsWith('orgs/bravo')), false);
    assert.equal(routes.some((route) => route.includes('beta')), false);
    // Display names
    assert.equal(names.includes('Bravo Ltd'), false);
    assert.equal(names.includes('Bravo Pricing Decision'), false);
    assert.equal(names.includes('Beta Sub'), false);
    // Extractable text
    assert.equal(corpus.text.includes('Bravo confidential pricing'), false);
    assert.equal(corpus.text.includes('Beta-only commercial terms'), false);
    assert.ok(corpus.text.includes('Alpha secret sauce'));
    // The pruned tree itself
    assert.equal(JSON.stringify(corpus.tree.byRoute).includes('bravo'), false);
  });
});

test('the isolation is symmetric — bravo sees zero of alpha', () => {
  withTree((tree) => {
    const corpus = scopedCorpus(tree, BRAVO);
    assert.equal(corpus.pages.some((page) => page.route.startsWith('orgs/alpha')), false);
    assert.equal(corpus.text.includes('Alpha secret sauce'), false);
    assert.ok(corpus.text.includes('Bravo confidential pricing'));
  });
});

test('an anonymous viewer sees nothing at all in a substrate that declares no public scope', () => {
  withTree((tree) => {
    const corpus = scopedCorpus(tree, ANON);
    assert.equal(corpus.pages.length, 0);
    assert.equal(corpus.text, '');
    assert.equal(corpus.tree.root, null);
  });
});

test('a platform admin sees every page', () => {
  withTree((tree) => {
    const corpus = scopedCorpus(tree, ADMIN);
    const routes = corpus.pages.map((page) => page.route);
    assert.ok(routes.includes('orgs/alpha/notes/playbook'));
    assert.ok(routes.includes('orgs/bravo/notes/pricing'));
    assert.ok(routes.includes('_users/ada/memberships'));
    assert.ok(routes.includes(''));
  });
});

test('each page carries the scope it was admitted under', () => {
  withTree((tree) => {
    const corpus = scopedCorpus(tree, ALPHA);
    const playbook = corpus.pages.find((page) => page.route === 'orgs/alpha/notes/playbook');
    assert.deepEqual(playbook.scope, { org: 'alpha' });
    assert.equal(playbook.url, '/docs/orgs/alpha/notes/playbook');
    assert.equal(playbook.displayName, 'Alpha Playbook');
    assert.equal(playbook.artifactType, 'note');
  });
});

test('the corpus reports the grants it was built for', () => {
  withTree((tree) => {
    assert.deepEqual(scopedCorpus(tree, ALPHA).scope, { isPlatformAdmin: false, orgs: ['alpha'] });
    assert.deepEqual(scopedCorpus(tree, { orgs: ['x'], isPlatformAdmin: 'yes' }).scope, {
      isPlatformAdmin: false,
      orgs: ['x']
    });
  });
});

test('llms.txt is derived from the scoped corpus only', () => {
  withTree((tree) => {
    const text = llmsText(scopedCorpus(tree, ALPHA));
    assert.match(text, /Alpha Playbook/);
    assert.equal(text.includes('Bravo'), false);
    assert.equal(text.includes('Beta'), false);
    assert.match(text, /ocp-core/);
    assert.match(text, /orgs: alpha/);

    const adminText = llmsText(scopedCorpus(tree, ADMIN));
    assert.match(adminText, /Bravo Pricing Decision/);
    assert.match(adminText, /platform-admin/);
  });
});

test('llmsText refuses anything that is not a corpus, so it cannot be handed a raw tree', () => {
  withTree((tree) => {
    assert.throws(() => llmsText(tree), TypeError);
    assert.throws(() => llmsText({ pages: undefined }), TypeError);
  });
});

test('the page tree projected from a scoped corpus contains no out-of-scope names', () => {
  withTree((tree) => {
    const pageTree = project(scopedCorpus(tree, ALPHA).tree);
    const serialized = JSON.stringify(pageTree);
    assert.equal(serialized.includes('Bravo'), false);
    assert.equal(serialized.includes('bravo'), false);
    assert.equal(serialized.includes('Beta Sub'), false);
    assert.ok(serialized.includes('Alpha Co'));
  });
});

test('scopedCorpus accepts a { tree, policy } context and reuses the supplied policy', () => {
  withTree((tree) => {
    // A hand-supplied policy that makes the graph root public: every descendant then
    // resolves to 'public' by nearest-prefix lookup, so an anonymous viewer sees all.
    const corpus = scopedCorpus({ tree, policy: { '': 'public' } }, ANON);
    assert.ok(corpus.pages.length > 5);
    assert.ok(corpus.pages.some((page) => page.route === 'orgs/bravo/notes/pricing'));
  });
});

test('scopedCorpus rejects a non-tree', () => {
  assert.throws(() => scopedCorpus(null, ANON), TypeError);
  assert.throws(() => scopedCorpus({}, ANON), TypeError);
});

test('the scoped tree carries policy only for routes the viewer retained', () => {
  // The policy map is keyed by route, so an unfiltered copy names every tenant's
  // paths to a viewer who cannot see a single one of their pages. Serializing the
  // scoped tree (an RSC payload, an API response, a debug dump) must not leak it.
  withTree((tree) => {
    const viewer = scopedCorpus(tree, { isPlatformAdmin: false, orgs: ['alpha'] });

    const routes = Object.keys(viewer.tree.policy);
    assert.ok(routes.length > 0, 'the viewer still gets policy for what they can see');
    for (const route of routes) {
      assert.ok(
        viewer.tree.byRoute[route],
        `policy route ${route} is one the viewer actually retained`
      );
    }
    assert.deepEqual(
      routes.filter((route) => route.includes('bravo')),
      [],
      'no policy entry names the other tenant'
    );

    // The whole serialized surface, not just the page list.
    const serialized =
      JSON.stringify(viewer.tree) +
      JSON.stringify(viewer.pages) +
      viewer.text +
      llmsText(viewer);
    assert.ok(!serialized.includes('bravo'), 'no trace of the other tenant anywhere');
    assert.ok(!serialized.includes('Bravo Ltd'), 'not the display name either');

    // The owner of the other subtree is unaffected.
    const owner = scopedCorpus(tree, { isPlatformAdmin: false, orgs: ['bravo'] });
    assert.ok(Object.keys(owner.tree.policy).some((route) => route.includes('bravo')));
  });
});
