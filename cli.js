#!/usr/bin/env node
'use strict';

// Conformance CLI for OCP substrates.
//
// `npx ocp-core validate [dir]` walks a substrate from its root, applies the
// same checks the library exposes as `conformance(tree)`, and reports every
// problem with its path, severity, and code. It exists to close the loop for
// agent scaffolding: generate, validate, fix, re-validate — a machine-checkable
// contract instead of prose an agent may or may not have honored.

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const ocp = require('./index.js');
const pkg = require('./package.json');

const HELP = `Usage: ocp-core validate [directory] [options]

Walk an OCP (Organizational Context Protocol) substrate — default: the current
directory — and check protocol conformance: entry-point README files, YAML
frontmatter, the closed artifact-type set, organization declarations
(org_id, display_name, parent_org_id), and Core Canon blocks. Files the walk
cannot read or parse are reported as errors, exactly as they would land in
DISCOVERED.md.

Options:
      --json             Emit the machine-readable result as JSON
  -h, --help             Print this help and exit
  -v, --version          Print the ocp-core version and exit

Exit codes:
  0  conformant (warnings are allowed)
  1  errors found, unreadable files found, the fail-soft halt threshold
     (>10% of files unparseable) was crossed, or the invocation was invalid

The spec and the conventions: https://ocp.wiki
Scaffolding a substrate as an AI agent: https://ocp.wiki/genesis.md
`;

// Errors caused by how the CLI was invoked: printed as a one-line message
// with a help hint — never as a stack trace.
class UsageError extends Error {}

function formatProblem(problem) {
  const where = problem.path || problem.route || '(root)';
  return `${problem.severity.padEnd(7)} ${where}  [${problem.code}] ${problem.message}`;
}

function runValidate(directory, { json }) {
  const target = path.resolve(process.cwd(), directory);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new UsageError(`target "${target}" does not exist`);
  }
  if (!stat.isDirectory()) {
    throw new UsageError(`target "${target}" is not a directory`);
  }

  const tree = ocp.walk(ocp.createFileSystemSubstrate(target), { substrateRoot: target });
  const result = ocp.conformance(tree);
  const halt = ocp.haltStatus(tree);

  const errors = result.problems.filter((problem) => problem.severity === 'error');
  const warnings = result.problems.filter((problem) => problem.severity !== 'error');
  const unreadable = tree.discovered;
  const ok = result.ok && unreadable.length === 0 && !halt.halt;

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok,
          target,
          sha: tree.sha,
          filesSeen: tree.stats.filesSeen,
          errors,
          warnings,
          unreadable,
          halt
        },
        null,
        2
      )}\n`
    );
    return ok ? 0 : 1;
  }

  const lines = [];
  for (const entry of unreadable) {
    lines.push(`error   ${entry.path}  [unreadable] ${entry.reason}`);
  }
  for (const problem of errors) lines.push(formatProblem(problem));
  for (const problem of warnings) lines.push(formatProblem(problem));
  if (lines.length > 0) lines.push('');

  const errorCount = errors.length + unreadable.length;
  let summary = `${ok ? 'OK' : 'FAIL'} — ${tree.stats.filesSeen} file(s) walked, ${errorCount} error(s), ${warnings.length} warning(s)`;
  if (halt.halt) {
    summary += ` — HALT: ${Math.round(halt.rate * 100)}% of files unparseable (threshold ${Math.round(
      halt.threshold * 100
    )}%)`;
  }
  if (tree.sha) summary += ` — substrate SHA ${tree.sha.slice(0, 12)}`;
  lines.push(summary);
  if (!ok) {
    lines.push('Fix the errors above (fix the source file, not the report), then re-run:');
    lines.push('  npx ocp-core validate');
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return ok ? 0 : 1;
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' }
      }
    });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (positionals.length === 0) {
    process.stderr.write(HELP);
    return 1;
  }

  const [command, ...rest] = positionals;
  if (command !== 'validate') {
    throw new UsageError(`unknown command "${command}" (expected: validate)`);
  }
  if (rest.length > 1) {
    throw new UsageError(`unexpected extra argument "${rest[1]}" — pass at most one target directory`);
  }

  return runValidate(rest[0] || '.', { json: Boolean(values.json) });
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const usage = error instanceof UsageError;
  const message = usage ? error.message : `unexpected error: ${error.message}`;
  process.stderr.write(`ocp-core: ${message}\n`);
  if (usage) {
    process.stderr.write('Run "ocp-core --help" for usage.\n');
  }
  process.exitCode = 1;
}
