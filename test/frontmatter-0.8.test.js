'use strict';

// 0.8.0 frontmatter parser. Two rules:
//   1. A wrapped value reads exactly as it would on one line; block scalars follow YAML 1.2 §8.1.
//   2. Unreadable is an error, never a wrong value: the top-level key is left unset and one
//      `unreadable-frontmatter-value` error names it with its file line numbers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArtifact } = require('../index.js');

function parse(lines) {
  return parseArtifact(['---', 'artifact_type: note', ...lines, '---', '', 'Body.'].join('\n'), {
    path: 'notes/fm.md'
  });
}

function frontmatterProblems(artifact) {
  return artifact.problems.filter((p) => /frontmatter/.test(p.code));
}

function assertClean(artifact) {
  assert.deepEqual(frontmatterProblems(artifact), []);
}

test('literal block scalar | keeps newlines and clips to one trailing newline', () => {
  const artifact = parse(['description: |', '  line one', '  line two', '', '  after a blank', 'next: x']);
  assert.equal(artifact.frontmatter.description, 'line one\nline two\n\nafter a blank\n');
  assert.equal(artifact.frontmatter.next, 'x');
  assertClean(artifact);
});

test('literal block scalar |- strips every trailing newline', () => {
  const artifact = parse(['description: |-', '  line one', '  line two', '', 'next: x']);
  assert.equal(artifact.frontmatter.description, 'line one\nline two');
  assertClean(artifact);
});

test('literal block scalar |+ keeps the trailing blank lines', () => {
  const artifact = parse(['description: |+', '  line one', '  line two', '', '', 'next: x']);
  assert.equal(artifact.frontmatter.description, 'line one\nline two\n\n\n');
  assert.equal(artifact.frontmatter.next, 'x');
  assertClean(artifact);
});

test('folded block scalar > folds lines with a space and keeps a blank line as a newline', () => {
  const artifact = parse(['summary: >', '  folded', '  text', '', '  second paragraph', 'next: x']);
  assert.equal(artifact.frontmatter.summary, 'folded text\nsecond paragraph\n');
  assertClean(artifact);
});

test('folded block scalar >- folds and strips the trailing newline', () => {
  const artifact = parse(['summary: >-   # a comment after the header', '  folded', '  text', '', 'next: x']);
  assert.equal(artifact.frontmatter.summary, 'folded text');
  assertClean(artifact);
});

test('folded block scalar >+ folds and keeps the trailing blank lines', () => {
  const artifact = parse(['summary: >+', '  folded', '  text', '', 'next: x']);
  assert.equal(artifact.frontmatter.summary, 'folded text\n\n');
  assertClean(artifact);
});

test('an explicit indentation indicator is honoured, with chomping in either order', () => {
  const artifact = parse([
    'clip: |2',
    '    more indented',
    '  at the indicator',
    'strip_after: |2-',
    '    more indented',
    '  at the indicator',
    'strip_before: |-2',
    '    more indented',
    '  at the indicator'
  ]);
  assert.equal(artifact.frontmatter.clip, '  more indented\nat the indicator\n');
  assert.equal(artifact.frontmatter.strip_after, '  more indented\nat the indicator');
  assert.equal(artifact.frontmatter.strip_before, '  more indented\nat the indicator');
  assertClean(artifact);
});

test('a folded block scalar keeps a more-indented line on its own line', () => {
  const artifact = parse(['summary: >', '  first', '  second', '    a code line', '  third']);
  assert.equal(artifact.frontmatter.summary, 'first second\n  a code line\nthird\n');
  assertClean(artifact);
});

test('a block scalar nested under a metadata: sub-key, and under a list item', () => {
  const artifact = parse([
    'metadata:',
    '  summary: >-',
    '    one',
    '    two',
    '  owner: ada',
    'members:',
    '  - user_id: ada',
    '    bio: |',
    '      hi',
    '      there',
    '  - user_id: grace'
  ]);
  assert.deepEqual(artifact.frontmatter.metadata, { summary: 'one two', owner: 'ada' });
  assert.deepEqual(artifact.frontmatter.members, [{ user_id: 'ada', bio: 'hi\nthere\n' }, { user_id: 'grace' }]);
  assertClean(artifact);
});

