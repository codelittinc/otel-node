import { addAppKeys } from "./app-keys.js";
let scope;
let service;
let errorHook;
function check(ok, message) {
    if (!ok)
        throw new TypeError(message);
}
/**
 * Validates and copies options without touching any state. Throws on options that cannot be read;
 * a redact key that is not a string is dropped and only its type is reported.
 */
export function checkOptions(input) {
    check(typeof input === "object" && input !== null, "options must be an object");
    const options = { ...input };
    check(typeof options.serviceName === "string", "serviceName must be a string");
    check(options.logScope === undefined || typeof options.logScope === "string", "bad logScope");
    check(options.onError === undefined || typeof options.onError === "function", "bad onError");
    check(options.env === undefined || typeof options.env === "object", "bad env");
    check(options.redactKeys === undefined || Array.isArray(options.redactKeys), "bad redactKeys");
    const keys = [...(options.redactKeys ?? [])];
    const invalidKeyTypes = keys
        .filter((key) => typeof key !== "string")
        .map((key) => (key === null ? "null" : typeof key));
    if (options.redactKeys) {
        options.redactKeys = keys.filter((key) => typeof key === "string");
    }
    return { options, invalidKeyTypes };
}
/**
 * Applies checked options in one step: the log scope, the error hook and the redact keys. Nothing
 * here can throw, so a call never leaves its options half-applied.
 */
export function applyOptions(options) {
    scope = options.logScope?.trim() || options.serviceName;
    service = options.serviceName;
    errorHook = options.onError;
    if (options.redactKeys)
        addAppKeys(options.redactKeys);
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
