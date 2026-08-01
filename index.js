'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = require('./package.json').version;

// The protocol is specified by ADR-020, which asserts no numbered protocol version.
// `surface` is this library's conformance-surface version — do not read it as one.
const PROTOCOL = Object.freeze({
  name: 'Organizational Context Protocol',
  spec: 'ADR-020',
  surface: '0.2'
});

// P16: the canonical artifact set is closed and small. A sixth type requires an
// OCP-amending ADR. ADR-026's `projection_definition` was retired 2026-07-28 and
// re-expressed as `role: report_definition` on `template`.
const ARTIFACT_TYPES = Object.freeze(['note', 'adr', 'prompt', 'template', 'report']);

// P4 / ADR-020 §7: five positional altitudes, exported as DESCRIPTIVE vocabulary for
// consumers that render position labels. Nothing here validates against it, because no
// artifact declares an altitude: the `org_type` field was retired 2026-07-21 and the whole
// axis went out of frontmatter with it (never `altitude:` either, top-level or under
// `metadata:`). The only structural fact an artifact records is `parent_org_id`.
const ALTITUDES = Object.freeze(['platform', 'tenant', 'agency', 'account', 'user']);

// ADR-020 §6: underscore-prefixed DIRECTORIES are substrate.
const SUBSTRATE_DIRS = Object.freeze(['_kernels', '_adrs', '_system', '_users']);

// ADR-020 §6: the uniform, un-prefixed content directories.
const CONTENT_DIRS = Object.freeze(['notes', 'prompts', 'templates', 'reports', 'initiatives', 'orgs']);

// D12: a per-file failure rate above 10% is a HALT condition, not a warning.
const HALT_THRESHOLD = 0.1;

const DEFAULT_EXCLUDE = Object.freeze(['.git', 'node_modules', 'DISCOVERED.md', 'CLAUDE.md', 'assets']);

const ENTRY_POINT = 'README.md';
const DEFAULT_BASE_URL = '/docs';

const WIKILINK_PATTERN = /\[\[([^\][|]+)(?:\|([^\][]*))?\]\]/g;

/* ------------------------------------------------------------------ *
 * Shared text helpers
 * ------------------------------------------------------------------ */

function normalizeNewlines(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function fenceMarkerOf(line) {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  return match ? match[1][0] : null;
}

// ONE shared code-segment helper. Wikilink extraction and wikilink rewriting both run
// through it, so the two can never disagree about what counts as code.
function transformLineSegments(line, transform) {
  let out = '';
  let index = 0;
  while (index < line.length) {
    const tick = line.indexOf('`', index);
    if (tick === -1) {
      out += transform(line.slice(index));
      break;
    }
    out += transform(line.slice(index, tick));
    let run = 0;
    while (line[tick + run] === '`') run += 1;
    const marker = '`'.repeat(run);
    const close = line.indexOf(marker, tick + run);
    if (close === -1) {
      out += line.slice(tick);
      break;
    }
    out += line.slice(tick, close + run);
    index = close + run;
  }
  return out;
}

function transformNonCodeSegments(body, transform) {
  let fence = null;
  return body
    .split('\n')
    .map((line) => {
      const marker = fenceMarkerOf(line);
      if (fence) {
        if (marker === fence) fence = null;
        return line;
      }
      if (marker) {
        fence = marker;
        return line;
      }
      return transformLineSegments(line, transform);
    })
    .join('\n');
}

function humanize(segment) {
  const words = String(segment).split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return String(segment);
  return words
    .map((word) => (/^[A-Z0-9]+$/.test(word) ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}

function posixJoin(base, name) {
  return base ? `${base}/${name}` : name;
}

function stringOrNull(value) {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  const single = stringOrNull(value);
  return single === null ? [] : [single];
}

/* ------------------------------------------------------------------ *
 * Frontmatter — tolerant YAML subset, never throws
 * ------------------------------------------------------------------ */

function stripInlineComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
  }
  return raw;
}

function splitTopLevelCommas(inner) {
  const parts = [];
  let current = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevelCommas(value.slice(1, -1)).map(parseScalar);
  }
  return parseScalar(value);
}

const KEY_PATTERN = /^([^:\s][^:]*):(.*)$/;

// `__proto__` is refused rather than assigned: assigning it on a plain object mutates
// the prototype instead of creating an own property.
function assign(target, key, value, skipped, line) {
  if (key === '__proto__') {
    skipped.push(line);
    return;
  }
  target[key] = value;
}

function trimTrailingBlank(lines) {
  const out = lines.slice();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

function collectIndentedBlock(lines, start) {
  const block = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      block.push(line);
      i += 1;
      continue;
    }
    if (indentOf(line) === 0) break;
    block.push(line);
    i += 1;
  }
  return { block: trimTrailingBlank(block), next: i };
}

function subBlockAfter(lines, index, base) {
  const block = [];
  let i = index + 1;
  while (i < lines.length && indentOf(lines[i]) > base) {
    block.push(lines[i]);
    i += 1;
  }
  return { block, next: i };
}

function parseIndentedBlock(blockLines, skipped) {
  const lines = blockLines.filter((line) => line.trim() !== '');
  if (lines.length === 0) return '';
  const base = Math.min.apply(null, lines.map(indentOf));
  return lines[0].trim().startsWith('-')
    ? parseListBlock(lines, base, skipped)
    : parseMapBlock(lines, base, skipped);
}

function parseListBlock(lines, base, skipped) {
  const items = [];
  let current = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const ind = indentOf(line);
    const text = line.trim();
    if (ind === base && text.startsWith('-')) {
      const itemText = stripInlineComment(text.slice(1)).trim();
      const keyed = KEY_PATTERN.exec(itemText);
      if (itemText === '') {
        current = {};
        items.push(current);
      } else if (keyed) {
        current = {};
        assign(current, keyed[1].trim(), parseValue(stripInlineComment(keyed[2])), skipped, line);
        items.push(current);
      } else {
        current = null;
        items.push(parseValue(itemText));
      }
      i += 1;
      continue;
    }
    if (ind > base && current !== null && typeof current === 'object') {
      const keyed = KEY_PATTERN.exec(text);
      if (keyed) {
        const rest = stripInlineComment(keyed[2]).trim();
        if (rest === '') {
          const sub = subBlockAfter(lines, i, ind);
          if (sub.block.length > 0) {
            assign(current, keyed[1].trim(), parseIndentedBlock(sub.block, skipped), skipped, line);
            i = sub.next;
            continue;
          }
        }
        assign(current, keyed[1].trim(), parseValue(rest), skipped, line);
      } else {
        skipped.push(line);
      }
      i += 1;
      continue;
    }
    skipped.push(line);
    i += 1;
  }
  return items;
}

