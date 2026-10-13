/** Pinned by scrub-contract.test.ts: the agent's layer-2 log scrub repeats these patterns. */
export declare const LOG_REDACT_PATTERNS: Readonly<Record<"SENSITIVE_KEY_PATTERN" | "CAMEL_EIN" | "PERSON_ID" | "RECORD_ID", import("./scrub-descriptor.js").PatternDescriptor>>;
export { resetAppKeys as resetSensitiveKeys } from "./app-keys.js";
export declare function isSensitiveKey(key: string): boolean;
/**
 * The JSON-facing form of an object: URL, byte view, date and toJSON values converted; `done`
 * stops the walk. A done value is inert: a plain string or object, so no serialization hook of
 * the caller's (an own toJSON on a Map, a Date subclass) runs after the sanitizer. A Map, Set or
 * RegExp becomes `{}`, as JSON shows one without own properties.
 */
export declare function convert(value: object): {
    done: boolean;
    value: unknown;
};
/**
 * A log call's first argument or child bindings as JSON would see them, so a spread keeps what a
 * toJSON hides hidden. Byte views become `{ bytes }`; a value that is not a plain record (an
 * array, a date, a map's entries, what a toJSON returns) lands under `value`.
 */
export declare function plainFields(fields: object, nested?: boolean): Record<string, unknown>;
/**
 * A sanitized copy of a log value; the caller's value is never mutated. Fails closed. The log
 * object, child bindings and every format argument take this one path: PII keys are redacted at
 * any depth, every Error and every non-nullish value under err/error/e is serialized deny-by-
 * default, and every string gets the message scrub (`scrubMessage`).
 */
export declare function sanitizeLogValue(value: unknown): unknown;
/** The log object or bindings, through sanitizeLogValue. */
export declare function redactLogObject(obj: Record<string, unknown>): Record<string, unknown>;
