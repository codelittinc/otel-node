/** Pinned by scrub-contract.test.ts: the agent's layer-2 scrub repeats these patterns. */
export declare const LOG_SCRUB_PATTERNS: Readonly<Record<"SSN_SHAPE" | "EMAIL_DOMAIN" | "EMAIL_LOCAL_CHAR" | "LONG_DIGIT_RUN" | "URL_TOKEN" | "URL_START" | "USERINFO_END" | "URL_END" | "QUOTE_END" | "USERINFO_QUOTE" | "HOST_PORT" | "QUERY_START" | "PATH_IN_TEXT", import("./scrub-descriptor.js").PatternDescriptor>>;
/**
 * Replaces SSN and email shapes in free text, strips the userinfo, query and fragment from any URL
 * it quotes and the query and fragment from an absolute path. Phone and account shapes are left
 * alone (id false positives).
 */
export declare function scrubMessage(text: string): string;
/** Error text comes from libraries and providers, so standalone long digit runs go too. */
export declare function scrubErrorText(text: string): string;
/** Scrubs the header line(s) of a stack and keeps every `at` frame byte for byte. */
export declare function scrubStack(stack: string, header?: string): string;
