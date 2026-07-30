# ocp-core

[![npm](https://img.shields.io/npm/v/ocp-core.svg)](https://www.npmjs.com/package/ocp-core)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/organizationalcontextprotocol/core/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

> ## Internal beta - MVP, not production ready
>
> **This is an internal beta MVP.** It is published to establish the package name and to exercise
> the shape of the OCP surface against real canon - not to be depended on. The API will change
> without notice, it implements only part of the protocol, and it has not been reviewed for
> correctness, security, or disclosure safety.
>
> **Do not ship this to clients or partners, or use it in production, without a full rework and
> review first.** Specifically not yet done:
>
> - **No renderer and no markdown compile.** `walk` and `project` produce a tree and page handles; turning a body into HTML is left entirely to the consumer.
> - **No per-scope search index** (plan D11). `scopedCorpus` hands you the viewer's slice; building, caching, and invalidating an index over it is not in this package.
> - **Access policy derivation is half-proven and half-undecided.** The cascading `visibility:` syntax has zero production data behind it (grounding F-038: no file in the 322-file reference substrate uses it), and the nested-org case is an open protocol question (F-016) that this package answers by failing closed — so a tenant nested two levels deep needs grants to its ancestor orgs to see its own content. See [Known limitation](#known-limitation-a-nested-tenant-needs-reach-to-its-ancestors).
> - **One SubstratePort adapter only** (filesystem). There is no remote/GitHub adapter, so a substrate must be on local disk.
> - **Conformance checking is partial.** It checks the invariants a linter can mechanically check, not the whole protocol, and it has no schema for per-type frontmatter.

---

`ocp-core` is the projection library for the **Organizational Context Protocol** — an open
specification for how an organization exposes its structure, knowledge, and access rules to AI
agents.

## Start at [ocp.wiki](https://ocp.wiki)

**https://ocp.wiki** is the single entry point for OCP: the specification, the conventions, and
the patterns — free and open to anyone.

It serves both audiences at once. A human browses it. An **agent fetches it** — which is the
point. Hand any coding agent (Claude, ChatGPT/Codex, Cursor, …) a single line:

> Create our company knowledge base using the patterns from https://ocp.wiki

…and it cascades the rest itself: reads the spec, scaffolds with `npm create ocp`, lays out the
recursive organizational structure, and fills it with the company's own content. One instruction
in, a self-hosted multi-tenant knowledge base out — one that humans and agents both read and
write, with role-based access that follows the organizational structure instead of being wired up
by hand afterward. No integration, no parsing library, no vendor client, because the substrate is
just markdown in git and the conventions are published where the agent can read them.

The material published there is not illustrative. It is the SOPs, templates, and agent context
actually running SalesBlaster and its white-label partners, alongside the assets generated
downstream of them — AI voice agents, AI SDRs, B-roll, content strategy.

That is the adoption thesis in one URL: **discovery, understanding, and implementation at the
same address, for humans and agents alike.**

## The axiom

One rule governs everything OCP does:

> Every piece of organizational reality is **either** sovereign substrate — authored once,
> versioned, canonical, living in git as markdown — **or** a derived projection, rendered from
> substrate on demand, never canonical, always disposable and rebuildable.

Git holds the substrate. Vector indexes, databases, caches, dashboards, an agent's working
context: all projections. Lose a projection and you rebuild it from git, losing nothing. The
vector store is not deleted by this move; it is **demoted** to one projection among many.

This library is a projection engine. It reads substrate through a port and emits projections —
a tree, a page tree, a policy map, a scoped corpus, an `llms.txt`. It never writes.

### What it corrects

The common "AI brain on a flat vector store" is broken in four load-bearing ways:

| Failure | What OCP does instead |
|---|---|
| **No source of truth** — the index *is* the memory, opaque and un-diffable | Markdown in git; every fact has an upstream you can read and review |
| **No structure** — cosine similarity does not respect client boundaries, so context bleeds | A recursive organizational hierarchy; retrieval is scoped by position, not by embedding distance |
| **No version history** — institutional memory that cannot be replayed is a mood | The commit SHA is the authoritative version reference at every scope (P8) |
| **No access control** — exfiltration, and prompt injection at scale | Access and trust are declared in the artifact's own frontmatter, versioned in the same commit |

And the invariant that holds it together:

> **Derivation does not launder trust.** A fact inherits the trust tier of its lowest-trust
> source, no matter how many LLM hops it passes through.

### Where it sits

OCP is to context what MCP is to tools — the same architectural move (port + adapter) applied to
a different substrate. MCP canonicalizes the **action** layer; OCP canonicalizes the **context**
layer. Both collapse N×M bespoke integrations to N+M. An agent that speaks both reads its
organization's reality through OCP and acts through MCP.

If you know Ports & Adapters: **OCP is hexagonal architecture for content instead of code.**
Port : Kernel :: Use case : Kernel instance :: Adapter : Renderer or integration.

OCP is a standard, not a product. It is MIT, free, and derives its value from adoption rather
than exclusion — the CommonMark, OpenAPI, and MCP lineage. The specification lives in ADR-020.

There is a second reason it is free. The leverage that comes from orchestrating AI agents should
not sit behind a consultancy retainer: a business ought to be able to equip its own marketing,
sales, operations, and support functions without first hiring someone to translate its knowledge
into a machine-readable shape. A protocol costs nothing to adopt and behaves identically for a
two-person shop and for a platform serving hundreds of accounts.

## Install

```sh
npm install ocp-core
```

Node.js 20 or newer. **Zero runtime dependencies, zero devDependencies.** CommonJS
(`require`); it also works from ESM via the default import.

## Quickstart

Fully self-contained: it writes a tiny conformant substrate to a temp directory, walks it,
derives access policy, and takes a scoped slice. Every line of output below is real.

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createFileSystemSubstrate,
  walk,
  derivePolicy,
  scopedCorpus,
  project,
  conformance
} = require('ocp-core');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-quickstart-'));
const write = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

// The repository root IS the graph-root organization. There is no wrapper directory,
// and there is no index.md anywhere in OCP — README.md is the entry point.
write('README.md', `---
artifact_type: note
role: org_definition
org_id: acme
display_name: Acme Platform
parent_org_id: null
---

# Acme Platform

## Core Canon

None declared yet.
`);

write('orgs/README.md', `---
artifact_type: note
display_name: Client Organizations
---

Every child organization lives here.
`);

write('orgs/northwind/README.md', `---
artifact_type: note
role: org_definition
org_id: northwind
display_name: Northwind
parent_org_id: acme
---

# Northwind

## Core Canon

None declared yet.
`);

write('orgs/northwind/notes/README.md', `---
artifact_type: note
display_name: Northwind Notes
---

Client-scoped notes.
`);

write('orgs/northwind/notes/pricing.md', `---
artifact_type: note
role: offer_canon
display_name: Northwind Pricing
---

Confidential to Northwind.
`);

const tree = walk(createFileSystemSubstrate(dir), { substrateRoot: dir });
console.log(tree.root.displayName);
// Acme Platform
console.log(tree.byRoute['orgs/northwind/notes/pricing'].owningOrg);
// northwind

const policy = derivePolicy(tree);
console.log(policy['orgs/northwind/notes/pricing']);
// { org: 'northwind' }
console.log(policy['']);
// internal

// Everything a viewer is allowed to see comes out of here, and only here.
const corpus = scopedCorpus(tree, { isPlatformAdmin: false, orgs: ['northwind'] });
console.log(corpus.pages.map((page) => page.route));
// [ '', 'orgs', 'orgs/northwind', 'orgs/northwind/notes', 'orgs/northwind/notes/pricing' ]

const outsider = scopedCorpus(tree, { isPlatformAdmin: false, orgs: ['other-client'] });
console.log(outsider.pages.map((page) => page.route));
// [ '', 'orgs' ]
console.log(outsider.text.includes('Confidential to Northwind'));
// false

console.log(project(corpus.tree).children[1].index);
// { type: 'page', name: 'Client Organizations', url: '/docs/orgs' }

console.log(conformance(tree).ok);
// true

fs.rmSync(dir, { recursive: true, force: true });
```

To scaffold a real substrate and a renderer around it, run `npm create ocp`
([create-ocp](https://github.com/organizationalcontextprotocol/create-ocp)).

## The shape `ocp-core` expects

Recursive and uniform. **The repository root is itself an organization** — the graph root, with
`parent_org_id: null`. Every org may contain child orgs under `orgs/`, to any depth.

```text
/                          the graph root org
├── README.md              entry point; role: org_definition
├── _kernels/              kernel definitions        (substrate)
├── _adrs/                 canonical platform ADRs   (substrate)
├── _system/               altitude-types.md, artifact-types.md, kernel-criteria.md
├── _users/<user-id>/      cross-cutting; README.md + memberships.md
├── notes/  prompts/  templates/  reports/  initiatives/    the root org's own content
└── orgs/<org-id>/         child orgs; recursion begins here
    ├── README.md  notes/  prompts/  templates/  reports/  initiatives/
    └── orgs/<org-id>/     grandchildren
```

Three conventions carry the weight:

**README-as-index (P20).** Every directory has a `README.md` entry point, and its `role:`
frontmatter field declares the directory's purpose — `org_definition`, `user_definition`,
`kernel_index`, `kernel_definition`, `org_structure_definition`, `artifact_types_definition`.
**There is no `index.md` anywhere in OCP.** Additionally, every `role: org_definition` README
carries a **Core Canon** block: a namespace + key → pointer table of the org's foundational
facts. The explicit empty state (`None declared yet.`) is conformant.

**Underscore-prefixed *directories* are substrate.** `_kernels/`, `_adrs/`, `_system/`,
`_users/` are metadata of the repository or definitions of the containing entity; un-prefixed
directories are content. The underscore applies to directories, never to entry-point files.

**Altitude is declared, not path-encoded.** Five positional altitudes exist as vocabulary —
`platform`, `tenant`, `agency`, `account`, `user` — and a designer builds only the ones they
need (a solo builder: 2; a direct agency: 3; a white-label: 4–5). The `org_type` frontmatter
**field was retired 2026-07-21**; only root-vs-child survives, keyed on `parent_org_id == null`.
`ocp-core` flags `org_type` as a warning if it finds it, and never authors it.

### Artifact types (P16)

Exactly five, declared via `artifact_type:` — `note`, `adr`, `prompt`, `template`, `report`. The
set is **closed**; a sixth requires an OCP-amending ADR. Closure is the point: five known
schemas means every OCP-aware tool is written once and works against every conformant
organization. (ADR-026 briefly added `projection_definition`; it was retired 2026-07-28 and
re-expressed as `role: report_definition` on `template`. `ocp-core` reports it as an unknown
type.)

Extensibility is exactly two open dimensions: the **`role:`** field, which discriminates within
a type, and the open **`metadata:`** object for user-domain fields. Conformant tooling never
reads `metadata`, and neither does this library.

### Frontmatter vocabulary (P17)

| Field | On | Notes |
|---|---|---|
| `artifact_type` | every artifact | one of the closed five |
| `role` | every artifact | open discriminator within the type |
| `display_name` | every artifact | **the human-readable name key — not `title`** |
| `status` | every artifact | `active`, `draft`, `archived`, `deprecated`, `paused` — illustrative, not closed. Org entry points use `active \| paused \| archived` (ADR-020 §8.1) |
| `tenant` | every artifact | tenant scope |
| `created` / `updated` | every artifact | RFC3339 |
| `tags` | every artifact | array |
| `metadata` | every artifact | open object; conformant tooling never reads it |
| `org_id`, `display_name`, `parent_org_id`, `members[]`, `settings{}` | org and entity entry points | `parent_org_id: null` marks the graph root |
| `visibility`, `trust_tier` | any artifact | access and trust ride on the artifact itself |

> **`display_name`, not `title`.** This is the single most load-bearing detail in the whole
> vocabulary, and it is why this library exists in the shape it does. Fumadocs' default
> `pageSchema` requires `title`; pointed at the 322-file reference substrate it **silently
> dropped 271 of 322 files and still exited 0** (grounding F-008). `ocp-core` resolves display
> names as `display_name` → `title` → first H1 outside fenced code → humanized final path
> segment. `title` is *tolerated* — Postel's law, be liberal in what you accept — but never
> required, and an unrecognized `artifact_type` is **recorded, never silently dropped**.

An artifact carrying access and trust, exactly as canon documents it:

```yaml
---
artifact_type: note
role: capture
status: active
trust_tier: 2                     # unvetted; captured from an external source
visibility: [account:acme-co]     # scope of who/what may retrieve this
metadata:
  source: inbound-email
  agent_roles_read: [triage]
---
```

## API

```js
const ocp = require('ocp-core');
```

### Constants

| Export | Value |
|---|---|
| `VERSION` | this package's version |
| `PROTOCOL` | `{ name: 'Organizational Context Protocol', spec: 'ADR-020', surface: '0.2' }` |
| `ARTIFACT_TYPES` | frozen `['note','adr','prompt','template','report']` (P16) |
| `ALTITUDES` | frozen `['platform','tenant','agency','account','user']` (P4) |
| `SUBSTRATE_DIRS` | frozen `['_kernels','_adrs','_system','_users']` |
| `CONTENT_DIRS` | frozen `['notes','prompts','templates','reports','initiatives','orgs']` |
| `HALT_THRESHOLD` | `0.1` — a walk failure rate above 10% is a halt condition (D12) |

`PROTOCOL.surface` is **this library's conformance-surface version**, not a protocol version
number. ADR-020 asserts no numbered protocol version, so this package does not invent one.

### `defineConfig(config) → OcpConfig`

A Vite-style identity helper that validates and fills defaults, so a scaffolded `ocp.config.js`
can do `module.exports = defineConfig({ ... })`. Exactly four keys; anything else throws.

```js
const { defineConfig } = require('ocp-core');

defineConfig({ substrateRoot: '../../../AIOS' });
// {
//   substrateRoot: '../../../AIOS',
//   exclude: [ '.git', 'node_modules', 'DISCOVERED.md', 'CLAUDE.md', 'assets' ],
//   sourceBlobBase: null,
//   displayOverrides: {}
// }
```

| Key | Default | Meaning |
|---|---|---|
| `substrateRoot` | `'.'` | where the substrate lives on disk |
| `exclude` | `['.git','node_modules','DISCOVERED.md','CLAUDE.md','assets']` | entry names skipped during the walk |
| `sourceBlobBase` | `null` | base URL for "view source" links, e.g. `https://github.com/acme/aios/blob/main` |
| `displayOverrides` | `{}` | route → display name, for the handful of names you want to force |

Entries beginning with `.` are always skipped, independent of `exclude`.

### `createFileSystemSubstrate(rootDir) → SubstratePort`

The **only** adapter. `{ kind, root, read(path), list(dir), sha() }`.

- `read(path)` returns UTF-8 text; it throws if the path escapes the root.
- `list(dir)` returns `[{ name, type: 'file' | 'dir' }]`.
- `sha()` returns the substrate's git commit SHA, or `null` outside a checkout. It reads
  `.git/HEAD` and the ref file directly — no `child_process`, no dependencies — and handles
  gitdir files (submodules and linked worktrees), detached HEAD, and `packed-refs`. **P8: the
  commit SHA is the authoritative version reference at every scope**; frontmatter version fields
  are human courtesy and may drift.

A remote/GitHub adapter is a named non-goal — see [Deferred](#deferred-with-triggers).

### `parseArtifact(source, opts?) → Artifact`

Parses one markdown artifact. **It never throws**, on any input, including hostile input.

```js
const { parseArtifact } = require('ocp-core');

const artifact = parseArtifact(
  [
    '---',
    'artifact_type: note',
    'role: capture',
    'display_name: Inbound Capture',
    'trust_tier: 2                     # unvetted',
    'visibility: [account:acme-co]',
    'tags: [inbound, triage]',
    '---',
    '',
    'See [[handbook|the handbook]]. Inline `[[not-a-link]]` stays code.'
  ].join('\n'),
  { path: 'orgs/acme/notes/capture.md' }
);

console.log(artifact.slug);        // orgs/acme/notes/capture
console.log(artifact.displayName); // Inbound Capture
console.log(artifact.trustTier);   // 2
console.log(artifact.visibility);  // [ 'account:acme-co' ]
console.log(artifact.tags);        // [ 'inbound', 'triage' ]
console.log(artifact.links);       // [ { target: 'handbook', display: 'the handbook', raw: '[[handbook|the handbook]]' } ]
console.log(artifact.problems);    // []
```

Returns `{ path, slug, artifactType, role, displayName, status, tenant, tags, visibility,
trustTier, frontmatter, body, links, problems }`.

The frontmatter parser accepts a tolerant YAML subset: quoted and bare scalars, booleans,
numbers, `null`, inline arrays (respecting quotes), block lists, list-of-maps (`members:`),
nested maps (`settings:`, `metadata:`), and trailing `# comments`. It strips a leading UTF-8
BOM, tolerates CRLF, preserves unknown keys verbatim, and skips lines it cannot parse rather
than failing. `__proto__` is refused rather than assigned.

`links` extracts `[[wikilink]]` and `[[wikilink|display]]`, ignoring fenced code blocks and
inline code spans. Extraction and text rewriting share one internal code-segment helper, so the
two can never disagree about what counts as code.

`problems` is an array of `{ code, severity, message }` with `severity` of `'error'` or
`'warning'`. Codes: `missing-frontmatter`, `unterminated-frontmatter`,
`unparsed-frontmatter-lines`, `missing-artifact-type`, `unknown-artifact-type`,
`retired-org-type-field`, `unreadable-source`.

### `walk(substrate, config) → OcpTree`

Walks a `SubstratePort` into a tree. README-as-index: a directory's `README.md` **is** its entry
point and supplies the directory's display name and role. A README never becomes its own node.

Each node:

```text
{
  kind,          // 'org' | 'user' | 'kernel' | 'substrate-dir' | 'content-dir' | 'artifact'
  route,         // 'orgs/alpha/notes/playbook' — '' at the graph root
  path,          // the file path for artifacts, the directory path otherwise
  name, displayName, role, artifactType, status, tenant, tags, visibility, trustTier,
  frontmatter, body, links,
  entryPoint,    // 'orgs/alpha/README.md', or null for a leaf artifact
  orgId, parentOrgId, owningOrg,
  children, problems
}
```

Classification: a declared `role:` wins (`org_definition` → `org`, `user_definition` → `user`,
`kernel_definition`/`kernel_index` → `kernel`); otherwise an underscore prefix means
`substrate-dir` and anything else is `content-dir`. The graph root is always an `org`.

`owningOrg` is the **deepest** org under an `orgs/` directory that contains the node — that is
what makes `orgs/<a>/orgs/<b>/…` resolve to `b` and not `a`. The graph root's own content has
`owningOrg: null`, because the root is an organization but not a tenant.

The tree is `{ root, nodes, byRoute, discovered, sha, config, stats }`.

#### Fail-soft (D12)

A file that cannot be read or parsed **never aborts the walk**. It lands in `tree.discovered[]`
as `{ path, reason }` and the walk continues.

A `SubstratePort` is two methods, so a failing one is easy to demonstrate:

```js
const { walk, discoveredReport, haltStatus } = require('ocp-core');

const readme = '---\nartifact_type: note\ndisplay_name: Root\n---\n\nBody.\n';
const substrate = {
  read(filePath) {
    if (filePath === 'notes/broken.md') throw new Error('simulated I/O failure');
    return readme;
  },
  list(dir) {
    if (dir === '') return [{ name: 'README.md', type: 'file' }, { name: 'notes', type: 'dir' }];
    if (dir === 'notes') return [{ name: 'README.md', type: 'file' }, { name: 'broken.md', type: 'file' }];
    return [];
  }
};

const tree = walk(substrate, {});

console.log(tree.discovered);
// [ { path: 'notes/broken.md', reason: 'read failed: simulated I/O failure' } ]

console.log(tree.byRoute['notes'].displayName); // the walk continued regardless
// Root

console.log(haltStatus(tree));
// { filesSeen: 3, failed: 1, rate: 0.3333333333333333, threshold: 0.1, halt: true }

console.log(discoveredReport(tree).split('\n')[0]);
// # DISCOVERED.md
```

`discoveredReport(tree)` returns the markdown body of a `DISCOVERED.md` — the same file the
reference substrate keeps at its root. `haltStatus(tree)` reports whether the failure rate
exceeded `HALT_THRESHOLD` (10%); above that, stop and fix the substrate rather than shipping a
wiki with holes in it.

### Access policy

`RequiredScope` is a four-member union:

```
'public' | 'internal' | 'platform' | { org: string }
```

`Grants` is the viewer's reachability: `{ isPlatformAdmin: boolean, orgs: string[] }`.

#### `derivePolicy(tree) → { [route]: RequiredScope }`

| Path | Derived scope | Why |
|---|---|---|
| `` (graph root) | `internal` | the root org's entry point |
| `notes/`, `prompts/`, `templates/`, `reports/`, `initiatives/` | `internal` | the root org's own content |
| `_adrs/`, `_kernels/`, `_system/` | `internal` | substrate definitions every member needs to operate (P21) |
| `_users/**` | `platform` | membership declarations decide authorization; reading them is a platform act |
| `orgs/<id>/**` | `{ org: <id> }` | path-derived ownership; the **deepest** owning org wins |
| anything with a declared `visibility:` | that value, cascading to descendants | frontmatter overrides the path — *proposed syntax*, see below |
| an unknown route | `platform` | fail closed |

Nothing is `public` unless something declares it. To publish a substrate, declare
`visibility: [public]` on the graph-root README; it cascades.

> ### Read this before deploying multi-tenant
>
> **`internal` means *any member of any organization*, not "staff only".** Combined with the
> table above, that has a consequence worth stating plainly: **by default, a member of one client
> org can read `_adrs/`, `_kernels/`, `_system/`, and all of the root org's `notes/`,
> `reports/`, and `initiatives/`.**
>
> That default is deliberate for a single-organization substrate, where the conventions have to
> be readable by everyone who authors against them (P21's thirty-minute bar). It is **the wrong
> default the moment you host more than one tenant**, because platform decision records and the
> root org's operating notes are rarely meant for a client.
>
> Close it by declaring visibility on the directories that should not be broadly readable — it
> cascades to everything beneath:
>
> ```yaml
> ---
> artifact_type: note
> role: note
> visibility: [platform]     # _adrs/README.md — and every ADR under it
> ---
> ```
>
> Verify with the corpus itself rather than by reading the table:
>
> ```js
> const client = scopedCorpus(tree, { isPlatformAdmin: false, orgs: ['some-client'] });
> console.log(client.pages.map((page) => page.route)); // audit this list before you ship
> ```
>
> There is no override hook on `derivePolicy` itself: `visibility:` frontmatter is the whole
> mechanism, which is the F-038 caveat below applied to the one case where you are most likely
> to need it.

`visibility` accepts `public`, `internal`, `platform`, and `<prefix>:<id>` where the prefix is
one of `org`, `account`, `tenant`, or `agency` — all four resolve to `{ org: id }`. Canon's
documented example uses `account:`, while the implemented union is flat `{ org }`; accepting
both is deliberate. Only the first recognized entry is honoured, because `RequiredScope` is one
value and canon has not ruled on set semantics.

> **The `visibility:` half is proposed and unexercised.** Grounding F-038: **zero** of the 322
> files in the reference substrate carry `visibility:` in frontmatter — the one occurrence in
> that tree is a documentation example. Path-derived ownership is the half with production data
> behind it. Treat the cascade as a design you are testing, not a mechanism that has run.

**One ruling beyond canon, stated so you can disagree with it:** an inherited `visibility`
cascade **resets at a nested org boundary**. Without that, a single `visibility: [public]` on the
graph root would silently publish every tenant subtree — exactly the disclosure class this
library exists to prevent. A child org's own declaration still governs its subtree.

#### Known limitation: a nested tenant needs reach to its ancestors

Because `filterTree` prunes at the first invisible ancestor, a viewer must be able to see **every
org on the path** to the content they own. In a substrate shaped like
`orgs/salesblaster/orgs/bingo-jets/…`, grants of `{ orgs: ['bingo-jets'] }` yield **zero**
bingo-jets pages — the walk is cut at `orgs/salesblaster`, which requires
`{ org: 'salesblaster' }`. Grants of `{ orgs: ['salesblaster', 'bingo-jets'] }` return the
bingo-jets subtree correctly (and still expose no sibling client), but they also grant the whole
`salesblaster` org, which is more than a client should have.

This is not an oversight to be worked around in a consumer; it is an **undecided policy question
in the protocol**, recorded as grounding F-016: whether `derivePolicy` should mirror the auth
layer's downward-admin reach, and whether an ancestor org directory should be traversable without
being readable, has not been ruled on. `ocp-core` takes the conservative branch — fail closed,
prune early, leak nothing — and leaves the ruling to canon. **A rework must resolve this before
any deployment with orgs nested more than one level deep.**

#### `canView(grants, scope) → boolean`

| `scope` | anonymous `{ orgs: [] }` | `{ orgs: ['a'] }` | `{ isPlatformAdmin: true }` |
|---|---|---|---|
| `'public'` | ✅ | ✅ | ✅ |
| `'internal'` | ❌ | ✅ | ✅ |
| `'platform'` | ❌ | ❌ | ✅ |
| `{ org: 'a' }` | ❌ | ✅ | ✅ |
| `{ org: 'b' }` | ❌ | ❌ | ✅ |

Admin authority cascades downward (P11) — but **that cascade happens in your identity provider,
not here**. `grants.orgs` is already the flattened reachability projection (direct memberships
plus the downward-admin cascade). `ocp-core` never expands an org id; it tests membership
exactly. That is precisely how "non-admin roles never cascade" stays true.

#### `lookupScope(policy, route) → RequiredScope`

Exact match, else nearest ancestor prefix, else `'platform'`. A route that was never walked
still resolves — to its nearest known ancestor, and to `platform` if it has none.

#### `filterTree(tree, grants) → OcpTree`

A pruned tree. Pruning is fail-closed at the **first invisible ancestor**: a
`visibility: [public]` artifact nested under a scope the viewer cannot see is *not* surfaced,
because surfacing it would leak the path containing it.

### `scopedCorpus(context, grants, options?)` — the chokepoint

**This is the single disclosure chokepoint. Every read surface must route through it, and
unscoped enumeration on a request path is banned.**

The quickstart above runs it end to end. The return value is:

```text
scopedCorpus(tree, grants, options?) → { tree, pages, text, scope, sha }
```

- `tree` — the pruned `OcpTree`, for the sidebar and page tree
- `pages` — `[{ route, url, path, displayName, artifactType, role, tags, scope, text }]`
- `text` — the concatenated extractable text of exactly those pages
- `scope` — the normalized grants the slice was built for
- `sha` — the substrate commit

`options.baseUrl` defaults to `/docs`.

Every one of these surfaces must be built from a corpus, never from the whole tree:

| Surface | Required behavior |
|---|---|
| Page tree / sidebar | `scopedCorpus(tree, grants).tree` |
| Page render | `canView` at the gate; 404 on out-of-scope |
| Search | a per-scope index built from the corpus, scope derived **server-side** from grants |
| An AI panel's retrieval tool | rebuilt over the corpus; grants resolved per request |
| `llms.txt` / `llms-full.txt` | scoped |
| Markdown content negotiation | gate before negotiate |
| OG images | scope-gated; a generic card otherwise |
| Error and 404 bodies | must not echo sibling titles or valid-route hints |

**Why this function exists, concretely.** The Fumadocs starter this protocol's reference renderer
is built on constructs a **module-scope search index over all pages**, and its AI chat `search`
tool **takes no scope parameter**. Deployed multi-tenant as-is, Ask-AI retrieves and summarizes
other clients' documents *invisibly*, because tool results are not rendered. That is the same
bug class as an ambient page map, relocated into retrieval. The fix is an inversion: **what
determines what a consumer sees must be an argument, not ambient state.** Hence one function,
one argument, one slice.

`llmsText` deliberately accepts a *corpus* and refuses a tree, so it is structurally impossible
to render it from unscoped content.

### `project(tree, options?) → PageTree`

`OcpTree` → a Fumadocs-shaped page tree. This is the **only** Fumadocs coupling `ocp-core` has:
a documented output shape. Nothing is imported from Fumadocs, UI or otherwise.

```text
{
  name: 'Acme Platform',
  children: [
    { type: 'page',   name: 'Acme Platform', url: '/docs' },
    { type: 'folder', name: 'Client Organizations',
      index:    { type: 'page', name: 'Client Organizations', url: '/docs/orgs' },
      children: [ ... ] }
  ]
}
```

A folder gets an `index` page only when its directory has a `README.md`. `options.baseUrl`
defaults to `/docs`. Pass it `corpus.tree` rather than the raw tree and the projection is scoped
for free — the quickstart does exactly that.

### `llmsText(corpus) → string`

A small scoped `llms.txt`-style projection. It exists mainly to demonstrate that projections are
derived from the **scoped** corpus, never from the whole tree.

Given the quickstart's `corpus`, `llmsText(corpus)` returns:

```text
# Acme Platform

> Projection of an OCP substrate (ADR-020), rendered by ocp-core 0.2.0 for a viewer scoped to orgs: northwind. Substrate SHA: unversioned.

- [Acme Platform](/docs) (note)
- [Client Organizations](/docs/orgs) (note)
- [Northwind](/docs/orgs/northwind) (note)
- [Northwind Notes](/docs/orgs/northwind/notes) (note)
- [Northwind Pricing](/docs/orgs/northwind/notes/pricing) (note)
```

### `conformance(tree) → { ok, problems }`

A linter for the canon invariants that can be checked mechanically. `ok` is true when no problem
has `severity: 'error'`.

| Code | Severity | Rule |
|---|---|---|
| `missing-readme` | error | every directory has a `README.md` entry point (P20) |
| `missing-frontmatter` | error | every artifact is self-describing (P17) |
| `missing-artifact-type` | error | frontmatter declares `artifact_type` (P16/P17) |
| `unknown-artifact-type` | error | the type is one of the closed five (P16) |
| `org-missing-org-id` / `org-missing-display-name` / `org-missing-parent-org-id` | error | org READMEs declare their identity (ADR-020 §8.1) |
| `org-missing-core-canon` | error | every `role: org_definition` README carries a Core Canon block (P20) |
| `org-role-not-declared` | warning | an org README should declare `role: org_definition` |
| `retired-org-type-field` | warning | `org_type` was retired 2026-07-21 |
| `unterminated-frontmatter` / `unparsed-frontmatter-lines` | warning | tolerated malformation, surfaced rather than hidden |

Each problem is `{ path, route, code, severity, message }`.

### GrantsPort adapters

A `GrantsPort` is one method: `resolve(request) → Grants`. Two are bundled.

```js
const { openGrants, envGrants } = require('ocp-core');

console.log(openGrants().resolve({}));
// { isPlatformAdmin: true, orgs: [] }

const port = envGrants({
  OCP_PLATFORM_ADMIN_TOKEN: 'staff-token',
  OCP_ORG_TOKENS: '{"tok-acme":["acme"],"tok-multi":["beta","gamma"]}'
});

console.log(port.resolve({ headers: { authorization: 'Bearer staff-token' } }));
// { isPlatformAdmin: true, orgs: [] }
console.log(port.resolve({ headers: { 'x-ocp-token': 'tok-acme' } }));
// { isPlatformAdmin: false, orgs: [ 'acme' ] }
console.log(port.resolve({ headers: { authorization: 'Bearer nope' } }));
// { isPlatformAdmin: false, orgs: [] }
```

`openGrants()` grants **full reach**, which makes it correct for a single-tenant or genuinely
public substrate and wrong for anything else. Never deploy it multi-tenant.

`envGrants(env)` reads a static token allowlist from environment variables (defaulting to
`process.env`) and fails closed on anything unrecognized. It accepts a bearer token, an
`x-ocp-token` header, a `Headers`-like object with `.get()`, or a bare token string.

#### Wiring a real identity provider

`GrantsPort` is not a paywall. It exists so that adopting OCP does not mean adopting anyone's
auth. To wire your own IdP as a relying party, implement one method:

```js
function myGrants(getSession) {
  return {
    kind: 'my-idp',
    async resolve(request) {
      const session = await getSession(request); // your IdP, your session
      if (!session) return { isPlatformAdmin: false, orgs: [] }; // fail closed
      return {
        isPlatformAdmin: session.isPlatformAdmin === true,
        // Already flattened: direct memberships + the downward-admin cascade.
        orgs: session.orgs
      };
    }
  };
}
```

Two rules make this safe. **Flatten before you return** — resolve the downward-admin cascade in
your IdP so `orgs` is a plain reachability list, because `ocp-core` will not expand it. And
**fail closed** — an absent or invalid session is `{ isPlatformAdmin: false, orgs: [] }`, which
sees only what is declared `public`.

## Design notes

**This package is the shared contract; the renderer is yours to fork.** `ocp-core` is the
conformance surface and must not fragment, which is why it is a package dependency rather than
copied source. `create-ocp` is the opposite: a template you own outright, shadcn-style, because
chrome is the adopter's job. If the two ever disagree about what a substrate means, `ocp-core`
is wrong and should be fixed here, once, for everyone.

**The prime over-engineering constraint**, quoted from the plan of record:

> `ocp-core` is four functions (walk, classify, project, derive-policy) plus two one-method
> ports. If it grows a plugin system before a second external consumer exists, halt and re-read
> this line.

**Thirty-minute operability (P21).** A first-time operator, human or agent, must be able to read
the root README, the kernel definition, and an initiative README and run a competent operation
within thirty minutes. Complexity beyond that budget is a defect, in a substrate and in this
library.

## Deferred, with triggers

Named non-goals, not oversights. Each has the condition that would reopen it.

| Deferred | Trigger |
|---|---|
| GitHub-API / remote `SubstratePort` adapter | the first external org that cannot vendor its substrate locally |
| Per-scope search index and caching (D11) | belongs to the renderer; `scopedCorpus` is the input it needs |
| Markdown → HTML compilation | belongs to the renderer; substrate must never contain JSX |
| A public OCP spec site | a separate initiative |
| Foundation, governance, RFC process | the first unsolicited external PR of substance |
| An external search service | a measured memory threshold breached in production |
| A plugin architecture for `ocp-core` | Rule of Three across **external** consumers, not internal surfaces |

Known limitations of what *is* here, stated plainly: the
[nested-tenant ancestor-reach problem](#known-limitation-a-nested-tenant-needs-reach-to-its-ancestors)
is unresolved and blocks any deployment with orgs nested more than one level deep; `walk` retains
every artifact body in memory, which is fine at a few hundred files and unmeasured beyond that;
`conformance` has no per-type frontmatter schema; there is no link-graph resolution or validation
across artifacts; and nothing in this package enforces that a consumer actually calls
`scopedCorpus` — that enforcement belongs in the renderer's lint rules.

## Status

Source lives in [organizationalcontextprotocol/core](https://github.com/organizationalcontextprotocol/core).
The package is on npm at `0.2.x` while the protocol documentation and the reference renderer are
built out. Expect breaking changes at every minor version until `1.0`.

## Related

- [ocp.wiki](https://ocp.wiki) — the specification, the conventions, and the worked examples
- [create-ocp](https://www.npmjs.com/package/create-ocp)
  ([source](https://github.com/organizationalcontextprotocol/create-ocp)) — the scaffolder, built
  on this package
- [github.com/organizationalcontextprotocol](https://github.com/organizationalcontextprotocol) —
  the protocol's identity namespace

The fastest on-ramp to conformance is to fork a conformant template and replace its content with
your own: the structure is portable, and only the domain content is yours to write.

## License

MIT © 2026 Max Forbang