test('a flow sequence wrapped over three lines reads as it would on one line', () => {
  const artifact = parse(['tags: [alpha, "beta, gamma",', "  'delta, epsilon',", '  zeta]', 'next: x']);
  assert.deepEqual(artifact.frontmatter.tags, ['alpha', 'beta, gamma', 'delta, epsilon', 'zeta']);
  assert.deepEqual(artifact.tags, ['alpha', 'beta, gamma', 'delta, epsilon', 'zeta']);
  assert.equal(artifact.frontmatter.next, 'x');
  assertClean(artifact);
});

test("Prettier's wrapped flow sequence (brackets on their own lines) reads as one line", () => {
  const artifact = parse(['references:', '  [', "    'ADR-016 (one, two)',", '    ADR-028,', '  ]', 'tags:', '  [composition, testing]']);
  assert.deepEqual(artifact.frontmatter.references, ['ADR-016 (one, two)', 'ADR-028']);
  assert.deepEqual(artifact.frontmatter.tags, ['composition', 'testing']);
  assertClean(artifact);
});

test('a plain scalar wrapped over two lines folds with a single space', () => {
  const artifact = parse(['description: Use this skill when', '  the user asks for help', 'next: x']);
  assert.equal(artifact.frontmatter.description, 'Use this skill when the user asks for help');
  assert.equal(artifact.frontmatter.next, 'x');
  assertClean(artifact);
});

test('a plain scalar wrapped over three lines folds; a blank line inside becomes a newline', () => {
  const artifact = parse([
    'description: Use this skill when',
    '  the user asks',
    '  for help',
    'paragraphs: first',
    '',
    '  second',
    'items:',
    '  - a long item',
    '    wrapped'
  ]);
  assert.equal(artifact.frontmatter.description, 'Use this skill when the user asks for help');
  assert.equal(artifact.frontmatter.paragraphs, 'first\nsecond');
  assert.deepEqual(artifact.frontmatter.items, ['a long item wrapped']);
  assertClean(artifact);
});

test('a wrapped double-quoted scalar reads as it would on one line', () => {
  const artifact = parse(['display_name: "Quoted: one', '  two"', 'next: x']);
  assert.equal(artifact.frontmatter.display_name, 'Quoted: one two');
  assert.equal(artifact.displayName, 'Quoted: one two');
  assertClean(artifact);
});

test('a comment line inside a nested map is ignored, never read as a key', () => {
  const artifact = parse(['settings:', '  # timezone: UTC', '  timezone: America/New_York', '  # language: fr', '  language: en']);
  assert.deepEqual(artifact.frontmatter.settings, { timezone: 'America/New_York', language: 'en' });
  assertClean(artifact);
});

test('a comment line inside a list is ignored', () => {
  const artifact = parse([
    'references:',
    '  - ADR-020',
    '  # - ADR-099: withdrawn',
    '  - ADR-026',
    'members:',
    '  - user_id: ada',
    '    # role: owner',
    '    role: admin'
  ]);
  assert.deepEqual(artifact.frontmatter.references, ['ADR-020', 'ADR-026']);
  assert.deepEqual(artifact.frontmatter.members, [{ user_id: 'ada', role: 'admin' }]);
  assertClean(artifact);
});

test('an unreadable line leaves its top-level key unset with one error naming the key and line', () => {
  // File lines: 1 `---`, 2 artifact_type, 3 metadata:, 4 owner, 5 the unreadable line.
  const artifact = parse(['metadata:', '  owner: ada', '    stray: not a continuation', 'status: active']);
  assert.equal(Object.prototype.hasOwnProperty.call(artifact.frontmatter, 'metadata'), false);
  assert.equal(artifact.frontmatter.status, 'active');
  const problems = frontmatterProblems(artifact);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'unreadable-frontmatter-value');
  assert.equal(problems[0].severity, 'error');
  assert.match(problems[0].message, /"metadata"/);
  assert.match(problems[0].message, /line 3\b/);
  assert.match(problems[0].message, /line 5\b/);
});

