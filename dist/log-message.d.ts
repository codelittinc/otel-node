/**
 * Arguments for a pino log call with a sanitized `msg`: the raw error message never becomes `msg`,
 * a `msg` field is scrubbed like a message string, and every format argument is sanitized exactly
 * like the log object. Arguments that cannot be inspected become a placeholder line.
 */
export declare function sanitizeLogArgs(args: unknown[]): unknown[];
