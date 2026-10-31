'use strict';

// ADR-OCP-007: the record validator. Appendix A's fixtures, then the record fixture corpus whose negative cases
// falsify GB-OCP007-01 to GB-OCP007-07, GB-OCP007-17 and GB-OCP007-22 (the frontmatter's acceptance criterion).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ocp = require('../index.js');
const { baseFixture, writeSubstrate, removeSubstrate } = require('./fixture.js');
const appendixA = require('./fixtures/appendix-a.json');

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('Appendix A: every accept fixture reproduces both forms and is accepted', () => {
  const accepts = appendixA.fixtures.filter((f) => f.expect === 'accept');
  assert.equal(accepts.length, 8);
  for (const f of accepts) {
    const stored = Buffer.from(f.stored_base64.join(''), 'base64');
    const hashed = Buffer.from(f.hash_base64.join(''), 'base64');
    assert.equal(sha(stored), f.stored_sha256, `${f.fixture}: stored sha256`);
    assert.equal(sha(hashed), f.hash_sha256, `${f.fixture}: hash sha256`);
    assert.ok(ocp.records.storedForm(f.value).equals(stored), `${f.fixture}: stored form`);
    assert.ok(ocp.records.hashForm(f.value).equals(hashed), `${f.fixture}: hash form`);
    assert.equal(ocp.records.checkRecordBytes(stored, f.corpus_class).code, null, `${f.fixture}: accepted`);
  }
});

test('Appendix A: every reject fixture names its code', () => {
  const rejects = appendixA.fixtures.filter((f) => f.expect === 'reject');
  assert.equal(rejects.length, 12);
  for (const f of rejects) {
    const input = Buffer.from(f.input_base64.join(''), 'base64');
    assert.equal(sha(input), f.input_sha256, `${f.fixture}: input sha256`);
    assert.equal(ocp.records.checkRecordBytes(input, f.corpus_class).code, f.error, f.fixture);
  }
});

test('LO-186: an integer a double cannot hold names noncanonical_bytes, and 2^53 names integer_out_of_bounds', () => {
  const at = (n) => Buffer.from(`{\n  "$ocp": {\n    "id": "k0_84c457c82b198395164cc59bc9a41f74",\n    "major": 1,\n    "provenance": "fixture",\n    "record_type": "deal"\n  },\n  "data": {\n    "q": ${n}\n  }\n}\n`);
  assert.equal(ocp.records.checkRecordBytes(at('9007199254740993'), 'fixture').code, 'noncanonical_bytes');
  assert.equal(ocp.records.checkRecordBytes(at('9007199254740992'), 'fixture').code, 'integer_out_of_bounds');
  assert.equal(ocp.records.checkRecordBytes(at('9007199254740991'), 'fixture').code, null);
});

// ---- the record fixture corpus ----

const PERSON_ID = 'k0_468cf909954e8539a74805c29f16677b';
const PERSON_PATH = `_records/person/46/${PERSON_ID}.json`;

function record(ocpFields, data) {
  const value = { $ocp: { provenance: 'fixture', ...ocpFields } };
  if (data !== undefined) value.data = data;
  return ocp.records.storedForm(value).toString('utf8');
}

const personRecord = (extra = {}) =>
  record(
    { id: PERSON_ID, major: 1, record_type: 'person', ...extra },
    { external_refs: [{ external_id: '1001', kind: 'person', provider: 'examplecrm' }], source_changed_at: '2026-10-29T18:04:11.000Z' }
  );

function collectionReadme(type, kind, major = 1) {
  return `---
artifact_type: note
role: record_collection
status: active
tenant: acme-platform
visibility: org:acme-platform
metadata:
  record_type: ${type}
  major: ${major}
  kind: ${kind}
  writer: fixture
  ref: default
  personal_data: none
  posture: restricted
---

# ${type} records

The ${type} collection.
`;
}

const configuration = (records) => `${JSON.stringify({ records }, null, 2)}\n`;

