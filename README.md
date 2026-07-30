# ocp-core

The projection library for the **Organizational Context Protocol** — an open specification for how
an organization exposes its structure, knowledge, and access rules to AI agents.

[![npm](https://img.shields.io/npm/v/ocp-core.svg)](https://www.npmjs.com/package/ocp-core)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> ## Internal beta - MVP, not production ready
>
> **This is an internal beta MVP.** It is published to establish the package name and to exercise
> the shape of the OCP surface against real canon - not to be depended on. The API will change
> without notice, it implements only part of the protocol, and it has not been reviewed for
> correctness, security, or disclosure safety.
>
> **Do not ship this to clients or partners, or use it in production, without a full rework and
> review first.**

---

## Start at [ocp.wiki](https://ocp.wiki)

**https://ocp.wiki** is where OCP lives in public: the specification, the conventions, and a
working library of the patterns — free, for anyone.

One address serves a reader and a machine. A person browses it; an **agent fetches it**. Give any
coding agent (Claude, ChatGPT/Codex, Cursor, …) a single instruction:

> Create our company knowledge base using the patterns from https://ocp.wiki

It takes it from there — reads the spec, scaffolds with `npm create ocp`, builds out the recursive
organizational structure, and populates it with the company's own material. The result is a
knowledge base the business hosts itself, that people and agents both read and write, whose access
boundaries fall out of the org structure rather than being assembled by hand.

The documents published there are load-bearing, not demonstrative: the SOPs, templates, and agent
context currently running SalesBlaster and its white-label partners, along with the assets built
on top of them.

**Discovery, understanding, and implementation at the same address** — that is the whole adoption
thesis.

## The axiom

One rule governs everything OCP does:

> Every piece of organizational reality is **either** sovereign substrate — authored once,
> versioned, canonical, living in git as markdown — **or** a derived projection, rendered from
> substrate on demand, never canonical, always disposable and rebuildable.

Git holds the substrate. Vector indexes, databases, caches, dashboards, an agent's working
context: all projections. Lose a projection and you rebuild it from git, losing nothing. The
vector store is not deleted by this move; it is **demoted** to one projection among many.

`ocp-core` is a projection engine. It reads substrate through a port and emits projections — a
tree, a page tree, an access-policy map, a scoped corpus. It never writes.

## Where it sits

OCP is to context what MCP is to tools — the same architectural move (port + adapter) applied to
a different substrate. MCP canonicalizes the **action** layer; OCP canonicalizes the **context**
layer. Both collapse N×M bespoke integrations to N+M. An agent that speaks both reads its
organization's reality through OCP and acts through MCP.

## Install

```sh
npm install ocp-core
```

Node.js 20 or newer. Zero runtime dependencies.

Full API reference, the frontmatter vocabulary, the access model, and runnable examples are in the
[package README on npm](https://www.npmjs.com/package/ocp-core).

## This package is the conformance surface

It is the shared contract — **the renderer is yours to fork.** The library stays small on purpose:

> `ocp-core` is four functions (walk, classify, project, derive-policy) plus two one-method ports.
> If it grows a plugin system before a second external consumer exists, halt and re-read this line.

## Status

Source lands in this repository. The package is on npm today at `0.2.x` while the protocol
documentation and the reference renderer are built out. Expect breaking changes at every minor
version until `1.0`.

## Related

- [`create-ocp`](https://github.com/organizationalcontextprotocol/create-ocp) — scaffold a
  conformant OCP organization in one command
- [The OCP organization](https://github.com/organizationalcontextprotocol)

## License

MIT © 2026 Max Forbang. See [LICENSE](./LICENSE).

OCP is a standard, not a product. It is free on purpose: a standard derives its value from
adoption, not from exclusion — and because the ten-fold leverage of agent-orchestrated work
should reach the businesses that cannot buy their way to it, not only the ones that can.
