declare const _exports: {
    VERSION: string;
    PROTOCOL: Readonly<{
        name: "Organizational Context Protocol";
        spec: "ADR-020";
        surface: "0.2";
    }>;
    ARTIFACT_TYPES: readonly string[];
    ALTITUDES: readonly string[];
    SUBSTRATE_DIRS: readonly string[];
    KERNEL_DIRS: readonly string[];
    CONTENT_DIRS: readonly string[];
    HALT_THRESHOLD: number;
    defineConfig: typeof defineConfig;
    createFileSystemSubstrate: typeof createFileSystemSubstrate;
    parseArtifact: typeof parseArtifact;
    walk: typeof walk;
    discoveredReport: typeof discoveredReport;
    haltStatus: typeof haltStatus;
    derivePolicy: typeof derivePolicy;
    parseVisibility: typeof parseVisibility;
    canView: typeof canView;
    isListed: typeof isListed;
    isReadableNode: typeof isReadableNode;
    lookupScope: typeof lookupScope;
    filterTree: typeof filterTree;
    scopedCorpus: typeof scopedCorpus;
    project: typeof project;
    llmsText: typeof llmsText;
    conformance: typeof conformance;
    openGrants: typeof openGrants;
    envGrants: typeof envGrants;
};
export = _exports;
export type VisibilityToken = 'public' | 'unlisted' | 'internal' | 'platform' | `org:${string}` | `account:${string}` | `tenant:${string}` | `agency:${string}`;
export type RequiredScope = 'public' | 'unlisted' | 'internal' | 'platform' | {
    org: string;
};
export type Grants = {
    /**
     * Staff reach. Absent means false.
     */
    isPlatformAdmin?: boolean;
    /**
     * Org slugs this viewer reaches. Absent means none.
     */
    orgs?: string[];
    /**
     * Explicit "authentication is switched off" posture, set
     * only by {@link openGrants}. **Absent means not open.** It is deliberately not the
     * same thing as platform-admin identity: open reaches every scope except `platform`,
     * and enumerates every scope except `platform` and `unlisted`.
     */
    open?: boolean;
};
export type NormalizedGrants = {
    isPlatformAdmin: boolean;
    orgs: string[];
    open: boolean;
};
export type SubstrateEntry = {
    name: string;
    type: 'file' | 'dir';
};
export type SubstratePort = {
    /**
     * Read a file as UTF-8. May throw; the walk is fail-soft.
     */
    read: (relPath: string) => string;
    /**
     * List a directory. May throw; the walk is fail-soft.
     */
    list: (relDir: string) => SubstrateEntry[];
    /**
     * Optional substrate version stamp.
     */
    sha?: () => string | null;
    /**
     * Optional; lets the walker detect a
     * symlinked directory resolving to one it has already visited.
     */
    realPath?: (relDir: string) => string | null;
    kind?: string;
    root?: string;
};
export type GrantsPort = {
    kind: string;
    resolve: (request?: unknown) => Grants;
};
export type OcpConfig = {
    substrateRoot: string;
    exclude: string[];
    sourceBlobBase: string | null;
    displayOverrides: Record<string, string>;
};
export type OcpConfigInput = {
    /**
     * Defaults to `'.'`.
     */
    substrateRoot?: string;
    /**
     * Defaults to the built-in exclude list.
     */
    exclude?: string[];
    /**
     * Defaults to null.
     */
    sourceBlobBase?: string | null;
    /**
     * Route to display name.
     */
    displayOverrides?: Record<string, string>;
};
export type ArtifactProblem = {
    code: string;
    severity: 'error' | 'warning';
    message: string;
};
export type WikiLink = {
    target: string;
    display: string | null;
    raw: string;
};
export type Artifact = {
    path: string;
    slug: string;
    artifactType: string | null;
    role: string | null;
    displayName: string;
    status: string | null;
    tenant: string | null;
    tags: string[];
    /**
     * Raw frontmatter
     * value, unparsed. Run it through {@link parseVisibility} to get a {@link RequiredScope}.
     */
    visibility: VisibilityToken | VisibilityToken[] | string | string[] | null;
    trustTier: number | null;
    frontmatter: Record<string, unknown>;
    body: string;
    links: WikiLink[];
    problems: ArtifactProblem[];
};
export type OcpNodeKind = 'org' | 'user' | 'kernel' | 'substrate-dir' | 'content-dir' | 'artifact';
export type OcpNode = {
    kind: OcpNodeKind;
    route: string;
    path: string;
    name: string;
    displayName: string;
    role: string | null;
    artifactType: string | null;
    status: string | null;
    tenant: string | null;
    tags: string[];
    visibility: VisibilityToken | VisibilityToken[] | string | string[] | null;
    trustTier: number | null;
    frontmatter: Record<string, unknown>;
    body: string;
    links: WikiLink[];
    /**
     * The README that stands in for a directory, else null.
     */
    entryPoint: string | null;
    orgId: string | null;
    parentOrgId: string | null;
    owningOrg: string | null;
    children: OcpNode[];
    problems: ArtifactProblem[];
    /**
     * Never true on a walked node. Present so that {@link OcpStubNode}is a discriminated union member: narrow on `node.stub === true` and TypeScript gives
     * you the stub in one branch and the readable node in the other.
     */
    stub?: false;
};
export type OcpStubNode = {
    stub: true;
    kind: OcpNodeKind;
    route: string;
    path: string;
    /**
     * The path segment. Never an authored display name.
     */
    name: string;
    children: Array<OcpNode | OcpStubNode>;
};
export type FilteredNode = OcpNode | OcpStubNode;
/**
 * A token as an author writes it in `visibility:` frontmatter.
 *
 * The prefixed forms all resolve to the same org scope. `org:` is the canonical
 * emission spelling; `account:`, `tenant:` and `agency:` are accepted aliases
 * retained under ADR-041's additive-only plus tolerant-reader policy.
 *
 * Note that `account`, `tenant` and `agency` are also OCP ALTITUDE terms. The two
 * axes are unrelated and happen to share three words.
 *
 * @typedef {'public' | 'unlisted' | 'internal' | 'platform'
 *   | `org:${string}` | `account:${string}` | `tenant:${string}` | `agency:${string}`} VisibilityToken
 */
