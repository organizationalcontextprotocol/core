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

## Where this is going: [ocp.wiki](https://ocp.wiki)

*(Planned. The site is not live yet — this package ships ahead of it.)*

**https://ocp.wiki** will be the single entry point for OCP: the specification, the conventions,
and the patterns — published as an OCP substrate rendered by this protocol's own renderer. The
spec site is the worked example of the thing it documents.

It is built for both audiences at once. A human browses it. An **agent fetches it** — which is
the point. Any coding agent (Claude, ChatGPT/Codex, Cursor, …) should be able to take a single
line:

> Create our company knowledge base using the patterns from https://ocp.wiki

…and cascade the rest itself: read the spec, scaffold with `npm create ocp`, lay out the
recursive organizational structure, and fill it with the company's own content. One instruction
in, a conformant, agent-readable knowledge base out.

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
adoption, not from exclusion.