function fixtureCorpus(extra = {}) {
  return {
    ...baseFixture(),
    'configuration.json': configuration({ admit: ['person', 'classification'], corpus_class: 'fixture' }),
    '_records/person/README.md': collectionReadme('person', 2),
    [PERSON_PATH]: personRecord(),
    ...extra
  };
}

function validate(files) {
  const root = writeSubstrate(files);
  try {
    const tree = ocp.walk(ocp.createFileSystemSubstrate(root));
    return { tree, result: ocp.conformance(tree) };
  } finally {
    removeSubstrate(root);
  }
}

const codes = (result) => result.problems.map((p) => p.code);
const recordCodes = (tree) => tree.records.problems.map((p) => p.code);

test('a conformant fixture corpus validates, and its record is accounted', () => {
  const { tree, result } = validate(fixtureCorpus());
  assert.deepEqual(recordCodes(tree), []);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(tree.records.records, 1);
  assert.equal(tree.stats.records, 1);
  assert.deepEqual(tree.records.collections, [{ scope: '', corpusClass: 'fixture', types: ['person'] }]);
});

test('GB-OCP007-01: a record carrying artifact_type is refused', () => {
  const { tree } = validate(fixtureCorpus({ [PERSON_PATH]: personRecord({ artifact_type: 'note' }) }));
  assert.deepEqual(recordCodes(tree), ['closed_profile_extra_key']);
});

test('GB-OCP007-02: no record is walked as an artifact, and _records/ never needs a README', () => {
  const plain = validate(baseFixture());
  const { tree, result } = validate(fixtureCorpus());
  assert.equal(tree.stats.rendered, plain.tree.stats.rendered, 'records add no rendered node');
  assert.equal(tree.nodes.some((n) => n.path.startsWith('_records')), false);
  assert.equal(codes(result).includes('missing-readme'), false);
  assert.equal(codes(result).includes('root-entry-misplaced'), false);
});

test('GB-OCP007-03: a container that does not sit in an org directory is refused', () => {
  const { tree } = validate(
    fixtureCorpus({ 'notes/_records/person/README.md': collectionReadme('person', 2), [`notes/${PERSON_PATH}`]: personRecord() })
  );
  assert.deepEqual(recordCodes(tree), ['record-container-not-at-org-scope']);
});

test('GB-OCP007-05: a collection with no kind, or a kind outside the record kinds of the closed list, is refused', () => {
  for (const kind of ['7', 'nine']) {
    const { tree } = validate(fixtureCorpus({ '_records/person/README.md': collectionReadme('person', kind) }));
    assert.ok(recordCodes(tree).includes('record-collection-kind-invalid'), `kind ${kind}`);
  }
  const noKind = collectionReadme('person', 2).replace('  kind: 2\n', '');
  assert.equal(noKind.includes('kind:'), false);
  const { tree } = validate(fixtureCorpus({ '_records/person/README.md': noKind }));
  assert.ok(recordCodes(tree).includes('record-collection-kind-invalid'), 'no kind');
});

test('GB-OCP007-06: a record carrying an event log is refused', () => {
  const value = JSON.parse(personRecord());
  value.log = [{ at: '2026-10-29T18:04:11.000Z', event: 'created' }];
  const { tree } = validate(fixtureCorpus({ [PERSON_PATH]: ocp.records.storedForm(value).toString('utf8') }));
  assert.deepEqual(recordCodes(tree), ['closed_profile_extra_key']);
});

test('GB-OCP007-07: a record outside a _records/ container is refused', () => {
  const { tree, result } = validate(fixtureCorpus({ 'notes/person.json': personRecord() }));
  assert.deepEqual(recordCodes(tree), ['record-outside-container']);
  assert.equal(result.ok, false);
});