/**
 * The resolved audience a route requires, after parsing and cascade.
 *
 * This is the OUTPUT vocabulary and it is not the same as {@link VisibilityToken}:
 * the four prefixed spellings have collapsed into one `{ org }` shape by the time
 * a scope exists.
 *
 * @typedef {'public' | 'unlisted' | 'internal' | 'platform' | { org: string }} RequiredScope
 */
/**
 * A viewer's reach, already flattened by the identity provider.
 *
 * `orgs` is the flattened reachability projection, direct memberships plus the
 * downward-admin cascade. `ocp-core` never expands an org id.
 *
 * @typedef {object} Grants
 * @property {boolean} [isPlatformAdmin] Staff reach. Absent means false.
 * @property {string[]} [orgs] Org slugs this viewer reaches. Absent means none.
 * @property {boolean} [open] Explicit "authentication is switched off" posture, set
 *   only by {@link openGrants}. **Absent means not open.** It is deliberately not the
 *   same thing as platform-admin identity: open reaches every scope except `platform`,
 *   and enumerates every scope except `platform` and `unlisted`.
 */
/** @typedef {{ isPlatformAdmin: boolean, orgs: string[], open: boolean }} NormalizedGrants */
/** @typedef {{ name: string, type: 'file' | 'dir' }} SubstrateEntry */
/**
 * The read side of the substrate. One interface, one bundled implementation.
 *
 * @typedef {object} SubstratePort
 * @property {(relPath: string) => string} read Read a file as UTF-8. May throw; the walk is fail-soft.
 * @property {(relDir: string) => SubstrateEntry[]} list List a directory. May throw; the walk is fail-soft.
 * @property {() => string | null} [sha] Optional substrate version stamp.
 * @property {(relDir: string) => string | null} [realPath] Optional; lets the walker detect a
 *   symlinked directory resolving to one it has already visited.
 * @property {string} [kind]
 * @property {string} [root]
 */
