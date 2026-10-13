import { serializeError } from "./log-serializer.js";
import { scrubMessage } from "./log-scrub.js";
import { stripQuery } from "./redact.js";
import { describePatterns } from "./scrub-descriptor.js";
// Matches PII and credential key names (camelCase, snake_case, kebab-case) at any depth.
// `ssn`, `dob` and `ein` are anchored so words such as "businessName", "adobe" or "protein"
// stay readable; a camelCase `...Ein` is matched case-sensitively in isSensitiveKey.
// A person's name is matched by its qualifier (`firstName`, `contactName`, `payeeName`). A bare
// `name` is not: queue, job, category and target names are logged under it.
// Any key ending in `address` is: in a provider payload it is a mailing address. That includes
// `ipAddress`, which only the access-audit rows store and no log call site emits.
// Structured address parts (`street1`, `line1`) and `mobile` are matched too.
const SENSITIVE_KEY_PATTERN = /(^ssn|ssn$|ssn.?(enc|last)|_ssn|social.?security|^dob|dob$|dob.?enc|_dob|date.?of.?birth|birth.?date|account.?number|routing.?number|tax.?id|taxpayer|(^|_)ein(_?number)?$|e.?mail|phone|password|passwd|secret|token|api.?key|authorization|cookie|holder.?name|iban|passport|drivers?.?license|birthday|bank.?account|aba.?number|clerk.?auth|signature$|enc$|enc.?snapshot$|(first|last|middle|full|legal|preferred|given|family).?name|surname|(occupant|caller|contact|payee|bill.?to|tenant|resident|applicant|guarantor|performed.?by|assignee|recipient|signer).?name|(street|mailing|home|billing|residential|postal).?address|^address(.?line)?.?\d*$|address.?line|address$|forwarding.?address|^street\d*$|^line[12]$|mobile|name.?on.?account|postal.?code|^zip|zip.?code)/i;
const CAMEL_EIN = /[a-z](Ein|EIN)(Number)?$/;
// A record id (`emailId`, `bankAccountId`, `resendEmailId`) names a row, not the value it points
// at.
const RECORD_ID = /(Id|ID|Ids|IDs|_id|_ids)$/;
// ...except where the id is itself the identifier of a person.
const PERSON_ID = /(tax|taxpayer|national|government|passport|license|licence|ssn).?(id|ids)$/i;
/** Pinned by scrub-contract.test.ts: the agent's layer-2 log scrub repeats these patterns. */
export const LOG_REDACT_PATTERNS = describePatterns({
    SENSITIVE_KEY_PATTERN,
    CAMEL_EIN,
    PERSON_ID,
    RECORD_ID,
});
/** App-supplied key names, lower-cased; redacted on top of the patterns above. */
const extraKeys = new Set();
/** Adds key names (matched whole, any letter case) to the redacted set; a default stays. */
export function addSensitiveKeys(keys) {
    for (const key of keys) {
        const name = key.trim().toLowerCase();
        if (name)
            extraKeys.add(name);
    }
}
/** Test seam: forgets the app-supplied keys. */
export function resetSensitiveKeys() {
    extraKeys.clear();
}
export function isSensitiveKey(key) {
    if (extraKeys.size > 0 && extraKeys.has(key.toLowerCase()))
        return true;
    if (PERSON_ID.test(key))
        return true;
    if (RECORD_ID.test(key))
        return false;
    return SENSITIVE_KEY_PATTERN.test(key) || CAMEL_EIN.test(key);
}
const MAX_DEPTH = 8;
const MAX_BREADTH = 1_000;
/** Total values visited per log line, so a deep and wide object cannot stall the process. */
const MAX_NODES = 5_000;
const REDACTED = "[redacted]";
const TRUNCATED = "[truncated]";
const ERROR_KEYS = new Set(["err", "error", "e"]);
function isOpaque(value) {
    return (value instanceof Map ||
        value instanceof Set ||
        value instanceof RegExp ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value));
}
/**
 * The JSON-facing form of an object: URL, Buffer and toJSON values converted; `done` stops the
 * walk.
 */
export function convert(value) {
    if (value instanceof URL)
        return { done: true, value: scrubMessage(stripQuery(value.href)) };
    if (Buffer.isBuffer(value))
        return { done: true, value: { bytes: value.length } };
    if (value instanceof Date)
        return { done: true, value };
    if (isOpaque(value))
        return { done: true, value };
    const toJSON = value.toJSON;
    if (typeof toJSON === "function")
        return { done: false, value: toJSON.call(value) };
    return { done: false, value };
}
/**
 * A log call's first argument or child bindings as JSON would see them, so a spread keeps what a
 * toJSON hides hidden. Byte views become `{ bytes }`; a value that is not a plain record (an
 * array, a date, a map's entries, what a toJSON returns) lands under `value`.
 */
