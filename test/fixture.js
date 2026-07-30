'use strict';

// Shared fixture builder. Not a test file — it declares no tests, so the runner loads
// it and moves on. Every substrate it writes lives under os.tmpdir(); nothing is ever
// written inside the package directory.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function note(fields, body) {
  const lines = ['---'];
  for (const key of Object.keys(fields)) lines.push(`${key}: ${fields[key]}`);
  lines.push('---', '');
  return `${lines.join('\n')}${body}\n`;
}

function orgReadme(orgId, displayName, parentOrgId, extra) {
  return `---
artifact_type: note
role: org_definition
org_id: ${orgId}
display_name: ${displayName}
parent_org_id: ${parentOrgId === null ? 'null' : parentOrgId}
status: active
tenant: acme
${extra || ''}---

# ${displayName}

Organization entry point.

## Core Canon

None declared yet.
`;
}

// Mirrors the real substrate shape: a graph-root org that also carries the substrate
// dirs, plus recursive child orgs under orgs/.
function baseFixture() {
  return {
    'README.md': orgReadme('acme-platform', 'Acme Platform', null),

    '_kernels/README.md': note(
      { artifact_type: 'note', role: 'kernel_index', display_name: 'Kernels', status: 'active' },
      'Kernel definitions.'
    ),
    '_kernels/initiative.md': note(
      { artifact_type: 'note', role: 'kernel_definition', display_name: 'Initiative Kernel', status: 'active' },
      'The universal primitive for goal-directed work.'
    ),

    '_system/README.md': note(
      { artifact_type: 'note', role: 'org_structure_definition', display_name: 'System', status: 'active' },
      'Canonical org structure.'
    ),
    '_system/artifact-types.md': note(
      { artifact_type: 'note', role: 'artifact_types_definition', display_name: 'Artifact Types', status: 'active' },
      'Five closed types.'
    ),

    '_users/README.md': note(
      { artifact_type: 'note', role: 'user_index', display_name: 'Users', status: 'active' },
      'Cross-cutting user identities.'
    ),
    '_users/ada/README.md': note(
      { artifact_type: 'note', role: 'user_definition', user_id: 'ada', display_name: 'Ada Lovelace', status: 'active' },
      'User identity.'
    ),
    '_users/ada/memberships.md': note(
      { artifact_type: 'note', role: 'memberships', display_name: 'Ada Memberships', status: 'active' },
      'Member of alpha as admin.'
    ),

    'notes/README.md': note(
      { artifact_type: 'note', role: 'notes_index', display_name: 'Platform Notes', status: 'active' },
      'Root org notes.'
    ),
    'notes/handbook.md': note(
      { artifact_type: 'note', role: 'sop', display_name: 'Operator Handbook', status: 'active' },
      'How we operate.'
    ),

    'orgs/README.md': note(
      { artifact_type: 'note', role: 'orgs_index', display_name: 'Organizations', status: 'active' },
      'Child organizations.'
    ),

    'orgs/alpha/README.md': orgReadme('alpha', 'Alpha Co', 'acme-platform'),
    'orgs/alpha/notes/README.md': note(
      { artifact_type: 'note', role: 'notes_index', display_name: 'Alpha Notes', status: 'active' },
      'Alpha notes.'
    ),
    // display name falls back to `title` (tolerated, not the contract) then to an H1.
    'orgs/alpha/notes/playbook.md': note(
      { artifact_type: 'note', role: 'sop', title: 'Alpha Playbook', status: 'active' },
      'Alpha secret sauce.'
    ),
    'orgs/alpha/orgs/README.md': note(
      { artifact_type: 'note', role: 'orgs_index', display_name: 'Alpha Children', status: 'active' },
      'Alpha child organizations.'
    ),
    'orgs/alpha/orgs/beta/README.md': orgReadme('beta', 'Beta Sub', 'alpha'),
    'orgs/alpha/orgs/beta/notes/README.md': note(
      { artifact_type: 'note', role: 'notes_index', display_name: 'Beta Notes', status: 'active' },
      'Beta notes.'
    ),
    'orgs/alpha/orgs/beta/notes/deposit-program.md': note(
      { artifact_type: 'note', role: 'offer_canon', display_name: 'Beta Deposit Program', status: 'active' },
      'Beta-only commercial terms.'
    ),

    'orgs/bravo/README.md': orgReadme('bravo', 'Bravo Ltd', 'acme-platform'),
    'orgs/bravo/notes/README.md': note(
      { artifact_type: 'note', role: 'notes_index', display_name: 'Bravo Notes', status: 'active' },
      'Bravo notes.'
    ),
    'orgs/bravo/notes/pricing.md': note(
      { artifact_type: 'adr', role: 'decision', display_name: 'Bravo Pricing Decision', status: 'active' },
      'Bravo confidential pricing.'
    ),

    // Excluded by the default exclude list, and by the leading-dot rule.
    'assets/logo-notes.md': note({ artifact_type: 'note', display_name: 'Asset Note' }, 'Should not appear.'),
    '.hidden/skip.md': note({ artifact_type: 'note', display_name: 'Hidden Note' }, 'Should not appear.')
  };
}

function writeSubstrate(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-core-test-'));
  for (const relPath of Object.keys(files)) {
    const target = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, files[relPath]);
  }
  return dir;
}

function removeSubstrate(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { note, orgReadme, baseFixture, writeSubstrate, removeSubstrate };