/**
 * The identity seam. One method, so any session-issuing IdP wires in as a relying party.
 *
 * @typedef {object} GrantsPort
 * @property {string} kind
 * @property {(request?: unknown) => Grants} resolve
 */
/**
 * @typedef {object} OcpConfig
 * @property {string} substrateRoot
 * @property {string[]} exclude
 * @property {string | null} sourceBlobBase
 * @property {Record<string, string>} displayOverrides
 */
/**
 * @typedef {object} OcpConfigInput
 * @property {string} [substrateRoot] Defaults to `'.'`.
 * @property {string[]} [exclude] Defaults to the built-in exclude list.
 * @property {string | null} [sourceBlobBase] Defaults to null.
 * @property {Record<string, string>} [displayOverrides] Route to display name.
 */
/** @typedef {{ code: string, severity: 'error' | 'warning', message: string }} ArtifactProblem */
/** @typedef {{ target: string, display: string | null, raw: string }} WikiLink */
/**
 * @typedef {object} Artifact
 * @property {string} path
 * @property {string} slug
 * @property {string | null} artifactType
 * @property {string | null} role
 * @property {string} displayName
 * @property {string | null} status
 * @property {string | null} tenant
 * @property {string[]} tags
 * @property {VisibilityToken | VisibilityToken[] | string | string[] | null} visibility Raw frontmatter
 *   value, unparsed. Run it through {@link parseVisibility} to get a {@link RequiredScope}.
 * @property {number | null} trustTier
 * @property {Record<string, unknown>} frontmatter
 * @property {string} body
 * @property {WikiLink[]} links
 * @property {ArtifactProblem[]} problems
 */
/** @typedef {'org' | 'user' | 'kernel' | 'substrate-dir' | 'content-dir' | 'artifact'} OcpNodeKind */
/**
 * @typedef {object} OcpNode
 * @property {OcpNodeKind} kind
 * @property {string} route
 * @property {string} path
 * @property {string} name
 * @property {string} displayName
 * @property {string | null} role
 * @property {string | null} artifactType
 * @property {string | null} status
 * @property {string | null} tenant
 * @property {string[]} tags
 * @property {VisibilityToken | VisibilityToken[] | string | string[] | null} visibility
 * @property {number | null} trustTier
 * @property {Record<string, unknown>} frontmatter
 * @property {string} body
 * @property {WikiLink[]} links
 * @property {string | null} entryPoint The README that stands in for a directory, else null.
 * @property {string | null} orgId
 * @property {string | null} parentOrgId
 * @property {string | null} owningOrg
 * @property {OcpNode[]} children
 * @property {ArtifactProblem[]} problems
 * @property {false} [stub] Never true on a walked node. Present so that {@link OcpStubNode}
 *   is a discriminated union member: narrow on `node.stub === true` and TypeScript gives
 *   you the stub in one branch and the readable node in the other.
 */
/**
 * An ancestor retained purely so a granted descendant is reachable. ADR-020 §14.7 R1.
 *
 * **This is deliberately NOT assignable to {@link OcpNode}**, and the missing properties
 * are the point rather than an omission. A stub has no `body`, no `displayName`, no
 * `frontmatter`, no `links`, and no `entryPoint`, so passing one to any function typed
 * against `OcpNode` is a compile error rather than a page that renders blank. A renderer
 * that walks a filtered tree must handle the stub branch explicitly.
 *
 * The predicate pair points the opposite way from `unlisted`, which is why the split in
 * {@link canView} and {@link isListed} keeps earning its keep:
 *
 *   isListed(stub) -> true    it must appear in navigation, or the grant is unreachable
 *   canView(stub)  -> false   there is no page at this route to fetch
 *
 * Its `name` is the raw path segment. A stub carries no authored label, because a
 * display name is content about an organization this viewer cannot read.
 *
 * @typedef {object} OcpStubNode
 * @property {true} stub
 * @property {OcpNodeKind} kind
 * @property {string} route
 * @property {string} path
 * @property {string} name The path segment. Never an authored display name.
 * @property {Array<OcpNode | OcpStubNode>} children
 */