test('unreadable keys are reported once each, in document order, with their line numbers', () => {
  const artifact = parse([
    'tags: [a, b', //               line 3
    '  c', //                       line 4: the sequence never closes
    'summary: |4', //               line 5
    '  under-indented', //          line 6: shallower than the indicator allows
    'aliases:', //                  line 7
    '- zero-indent', //             line 8: a sequence at the key's own column
    'status: active'
  ]);
  const problems = frontmatterProblems(artifact);
  assert.deepEqual(
    problems.map((p) => [p.code, p.severity]),
    [
      ['unreadable-frontmatter-value', 'error'],
      ['unreadable-frontmatter-value', 'error'],
      ['unreadable-frontmatter-value', 'error']
    ]
  );
  assert.match(problems[0].message, /"tags" \(line 3\).*lines 3, 4/);
  assert.match(problems[1].message, /"summary" \(line 5\).*line 6/);
  assert.match(problems[2].message, /"aliases" \(line 7\).*line 8/);
  for (const key of ['tags', 'summary', 'aliases']) {
    assert.equal(Object.prototype.hasOwnProperty.call(artifact.frontmatter, key), false, key);
  }
  assert.deepEqual(artifact.tags, []);
  assert.equal(artifact.frontmatter.status, 'active');
});

test('out of scope and unchanged: single-line flow maps stay strings, indicator-led plain values stay as written', () => {
  const artifact = parse(['options: {default: true}', 'star: *not-an-alias', 'at: @handle', 'tick: `code`']);
  assert.equal(artifact.frontmatter.options, '{default: true}');
  assert.equal(artifact.frontmatter.star, '*not-an-alias');
  assert.equal(artifact.frontmatter.at, '@handle');
  assert.equal(artifact.frontmatter.tick, '`code`');
  assertClean(artifact);
});

test('never throws on unterminated block scalars, unclosed flow sequences, or hostile nesting', () => {
  let deep = 'root:\n';
  for (let depth = 1; depth < 400; depth += 1) deep += `${' '.repeat(depth)}k${depth}:\n`;
  const hostile = [
    '---\nsummary: |\n---\n',
    '---\nsummary: >-\n',
    '---\nsummary: |+\n\n\n---\n',
    '---\nsummary: |9\n x\n---\n',
    '---\nsummary: >\n  a\n b\n---\n',
    '---\ntags: [a,\n  b,\n---\n',
    '---\ntags:\n  [\n    a,\n---\n',
    '---\ntags: [a, [b,\n  c]\n---\n',
    '---\nsummary: "never closed\n  still open\n---\n',
    '---\nitems:\n  - |\n  - >2\n  -\n---\n',
    `---\n${deep}---\n`,
    `---\nlist:\n${'  - x\n'.repeat(50000)}---\n`
  ];
  for (const source of hostile) {
    assert.doesNotThrow(() => parseArtifact(source, { path: 'notes/hostile.md' }));
  }
  assert.equal(parseArtifact('---\nartifact_type: note\nsummary: |\n---\n', { path: 'n.md' }).frontmatter.summary, '');
  const nested = parseArtifact(`---\nartifact_type: note\n${deep}---\n`, { path: 'n.md' });
  assert.equal(Object.prototype.hasOwnProperty.call(nested.frontmatter, 'root'), false);
  assert.equal(nested.problems.filter((p) => p.code === 'unreadable-frontmatter-value').length, 1);
  const unclosed = parseArtifact('---\nartifact_type: note\ntags: [a,\n  b,\n---\n', { path: 'n.md' });
  assert.equal(Object.prototype.hasOwnProperty.call(unclosed.frontmatter, 'tags'), false);
  assert.equal(unclosed.problems.some((p) => p.code === 'unreadable-frontmatter-value'), true);
});
