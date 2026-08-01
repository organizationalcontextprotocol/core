'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ocp = require('../index.js');
const { defineConfig, createFileSystemSubstrate, openGrants, envGrants, canView } = ocp;
const { baseFixture, writeSubstrate, removeSubstrate } = require('./fixture.js');

test('the public export surface is stable', () => {
  assert.deepEqual(Object.keys(ocp).sort(), [
    'ALTITUDES',
    'ARTIFACT_TYPES',
    'CONTENT_DIRS',
    'HALT_THRESHOLD',
    'PROTOCOL',
    'SUBSTRATE_DIRS',
    'VERSION',
    'canView',
    'conformance',
    'createFileSystemSubstrate',
    'defineConfig',
    'derivePolicy',
    'discoveredReport',
    'envGrants',
    'filterTree',
    'haltStatus',
    'isListed',
    'llmsText',
    'lookupScope',
    'openGrants',
    'parseArtifact',
    'parseVisibility',
    'project',
    'scopedCorpus',
    'walk'
  ]);
});

test('the canon constants are frozen and correct', () => {
  assert.deepEqual(ocp.ARTIFACT_TYPES, ['note', 'adr', 'prompt', 'template', 'report']);
  assert.deepEqual(ocp.ALTITUDES, ['platform', 'tenant', 'agency', 'account', 'user']);
  assert.deepEqual(ocp.SUBSTRATE_DIRS, ['_kernels', '_adrs', '_system', '_users']);
  assert.deepEqual(ocp.CONTENT_DIRS, ['notes', 'prompts', 'templates', 'reports', 'initiatives', 'orgs']);
  assert.equal(Object.isFrozen(ocp.ARTIFACT_TYPES), true);
  assert.equal(Object.isFrozen(ocp.ALTITUDES), true);
  assert.equal(Object.isFrozen(ocp.PROTOCOL), true);
  assert.equal(ocp.PROTOCOL.spec, 'ADR-020');
  assert.equal(ocp.HALT_THRESHOLD, 0.1);
  assert.equal(ocp.VERSION, require('../package.json').version);
});

test('defineConfig fills the four documented keys with defaults', () => {
  assert.deepEqual(defineConfig(), {
    substrateRoot: '.',
    exclude: ['.git', 'node_modules', 'DISCOVERED.md', 'CLAUDE.md', 'assets'],
    sourceBlobBase: null,
    displayOverrides: {}
  });
});

test('defineConfig is an identity-style helper that returns a validated copy', () => {
  const input = {
    substrateRoot: '../../../AIOS',
    exclude: ['.git'],
    sourceBlobBase: 'https://github.com/acme/aios/blob/main',
    displayOverrides: { 'orgs/alpha': 'Alpha' }
  };
  const config = defineConfig(input);
  assert.deepEqual(config, input);
  config.exclude.push('mutated');
  assert.deepEqual(input.exclude, ['.git']);
});

test('defineConfig rejects wrong shapes and unknown keys', () => {
  assert.throws(() => defineConfig(null), TypeError);
  assert.throws(() => defineConfig([]), TypeError);
  assert.throws(() => defineConfig({ substrateRoot: '' }), TypeError);
  assert.throws(() => defineConfig({ substrateRoot: 5 }), TypeError);
  assert.throws(() => defineConfig({ exclude: 'no' }), TypeError);
  assert.throws(() => defineConfig({ exclude: [1] }), TypeError);
  assert.throws(() => defineConfig({ sourceBlobBase: 7 }), TypeError);
  assert.throws(() => defineConfig({ displayOverrides: { a: 1 } }), TypeError);
  assert.throws(() => defineConfig({ contentRoot: 'context' }), /unknown config key "contentRoot"/);
});

test('the filesystem substrate reads, lists and refuses to escape its root', () => {
  const dir = writeSubstrate(baseFixture());
  try {
    const substrate = createFileSystemSubstrate(dir);
    assert.equal(substrate.kind, 'filesystem');
    assert.match(substrate.read('README.md'), /Acme Platform/);

    const rootEntries = substrate.list('');
    assert.ok(rootEntries.some((entry) => entry.name === 'README.md' && entry.type === 'file'));
    assert.ok(rootEntries.some((entry) => entry.name === 'orgs' && entry.type === 'dir'));

    assert.throws(() => substrate.read('../escape.md'), /escapes the substrate root/);
    assert.throws(() => substrate.list('/etc'), /escapes the substrate root/);
    assert.throws(() => createFileSystemSubstrate(''), TypeError);
  } finally {
    removeSubstrate(dir);
  }
});