test('GB-OCP007-08: a profile the collection kind does not admit is refused', () => {
  const generated = record(
    {
      caused_by: 'u-1', event_date: '2026-10-30T01:12:40.000Z', id: PERSON_ID, logic: 'classifier', logic_version: '1.0.0',
      major: 1, record_type: 'person', recorded_at: '2026-10-30T01:12:44.000Z', recorded_by: 'runtime:fixture',
      recording_method: 'automated', subject: `record:person/${PERSON_ID}`
    },
    { category: 'objection' }
  );
  const { tree } = validate(fixtureCorpus({ [PERSON_PATH]: generated }));
  assert.deepEqual(recordCodes(tree), ['record-profile-not-admitted']);
});

test('GB-OCP007-17: a data-shaped file outside a registered placement warns, a convention file does not', () => {
  const { tree, result } = validate(fixtureCorpus({ 'notes/leads.csv': 'a,b\n1,2\n' }));
  assert.deepEqual(recordCodes(tree), ['data-file-unregistered-placement']);
  assert.equal(tree.records.problems[0].severity, 'warning');
  assert.equal(result.ok, true);
});

test('GB-OCP007-22: a record in a corpus with no records block is refused', () => {
  const files = fixtureCorpus();
  delete files['configuration.json'];
  const { tree } = validate(files);
  assert.deepEqual(recordCodes(tree), ['record-in-shared-corpus']);
});

test('the corpus class gates key custody: a k0_ id in a private client instance is refused', () => {
  const value = JSON.parse(personRecord());
  delete value.$ocp.provenance;
  const { tree } = validate(
    fixtureCorpus({
      'configuration.json': configuration({ admit: ['person'], corpus_class: 'private_client_instance', endpoint: 'env:RUNTIME_BASE_URL' }),
      [PERSON_PATH]: ocp.records.storedForm(value).toString('utf8')
    })
  );
  assert.deepEqual(recordCodes(tree), ['key_custody_failure']);
});

test('paths and admission: wrong shard, id, type, missing README and unadmitted type are each refused', () => {
  const cases = [
    [{ [`_records/person/47/${PERSON_ID}.json`]: personRecord(), [PERSON_PATH]: undefined }, 'record-shard-mismatch'],
    [{ '_records/person/46/k0_46.json': personRecord(), [PERSON_PATH]: undefined }, 'record-id-invalid'],
    [{ [PERSON_PATH]: personRecord({ record_type: 'deal' }) }, 'record-type-mismatch'],
    [{ '_records/person/README.md': undefined }, 'record-collection-missing-readme'],
    [{ 'configuration.json': configuration({ admit: ['deal'], corpus_class: 'fixture' }) }, 'record-type-not-admitted'],
    [{ '_records/person/46/stray.txt': 'x' }, 'record-path-invalid']
  ];
  for (const [overrides, code] of cases) {
    const files = fixtureCorpus(overrides);
    for (const key of Object.keys(files)) if (files[key] === undefined) delete files[key];
    const { tree } = validate(files);
    assert.ok(recordCodes(tree).includes(code), `${code}: got ${JSON.stringify(recordCodes(tree))}`);
  }
});

test('a manifest must be canonical and carry exactly its keys', () => {
  const manifest = {
    as_of: '2026-10-30T02:00:00.000Z', cursor: null, major: 1, manifest_version: 1, record_type: 'person',
    recorded_at: '2026-10-30T02:00:05.000Z', recorded_by: 'runtime:fixture', recording_method: 'automated', refused: [],
    scope: { linked_to: ['deal'] }, source: 'external:crm'
  };
  const good = validate(fixtureCorpus({ '_records/person/_manifest.json': ocp.records.storedForm(manifest).toString('utf8') }));
  assert.deepEqual(recordCodes(good.tree), []);
  const extra = { ...manifest, as_of_per_record: true };
  const bad = validate(fixtureCorpus({ '_records/person/_manifest.json': ocp.records.storedForm(extra).toString('utf8') }));
  assert.deepEqual(recordCodes(bad.tree), ['record-manifest-invalid']);
  const loose = validate(fixtureCorpus({ '_records/person/_manifest.json': JSON.stringify(manifest) }));
  assert.deepEqual(recordCodes(loose.tree), ['record-manifest-invalid']);
});
