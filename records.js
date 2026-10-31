'use strict';

/**
 * Record bytes for ADR-OCP-007: the stored-file form, the hash form, and Appendix A's ordered checks.
 *
 * Zero dependencies. Numbers are parsed as doubles (JSON.parse), which is what RFC 8785 assumes, so an integer a
 * double cannot hold re-serializes to different bytes and is named `noncanonical_bytes` (LO-186).
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 2^53 - 1

/**
 * Sort keys by UTF-16 code units (RFC 8785 section 3.2.3). JavaScript's default string comparison already compares
 * code units, so a plain comparator is exact.
 * @param {string} a
 * @param {string} b
 */
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A copy of `value` with every object's keys in canonical order. Arrays keep their order.
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      out[key] = sortKeys(/** @type {Record<string, unknown>} */ (value)[key]);
    }
    return out;
  }
  return value;
}

/**
 * The stored-file form: canonical key order, `JSON.stringify(value, null, 2)`, LF, one trailing LF, UTF-8, no BOM.
 * @param {unknown} value
 * @returns {Buffer}
 */
function storedForm(value) {
  return Buffer.from(JSON.stringify(sortKeys(value), null, 2) + '\n', 'utf8');
}

/**
 * The hash form: compact RFC 8785 (JCS). Every record digest is SHA-256 over these bytes, never over the file.
 * @param {unknown} value
 * @returns {Buffer}
 */
function hashForm(value) {
  return Buffer.from(JSON.stringify(sortKeys(value)), 'utf8');
}

const COMMON_OPTIONAL = ['envelope_version', 'provenance'];

/** The four closed profiles of section 9.1: required `$ocp` keys, optional ones, and whether `data` is required. */
const PROFILES = {
  projected: { required: ['record_type', 'major', 'id'], optional: [], data: true },
  generated: {
    required: ['record_type', 'major', 'id', 'subject', 'logic', 'logic_version', 'caused_by', 'event_date',
      'recorded_at', 'recorded_by', 'recording_method'],
    optional: ['attempt'],
    data: true
  },
  tombstone: {
    required: ['record_type', 'major', 'id', 'event_date', 'recorded_at', 'recorded_by', 'recording_method',
      'tombstone'],
    optional: [],
    data: false
  },
  stub: { required: ['record_type', 'major', 'id', 'scope_status', 'left_scope_at'], optional: [], data: false }
};

/**
 * The names of the profiles a parsed record matches. A valid record matches exactly one.
 * @param {Record<string, any>} record
 * @returns {string[]}
 */
function matchingProfiles(record) {
  const ocp = record.$ocp;
  if (ocp === null || typeof ocp !== 'object' || Array.isArray(ocp)) return [];
  const keys = Object.keys(ocp);
  const hasData = Object.prototype.hasOwnProperty.call(record, 'data');
  const out = [];
  for (const [name, profile] of Object.entries(PROFILES)) {
    const allowed = new Set([...profile.required, ...profile.optional, ...COMMON_OPTIONAL]);
    if (!profile.required.every((k) => keys.includes(k))) continue;
    if (!keys.every((k) => allowed.has(k))) continue;
    if (profile.data !== hasData) continue;
    if (name === 'tombstone') {
      const t = ocp.tombstone;
      if (t === null || typeof t !== 'object' || Array.isArray(t)) continue;
      const tk = Object.keys(t);
      if (!tk.includes('reason') || !tk.every((k) => k === 'reason' || k === 'merged_into')) continue;
    }
    out.push(name);
  }
  return out;
}

/** @param {unknown} v @returns {boolean} */
function hasLoneSurrogate(v) {
  if (typeof v === 'string') {
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = v.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          i++;
          continue;
        }
        return true;
      }
      if (c >= 0xdc00 && c <= 0xdfff) return true;
    }
    return false;
  }
  if (Array.isArray(v)) return v.some(hasLoneSurrogate);
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).some(([k, x]) => hasLoneSurrogate(k) || hasLoneSurrogate(x));
  }
  return false;
}

/** @param {unknown} v @returns {boolean} */
function hasNumberOutOfBounds(v) {
  if (typeof v === 'number') return !Number.isInteger(v) || Math.abs(v) > MAX_SAFE;
  if (Array.isArray(v)) return v.some(hasNumberOutOfBounds);
  if (v !== null && typeof v === 'object') return Object.values(v).some(hasNumberOutOfBounds);
  return false;
}

