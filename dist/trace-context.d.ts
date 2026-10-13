import { type Link } from "@opentelemetry/api";
/** The W3C `traceparent` of the active span, or undefined when no span is active. */
export declare function currentTraceparent(): string | undefined;
/** A span link to a stored `traceparent`. A missing or malformed value gives no link. */
export declare function linkFromTraceparent(value: string | null | undefined): Link | undefined;
/**
 * Run `fn` inside a new active span that links to the trace in `traceparent`. A link, not a
 * parent: the work runs later and apart from the request that stored the value.
 */
export declare function withLinkedSpan<T>(name: string, traceparent: string | null | undefined, fn: () => Promise<T>): Promise<T>;
/**
 * Run `fn` inside a new active root span, recorded even where the HTTP instrumentation suppressed
 * tracing for an ignored path. The span ends with ERROR when `fn` throws or `failed` holds for its
 * result, else OK.
 */
export declare function withRootSpan<T>(name: string, fn: () => Promise<T>, failed?: (result: T) => boolean): Promise<T>;
