import type { Attributes } from "@opentelemetry/api";
import { stripQuery } from "./strip-query.js";
export { stripQuery };
/** Pinned by scrub-contract.test.ts: the agent's layer-2 span scrub repeats these. */
export declare const REDACT_PATTERNS: Readonly<Record<"URL_AUTHORITY" | "URL_QUERY_START" | "NAMED_REQUEST" | "FRAME_LINE", import("./scrub-descriptor.js").PatternDescriptor>>;
export declare const REDACT_KEY_SETS: Readonly<Record<"URL_KEYS" | "DROPPED_KEYS" | "REDACTED_KEYS" | "DROPPED_PREFIXES" | "STATEMENT_KEYS" | "NAME_KEYS" | "REDIS_SYSTEM_KEYS", readonly string[]>>;
export declare const REDACT_LITERALS: Readonly<{
    REDIS_SYSTEM: "redis";
}>;
/**
 * A span name of the form `METHOD /path`, `METHOD scheme://host/path` or `METHOD user@host/path`
 * gets the same treatment as a URL attribute: no query, fragment or userinfo, and the path
 * templated. Next.js names an unrouted request's span after its raw URL. Any other name gets the
 * message scrub, and each of its words its token paths templated.
 */
export declare function scrubSpanName(name: string, route: string | undefined, tokenPaths?: readonly (readonly [RegExp, string])[]): string;
/**
 * Scrubs one attribute set. Every URL attribute loses its query, fragment and userinfo, and its
 * path becomes the span's `http.route` template when it has one, so a path parameter never
 * leaves. Without a route (client spans, unmatched requests) `url.path` is dropped and known
 * token-bearing paths are templated in the remaining URL attributes. An attribute named by the
 * app's `redactKeys` (its whole name or last `.` segment) is redacted.
 */
export declare function scrubAttributes(attributes: Attributes, tokenPaths?: readonly (readonly [RegExp, string])[]): Attributes;