function parseMapBlock(lines, base, skipped) {
  const map = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (indentOf(line) !== base) {
      skipped.push(line);
      i += 1;
      continue;
    }
    const keyed = KEY_PATTERN.exec(line.trim());
    if (!keyed) {
      skipped.push(line);
      i += 1;
      continue;
    }
    const key = keyed[1].trim();
    const rest = stripInlineComment(keyed[2]).trim();
    if (rest === '') {
      const sub = subBlockAfter(lines, i, base);
      if (sub.block.length > 0) {
        assign(map, key, parseIndentedBlock(sub.block, skipped), skipped, line);
        i = sub.next;
        continue;
      }
    }
    assign(map, key, parseValue(rest), skipped, line);
    i += 1;
  }
  return map;
}

function parseFrontmatterBlock(block) {
  const data = {};
  const skipped = [];
  const lines = block.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }
    if (indentOf(line) > 0) {
      skipped.push(line);
      i += 1;
      continue;
    }
    const keyed = KEY_PATTERN.exec(line);
    if (!keyed) {
      skipped.push(line);
      i += 1;
      continue;
    }
    const key = keyed[1].trim();
    const rest = stripInlineComment(keyed[2]).trim();
    if (rest !== '') {
      assign(data, key, parseValue(rest), skipped, line);
      i += 1;
      continue;
    }
    const collected = collectIndentedBlock(lines, i + 1);
    if (collected.block.length === 0) {
      assign(data, key, '', skipped, line);
      i += 1;
      continue;
    }
    assign(data, key, parseIndentedBlock(collected.block, skipped), skipped, line);
    i = collected.next;
  }
  return { data, skipped };
}

function splitFrontmatter(text) {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return { frontmatter: {}, body: normalized, present: false, terminated: true, skipped: [] };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: {}, body: normalized, present: true, terminated: false, skipped: [] };
  }
  const parsed = parseFrontmatterBlock(lines.slice(1, end).join('\n'));
  return {
    frontmatter: parsed.data,
    body: lines.slice(end + 1).join('\n').replace(/^\n/, ''),
    present: true,
    terminated: true,
    skipped: parsed.skipped
  };
}

/* ------------------------------------------------------------------ *
 * Artifacts
 * ------------------------------------------------------------------ */

function toSlug(filePath) {
  const clean = String(filePath).replace(/\\/g, '/').replace(/^\.?\//, '');
  const withoutExt = clean.replace(/\.md$/i, '');
  if (withoutExt === 'README') return '';
  return withoutExt.replace(/\/README$/, '');
}

function firstHeading(body) {
  let fence = null;
  for (const line of body.split('\n')) {
    const marker = fenceMarkerOf(line);
    if (fence) {
      if (marker === fence) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) return match[1].trim();
  }
  return null;
}

function extractLinks(body) {
  const links = [];
  transformNonCodeSegments(body, (segment) => {
    let match;
    WIKILINK_PATTERN.lastIndex = 0;
    while ((match = WIKILINK_PATTERN.exec(segment)) !== null) {
      // A `|` inside a markdown table cell must be written `\|`, so a piped
      // wikilink in a table arrives as `[[target\|display]]`. Drop that escape
      // rather than reading the backslash as part of the target.
      const target = match[1].trim().replace(/\\$/, '');
      if (!target) continue;
      links.push({ target, display: match[2] === undefined ? null : match[2].trim(), raw: match[0] });
    }
    return segment;
  });
  return links;
}

function plainText(body) {
  let fence = null;
  const kept = [];
  for (const line of body.split('\n')) {
    const marker = fenceMarkerOf(line);
    if (fence) {
      if (marker === fence) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    kept.push(line);
  }
  const stripped = transformNonCodeSegments(kept.join('\n'), (segment) =>
    segment
      .replace(WIKILINK_PATTERN, (all, target, display) => (display === undefined ? target : display))
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  );
  return stripped
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Parse one markdown artifact. Never throws.
 *
 * displayName resolves display_name -> title -> first H1 outside fenced code ->
 * humanized final path segment. Grounding F-008: OCP names the human-readable key
 * `display_name`, and a schema that requires `title` silently drops most of a real
 * substrate (271 of 322 files). Accepting `title` is Postel's law, not the contract.
 */
function parseArtifact(source, opts) {
  const options = opts || {};
  const filePath = options.path === undefined ? '' : String(options.path).replace(/\\/g, '/');
  const problems = [];
  let text = source;

  if (typeof text !== 'string') {
    problems.push({
      code: 'unreadable-source',
      severity: 'error',
      message: `expected markdown source as a string, received ${typeof source}`
    });
    text = '';
  }

  const split = splitFrontmatter(text);
  const frontmatter = split.frontmatter;

  if (!split.present) {
    problems.push({ code: 'missing-frontmatter', severity: 'error', message: 'no YAML frontmatter block (P17)' });
  } else if (!split.terminated) {
    problems.push({
      code: 'unterminated-frontmatter',
      severity: 'warning',
      message: 'frontmatter opened with --- but never closed; the whole file is treated as body'
    });
  }
  if (split.skipped.length > 0) {
    problems.push({
      code: 'unparsed-frontmatter-lines',
      severity: 'warning',
      message: `${split.skipped.length} frontmatter line(s) could not be parsed and were skipped`
    });
  }

  const slug = toSlug(filePath);
  const artifactType = stringOrNull(frontmatter.artifact_type);
  if (artifactType === null) {
    if (split.present && split.terminated) {
      problems.push({
        code: 'missing-artifact-type',
        severity: 'error',
        message: 'frontmatter declares no artifact_type (P16/P17)'
      });
    }
  } else if (!ARTIFACT_TYPES.includes(artifactType)) {
    // Recorded, never silently dropped — silent dropping is the F-008 failure mode.
    problems.push({
      code: 'unknown-artifact-type',
      severity: 'error',
      message: `artifact_type "${artifactType}" is outside the closed five (${ARTIFACT_TYPES.join(', ')}) — P16`
    });
  }

  if (Object.prototype.hasOwnProperty.call(frontmatter, 'org_type')) {
    problems.push({
      code: 'retired-org-type-field',
      severity: 'warning',
      message: 'org_type was retired 2026-07-21; only root-vs-child survives, keyed on parent_org_id == null'
    });
  }

  const fallbackSegment =
    slug === '' ? String(filePath).split('/').pop().replace(/\.md$/i, '') || 'README' : slug.split('/').pop();
  const displayName =
    stringOrNull(frontmatter.display_name) ||
    stringOrNull(frontmatter.title) ||
    firstHeading(split.body) ||
    humanize(fallbackSegment);

  return {
    path: filePath,
    slug,
    artifactType,
    role: stringOrNull(frontmatter.role),
    displayName,
    status: stringOrNull(frontmatter.status),
    tenant: stringOrNull(frontmatter.tenant),
    tags: toStringArray(frontmatter.tags),
    visibility: frontmatter.visibility === undefined ? null : frontmatter.visibility,
    trustTier: typeof frontmatter.trust_tier === 'number' ? frontmatter.trust_tier : null,
    frontmatter,
    body: split.body,
    links: extractLinks(split.body),
    problems
  };
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

const CONFIG_KEYS = ['substrateRoot', 'exclude', 'sourceBlobBase', 'displayOverrides'];

function defineConfig(config) {
  const input = config === undefined ? {} : config;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('defineConfig expects a configuration object');
  }
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw new TypeError(`unknown config key "${key}" (known keys: ${CONFIG_KEYS.join(', ')})`);
    }
  }
  const substrateRoot = input.substrateRoot === undefined ? '.' : input.substrateRoot;
  if (typeof substrateRoot !== 'string' || substrateRoot === '') {
    throw new TypeError('config.substrateRoot must be a non-empty string');
  }
  let exclude;
  if (input.exclude === undefined) {
    exclude = DEFAULT_EXCLUDE.slice();
  } else if (Array.isArray(input.exclude) && input.exclude.every((item) => typeof item === 'string')) {
    exclude = input.exclude.slice();
  } else {
    throw new TypeError('config.exclude must be an array of strings');
  }
  const sourceBlobBase = input.sourceBlobBase === undefined ? null : input.sourceBlobBase;
  if (sourceBlobBase !== null && typeof sourceBlobBase !== 'string') {
    throw new TypeError('config.sourceBlobBase must be a string or null');
  }
  const overrides = input.displayOverrides === undefined ? {} : input.displayOverrides;
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('config.displayOverrides must be an object keyed by route');
  }
  for (const key of Object.keys(overrides)) {
    if (typeof overrides[key] !== 'string') {
      throw new TypeError(`config.displayOverrides["${key}"] must be a string`);
    }
  }
  return { substrateRoot, exclude, sourceBlobBase, displayOverrides: Object.assign({}, overrides) };
}

