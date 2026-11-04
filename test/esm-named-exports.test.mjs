// Every export is reachable by name from an ES module, as it was in 0.5.0 (Node's CommonJS export detection).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from '../index.js';

const cjs = createRequire(import.meta.url)('../index.js');

test('every module.exports key is a named ES export', () => {
  const named = Object.keys(esm).filter((k) => k !== 'default' && k !== 'module.exports').sort();
  assert.deepEqual(named, Object.keys(cjs).sort());
  assert.equal(esm.records.checkRecordBytes, cjs.records.checkRecordBytes);
});