/** @param {unknown} v @returns {boolean} */
function hasNonStringExternalId(v) {
  if (Array.isArray(v)) return v.some(hasNonStringExternalId);
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'external_refs' && Array.isArray(x)) {
        if (x.some((e) => e === null || typeof e !== 'object' || typeof e.external_id !== 'string')) return true;
      }
      if (hasNonStringExternalId(x)) return true;
    }
  }
  return false;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Appendix A's checks, in order. Returns the first failing code, or null when the bytes are a valid record for a
 * corpus of the given class.
 * @param {Uint8Array} bytes
 * @param {'fixture' | 'private_client_instance' | 'shared'} corpusClass
 * @returns {{ code: string | null, value?: unknown }}
 */
function checkRecordBytes(bytes, corpusClass) {
  const buf = Buffer.from(bytes);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { code: 'bom_present' };
  let text;
  try {
    text = UTF8.decode(buf);
  } catch {
    return { code: 'invalid_unicode' };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { code: 'noncanonical_bytes' };
  }
  if (hasLoneSurrogate(value)) return { code: 'invalid_unicode' };
  if (buf.includes(0x0d)) return { code: 'crlf_line_ending' };
  if (buf[buf.length - 1] !== 0x0a) return { code: 'missing_trailing_lf' };
  if (!buf.equals(storedForm(value))) {
    const asParsed = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
    return { code: buf.equals(asParsed) ? 'noncanonical_key_order' : 'noncanonical_bytes', value };
  }
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const ocp = isObject ? value.$ocp : undefined;
  const ocpIsObject = ocp !== null && typeof ocp === 'object' && !Array.isArray(ocp);
  if (ocpIsObject && 'envelope_version' in ocp && ocp.envelope_version !== 1) {
    return { code: 'unknown_envelope_version', value };
  }
  if (isObject && ('raw' in value || (ocpIsObject && 'raw' in ocp))) return { code: 'raw_member', value };
  if (!isObject || !Object.keys(value).every((k) => k === '$ocp' || k === 'data') || matchingProfiles(value).length !== 1) {
    return { code: 'closed_profile_extra_key', value };
  }
  if (hasNumberOutOfBounds(value)) return { code: 'integer_out_of_bounds', value };
  if ('data' in value && hasNonStringExternalId(value.data)) return { code: 'external_id_not_string', value };
  if (corpusClass === 'private_client_instance' && typeof ocp.id === 'string' && ocp.id.startsWith('k0_')) {
    return { code: 'key_custody_failure', value };
  }
  if (corpusClass === 'fixture' && ocp.provenance !== 'fixture') return { code: 'missing_provenance', value };
  return { code: null, value };
}

/* ------------------------------------------------------------------ *
 * The corpus-level pass: placement, paths, ids, admission, corpus class
 * ------------------------------------------------------------------ */

