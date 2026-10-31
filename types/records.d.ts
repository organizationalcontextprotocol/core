declare const _exports: {
    storedForm: typeof storedForm;
    hashForm: typeof hashForm;
    sortKeys: typeof sortKeys;
    matchingProfiles: typeof matchingProfiles;
    checkRecordBytes: typeof checkRecordBytes;
    checkRecords: typeof checkRecords;
    PROFILES: {
        projected: {
            required: string[];
            optional: never[];
            data: boolean;
        };
        generated: {
            required: string[];
            optional: string[];
            data: boolean;
        };
        tombstone: {
            required: string[];
            optional: never[];
            data: boolean;
        };
        stub: {
            required: string[];
            optional: never[];
            data: boolean;
        };
    };
    CORPUS_CLASSES: readonly string[];
    RECORDS_DIR: string;
};
export = _exports;
/**
 * A copy of `value` with every object's keys in canonical order. Arrays keep their order.
 * @param {unknown} value
 * @returns {unknown}
 */
declare function sortKeys(value: unknown): unknown;
/**
 * The stored-file form: canonical key order, `JSON.stringify(value, null, 2)`, LF, one trailing LF, UTF-8, no BOM.
 * @param {unknown} value
 * @returns {Buffer}
 */
declare function storedForm(value: unknown): Buffer;
/**
 * The hash form: compact RFC 8785 (JCS). Every record digest is SHA-256 over these bytes, never over the file.
 * @param {unknown} value
 * @returns {Buffer}
 */
declare function hashForm(value: unknown): Buffer;
/**
 * The names of the profiles a parsed record matches. A valid record matches exactly one.
 * @param {Record<string, any>} record
 * @returns {string[]}
 */
declare function matchingProfiles(record: Record<string, any>): string[];
/**
 * Appendix A's checks, in order. Returns the first failing code, or null when the bytes are a valid record for a
 * corpus of the given class.
 * @param {Uint8Array} bytes
 * @param {'fixture' | 'private_client_instance' | 'shared'} corpusClass
 * @returns {{ code: string | null, value?: unknown }}
 */
declare function checkRecordBytes(bytes: Uint8Array, corpusClass: 'fixture' | 'private_client_instance' | 'shared'): {
    code: string | null;
    value?: unknown;
};
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
declare function checkRecords(substrate: any, tree: {
    byRoute: Record<string, {
        kind: string;
        frontmatter?: Record<string, any>;
    }>;
}, containers: Array<{
    scope: string;
    path: string;
}>, loose: string[], parseArtifact: (source: string, opts: {
    path: string;
}) => {
    frontmatter: Record<string, any>;
    role: string | null;
}): {
    records: number;
    collections: any[];
    problems: {
        path: string;
        code: string;
        severity: 'error' | 'warning';
        message: string;
    }[];
};
