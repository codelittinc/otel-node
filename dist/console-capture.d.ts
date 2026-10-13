/**
 * Sends every `console.warn` and `console.error` line to OTLP logs, through the logger's scrub and
 * under the configured log scope, and still writes it to the console unchanged. Only the scrubbed
 * copy is exported; stdout keeps the app's own line. Calling it again changes nothing.
 */
export declare function captureConsole(): void;
/** Puts back the console methods `captureConsole` replaced. */
export declare function releaseConsole(): void;