// ADR-OCP-007 section 7's grammars.
const TYPE_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const RECORD_ID = /^k(0|[1-9][0-9]*)_([0-9a-f]{32})$/;
const RECORD_POINTER =
  /^record:[a-z][a-z0-9_]{0,62}\/k(0|[1-9][0-9]*)_[0-9a-f]{32}(#[a-z][a-z0-9_]{0,62}\/k(0|[1-9][0-9]*)_[0-9a-f]{32})?$/;

const RECORDS_DIR = '_records';
const MANIFEST = '_manifest.json';
const COLLECTION_README = 'README.md';

/** The closed corpus classes of section 9.4. A corpus with no records block is `shared`. */
const CORPUS_CLASSES = Object.freeze(['fixture', 'private_client_instance', 'shared']);

/** Which envelope profiles each record kind admits (section 9.1). */
const PROFILES_BY_KIND = Object.freeze({ 2: ['projected', 'tombstone', 'stub'], 3: ['generated', 'tombstone'] });

/** Data-shaped extensions that must sit in a registered placement (GB-OCP007-17). */
const DATA_EXTENSIONS = /\.(json|jsonl|ndjson|csv|tsv|parquet)$/i;

/**
 * Registered placements outside `_records/`, mirroring `_system/record-types.md`'s convention-file names
 * (ADR-OCP-007 section 5) and the instance-corpus layout's files, plus the package tooling a corpus may carry.
 */
const CONVENTION_FILES = [
  /^configuration\.json$/,
  /^governing\.lock\.json$/,
  /^projection\.lock\.json$/,
  /^ocp-writers\.json$/,
  /^surface\.[a-z0-9_.-]+\.json$/,
  /^package(-lock)?\.json$/,
  /^tsconfig(\.[a-z0-9_-]+)?\.json$/
];

/** The manifest's keys (section 9.3). */
const MANIFEST_REQUIRED = ['as_of', 'cursor', 'major', 'manifest_version', 'record_type', 'recorded_at', 'recorded_by',
  'recording_method', 'refused', 'scope', 'source'];
const MANIFEST_OPTIONAL = ['last_full'];

/** @param {string} base @param {string} name */
function join(base, name) {
  return base === '' ? name : `${base}/${name}`;
}

/**
 * Collect every file under a `_records/` directory. Listing failures are reported, never thrown.
 * @param {{ list: (dir: string) => Array<{ name: string, type: string }> }} substrate
 * @param {string} dir
 * @param {string[]} out
 * @param {Array<{ path: string, code: string, severity: 'error' | 'warning', message: string }>} problems
 */
function collectFiles(substrate, dir, out, problems) {
  let entries;
  try {
    entries = substrate.list(dir);
  } catch (err) {
    problems.push({ path: dir, code: 'record-listing-failed', severity: 'error', message: `could not list: ${err.message}` });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const child = join(dir, entry.name);
    if (entry.type === 'dir') collectFiles(substrate, child, out, problems);
    else out.push(child);
  }
}

/**
 * Read a file's raw bytes. A substrate may offer `readBytes`; otherwise the text is re-encoded, which cannot see
 * invalid UTF-8 (the text read already replaced it).
 * @param {any} substrate
 * @param {string} path
 * @returns {Buffer}
 */
function readBytes(substrate, path) {
  if (typeof substrate.readBytes === 'function') return Buffer.from(substrate.readBytes(path));
  return Buffer.from(substrate.read(path), 'utf8');
}

/**
 * The tenant root's records block, from its `configuration.json`. A missing file or block means `shared`.
 * @param {any} substrate
 * @param {string} scope
 * @param {Array<{ path: string, code: string, severity: 'error' | 'warning', message: string }>} problems
 * @returns {{ corpusClass: string, admit: string[] | null }}
 */
function recordsBlock(substrate, scope, problems) {
  const path = join(scope, 'configuration.json');
  let text;
  try {
    text = substrate.read(path);
  } catch {
    return { corpusClass: 'shared', admit: null };
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (err) {
    problems.push({ path, code: 'configuration-unparseable', severity: 'error', message: `configuration.json does not parse: ${err.message}` });
    return { corpusClass: 'shared', admit: null };
  }
  const block = config && typeof config === 'object' ? config.records : undefined;
  if (block === undefined) return { corpusClass: 'shared', admit: null };
  const corpusClass = block && typeof block.corpus_class === 'string' ? block.corpus_class : null;
  if (!corpusClass || !CORPUS_CLASSES.includes(corpusClass)) {
    problems.push({
      path,
      code: 'records-corpus-class-invalid',
      severity: 'error',
      message: `records.corpus_class must be one of ${CORPUS_CLASSES.join(', ')} (ADR-OCP-007 section 9.4)`
    });
    return { corpusClass: 'shared', admit: null };
  }
  const admit = Array.isArray(block.admit) ? block.admit.filter((t) => typeof t === 'string') : [];
  return { corpusClass, admit };
}

/**
 * Check a manifest file: canonical bytes, then its closed key set.
 * @param {Buffer} bytes
 * @param {string} type
 * @returns {string | null} a message, or null when valid
 */
function manifestProblem(bytes, type) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return 'does not parse as JSON';
  }
  if (!bytes.equals(storedForm(value))) return 'is not in canonical bytes (ADR-OCP-007 section 6)';
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'is not an object';
  const keys = Object.keys(value);
  const missing = MANIFEST_REQUIRED.filter((k) => !keys.includes(k));
  if (missing.length) return `is missing ${missing.join(', ')}`;
  const extra = keys.filter((k) => !MANIFEST_REQUIRED.includes(k) && !MANIFEST_OPTIONAL.includes(k));
  if (extra.length) return `carries keys outside its closed set: ${extra.join(', ')}`;
  if (value.record_type !== type) return `names record_type ${JSON.stringify(value.record_type)} in the ${type} collection`;
  return null;
}

