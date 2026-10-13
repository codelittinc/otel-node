/**
 * Paths whose segments are bearer secrets, with the template each becomes. Anchored at the start
 * of the path. An applicant intake token opens and submits an application for whoever holds it:
 * the web page (`/apply/[token]`) and the api routes it calls. Any letter case and any run of `/`
 * match, as a server routes them alike.
 */
export declare const TOKEN_PATH_TEMPLATES: readonly (readonly [RegExp, string])[];
/** Pinned by scrub-contract.test.ts: the agent's layer-2 span scrub repeats these. */
export declare const URL_PATH_PATTERNS: Readonly<Record<"ORIGIN", import("./scrub-descriptor.js").PatternDescriptor>>;
export declare const URL_PATH_LITERALS: Readonly<{
    ROUTE_TEMPLATE_PREFIX: "/";
}>;
export declare const TOKEN_PATH_CONTRACT: readonly Readonly<{
    source: string;
    flags: string;
    replacement: string;
}>[];
/**
 * The URL with its path replaced by the route template when there is one, else with any token
 * segment templated. The origin is kept; the query and fragment are the caller's to strip. A
 * leading `//` may open a path rather than a host, so it is never kept beside a route, and a
 * token path right after it is templated as a path. Leading whitespace is kept as it is.
 */
export declare function templateUrlPath(value: string, route: string | undefined, tokenPaths?: readonly (readonly [RegExp, string])[]): string;
/** A usable route template: a path, and not the shared label for unmatched requests. */
export declare function routeTemplateOf(route: unknown): string | undefined;
