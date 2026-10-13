import { safeErrorMessage } from "./log-errors.js";
import { plainFields, sanitizeLogValue } from "./log-redact.js";
import { scrubMessage } from "./log-scrub.js";
const UNLOGGABLE = "[unloggable]";
/** pino derives `msg` from an Error first argument or from `err.message` of any object. */
function errorIn(first) {
    if (first instanceof Error)
        return first;
    if (typeof first !== "object" || first === null)
        return undefined;
    const fields = first;
    for (const key of ["err", "error", "e"]) {
        const candidate = fields[key];
        if (candidate instanceof Error)
            return candidate;
    }
    const err = fields.err;
    return typeof err === "object" && err !== null && "message" in err ? err : undefined;
}
/**
 * Arguments for a pino log call with a sanitized `msg`: the raw error message never becomes `msg`,
 * a `msg` field is scrubbed like a message string, and every format argument is sanitized exactly
 * like the log object. Arguments that cannot be inspected become a placeholder line.
 */
export function sanitizeLogArgs(args) {
    try {
        const out = [...args];
        // Converted once, before any msg handling, so a toJSON-hidden field never reaches a spread.
        if (typeof out[0] === "object" && out[0] !== null && !(out[0] instanceof Error)) {
            out[0] = plainFields(out[0]);
        }
        const first = out[0];
        const msgIndex = typeof first === "string" ? 0 : 1;
        const fields = first;
        if (msgIndex === 1 && !(first instanceof Error) && typeof fields?.msg === "string") {
            out[0] = { ...fields, msg: scrubMessage(fields.msg) };
        }
        if (typeof out[msgIndex] !== "string" && msgIndex === 1) {
            const err = errorIn(first);
            if (err !== undefined)
                out.splice(1, 0, safeErrorMessage(err));
            else if (typeof fields?.msg === "string") {
                const { msg, ...rest } = out[0];
                out[0] = rest;
                out.splice(1, 0, msg);
            }
        }
        // The message and every format argument take the log object's own sanitizer.
        for (let i = msgIndex; i < out.length; i++)
            out[i] = sanitizeLogValue(out[i]);
        return out;
    }
    catch {
        // Nothing raw goes out: a format arg could carry PII the sanitizer never saw.
        return [{ log_redaction_failed: true }, UNLOGGABLE];
    }
}
