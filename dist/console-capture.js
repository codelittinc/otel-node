import { formatWithOptions } from "node:util";
import { createLogger } from "./logger.js";
import { safeErrorMessage } from "./log-errors.js";
import { sanitizeLogValue } from "./log-redact.js";
import { scrubErrorText } from "./log-scrub.js";
import { hasLogLineSink } from "./log-sink.js";
import { currentService } from "./shared-log.js";
const LEVELS = ["warn", "error"];
let originals;
/**
 * Sends every `console.warn` and `console.error` line to OTLP logs, through the logger's scrub and
 * under the configured log scope, and still writes it to the console unchanged. Only the scrubbed
 * copy is exported; stdout keeps the app's own line. Calling it again changes nothing.
 */
export function captureConsole() {
    if (originals)
        return;
    originals = {};
    // Writes nothing itself: the line reaches only the OTLP sink.
    const logger = createLogger(currentService, { write: () => undefined }).child({
        component: "console",
    });
    for (const level of LEVELS) {
        const original = console[level];
        originals[level] = original;
        console[level] = (...args) => {
            original.apply(console, args);
            exportLine(logger, level, args);
        };
    }
}
/** Puts back the console methods `captureConsole` replaced. */
export function releaseConsole() {
    if (!originals)
        return;
    for (const level of LEVELS) {
        const original = originals[level];
        if (original)
            console[level] = original;
    }
    originals = undefined;
}
/**
 * The first Error goes under `err`, and its safe message takes its place in the text, so a `%s`
 * still reads as on the console. Every other argument is reduced to what the logger would export
 * for it, then the arguments are formatted, and the rendered text is scrubbed last: a value split
 * across arguments only takes its final shape once formatted.
 */
function exportLine(logger, level, args) {
    if (!hasLogLineSink())
        return;
    try {
        const err = args.find((arg) => arg instanceof Error);
        const parts = args.map((arg) => (arg === err ? safeErrorMessage(err) : asLogged(arg)));
        const message = scrubErrorText(formatWithOptions({ colors: false }, ...parts));
        if (err === undefined)
            logger[level](message);
        else
            logger[level]({ err }, message);
    }
    catch {
        // the console line is already written
    }
}
/**
 * An argument as the logger's JSON line would carry it: sanitized (bounded, PII keys redacted),
 * then through JSON, so console formatting has nothing left to print that the line would not
 * hold. No function, Map or Set contents, getter, custom inspect or toString survives.
 */
function asLogged(arg) {
    if (typeof arg === "function")
        return "[Function]";
    const sanitized = sanitizeLogValue(arg);
    if (typeof sanitized !== "object" || sanitized === null)
        return sanitized;
    const json = JSON.stringify(sanitized, jsonSafe);
    return json === undefined ? undefined : JSON.parse(json);
}
/** A byte view becomes its size, a Map or Set `{}`, a bigint its digits. */
function jsonSafe(_key, value) {
    if (typeof value === "bigint")
        return value.toString();
    if (ArrayBuffer.isView(value))
        return { bytes: value.byteLength };
    if (value instanceof Map || value instanceof Set)
        return {};
    return value;
}
