import { pino, stdTimeFunctions } from "pino";
import { sanitizeLogArgs } from "./log-message.js";
import { plainFields, redactLogObject } from "./log-redact.js";
import { traceLogFields } from "./log-fields.js";
import { forwardLogLine } from "./log-sink.js";
// `silent` is not offered: it would hide fatal lines too.
const VALID_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
/**
 * Fields the logger owns. A caller's field of the same name is renamed `field.<name>`, so only the
 * active span sets `trace_id`/`span_id` (a Stripe payout carries its own `trace_id`).
 */
const RESERVED_FIELDS = new Set(["level", "time", "msg", "app", "env", "trace_id", "span_id"]);
/**
 * LOG_LEVEL (any case) when it names a level; anything else falls back to "info" rather than
 * throwing.
 */
export function resolveLogLevel(raw = process.env.LOG_LEVEL) {
    const requested = raw?.trim();
    if (!requested)
        return { level: "info" };
    const level = requested.toLowerCase();
    return VALID_LEVELS.has(level) ? { level } : { level: "info", invalid: requested };
}
function renameReserved(fields) {
    if (!Object.keys(fields).some((key) => RESERVED_FIELDS.has(key)))
        return fields;
    const out = {};
    for (const [key, value] of Object.entries(fields)) {
        out[RESERVED_FIELDS.has(key) ? `field.${key}` : key] = value;
    }
    return out;
}
/** Child bindings in their JSON shape, renamed; a binding that cannot be read never throws. */
function safeBindings(bindings) {
    try {
        return renameReserved(plainFields(bindings));
    }
    catch {
        return { log_redaction_failed: true };
    }
}
/** A new object: the caller's fields (reserved names renamed) under the logger's own fields. */
function mergeMixin(fields, mixin) {
    try {
        return { ...renameReserved(plainFields(fields)), ...mixin };
    }
    catch {
        return { log_redaction_failed: true, ...mixin };
    }
}
/** Emits the invalid LOG_LEVEL warning once; held back until the process has named itself. */
const pendingLevelWarnings = new WeakMap();
export function announceLogLevel(logger) {
    const emit = pendingLevelWarnings.get(logger);
    pendingLevelWarnings.delete(logger);
    emit?.();
}
/**
 * Builds a redacting pino logger that names its process in `app`. `app` is read on every line, so
 * a logger or child created before the process names itself still reports the configured name.
 */
export function createLogger(app, destination) {
    const { level, invalid } = resolveLogLevel();
    let logger;
    const announce = () => announceLogLevel(logger);
    logger = pino({
        level,
        base: { env: process.env.RAILWAY_ENVIRONMENT_NAME?.trim() || "unknown" },
        // The log formatter sanitizes the whole object, err/error/e included, on the same path as
        // format args. pino's default err serializer would rewrite that result, so it is replaced.
        serializers: { err: (value) => value },
        formatters: {
            level: (label) => ({ level: label }),
            bindings: redactLogObject,
            log: redactLogObject,
        },
        hooks: {
            logMethod(args, method) {
                announce();
                return method.apply(this, sanitizeLogArgs(args));
            },
            // The finished, scrubbed line: written unchanged, and copied to the OTLP sink once the SDK
            // has installed one.
            streamWrite: forwardLogLine,
        },
        timestamp: stdTimeFunctions.isoTime,
        mixin: () => ({ app: app(), ...traceLogFields() }),
        mixinMergeStrategy: (fields, mixin) => mergeMixin(fields, mixin),
    }, destination);
    // pino applies formatters.bindings to the base bindings only, so child bindings are handled here.
    const originalChild = logger.child;
    logger.child = function (bindings, options) {
        return originalChild.call(this, redactLogObject(safeBindings(bindings)), options);
    };
    if (invalid !== undefined) {
        pendingLevelWarnings.set(logger, () => logger.warn({ event: "invalid_log_level", requested: invalid }, "invalid LOG_LEVEL, using info"));
    }
    return logger;
}