export function plainFields(fields, nested = false) {
    if (ArrayBuffer.isView(fields))
        return { bytes: fields.byteLength };
    if (Array.isArray(fields))
        return { value: fields };
    if (fields instanceof Date) {
        return { value: Number.isNaN(fields.getTime()) ? null : fields.toISOString() };
    }
    if (fields instanceof Map)
        return { value: Object.fromEntries(fields) };
    const { value } = convert(fields);
    if (value === fields)
        return fields;
    // What a toJSON returns gets the same treatment once, so a returned date or map keeps its value.
    if (typeof value === "object" && value !== null) {
        return nested ? value : plainFields(value, true);
    }
    return { value };
}
/** Maps an array within the breadth cap, stopping at the first item past the node budget. */
function walkItems(items, depth, state, visit) {
    const out = [];
    for (const item of items) {
        if (out.length >= MAX_BREADTH || state.nodes >= MAX_NODES) {
            out.push(TRUNCATED);
            break;
        }
        out.push(visit(item, depth + 1, state));
    }
    return out;
}
/** A value under err/error/e at any depth: serialized deny-by-default; an array is mapped. */
function walkErrorValue(value, depth, state) {
    if (++state.nodes > MAX_NODES)
        return TRUNCATED;
    if (value === null || value === undefined)
        return value;
    if (!Array.isArray(value))
        return serializeError(value);
    if (depth > MAX_DEPTH)
        return TRUNCATED;
    return walkItems(value, depth, state, walkErrorValue);
}
/** `base`, or `base#n` when that name is taken; the chosen name is then taken. */
function freeKey(base, taken) {
    let candidate = base;
    for (let n = 1; taken.has(candidate); n++)
        candidate = `${base}#${n}`;
    taken.add(candidate);
    return candidate;
}
/**
 * An object's entries within the breadth cap, each with the key it is logged under. A key that the
 * message scrub would change becomes `[redacted]`; every clean key is reserved first, so a caller key that
 * looks like a marker is never overwritten and never overwrites.
 */
function keyedEntries(target) {
    const raw = Object.entries(target).slice(0, MAX_BREADTH + 1);
    const clean = raw.map(([k]) => scrubMessage(k) === k);
    const taken = new Set(raw.filter((_, i) => clean[i]).map(([k]) => k));
    const entries = raw.map(([k, v], i) => [
        k,
        clean[i] ? k : freeKey(REDACTED, taken),
        v,
    ]);
    return { entries, taken };
}
function walk(value, depth, state) {
    if (++state.nodes > MAX_NODES)
        return TRUNCATED;
    if (typeof value === "string")
        return scrubMessage(value);
    if (typeof value !== "object" || value === null)
        return value;
    if (value instanceof Error)
        return serializeError(value);
    const converted = convert(value);
    if (converted.done)
        return converted.value;
    const target = converted.value;
    if (typeof target === "string")
        return scrubMessage(target);
    if (typeof target !== "object" || target === null)
        return target;
    if (state.ancestors.has(target))
        return "[circular]";
    if (depth > MAX_DEPTH)
        return TRUNCATED;
    state.ancestors.add(target);
    try {
        if (Array.isArray(target))
            return walkItems(target, depth, state, walk);
        const out = {};
        const { entries, taken } = keyedEntries(target);
        let count = 0;
        for (const [k, key, child] of entries) {
            if (++count > MAX_BREADTH || state.nodes >= MAX_NODES) {
                out[freeKey(TRUNCATED, taken)] = true;
                break;
            }
            if (isSensitiveKey(k))
                out[key] = REDACTED;
            else if (ERROR_KEYS.has(k))
                out[key] = walkErrorValue(child, depth + 1, state);
            else
                out[key] = walk(child, depth + 1, state);
        }
        return out;
    }
    finally {
        state.ancestors.delete(target);
    }
}
/**
 * A sanitized copy of a log value; the caller's value is never mutated. Fails closed. The log
 * object, child bindings and every format argument take this one path: PII keys are redacted at
 * any depth, every Error and every non-nullish value under err/error/e is serialized deny-by-
 * default, and every string gets the message scrub (`scrubMessage`).
 */
export function sanitizeLogValue(value) {
    try {
        return walk(value, 0, { nodes: 0, ancestors: new WeakSet() });
    }
    catch {
        return { log_redaction_failed: true };
    }
}
/** The log object or bindings, through sanitizeLogValue. */
export function redactLogObject(obj) {
    return sanitizeLogValue(obj);
}
