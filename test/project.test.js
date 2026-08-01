'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { walk, createFileSystemSubstrate, project, filterTree, scopedCorpus, llmsText } = require('../index.js');
const { baseFixture, writeSubstrate, removeSubstrate } = require('./fixture.js');

// 0.5.0: `project` refuses an unfiltered tree, so these shape tests scope first. A staff
// grant is used because these assert the projection shape rather than the filtering.
const STAFF = { isPlatformAdmin: true, orgs: [] };

function withTree(fn) {
  const dir = writeSubstrate(baseFixture());
  try {
    return fn(walk(createFileSystemSubstrate(dir), { substrateRoot: dir }));
  } finally {
    removeSubstrate(dir);
  }
}

function withScopedTree(fn) {
  return withTree((tree) => fn(filterTree(tree, STAFF), tree));
}

function findFolder(children, name) {
  return children.find((child) => child.type === 'folder' && child.name === name);
}

test('project produces the documented Fumadocs PageTree shape', () => {
  withScopedTree((tree) => {
    const pageTree = project(tree);

    assert.equal(pageTree.name, 'Acme Platform');
    assert.ok(Array.isArray(pageTree.children));

    // The graph root's own README is the first page.
    assert.deepEqual(pageTree.children[0], { type: 'page', name: 'Acme Platform', url: '/docs' });

    const notes = findFolder(pageTree.children, 'Platform Notes');
    assert.ok(notes);
    assert.deepEqual(notes.index, { type: 'page', name: 'Platform Notes', url: '/docs/notes' });
    assert.deepEqual(notes.children, [
      { type: 'page', name: 'Operator Handbook', url: '/docs/notes/handbook' }
    ]);

    const orgs = findFolder(pageTree.children, 'Organizations');
    const alpha = findFolder(orgs.children, 'Alpha Co');
    assert.ok(alpha);
    assert.equal(alpha.index.url, '/docs/orgs/alpha');
    const alphaChildren = findFolder(alpha.children, 'Alpha Children');
    assert.ok(findFolder(alphaChildren.children, 'Beta Sub'));
  });
});

test('project honours a custom baseUrl', () => {
  withScopedTree((tree) => {
    const pageTree = project(tree, { baseUrl: '/wiki' });
    assert.equal(pageTree.children[0].url, '/wiki');
    const notes = findFolder(pageTree.children, 'Platform Notes');
    assert.equal(notes.children[0].url, '/wiki/notes/handbook');
  });
});

test('a directory without a README renders as a folder with no index page', () => {
  const files = baseFixture();
  delete files['notes/README.md'];
  const dir = writeSubstrate(files);
  try {
    const tree = walk(createFileSystemSubstrate(dir), { substrateRoot: dir });
    const notes = findFolder(project(filterTree(tree, STAFF)).children, 'Notes');
    assert.ok(notes);
    assert.equal(notes.index, undefined);
    assert.equal(notes.children.length, 1);
  } finally {
    removeSubstrate(dir);
  }
});

test('project rejects anything that is not a tree', () => {
  assert.throws(() => project(null), TypeError);
  assert.throws(() => project({ nodes: [] }), TypeError);
});

test('project rejects an unfiltered tree, naming the fix', () => {
  withTree((tree) => {
    assert.throws(() => project(tree), TypeError);
    assert.throws(() => project(tree), /filterTree|scopedCorpus/);
  });
});

test('llmsText lists exactly the corpus pages, in tree order', () => {
  withTree((tree) => {
    const corpus = scopedCorpus(tree, { isPlatformAdmin: true, orgs: [] });
    const text = llmsText(corpus);
    const listed = text
      .split('\n')
      .filter((line) => line.startsWith('- ['))
      .map((line) => line.slice(3, line.indexOf(']')));
    assert.deepEqual(listed, corpus.pages.map((page) => page.displayName));
    assert.match(text, /^# Acme Platform$/m);
    assert.match(text, /ADR-020/);
  });
});
