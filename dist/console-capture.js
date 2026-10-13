import { formatWithOptions } from "node:util";
import { createLogger } from "./logger.js";
import { sanitizeLogValue } from "./log-redact.js";
import { scrubErrorText } from "./log-scrub.js";
import { hasLogLineSink } from "./log-sink.js";
import { currentService } from "./shared-log.js";
const LEVELS = ["warn", "error"];
/** Values visited per line while expanding collections, as the field sanitizer caps its walk. */
const MAX_NODES = 5_000;
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
 * The first Error goes under `err`. Every other argument is sanitized like a log field (PII keys
 * redacted at any depth, including inside a Map or Set), then the arguments are formatted, and the
 * rendered text is scrubbed last: a custom inspect, a toString or a value split across arguments
 * only takes its final shape once formatted.
 */
function exportLine(logger, level, args) {
    if (!hasLogLineSink())
        return;
    try {
        const err = args.find((arg) => arg instanceof Error);
        const budget = { nodes: 0 };
        const rest = args
            .filter((arg) => arg !== err)
            .map((arg) => sanitizeLogValue(expandCollections(arg, budget, new WeakSet())));
        const message = rest.length > 0 ? scrubErrorText(formatWithOptions({ colors: false }, ...rest)) : undefined;
        if (err === undefined)
            logger[level](message ?? "");
        else if (message === undefined)
            logger[level]({ err });
        else
            logger[level]({ err }, message);
    }
    catch {
        // the console line is already written
    }
}
/**
 * A copy in which every Map becomes a plain object and every Set an array, so the field sanitizer
 * sees their keys; a byte view becomes `{ bytes }`. The sanitizer treats these as opaque, which is
 * safe in a JSON log line (a Map serializes as `{}`) but not in console formatting, which prints
 * their contents. Errors, dates, URLs and toJSON values are left to the sanitizer.
 */
function expandCollections(value, budget, seen) {
    if (typeof value !== "object" || value === null)
        return value;
    if (++budget.nodes > MAX_NODES)
        return "[truncated]";
    if (ArrayBuffer.isView(value))
        return { bytes: value.byteLength };
    if (value instanceof Error || value instanceof Date || value instanceof URL)
        return value;
    if (typeof value.toJSON === "function")
        return value;
    if (seen.has(value))
        return "[circular]";
    seen.add(value);
    try {
        const expand = (item) => expandCollections(item, budget, seen);
        if (value instanceof Map) {
            return Object.fromEntries([...value].map(([key, item]) => [String(key), expand(item)]));
        }
        if (value instanceof Set)
            return [...value].map(expand);
        if (Array.isArray(value))
            return value.map(expand);
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
    }
    finally {
        seen.delete(value);
    }
}
