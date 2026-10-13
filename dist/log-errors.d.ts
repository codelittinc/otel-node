/**
 * The message safe to log for an error: code-only for value-embedding families, else scrubbed.
 * An empty message falls back to the error type.
 */
export declare function safeErrorMessage(value: unknown): string;
/** An allowlisted, scrubbed plain copy of an error or error-like value. May throw; see serializeError. */
export declare function serializeErrorBase(value: unknown): unknown;