/** @typedef {OcpNode | OcpStubNode} FilteredNode */
/**
 * Narrow a filtered tree's node to the readable half. Every projection in this file
 * routes through it, so the stub branch is handled once rather than remembered at each
 * site. A renderer consuming `FilteredTree` wants the same guard.
 *
 * @param {FilteredNode} node
 * @returns {node is OcpNode} True when the node carries a page.
 */
declare function isReadableNode(node: FilteredNode): node is OcpNode;
export type Discovered = {
    kind: 'file' | 'directory';
    path: string;
    reason: string;
    route?: string;
};
export type WalkStats = {
    filesSeen: number;
    directories: number;
    rendered: number;
};
export type OcpTree = {
    root: OcpNode;
    nodes: OcpNode[];
    byRoute: Record<string, OcpNode>;
    discovered: Discovered[];
    sha: string | null;
    config: OcpConfig;
    stats: WalkStats;
    policy?: Record<string, RequiredScope>;
    /**
     * Never present on a raw tree. This is what makes passing
     * one to {@link project} a compile error rather than only a runtime throw.
     */
    grants?: undefined;
    /**
     * Never present. Declared so the accepted-input union below is
     * discriminated on the same property the runtime unwrap tests.
     */
    tree?: undefined;
};
export type FilteredTree = {
    /**
     * Null when the viewer reaches nothing at all. It is
     * an {@link OcpStubNode} whenever the viewer reaches only descendants of the root, which
     * is the ordinary case for a nested tenant.
     */
    root: FilteredNode | null;
    /**
     * Readable nodes and R1 ancestor stubs, mixed. Narrow on
     * `node.stub === true` before touching any page-bearing field.
     */
    nodes: FilteredNode[];
    byRoute: Record<string, FilteredNode>;
    discovered: Discovered[];
    sha: string | null;
    config: OcpConfig;
    stats: WalkStats;
    policy: Record<string, RequiredScope>;
    grants: NormalizedGrants;
    /**
     * Never present; see {@link OcpTree}.
     */
    tree?: undefined;
};
export type TreeWrapper = {
    tree: OcpTree | FilteredTree;
    root?: undefined;
    policy?: Record<string, RequiredScope>;
};
export type TreeInput = OcpTree | FilteredTree | TreeWrapper;
export type ScopedTreeWrapper = {
    tree: FilteredTree;
    root?: undefined;
};
export type ScopedTreeInput = FilteredTree | ScopedTreeWrapper;
export type CorpusPage = {
    route: string;
    url: string;
    path: string;
    displayName: string;
    artifactType: string | null;
    role: string | null;
    tags: string[];
    scope: RequiredScope;
    text: string;
};
export type ScopedCorpus = {
    tree: FilteredTree;
    pages: CorpusPage[];
    text: string;
    scope: NormalizedGrants;
    sha: string | null;
};
export type PageTreePage = {
    type: 'page';
    name: string;
    url: string;
};
export type PageTreeFolder = {
    type: 'folder';
    name: string;
    children: Array<PageTreePage | PageTreeFolder>;
    index?: PageTreePage;
};
export type PageTree = {
    name: string;
    children: Array<PageTreePage | PageTreeFolder>;
};
export type ConformanceProblem = {
    path: string | null;
    route: string;
    code: string;
    severity: 'error' | 'warning';
    message: string;
};
export type ConformanceResult = {
    ok: boolean;
    problems: ConformanceProblem[];
};
export type HaltStatus = {
    filesSeen: number;
    failed: number;
    directoryFailures: number;
    /**
     * Denominator: files read plus directories that could not be listed.
     */
    considered: number;
    rate: number;
    threshold: number;
    halt: boolean;
};
export type ProjectOptions = {
    baseUrl?: string | null;
};
export type CorpusOptions = {
    baseUrl?: string | null;
};
export type VisibilityAnalysis = {
    scope: RequiredScope | null;
    recognized: RequiredScope[];
    unrecognized: string[];
    nonCanonicalPrefixes: string[];
    conflictingOrgs: boolean;
    multiple: boolean;
};
/**
 * Parse one markdown artifact. Never throws.
 *
 * displayName resolves display_name -> title -> first H1 outside fenced code ->
 * humanized final path segment. Grounding F-008: OCP names the human-readable key
 * `display_name`, and a schema that requires `title` silently drops most of a real
 * substrate (271 of 322 files). Accepting `title` is Postel's law, not the contract.
 */