/* ------------------------------------------------------------------ *
 * SubstratePort — filesystem adapter (the only adapter, per D4 / §8)
 * ------------------------------------------------------------------ */

function assertSafeRelative(relPath) {
  const clean = String(relPath).replace(/\\/g, '/');
  if (clean.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(clean)) {
    throw new Error(`path escapes the substrate root: ${relPath}`);
  }
  return clean;
}

// P8: the commit SHA is the authoritative version reference at every scope. Resolved
// by reading .git directly — no child_process, no dependencies.
function readGitSha(rootDir) {
  let gitPath = path.join(rootDir, '.git');
  let stat;
  try {
    stat = fs.statSync(gitPath);
  } catch {
    return null;
  }
  if (stat.isFile()) {
    let raw;
    try {
      raw = fs.readFileSync(gitPath, 'utf8');
    } catch {
      return null;
    }
    const match = /^gitdir:\s*(.+)$/m.exec(raw);
    if (!match) return null;
    gitPath = path.resolve(rootDir, match[1].trim());
  }
  let head;
  try {
    head = fs.readFileSync(path.join(gitPath, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  if (/^[0-9a-f]{40}$/i.test(head)) return head;
  const ref = /^ref:\s*(.+)$/.exec(head);
  if (!ref) return null;
  const refName = ref[1].trim();

  const searchDirs = [gitPath];
  try {
    const commonDir = fs.readFileSync(path.join(gitPath, 'commondir'), 'utf8').trim();
    if (commonDir) searchDirs.push(path.resolve(gitPath, commonDir));
  } catch {
    /* not a linked worktree */
  }

  for (const dir of searchDirs) {
    try {
      const value = fs.readFileSync(path.join(dir, refName), 'utf8').trim();
      if (/^[0-9a-f]{40}$/i.test(value)) return value;
    } catch {
      /* fall through to packed-refs */
    }
    try {
      const packed = fs.readFileSync(path.join(dir, 'packed-refs'), 'utf8');
      for (const line of packed.split('\n')) {
        const entry = /^([0-9a-f]{40})\s+(.+)$/.exec(line.trim());
        if (entry && entry[2] === refName) return entry[1];
      }
    } catch {
      /* no packed-refs */
    }
  }
  return null;
}

function createFileSystemSubstrate(rootDir) {
  if (typeof rootDir !== 'string' || rootDir === '') {
    throw new TypeError('createFileSystemSubstrate expects a root directory path');
  }
  const root = path.resolve(rootDir);
  return {
    kind: 'filesystem',
    root,
    read(relPath) {
      return fs.readFileSync(path.join(root, assertSafeRelative(relPath)), 'utf8');
    },
    list(relDir) {
      const target =
        relDir === '' || relDir === undefined || relDir === null
          ? root
          : path.join(root, assertSafeRelative(relDir));
      return fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
        if (entry.isDirectory()) return { name: entry.name, type: 'dir' };
        if (entry.isFile()) return { name: entry.name, type: 'file' };
        try {
          return { name: entry.name, type: fs.statSync(path.join(target, entry.name)).isDirectory() ? 'dir' : 'file' };
        } catch {
          return { name: entry.name, type: 'file' };
        }
      });
    },
    // Optional port method: lets the walker detect a symlinked directory that
    // resolves to one it has already visited, instead of recursing forever.
    realPath(relDir) {
      const target =
        relDir === '' || relDir === undefined || relDir === null
          ? root
          : path.join(root, assertSafeRelative(relDir));
      try {
        return fs.realpathSync(target);
      } catch {
        return null;
      }
    },
    sha() {
      return readGitSha(root);
    }
  };
}

/* ------------------------------------------------------------------ *
 * walk — README-as-index, frontmatter classification, fail-soft
 * ------------------------------------------------------------------ */

function classifyDirectory(name, role, isRoot) {
  // The repository root IS an organization: the graph root, parent_org_id null.
  if (isRoot) return 'org';
  // A declared role wins over the naming convention, because role is authored.
  if (role === 'org_definition') return 'org';
  if (role === 'user_definition') return 'user';
  if (role === 'kernel_definition' || role === 'kernel_index') return 'kernel';
  if (name.startsWith('_')) return 'substrate-dir';
  return 'content-dir';
}

function walk(substrate, config) {
  if (!substrate || typeof substrate.read !== 'function' || typeof substrate.list !== 'function') {
    throw new TypeError('walk expects a SubstratePort with read(path) and list(dir)');
  }
  const cfg = defineConfig(config);
  const excluded = new Set(cfg.exclude);
  const discovered = [];
  const nodes = [];
  const byRoute = {};
  let filesSeen = 0;

  function listSafe(dir) {
    try {
      return substrate.list(dir);
    } catch (err) {
      // `kind` partitions discovered[] for the count-parity identity below: a directory
      // that could not be enumerated is not a FILE that was read and then dropped, so it
      // belongs to neither side of the file-level identity.
      discovered.push({
        kind: 'directory',
        path: dir === '' ? '.' : dir,
        reason: `directory listing failed: ${err.message}`
      });
      return [];
    }
  }

  // D12 fail-soft: a file that cannot be read or parsed lands in discovered[] and the
  // walk continues. It never aborts, and it is never silently dropped.
  function readArtifactSafe(filePath) {
    filesSeen += 1;
    let source;
    try {
      source = substrate.read(filePath);
    } catch (err) {
      discovered.push({ kind: 'file', path: filePath, reason: `read failed: ${err.message}` });
      return null;
    }
    try {
      return parseArtifact(source, { path: filePath });
    } catch (err) {
      discovered.push({ kind: 'file', path: filePath, reason: `parse failed: ${err.message}` });
      return null;
    }
  }

  function displayFor(route, fallback) {
    return Object.prototype.hasOwnProperty.call(cfg.displayOverrides, route)
      ? cfg.displayOverrides[route]
      : fallback;
  }

  function sortEntries(entries) {
    return entries
      .filter((entry) => !entry.name.startsWith('.') && !excluded.has(entry.name))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'file' ? -1 : 1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
  }

  // A symlinked directory that points at an ancestor would otherwise recurse until
  // the path length stops it, materializing phantom nodes and spurious conformance
  // errors. Revisiting a real path is recorded as a fail-soft discovery (D12) and
  // the descent stops there.
  const visitedRealPaths = new Set();

  function alreadyVisited(dirPath) {
    if (typeof substrate.realPath !== 'function') return false;
    let real;
    try {
      real = substrate.realPath(dirPath);
    } catch {
      return false;
    }
    if (real === null || real === undefined) return false;
    if (visitedRealPaths.has(real)) return true;
    visitedRealPaths.add(real);
    return false;
  }

  function build(dirPath, name, inherited, isRoot) {
    if (alreadyVisited(dirPath)) {
      discovered.push({
        path: dirPath === '' ? '.' : dirPath,
        reason: 'symlink loop: this directory resolves to one already walked'
      });
      return null;
    }
    const entries = sortEntries(listSafe(dirPath));
    const hasEntryPoint = entries.some((entry) => entry.type === 'file' && entry.name === ENTRY_POINT);
    // README-as-index (P20): the directory's README.md IS its entry point and supplies
    // the directory's displayName and role. There is no index.md anywhere in OCP.
    const parsed = hasEntryPoint ? readArtifactSafe(posixJoin(dirPath, ENTRY_POINT)) : null;
    const role = parsed ? parsed.role : null;
    const kind = classifyDirectory(name, role, isRoot);
    const frontmatter = parsed ? parsed.frontmatter : {};

    let orgId = null;
    let owningOrg = inherited.owningOrg;
    let parentOrgId = inherited.orgId;
    if (kind === 'org') {
      orgId = stringOrNull(frontmatter.org_id) || (isRoot ? null : name);
      parentOrgId = Object.prototype.hasOwnProperty.call(frontmatter, 'parent_org_id')
        ? stringOrNull(frontmatter.parent_org_id)
        : inherited.orgId;
      // Only orgs nested under an `orgs/` directory own a routable tenant scope. The
      // graph root is an org too (ADR-020 §6) but its own content is platform work.
      if (inherited.underOrgsDir && orgId) owningOrg = orgId;
    } else if (kind === 'user') {
      orgId = inherited.orgId;
    }

    const node = {
      kind,
      route: dirPath,
      path: dirPath,
      name: isRoot ? '' : name,
      displayName: displayFor(dirPath, parsed ? parsed.displayName : humanize(isRoot ? 'root' : name)),
      role,
      artifactType: parsed ? parsed.artifactType : null,
      status: parsed ? parsed.status : null,
      tenant: parsed ? parsed.tenant : null,
      tags: parsed ? parsed.tags : [],
      visibility: parsed ? parsed.visibility : null,
      trustTier: parsed ? parsed.trustTier : null,
      frontmatter,
      body: parsed ? parsed.body : '',
      links: parsed ? parsed.links : [],
      entryPoint: parsed ? parsed.path : null,
      orgId,
      parentOrgId,
      owningOrg,
      children: [],
      problems: parsed ? parsed.problems : []
    };

    nodes.push(node);
    byRoute[node.route] = node;

    const nextOrgId = kind === 'org' ? orgId : inherited.orgId;

    for (const entry of entries) {
      if (entry.type === 'file') {
        if (entry.name === ENTRY_POINT) continue;
        if (!/\.md$/i.test(entry.name)) continue;
        const childParsed = readArtifactSafe(posixJoin(dirPath, entry.name));
        if (!childParsed) continue;
        const childNode = {
          kind: 'artifact',
          route: childParsed.slug,
          path: childParsed.path,
          name: childParsed.slug.split('/').pop(),
          displayName: displayFor(childParsed.slug, childParsed.displayName),
          role: childParsed.role,
          artifactType: childParsed.artifactType,
          status: childParsed.status,
          tenant: childParsed.tenant,
          tags: childParsed.tags,
          visibility: childParsed.visibility,
          trustTier: childParsed.trustTier,
          frontmatter: childParsed.frontmatter,
          body: childParsed.body,
          links: childParsed.links,
          entryPoint: null,
          orgId: null,
          parentOrgId: nextOrgId,
          owningOrg,
          children: [],
          problems: childParsed.problems
        };
        nodes.push(childNode);
        byRoute[childNode.route] = childNode;
        node.children.push(childNode);
        continue;
      }
      // `orgs/` is the recursion edge: its immediate children are child organizations,
      // at any depth (orgs/<a>/orgs/<b>/...).
      const childDir = build(
        posixJoin(dirPath, entry.name),
        entry.name,
        { owningOrg, orgId: nextOrgId, underOrgsDir: name === 'orgs' && !isRoot },
        false
      );
      if (childDir) node.children.push(childDir);
    }

    return node;
  }

  const root = build('', '', { owningOrg: null, orgId: null, underOrgsDir: false }, true);

  // COUNT PARITY (D12-R item 3). Every markdown file the walk read is either served as a
  // page, served as a directory landing, or recorded as a failure. Nothing is dropped.
  //
  // This is asserted rather than merely computed because the failure it guards against is
  // a SILENT DROP, and a failure rate cannot surface one: a dropped file leaves both the
  // numerator and the denominator, so `haltStatus` stays green while content disappears.
  //
  // Note the shape carefully; two nearby identities are both wrong.
  //
  // `filesSeen === artifacts + failures` is FALSE on every conformant substrate: a
  // directory's README.md is read (so it counts in filesSeen) but becomes that directory
  // node's `entryPoint` rather than a separate artifact node, leaving a residual equal to
  // the number of directories carrying one.
  //
  // `filesSeen === rendered + discovered.length` is FALSE whenever a directory listing
  // fails: that failure is recorded without any file having been read, so it inflates the
  // right side only. The identity is over FILES, so only file-level failures belong in it.
  const renderedNodes = nodes.filter((node) => node.kind === 'artifact' || node.entryPoint !== null).length;
  const fileFailures = discovered.filter((entry) => entry.kind !== 'directory').length;
  if (filesSeen !== renderedNodes + fileFailures) {
    throw new Error(
      `ocp-core walk count parity failed: read ${filesSeen} file(s) but accounted for ${renderedNodes + fileFailures} ` +
        `(${renderedNodes} rendered + ${fileFailures} recorded as file failures). ` +
        'A file was read and then silently dropped, which is the one failure mode the fail-soft contract exists to prevent. ' +
        'This is a bug in ocp-core, not in the substrate; please report it with the substrate shape that triggered it.'
    );
  }

  return {
    root,
    nodes,
    byRoute,
    discovered,
    sha: typeof substrate.sha === 'function' ? substrate.sha() : null,
    config: cfg,
    stats: {
      filesSeen,
      directories: nodes.filter((node) => node.kind !== 'artifact').length,
      rendered: renderedNodes
    }
  };
}

/* ------------------------------------------------------------------ *
 * DISCOVERED.md / halt reporting (D12)
 * ------------------------------------------------------------------ */

function haltStatus(tree) {
  const source = tree && tree.root === undefined && tree.tree ? tree.tree : tree;
  const failures = source.discovered || [];
  const failed = failures.length;
  const seen = source.stats.filesSeen;
  // A directory that could not be listed is a unit of work that failed while reading no
  // file, so it must join the denominator as well as the numerator. Dividing by filesSeen
  // alone admitted numerator entries the denominator never counted, and in the degenerate
  // case (every listing fails, so no file is ever read) produced filesSeen 0, rate 0, and
  // halt false: a substrate that could not be enumerated at all reported OK.
  const directoryFailures = failures.filter((entry) => entry.kind === 'directory').length;
  const denominator = seen + directoryFailures;
  const rate = denominator === 0 ? 0 : failed / denominator;
  return {
    filesSeen: seen,
    failed,
    directoryFailures,
    considered: denominator,
    rate,
    threshold: HALT_THRESHOLD,
    halt: rate > HALT_THRESHOLD
  };
}

function discoveredReport(tree) {
  const source = tree && tree.root === undefined && tree.tree ? tree.tree : tree;
  const status = haltStatus(source);
  const lines = [];
  lines.push('# DISCOVERED.md');
  lines.push('');
  lines.push(
    `Files the OCP walk could not read or parse. Generated by ocp-core ${VERSION}. Per D12 a failing file never aborts the walk; it is recorded here instead.`
  );
  lines.push('');
  lines.push(`- Substrate SHA: ${source.sha ? `\`${source.sha}\`` : 'unversioned (not a git checkout)'}`);
  lines.push(`- Files seen: ${status.filesSeen}`);
  lines.push(`- Failed: ${status.failed}`);
  lines.push(
    `- Failure rate: ${(status.rate * 100).toFixed(1)}% (halt threshold ${(HALT_THRESHOLD * 100).toFixed(0)}%)`
  );
  lines.push(`- Status: ${status.halt ? 'HALT' : 'OK'}`);
  lines.push('');
  if (status.failed === 0) {
    lines.push('No files failed to parse.');
    lines.push('');
    return lines.join('\n');
  }
  source.discovered.forEach((item, index) => {
    lines.push(`## ${index + 1}. \`${item.path}\``);
    lines.push('');
    lines.push(`**Reason:** ${item.reason}`);
    lines.push('');
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Policy + disclosure
 * ------------------------------------------------------------------ */

/**
 * Accepted `<prefix>:<id>` spellings. `org` is the canonical emission spelling per the
 * 2026-07-31 ruling; the other three are ACCEPTED ALIASES retained under ADR-041's
 * additive-only plus tolerant-reader policy, and the parser is deliberately not narrowed
 * (narrowing an accepted input set is a breaking change with nothing on the other side).
 *
 * READER TRAP, stated here because every reader so far has hit it: `account`, `tenant`,
 * and `agency` are ALSO OCP altitude terms (see ALTITUDES). Altitude and
 * visibility-audience are different axes that happen to share three words. An altitude is
 * a position in the org hierarchy, it is descriptive, and nothing validates against it
 * because no artifact declares one. A visibility-audience token is authored per artifact,
 * is parsed, and decides policy. They are unrelated.
 */
const VISIBILITY_ORG_PREFIXES = ['org', 'account', 'tenant', 'agency'];
const VISIBILITY_CANONICAL_ORG_PREFIX = 'org';
const VISIBILITY_BARE_TOKENS = ['public', 'unlisted', 'internal', 'platform'];

/**
 * Restrictiveness, least to most. `visibility` names the AUDIENCE and a page has exactly
 * one, so when several recognized tokens are declared the resolution is the most
 * restrictive of them, and it is ORDER-INDEPENDENT. The previous first-match behavior
 * made `[unlisted, public]` and `[public, unlisted]` mean different things, which is
 * order-dependent semantics on a security field.
 */
const VISIBILITY_RANK = { public: 0, unlisted: 1, internal: 2, org: 3, platform: 4 };

function visibilityRank(scope) {
  if (scope && typeof scope === 'object' && typeof scope.org === 'string') return VISIBILITY_RANK.org;
  return Object.prototype.hasOwnProperty.call(VISIBILITY_RANK, scope) ? VISIBILITY_RANK[scope] : -1;
}

/**
 * Full analysis of a raw `visibility` frontmatter value. `parseVisibility` is the scope
 * half of this; `conformance()` consumes the diagnostic half, which is what turns a
 * misspelled token from a silent scope change into a reported error.
 */
function analyzeVisibility(value) {
  const entries = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const recognized = [];
  const unrecognized = [];
  const nonCanonicalPrefixes = [];
  const orgIds = new Set();

  for (const raw of entries) {
    const token = stringOrNull(raw);
    if (token === null) continue;
    if (VISIBILITY_BARE_TOKENS.includes(token)) {
      recognized.push(token);
      continue;
    }
    const split = token.indexOf(':');
    if (split > 0) {
      const prefix = token.slice(0, split).trim();
      const id = token.slice(split + 1).trim();
      if (VISIBILITY_ORG_PREFIXES.includes(prefix) && id) {
        recognized.push({ org: id });
        orgIds.add(id);
        if (prefix !== VISIBILITY_CANONICAL_ORG_PREFIX) nonCanonicalPrefixes.push(token);
        continue;
      }
    }
    unrecognized.push(token);
  }

  // Two DIFFERENT org tokens name two audiences and cannot be reconciled, so the value
  // fails closed to `platform` rather than silently picking one tenant over another.
  const conflictingOrgs = orgIds.size > 1;
  let scope = null;
  if (conflictingOrgs) {
    scope = 'platform';
  } else if (recognized.length > 0) {
    scope = recognized.reduce((most, next) => (visibilityRank(next) > visibilityRank(most) ? next : most));
  }

  // Distinct audiences, counting all org tokens for the same org as one audience.
  const distinct = new Set(recognized.map((entry) => (typeof entry === 'object' ? `org:${entry.org}` : entry)));

  return {
    scope,
    recognized,
    unrecognized,
    nonCanonicalPrefixes,
    conflictingOrgs,
    multiple: distinct.size > 1
  };
}

function parseVisibility(value) {
  return analyzeVisibility(value).scope;
}

function pathScope(node) {
  if (node.owningOrg) return { org: node.owningOrg };
  // Membership declarations decide authorization, so reading them needs platform reach.
  if (node.route.split('/')[0] === '_users') return 'platform';
  return 'internal';
}

/**
 * route -> RequiredScope.
 *
 * Path-derived ownership is the half with production data. The cascading `visibility:`
 * half is PROPOSED syntax: grounding F-038 found zero files in the reference substrate
 * using it, so it is implemented but unexercised against real content.
 */
function derivePolicy(tree) {
  const source = tree && tree.root === undefined && tree.tree ? tree.tree : tree;
  if (!source || !source.root) throw new TypeError('derivePolicy expects an OcpTree (or { tree })');
  const policy = {};
  function visit(node, inheritedVisibility, inheritedOwner) {
    const declared = parseVisibility(node.visibility);
    // A nested org boundary resets an inherited cascade. Without this, one
    // `visibility: [public]` at the graph root would publish every tenant subtree.
    const carried = node.owningOrg === inheritedOwner ? inheritedVisibility : null;
    const effective = declared || carried;
    policy[node.route] = effective || pathScope(node);
    for (const child of node.children) visit(child, effective, node.owningOrg);
  }
  visit(source.root, null, source.root.owningOrg);
  return policy;
}

function normalizeGrants(grants) {
  const input = grants && typeof grants === 'object' ? grants : {};
  return {
    isPlatformAdmin: input.isPlatformAdmin === true,
    orgs: Array.isArray(input.orgs) ? input.orgs.map((org) => String(org)).filter(Boolean) : [],
    // An explicit "authentication is switched off" posture, set only by openGrants().
    // It is deliberately NOT the same thing as platform-admin identity; see openGrants.
    open: input.open === true
  };
}

/**
 * THE SPLIT. `canView` gates a FETCH; `isListed` gates an ENUMERATION.
 *
 * `unlisted` is the first value whose two answers differ: it is reachable by anyone
 * holding the address and it is never enumerated. Getting the direction wrong is a bug in
 * either direction, and both are silent:
 *
 *   canView used on an enumeration surface  -> unlisted pages published into llms.txt,
 *                                              the sidebar, the search index, a sitemap
 *   isListed used on the gate               -> 403 to the legitimate bearer, whose only
 *                                              credential is the address they already hold
 *
 * If you are about to call one of these, the question to ask is not "who is this viewer"
 * but "am I answering a fetch or building a list".
 *
 * Grants are already the flattened reachability projection: direct memberships plus the
 * downward-admin cascade, resolved by the identity provider. ocp-core never expands an
 * org id, which is exactly how P11's "non-admin roles never cascade" is preserved.
 */
function canView(grants, scope) {
  const g = normalizeGrants(grants);
  if (scope === 'public') return true;
  // Authorization for the bearer tier: possession of the address IS the credential, so
  // every viewer is authorized. Discoverability is the other question; see isListed.
  if (scope === 'unlisted') return true;
  // Open posture reaches everything EXCEPT platform. An open wiki has no staff, so
  // platform-scoped material (which includes `_users/**` membership declarations, the
  // files that decide authorization) must not become reachable merely because
  // authentication is switched off.
  if (g.open) return scope !== 'platform';
  if (g.isPlatformAdmin) return true;
  if (scope === 'platform') return false;
  if (scope === 'internal') return g.orgs.length > 0;
  if (scope && typeof scope === 'object' && typeof scope.org === 'string') return g.orgs.includes(scope.org);
  return false;
}

/**
 * Discoverability. Everything `canView` allows, minus the bearer tier.
 *
 * `isListed` EXEMPTS NOBODY, platform admins included, and that is deliberate. The axis
 * that matters is artifact durability rather than viewer class: an unlisted page in a
 * staff member's live sidebar is harmless, but the same page in an `llms.txt` response is
 * a durable artifact that gets cached, scraped, and re-served. A surface that genuinely
 * needs unlisted pages in a staff navigation tree should take an explicit option at the
 * one call site that needs it, so the decision is auditable and greppable, never
 * acquirable by accident through a grants object.
 */
function isListed(grants, scope) {
  if (scope === 'unlisted') return false;
  return canView(grants, scope);
}

function lookupScope(policy, route) {
  const key = String(route === undefined || route === null ? '' : route).replace(/^\/+|\/+$/g, '');
  if (Object.prototype.hasOwnProperty.call(policy, key)) return policy[key];
  const segments = key.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const prefix = segments.slice(0, i).join('/');
    if (Object.prototype.hasOwnProperty.call(policy, prefix)) return policy[prefix];
  }
  // Fail closed: an unknown route is platform-only, never public.
  return 'platform';
}

/**
 * Prune to the viewer's slice. Pruning is fail-closed at the first invisible ancestor:
 * a `visibility: [public]` artifact nested under a scope the viewer cannot see is not
 * surfaced, because surfacing it would leak the path that contains it.
 */
function filterTree(tree, grants) {
  const source = tree && tree.root === undefined && tree.tree ? tree.tree : tree;
  const policy = source.policy || derivePolicy(source);
  const g = normalizeGrants(grants);
  const nodes = [];
  const byRoute = {};

  // Every predicate call in this function is an ENUMERATION, so all three are isListed
  // rather than canView. A tree, a policy map, and a discovered list are all lists.
  function visit(node) {
    if (!isListed(g, lookupScope(policy, node.route))) return null;
    const copy = Object.assign({}, node, { children: [] });
    nodes.push(copy);
    byRoute[copy.route] = copy;
    for (const child of node.children) {
      const kept = visit(child);
      if (kept) copy.children.push(kept);
    }
    return copy;
  }

  const root = visit(source.root);

  // The policy map is itself disclosure: it is keyed by route, so shipping the
  // unfiltered map would name every tenant's paths to a viewer who cannot see a
  // single one of their pages. A filtered tree must carry only the policy for
  // the routes it retained — otherwise serializing this object (into an RSC
  // payload, an API response, a debug dump) leaks exactly what the chokepoint
  // exists to withhold.
  const scopedPolicy = {};
  for (const route of Object.keys(byRoute)) {
    if (Object.prototype.hasOwnProperty.call(policy, route)) scopedPolicy[route] = policy[route];
  }

  // `discovered` records unparseable files by path, so it is scoped the same way. This
  // one matters more than it looks: DISCOVERED.md entries are keyed by path, so an
  // unlisted page that failed to parse would otherwise name itself in a published report.
  const scopedDiscovered = (source.discovered || []).filter((entry) => {
    const route = String(entry.route || entry.path || '').replace(/\.md$/, '');
    return isListed(g, lookupScope(policy, route));
  });

  return {
    root,
    nodes,
    byRoute,
    discovered: scopedDiscovered,
    sha: source.sha,
    config: source.config,
    stats: source.stats,
    policy: scopedPolicy,
    grants: g
  };
}

function pageUrl(route, baseUrl) {
  const base = baseUrl === undefined ? DEFAULT_BASE_URL : baseUrl;
  return route === '' ? base || '/' : `${base}/${route}`;
}

/**
 * THE single disclosure chokepoint (D6).
 *
 * Every read surface — sidebar and page tree, search, an AI panel's retrieval tool,
 * llms.txt, markdown content negotiation, OG images — must derive from this function's
 * output. Unscoped enumeration on a request path is banned.
 */
function scopedCorpus(context, grants, options) {
  const opts = options || {};
  const tree = context && context.root === undefined && context.tree ? context.tree : context;
  if (!tree || !tree.root) throw new TypeError('scopedCorpus expects an OcpTree (or { tree })');
  const policy = (context && context.policy) || tree.policy || derivePolicy(tree);
  const filtered = filterTree(Object.assign({}, tree, { policy }), grants);
  const baseUrl = opts.baseUrl === undefined ? DEFAULT_BASE_URL : opts.baseUrl;

  const pages = filtered.nodes
    .filter((node) => node.kind === 'artifact' || node.entryPoint !== null)
    .map((node) => ({
      route: node.route,
      url: pageUrl(node.route, baseUrl),
      path: node.entryPoint || node.path,
      displayName: node.displayName,
      artifactType: node.artifactType,
      role: node.role,
      tags: node.tags,
      scope: lookupScope(policy, node.route),
      text: plainText(node.body)
    }));

  return {
    tree: filtered,
    pages,
    text: pages.map((page) => page.text).filter(Boolean).join('\n\n'),
    scope: filtered.grants,
    sha: tree.sha
  };
}

/* ------------------------------------------------------------------ *
 * Projections
 * ------------------------------------------------------------------ */

/**
 * Scoped OcpTree -> a Fumadocs-shaped PageTree. This is the only Fumadocs coupling
 * ocp-core has: a documented output shape. Nothing is imported from Fumadocs.
 *
 * It REFUSES an unfiltered tree. A page tree is an enumeration, and a projection function
 * that will happily enumerate an unfiltered tree is a disclosure primitive wearing a
 * rendering function's name. `llmsText` has always had this guard; `project` did not, and
 * scoping was left to caller convention, which is not a chokepoint. Detection is
 * structural: `filterTree` attaches the normalized `grants` it filtered against, so its
 * presence is the proof that filtering happened.
 */
function project(tree, options) {
  const opts = options || {};
  const baseUrl = opts.baseUrl === undefined ? DEFAULT_BASE_URL : opts.baseUrl;
  const source = tree && tree.root === undefined && tree.tree ? tree.tree : tree;
  if (!source || typeof source !== 'object') throw new TypeError('project expects an OcpTree (or { tree })');
  if (!source.grants) {
    throw new TypeError(
      'project expects a SCOPED tree: pass filterTree(tree, grants) or scopedCorpus(tree, grants).tree, never a raw walk() result'
    );
  }
  if (!source.root) throw new TypeError('project expects an OcpTree (or { tree })');

  function toChild(node) {
    if (node.kind === 'artifact') {
      return { type: 'page', name: node.displayName, url: pageUrl(node.route, baseUrl) };
    }
    const folder = { type: 'folder', name: node.displayName, children: node.children.map(toChild) };
    if (node.entryPoint) {
      folder.index = { type: 'page', name: node.displayName, url: pageUrl(node.route, baseUrl) };
    }
    return folder;
  }

  const root = source.root;
  const children = root.children.map(toChild);
  if (root.entryPoint) {
    children.unshift({ type: 'page', name: root.displayName, url: pageUrl(root.route, baseUrl) });
  }
  return { name: root.displayName, children };
}

/**
 * A scoped llms.txt-style plain-text projection. It takes a corpus, never a tree, so
 * that it is structurally impossible to render it from unscoped content.
 */
function llmsText(corpus) {
  if (!corpus || !Array.isArray(corpus.pages)) {
    throw new TypeError('llmsText expects the result of scopedCorpus(tree, grants)');
  }
  const scope = corpus.scope || { isPlatformAdmin: false, orgs: [] };
  const scopeLabel = scope.open
    ? 'open (unauthenticated)'
    : scope.isPlatformAdmin
      ? 'platform-admin'
      : scope.orgs.length > 0
        ? `orgs: ${scope.orgs.join(', ')}`
        : 'public only';
  const title = corpus.tree && corpus.tree.root ? corpus.tree.root.displayName : 'OCP substrate';
  const lines = [`# ${title}`, ''];
  lines.push(
    `> Projection of an OCP substrate (${PROTOCOL.spec}), rendered by ocp-core ${VERSION} for a viewer scoped to ${scopeLabel}. Substrate SHA: ${corpus.sha || 'unversioned'}.`
  );
  lines.push('');
  for (const page of corpus.pages) {
    lines.push(`- [${page.displayName}](${page.url})${page.artifactType ? ` (${page.artifactType})` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Conformance
 * ------------------------------------------------------------------ */

const CORE_CANON_PATTERN = /^#{1,6}[ \t]+core[ \t]+canon[ \t]*$/im;

function conformance(tree) {
  const source = tree && tree.root === undefined && tree.tree ? tree.tree : tree;
  if (!source || !source.root) throw new TypeError('conformance expects an OcpTree (or { tree })');
  const problems = [];

  function add(node, code, severity, message) {
    problems.push({ path: node.entryPoint || node.path, route: node.route, code, severity, message });
  }

  for (const node of source.nodes) {
    // `visibility` diagnostics. Before these existed, a misspelled token parsed to nothing
    // and the route fell through to path-derived scope with no signal at all, which meant
    // a typo silently widened or narrowed who could read a page.
    const vis = analyzeVisibility(node.visibility);
    for (const token of vis.unrecognized) {
      add(
        node,
        'visibility-unrecognized-token',
        'error',
        `visibility token "${token}" is not recognized (expected one of ${VISIBILITY_BARE_TOKENS.join(', ')}, or <${VISIBILITY_ORG_PREFIXES.join('|')}>:<id>); it contributes nothing and this route falls through to path-derived scope`
      );
    }
    if (vis.conflictingOrgs) {
      add(
        node,
        'visibility-multiple-audiences',
        'error',
        'visibility declares more than one org audience; the field names one audience, so this resolves fail-closed to platform'
      );
    } else if (vis.multiple) {
      add(
        node,
        'visibility-multiple-audiences',
        'error',
        `visibility declares more than one audience; the field names one, so this resolves to the most restrictive (${JSON.stringify(vis.scope)})`
      );
    }
    for (const token of vis.nonCanonicalPrefixes) {
      add(
        node,
        'visibility-non-canonical-prefix',
        'warning',
        `visibility token "${token}" uses an accepted alias prefix; "${VISIBILITY_CANONICAL_ORG_PREFIX}:" is the canonical emission spelling and all four resolve identically`
      );
    }

    for (const problem of node.problems) {
      problems.push({
        path: node.entryPoint || node.path,
        route: node.route,
        code: problem.code,
        severity: problem.severity,
        message: problem.message
      });
    }

    if (node.kind !== 'artifact' && node.entryPoint === null) {
      add(node, 'missing-readme', 'error', 'every OCP directory needs a README.md entry point (P20)');
      continue;
    }

    if (node.kind === 'org' && node.entryPoint !== null) {
      if (node.role !== 'org_definition') {
        add(node, 'org-role-not-declared', 'warning', 'an organization README should declare role: org_definition (P20)');
      }
      if (!stringOrNull(node.frontmatter.org_id)) {
        add(node, 'org-missing-org-id', 'error', 'organization README must declare org_id (ADR-020 §8.1)');
      }
      if (!stringOrNull(node.frontmatter.display_name)) {
        add(node, 'org-missing-display-name', 'error', 'organization README must declare display_name (ADR-020 §8.1; F-008)');
      }
      if (!Object.prototype.hasOwnProperty.call(node.frontmatter, 'parent_org_id')) {
        add(
          node,
          'org-missing-parent-org-id',
          'error',
          'organization README must declare parent_org_id (null at the graph root) — the only surviving root-vs-child key'
        );
      }
      if (!CORE_CANON_PATTERN.test(node.body)) {
        add(
          node,
          'org-missing-core-canon',
          'error',
          'every role: org_definition README carries a Core Canon block (P20); the explicit empty state "None declared yet." is conformant'
        );
      }
    }
  }

  return { ok: problems.every((problem) => problem.severity !== 'error'), problems };
}

/* ------------------------------------------------------------------ *
 * GrantsPort adapters
 * ------------------------------------------------------------------ */

/**
 * Everything-public adapter, for a single-tenant or genuinely public substrate. Never
 * deploy it multi-tenant.
 *
 * It declares an explicit OPEN POSTURE rather than claiming platform-admin identity. The
 * distinction is not cosmetic. Returning `isPlatformAdmin: true` meant the bundled "there
 * is no auth here" adapter achieved its result by impersonating staff, so any rule
 * written in terms of staff identity silently applied to every anonymous visitor. Paired
 * with a platform-admin exemption it would publish exactly what `unlisted` exists to
 * withhold, reachable by using the default.
 *
 * Open reaches everything except `platform`, and enumerates everything except `platform`
 * and `unlisted`.
 */
function openGrants() {
  return {
    kind: 'open',
    resolve() {
      return { isPlatformAdmin: false, orgs: [], open: true };
    }
  };
}

function tokenFromRequest(request) {
  if (typeof request === 'string') return request.trim() === '' ? null : request.trim();
  if (!request || typeof request !== 'object') return null;
  const headers = request.headers;
  if (!headers) return null;
  const get = (name) =>
    typeof headers.get === 'function' ? headers.get(name) : headers[name] || headers[name.toLowerCase()];
  const auth = get('authorization');
  if (typeof auth === 'string' && auth.trim() !== '') {
    const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
    return bearer ? bearer[1].trim() : auth.trim();
  }
  const direct = get('x-ocp-token');
  return typeof direct === 'string' && direct.trim() !== '' ? direct.trim() : null;
}

/**
 * Static token/allowlist adapter, for CI, previews, and small deployments:
 *
 *   OCP_PLATFORM_ADMIN_TOKEN=<token>
 *   OCP_ORG_TOKENS={"tok-acme":["acme"],"tok-multi":["beta","gamma"]}
 *
 * Anything unrecognized resolves to zero reach (fail closed).
 */
function envGrants(env) {
  const source = env && typeof env === 'object' ? env : process.env;
  const adminToken =
    typeof source.OCP_PLATFORM_ADMIN_TOKEN === 'string' ? source.OCP_PLATFORM_ADMIN_TOKEN.trim() : '';
  let orgTokens = {};
  if (typeof source.OCP_ORG_TOKENS === 'string' && source.OCP_ORG_TOKENS.trim() !== '') {
    try {
      const parsed = JSON.parse(source.OCP_ORG_TOKENS);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) orgTokens = parsed;
    } catch {
      orgTokens = {};
    }
  }
  return {
    kind: 'env',
    resolve(request) {
      const token = tokenFromRequest(request);
      if (!token) return { isPlatformAdmin: false, orgs: [] };
      if (adminToken !== '' && token === adminToken) return { isPlatformAdmin: true, orgs: [] };
      const orgs = Object.prototype.hasOwnProperty.call(orgTokens, token) ? orgTokens[token] : null;
      if (!Array.isArray(orgs)) return { isPlatformAdmin: false, orgs: [] };
      return { isPlatformAdmin: false, orgs: orgs.map((org) => String(org)).filter(Boolean) };
    }
  };
}

module.exports = {
  VERSION,
  PROTOCOL,
  ARTIFACT_TYPES,
  ALTITUDES,
  SUBSTRATE_DIRS,
  CONTENT_DIRS,
  HALT_THRESHOLD,
  defineConfig,
  createFileSystemSubstrate,
  parseArtifact,
  walk,
  discoveredReport,
  haltStatus,
  derivePolicy,
  parseVisibility,
  canView,
  isListed,
  lookupScope,
  filterTree,
  scopedCorpus,
  project,
  llmsText,
  conformance,
  openGrants,
  envGrants
};
