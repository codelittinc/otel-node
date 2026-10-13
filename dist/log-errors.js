import { scrubErrorText, scrubStack } from "./log-scrub.js";
const MAX_CAUSE_DEPTH = 10;
const MAX_AGGREGATE_ERRORS = 20;
/** The only properties any error keeps, besides type, name, message, stack, cause and errors. */
const COMMON_KEYS = ["code", "errorCode", "status", "statusCode"];
function read(target, key) {
    try {
        return target[key];
    }
    catch {
        return undefined;
    }
}
function asRecord(value) {
    return typeof value === "object" && value !== null ? value : undefined;
}
function str(value) {
    return typeof value === "string" ? value : undefined;
}
const PRISMA = {
    keys: [],
    message: (err, name) => {
        const code = str(read(err, "code")) ?? str(read(err, "errorCode"));
        return code ? `${name} ${code}` : name;
    },
};
const DRIVER_ADAPTER = {
    keys: [],
    dropCause: true,
    message: (err, name) => {
        const cause = read(err, "cause");
        const code = str(read(cause, "originalCode")) ?? str(read(cause, "kind"));
        return code ? `${name} ${code}` : name;
    },
};
const ZOD = {
    keys: [],
    message: (err, name) => {
        const issues = read(err, "issues");
        return `${name} ${Array.isArray(issues) ? issues.length : 0} issue(s)`;
    },
};
const STRIPE = { keys: ["decline_code", "param", "requestId"] };
const HAPPYCO = { keys: ["outcome"] };
const FUNNEL = { keys: ["api", "errorType"] };
const GENERIC = { keys: [] };
function familyOf(name, err) {
    if (name.startsWith("Prisma"))
        return PRISMA;
    if (name === "DriverAdapterError")
        return DRIVER_ADAPTER;
    if (name === "ZodError")
        return ZOD;
    if (name.startsWith("Stripe") || str(read(err, "type"))?.startsWith("Stripe"))
        return STRIPE;
    if (name.startsWith("HappyCo"))
        return HAPPYCO;
    if (name.startsWith("Funnel"))
        return FUNNEL;
    return GENERIC;
}
function typeOf(err, name) {
    if (err instanceof Error) {
        const ctor = read(err, "constructor");
        const ctorName = typeof ctor === "function" ? ctor.name : undefined;
        if (ctorName)
            return ctorName;
    }
    return name ?? "Error";
}
function primitive(value) {
    if (typeof value === "string")
        return scrubErrorText(value);
    return typeof value === "number" || typeof value === "boolean" ? value : undefined;
}
/** Prisma's meta names the failing column or model; every other meta field is a value. */
function prismaMeta(err) {
    const meta = asRecord(read(err, "meta"));
    if (!meta)
        return undefined;
    const target = read(meta, "target");
    const modelName = read(meta, "modelName");
    const out = {};
    if (typeof target === "string" || Array.isArray(target))
        out.target = target;
    if (typeof modelName === "string")
        out.modelName = modelName;
    return out;
}
function sanitizeValue(value, depth, ancestors) {
    const record = asRecord(value);
    if (!record)
        return primitive(value);
    if (ancestors.has(record))
        return "[circular]";
    if (depth >= MAX_CAUSE_DEPTH)
        return "[truncated]";
    return sanitize(record, depth, ancestors);
}
/** A caller-built error-like object's name is free text; scrub it like a message. */
function nameOf(err) {
    const raw = str(read(err, "name"));
    return { raw, name: raw === undefined ? undefined : scrubErrorText(raw) };
}
/** Deny by default: an error keeps only the fields listed here; every other property is dropped. */
function sanitize(err, depth, ancestors) {
    ancestors.add(err);
    try {
        return sanitizeFields(err, depth, ancestors);
    }
    finally {
        ancestors.delete(err);
    }
}
function sanitizeFields(err, depth, ancestors) {
    const { raw, name } = nameOf(err);
    const family = familyOf(raw ?? "", err);
    const out = { type: typeOf(err, name) };
    if (name !== undefined)
        out.name = name;
    const safe = family.message?.(err, name ?? "Error");
    const rawMessage = str(read(err, "message"));
    if (safe !== undefined)
        out.message = safe;
    else if (rawMessage !== undefined)
        out.message = scrubErrorText(rawMessage);
    const stack = str(read(err, "stack"));
    if (stack !== undefined) {
        out.stack = scrubStack(stack, safe === undefined ? undefined : `${name ?? "Error"}: ${safe}`);
    }
    for (const key of [...COMMON_KEYS, ...family.keys]) {
        const value = primitive(read(err, key));
        if (value !== undefined)
            out[key] = value;
    }
    if (family === PRISMA) {
        const meta = prismaMeta(err);
        if (meta)
            out.meta = meta;
    }
    const cause = family.dropCause ? undefined : read(err, "cause");
    if (cause !== undefined) {
        const sanitized = sanitizeValue(cause, depth + 1, ancestors);
        if (sanitized !== undefined)
            out.cause = sanitized;
    }
    const errors = read(err, "errors");
    if (Array.isArray(errors)) {
        out.errors = errors
            .slice(0, MAX_AGGREGATE_ERRORS)
            .map((item) => sanitizeValue(item, depth + 1, ancestors) ?? null);
    }
    return out;
}
/**
 * The message safe to log for an error: code-only for value-embedding families, else scrubbed.
 * An empty message falls back to the error type.
 */
export function safeErrorMessage(value) {
    try {
        const err = asRecord(value);
        if (!err)
            return scrubErrorText(String(value));
        const { raw, name } = nameOf(err);
        const safe = familyOf(raw ?? "", err).message?.(err, name ?? "Error");
        const message = safe ?? scrubErrorText(String(read(err, "message") ?? ""));
        return message === "" ? typeOf(err, name) : message;
    }
    catch {
        return "[unserializable error]";
    }
}
/** An allowlisted, scrubbed plain copy of an error or error-like value. May throw; see serializeError. */
export function serializeErrorBase(value) {
    const err = asRecord(value);
    return err ? sanitize(err, 0, new WeakSet()) : primitive(value);
}