/**
 * The record pass over a walked tree (ADR-OCP-007 section 19). `containers` are the `_records/` directories the
 * walk found, each with the route of the directory that holds it; `loose` are every other non-markdown file.
 *
 * Problems use Appendix A's codes verbatim for byte and envelope failures, because those codes are the protocol's;
 * the placement and corpus findings use this package's kebab-case codes.
 *
 * @param {any} substrate
 * @param {{ byRoute: Record<string, { kind: string, frontmatter?: Record<string, any> }> }} tree
 * @param {Array<{ scope: string, path: string }>} containers
 * @param {string[]} loose
 * @param {(source: string, opts: { path: string }) => { frontmatter: Record<string, any>, role: string | null }} parseArtifact
 */
function checkRecords(substrate, tree, containers, loose, parseArtifact) {
  /** @type {Array<{ path: string, code: string, severity: 'error' | 'warning', message: string }>} */
  const problems = [];
  let recordCount = 0;
  const collections = [];

  /** @param {string} path @param {string} code @param {'error' | 'warning'} severity @param {string} message */
  const add = (path, code, severity, message) => problems.push({ path, code, severity, message });

  // Placement outside every container (GB-OCP007-07, GB-OCP007-17).
  for (const path of loose) {
    const name = path.split('/').pop() || path;
    if (!DATA_EXTENSIONS.test(name)) continue;
    if (/\.json$/i.test(name)) {
      let value;
      try {
        value = JSON.parse(readBytes(substrate, path).toString('utf8'));
      } catch {
        value = undefined;
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, '$ocp')) {
        add(path, 'record-outside-container', 'error',
          'a record sits outside a registered _records/ container (ADR-OCP-007 section 5; GB-OCP007-07)');
        continue;
      }
    }
    if (CONVENTION_FILES.some((pattern) => pattern.test(name))) continue;
    add(path, 'data-file-unregistered-placement', 'warning',
      'a data-shaped file sits outside a registered placement; it becomes an error at ocp-core 0.9.0 (ADR-OCP-007 section 14; GB-OCP007-17)');
  }

  for (const container of containers) {
    const scopeNode = tree.byRoute[container.scope];
    // GB-OCP007-03: a record's tenant comes from its path, so the container sits directly in an org directory.
    if (!scopeNode || scopeNode.kind !== 'org') {
      add(container.path, 'record-container-not-at-org-scope', 'error',
        'a _records/ container must sit directly in an organization directory, so each record\'s tenant is derivable from its path (ADR-OCP-007 section 5; GB-OCP007-03)');
      continue;
    }
    const { corpusClass, admit } = recordsBlock(substrate, container.scope, problems);
    const files = [];
    collectFiles(substrate, container.path, files, problems);

    /** @type {Map<string, { kind: number | null, major: unknown }>} */
    const declared = new Map();
    for (const file of files) {
      const rel = file.slice(container.path.length + 1).split('/');
      if (rel.length === 2 && rel[1] === COLLECTION_README) {
        let parsed;
        try {
          parsed = parseArtifact(substrate.read(file), { path: file });
        } catch (err) {
          add(file, 'record-collection-readme-unreadable', 'error', `could not read: ${err.message}`);
          continue;
        }
        const meta = parsed.frontmatter && typeof parsed.frontmatter.metadata === 'object' && parsed.frontmatter.metadata
          ? parsed.frontmatter.metadata
          : {};
        const kind = Number.isInteger(meta.kind) ? meta.kind : null;
        if (parsed.role !== 'record_collection') {
          add(file, 'record-collection-role', 'error', 'a collection README declares role: record_collection (ADR-OCP-007 section 9.2)');
        }
        if (meta.record_type !== rel[0]) {
          add(file, 'record-collection-type-mismatch', 'error',
            `metadata.record_type must be ${JSON.stringify(rel[0])}, the collection's directory name`);
        }
        if (kind !== 2 && kind !== 3) {
          add(file, 'record-collection-kind-invalid', 'error',
            'metadata.kind must be 2 (a projection) or 3 (a generated record), from the closed kind list (ADR-OCP-007 section 4; GB-OCP007-05)');
        }
        declared.set(rel[0], { kind: kind === 2 || kind === 3 ? kind : null, major: meta.major });
      }
    }

    for (const file of files) {
      const rel = file.slice(container.path.length + 1).split('/');
      const type = rel[0];
      if (rel.length === 2 && rel[1] === COLLECTION_README) continue;
      if (!TYPE_KEY.test(type)) {
        add(file, 'record-path-invalid', 'error', `"${type}" is not a record-type key (ADR-OCP-007 section 7)`);
        continue;
      }
      if (rel.length === 2 && rel[1] === MANIFEST) {
        const message = manifestProblem(readBytes(substrate, file), type);
        if (message) add(file, 'record-manifest-invalid', 'error', `the manifest ${message} (ADR-OCP-007 section 11.3)`);
        continue;
      }
      if (rel.length !== 3 || !/\.json$/.test(rel[2])) {
        add(file, 'record-path-invalid', 'error',
          'a record path is <org scope>/_records/<type>/<shard>/<id>.json (ADR-OCP-007 section 5)');
        continue;
      }
      const id = rel[2].slice(0, -'.json'.length);
      const match = RECORD_ID.exec(id);
      if (!match) {
        add(file, 'record-id-invalid', 'error', `"${id}" is not a record id k<g>_<32 hex> (ADR-OCP-007 section 7)`);
        continue;
      }
      if (rel[1] !== match[2].slice(0, 2)) {
        add(file, 'record-shard-mismatch', 'error',
          `the shard is the first two hex characters after the prefix, "${match[2].slice(0, 2)}" (ADR-OCP-007 section 6)`);
        continue;
      }
      recordCount += 1;
      if (corpusClass === 'shared') {
        add(file, 'record-in-shared-corpus', 'error',
          'a shared corpus holds no records in v1; a corpus with no records block is shared (ADR-OCP-007 section 9.4; GB-OCP007-22)');
        continue;
      }
      if (admit && !admit.includes(type)) {
        add(file, 'record-type-not-admitted', 'error',
          `the tenant root's configuration.json does not admit "${type}" (ADR-OCP-007 section 5)`);
      }
      const collection = declared.get(type);
      if (!collection) {
        add(file, 'record-collection-missing-readme', 'error',
          'every collection root holds its README (ADR-OCP-007 section 9.2)');
      }
      const result = checkRecordBytes(readBytes(substrate, file), /** @type {any} */ (corpusClass));
      if (result.code) {
        add(file, result.code, 'error', `record bytes or envelope rejected: ${result.code} (ADR-OCP-007 Appendix A)`);
        continue;
      }
      const record = /** @type {any} */ (result.value);
      const ocp = record.$ocp;
      if (ocp.record_type !== type) {
        add(file, 'record-type-mismatch', 'error', `$ocp.record_type is ${JSON.stringify(ocp.record_type)} in the ${type} collection`);
      }
      if (ocp.id !== id) add(file, 'record-id-mismatch', 'error', '$ocp.id must equal the file name (ADR-OCP-007 section 7)');
      if (collection && collection.major !== undefined && ocp.major !== collection.major) {
        add(file, 'record-major-mismatch', 'error', `$ocp.major ${ocp.major} differs from the collection's ${collection.major}`);
      }
      const profile = matchingProfiles(record)[0];
      if (collection && collection.kind && !PROFILES_BY_KIND[collection.kind].includes(profile)) {
        add(file, 'record-profile-not-admitted', 'error',
          `a ${profile} record is not admitted in a kind ${collection.kind} collection (ADR-OCP-007 section 9.1; GB-OCP007-08)`);
      }
      if (profile === 'generated' && (typeof ocp.subject !== 'string' || !RECORD_POINTER.test(ocp.subject))) {
        add(file, 'record-pointer-invalid', 'error', '$ocp.subject must be a record: pointer (ADR-OCP-007 section 7)');
      }
      if (profile === 'tombstone' && ocp.tombstone.merged_into !== undefined && !RECORD_ID.test(String(ocp.tombstone.merged_into))) {
        add(file, 'record-pointer-invalid', 'error', 'tombstone.merged_into must be a record id (ADR-OCP-007 section 7)');
      }
    }
    collections.push({ scope: container.scope, corpusClass, types: [...declared.keys()] });
  }

  return { records: recordCount, collections, problems };
}

module.exports = {
  storedForm,
  hashForm,
  sortKeys,
  matchingProfiles,
  checkRecordBytes,
  checkRecords,
  PROFILES,
  CORPUS_CLASSES,
  RECORDS_DIR
};