/**
 * Parse one markdown artifact. Never throws on bad frontmatter: problems are
 * collected onto the returned artifact so the walk stays fail-soft.
 *
 * @param {string} source
 * @param {{ path?: string }} [opts]
 * @returns {Artifact}
 */
declare function parseArtifact(source: string, opts?: {
    path?: string;
}): Artifact;
/**
 * Validate and normalize an OCP config. Throws on an unknown key, which is how a
 * typo in a config file becomes an error rather than a silently ignored setting.
 *
 * @param {OcpConfigInput} [config]
 * @returns {OcpConfig}
 */
declare function defineConfig(config?: OcpConfigInput): OcpConfig;
/**
 * The one bundled {@link SubstratePort}: read a substrate from local disk.
 *
 * @param {string} rootDir
 * @returns {SubstratePort}
 */
declare function createFileSystemSubstrate(rootDir: string): SubstratePort;
/**
 * Walk a substrate into an {@link OcpTree}.
 *
 * Fail-soft: a file that cannot be read or parsed lands in `discovered` and the walk
 * continues. It never aborts and it is never silently dropped, which the count-parity
 * assertion at the end of the walk enforces structurally.
 *
 * The result is **unscoped**. Pass it through {@link filterTree} or
 * {@link scopedCorpus} before any surface that enumerates.
 *
 * @param {SubstratePort} substrate
 * @param {OcpConfigInput} [config]
 * @returns {OcpTree}
 */
declare function walk(substrate: SubstratePort, config?: OcpConfigInput): OcpTree;
/**
 * The D12 halt calculation. A failure rate above {@link HALT_THRESHOLD} means the
 * substrate is not renderable and the caller should stop rather than ship a
 * partial projection.
 *
 * @param {TreeInput} tree
 * @returns {HaltStatus}
 */
declare function haltStatus(tree: TreeInput): HaltStatus;
/**
 * Render a `DISCOVERED.md` report of everything the walk could not parse.
 *
 * @param {TreeInput} tree
 * @returns {string}
 */
declare function discoveredReport(tree: TreeInput): string;
/**
 * Resolve a raw `visibility` frontmatter value to the audience it names.
 *
 * Returns null when nothing in the value is recognized, in which case the caller
 * falls through to path-derived scope. Several recognized tokens resolve to the
 * **most restrictive**, independent of declaration order.
 *
 * @param {unknown} value Scalar or list, as authored.
 * @returns {RequiredScope | null}
 */
declare function parseVisibility(value: unknown): RequiredScope | null;
/**
 * route -> RequiredScope.
 *
 * Path-derived ownership is the half with production data. The cascading `visibility:`
 * half is PROPOSED syntax: grounding F-038 found zero files in the reference substrate
 * using it, so it is implemented but unexercised against real content.
 */
/**
 * Build the route to {@link RequiredScope} map. Path derives the default;
 * `visibility:` overrides it and cascades, resetting at each nested org boundary.
 *
 * @param {TreeInput} tree
 * @returns {Record<string, RequiredScope>}
 */
declare function derivePolicy(tree: TreeInput): Record<string, RequiredScope>;
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
 *
 * @param {Grants} grants
 * @param {RequiredScope} scope
 * @returns {boolean} True if this viewer may FETCH the artifact at this scope.
 */
declare function canView(grants: Grants, scope: RequiredScope): boolean;
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
 *
 * @param {Grants} grants
 * @param {RequiredScope} scope
 * @returns {boolean} True if the artifact at this scope may appear in a LIST built for
 *   this viewer. Always false for `'unlisted'`, for every viewer.
 */
declare function isListed(grants: Grants, scope: RequiredScope): boolean;
/**
 * Exact match, else nearest ancestor prefix, else `'platform'`. A route that was
 * never walked still resolves, and it resolves fail-closed.
 *
 * @param {Record<string, RequiredScope>} policy
 * @param {string} route
 * @returns {RequiredScope}
 */
