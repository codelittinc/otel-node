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
/** Equal arrays: the same items, by identity. */
function sameItems(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b))
        return a === b;
    return a.length === b.length && a.every((item, i) => item === b[i]);
}
/** True when two calls pass the same options; `env` aside, since it only says whether to export. */
export function sameOptions(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.delete("env");
    for (const key of keys) {
        const x = a[key];
        const y = b[key];
        if (key === "metricViews") {
            const [m, n] = [x, y];
            if (m?.instrumentPrefix !== n?.instrumentPrefix)
                return false;
            if (!sameItems(m?.allowedAttributes, n?.allowedAttributes))
                return false;
        }
        else if (!sameItems(x, y))
            return false;
    }
    return true;
}
/** Test seam: forgets the recorded options. */
export function resetOptions() {
    scope = undefined;
    service = undefined;
    errorHook = undefined;
}