test('sha() returns null outside a git checkout and the HEAD commit inside one (P8)', () => {
  const dir = writeSubstrate(baseFixture());
  try {
    assert.equal(createFileSystemSubstrate(dir).sha(), null);

    const sha = 'a'.repeat(40);
    fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(dir, '.git', 'refs', 'heads', 'main'), `${sha}\n`);
    assert.equal(createFileSystemSubstrate(dir).sha(), sha);

    // Detached HEAD.
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), `${'b'.repeat(40)}\n`);
    assert.equal(createFileSystemSubstrate(dir).sha(), 'b'.repeat(40));

    // Packed refs.
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/packed\n');
    fs.writeFileSync(
      path.join(dir, '.git', 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${'c'.repeat(40)} refs/heads/packed\n`
    );
    assert.equal(createFileSystemSubstrate(dir).sha(), 'c'.repeat(40));
  } finally {
    removeSubstrate(dir);
  }
});

test('walk stamps the substrate SHA onto the tree', () => {
  const dir = writeSubstrate(baseFixture());
  try {
    const sha = 'd'.repeat(40);
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), `${sha}\n`);
    const tree = ocp.walk(createFileSystemSubstrate(dir), { substrateRoot: dir });
    assert.equal(tree.sha, sha);
    assert.match(ocp.discoveredReport(tree), new RegExp(sha));
  } finally {
    removeSubstrate(dir);
  }
});

test('openGrants resolves to an explicit open posture, not a platform-admin identity', () => {
  const port = openGrants();
  assert.equal(port.kind, 'open');
  // 0.5.0: the adapter declares `open` rather than claiming staff identity. It reaches
  // every scope except `platform`, because an open wiki has no staff and `_users/**`
  // membership declarations must not become readable merely because auth is switched off.
  assert.deepEqual(port.resolve({}), { isPlatformAdmin: false, orgs: [], open: true });
  assert.equal(canView(port.resolve({}), { org: 'anything' }), true);
  assert.equal(canView(port.resolve({}), 'internal'), true);
  assert.equal(canView(port.resolve({}), 'platform'), false);
});

test('envGrants maps a platform-admin token and an org allowlist, and otherwise fails closed', () => {
  const port = envGrants({
    OCP_PLATFORM_ADMIN_TOKEN: 'staff-token',
    OCP_ORG_TOKENS: '{"tok-alpha":["alpha"],"tok-multi":["beta","gamma"]}'
  });
  assert.equal(port.kind, 'env');

  assert.deepEqual(port.resolve({ headers: { authorization: 'Bearer staff-token' } }), {
    isPlatformAdmin: true,
    orgs: []
  });
  assert.deepEqual(port.resolve({ headers: { 'x-ocp-token': 'tok-alpha' } }), {
    isPlatformAdmin: false,
    orgs: ['alpha']
  });
  assert.deepEqual(port.resolve('tok-multi'), { isPlatformAdmin: false, orgs: ['beta', 'gamma'] });

  assert.deepEqual(port.resolve({ headers: { authorization: 'Bearer unknown' } }), {
    isPlatformAdmin: false,
    orgs: []
  });
  assert.deepEqual(port.resolve({}), { isPlatformAdmin: false, orgs: [] });
  assert.deepEqual(port.resolve(undefined), { isPlatformAdmin: false, orgs: [] });
});

test('envGrants reads a Headers-like object and survives malformed JSON', () => {
  const headers = new Map([['authorization', 'Bearer tok-alpha']]);
  const port = envGrants({ OCP_ORG_TOKENS: '{"tok-alpha":["alpha"]}' });
  assert.deepEqual(port.resolve({ headers }), { isPlatformAdmin: false, orgs: ['alpha'] });

  const broken = envGrants({ OCP_ORG_TOKENS: 'not json at all' });
  assert.deepEqual(broken.resolve('tok-alpha'), { isPlatformAdmin: false, orgs: [] });
});