declare function lookupScope(policy: Record<string, RequiredScope>, route: string): RequiredScope;
/**
 * Prune to the viewer's slice. Pruning is fail-closed at the first invisible ancestor:
 * a `visibility: [public]` artifact nested under a scope the viewer cannot see is not
 * surfaced, because surfacing it would leak the path that contains it.
 */
/**
 * Prune a tree to one viewer. Every predicate call inside is an enumeration, so all
 * of them use {@link isListed}.
 *
 * Pruning is fail-closed at the first invisible ancestor: a `public` artifact nested
 * under a scope the viewer cannot see is not surfaced, because surfacing it would leak
 * the path containing it. The returned policy map and `discovered` list are scoped the
 * same way, since both are keyed by route and are therefore disclosure themselves.
 *
 * @param {TreeInput} tree
 * @param {Grants} grants
 * @returns {FilteredTree}
 */
declare function filterTree(tree: TreeInput, grants: Grants): FilteredTree;
/**
 * THE single disclosure chokepoint (D6).
 *
 * Every read surface — sidebar and page tree, search, an AI panel's retrieval tool,
 * llms.txt, markdown content negotiation, OG images — must derive from this function's
 * output. Unscoped enumeration on a request path is banned.
 */
/**
 * THE single disclosure chokepoint. Every read surface must derive from this.
 *
 * @param {TreeInput} context
 * @param {Grants} grants
 * @param {CorpusOptions} [options]
 * @returns {ScopedCorpus}
 */
declare function scopedCorpus(context: TreeInput, grants: Grants, options?: CorpusOptions): ScopedCorpus;
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
 *
 * The parameter type is the filtered shape, so passing a raw {@link OcpTree} is a
 * COMPILE error and not only a runtime throw. That is the point of the annotation:
 * the guard has to be visible to the compiler at the call site, where the developer
 * can still choose correctly.
 *
 * @param {ScopedTreeInput} tree Output of {@link filterTree}, or a
 *   {@link ScopedCorpus} (its `tree` field is unwrapped). A raw `walk()` result is rejected.
 * @param {ProjectOptions} [options]
 * @returns {PageTree}
 */
declare function project(tree: ScopedTreeInput, options?: ProjectOptions): PageTree;
/**
 * A scoped llms.txt-style plain-text projection. It takes a corpus, never a tree, so
 * that it is structurally impossible to render it from unscoped content.
 */
/**
 * A scoped `llms.txt`-style projection. It takes a corpus and never a tree, so it is
 * structurally impossible to render from unscoped content.
 *
 * @param {ScopedCorpus} corpus
 * @returns {string}
 */
declare function llmsText(corpus: ScopedCorpus): string;
/**
 * Check a substrate against the OCP conventions. Errors fail the check; warnings do not.
 *
 * @param {TreeInput} tree
 * @returns {ConformanceResult}
 */
declare function conformance(tree: TreeInput): ConformanceResult;
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
/**
 * Everything-public adapter, for a single-tenant or genuinely public substrate.
 * **Never deploy it multi-tenant.**
 *
 * It declares an explicit open posture rather than claiming platform-admin identity,
 * and it does not reach `platform` scope: an open wiki has no staff, so `_users/**`
 * membership declarations must not become readable merely because authentication is
 * switched off.
 *
 * @returns {GrantsPort}
 */
declare function openGrants(): GrantsPort;
/**
 * Static token/allowlist adapter, for CI, previews, and small deployments:
 *
 *   OCP_PLATFORM_ADMIN_TOKEN=<token>
 *   OCP_ORG_TOKENS={"tok-acme":["acme"],"tok-multi":["beta","gamma"]}
 *
 * Anything unrecognized resolves to zero reach (fail closed).
 */
/**
 * Static token allowlist adapter for CI, previews, and small deployments. Anything
 * unrecognized resolves to zero reach.
 *
 * @param {Record<string, string | undefined>} [env] Defaults to `process.env`.
 * @returns {GrantsPort}
 */
declare function envGrants(env?: Record<string, string | undefined>): GrantsPort;
