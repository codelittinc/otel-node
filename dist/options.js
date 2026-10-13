let scope;
let service;
let errorHook;
/** Records the options that outlive `startTelemetry`: the log scope and the error hook. */
export function applyOptions(options) {
    scope = options.logScope?.trim() || options.serviceName;
    service = options.serviceName;
    errorHook = options.onError;
}
/** The configured log scope; before `startTelemetry`, the service name from the environment. */
export function logScope() {
    return scope ?? (process.env.OTEL_SERVICE_NAME?.trim() || "unknown");
}
/** Calls the app's error hook, if any, with `service` set; never throws. */
export function reportError(err, context = {}) {
    try {
        errorHook?.(err, { service: service ?? "unknown", ...context });
    }
    catch {
        // reporting must never break the caller
    }
}
/** Test seam: forgets the recorded options. */
export function resetOptions() {
    scope = undefined;
    service = undefined;
    errorHook = undefined;
}
