import { log as sharedLog } from "./shared-log.js";
export const log = sharedLog.child({ component: "telemetry" });
/** Telemetry never breaks the app, so not even a failing logger may throw out of it. */
export function logSafely(level, fields, message) {
    try {
        log[level](fields, message);
    }
    catch {
        // nothing left to report to
    }
}
/** OTel's own diagnostics, through the redacting logger; only an Error argument is kept. */
function diagMethod(level, event) {
    return (message, ...args) => {
        const err = args.find((arg) => arg instanceof Error);
        logSafely(level, { event, ...(err !== undefined && { err }) }, message);
    };
}
export const diagLogger = {
    error: diagMethod("error", "otel_diag"),
    warn: diagMethod("warn", "otel_diag"),
    info: diagMethod("info", "otel_diag"),
    debug: diagMethod("debug", "otel_diag"),
    verbose: diagMethod("trace", "otel_diag"),
};
