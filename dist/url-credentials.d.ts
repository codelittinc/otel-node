export declare const URL_TOKEN: RegExp;
export declare const URL_START: RegExp;
export declare const USERINFO_END: RegExp;
export declare const URL_END: RegExp;
export declare const QUOTE_END: RegExp;
export declare const USERINFO_QUOTE: RegExp;
export declare const HOST_PORT: RegExp;
export declare const URL_AUTHORITY: RegExp;
export declare const QUERY_START: RegExp;
/**
 * In a URL token, each URL loses its userinfo, and a URL with a `?`, `#` or `;` after its
 * authority loses everything from there to the next whitespace. A host and path run to URL_END,
 * QUOTE_END or the next URL's start, whichever comes first.
 */
export declare function scrubUrlToken(token: string): string;
/** Every URL in free text, scrubbed as `scrubUrlToken` does. */
export declare function scrubUrls(text: string): string;
/**
 * A URL value without its userinfo. The authority starts after URL_AUTHORITY. With `schemeless`,
 * a value without one that is not a path starts its authority at its first non-space character.
 * The value is one URL, so its userinfo may run to the value's end.
 */
export declare function stripUserinfo(value: string, schemeless?: boolean): string;
