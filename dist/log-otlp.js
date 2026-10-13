import { isSpanContextValid, ROOT_CONTEXT, trace, TraceFlags, } from "@opentelemetry/api";
import { SeverityNumber, } from "@opentelemetry/api-logs";
const SEVERITY = {
    trace: SeverityNumber.TRACE,
    debug: SeverityNumber.DEBUG,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
    fatal: SeverityNumber.FATAL,
};
/** Body of a line with no message, so a text search in Loki still has something to match. */
export const NO_MESSAGE = "(no message)";
/**
 * OTel's own diagnostics (exporter failures among them). Exporting one would feed a failing
 * exporter its own failures, once per batch, so they stay on stdout.
 */
function isOtelDiag(fields) {
    return fields.component === "telemetry" && fields.event === "otel_diag";
}
/** The line's correlation fields as a log record context; flags come from the matching span. */
function lineContext(traceId, spanId) {
    if (typeof traceId !== "string" || typeof spanId !== "string")
        return undefined;
    const active = trace.getActiveSpan()?.spanContext();
    const traceFlags = active?.traceId === traceId && active.spanId === spanId ? active.traceFlags : TraceFlags.NONE;
    const spanContext = { traceId, spanId, traceFlags };
    return isSpanContextValid(spanContext)
        ? trace.setSpanContext(ROOT_CONTEXT, spanContext)
        : undefined;
}
function timestampOf(time) {
    if (typeof time !== "string")
        return undefined;
    const date = new Date(time);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
/**
 * The fields search and dashboards need, first: the SDK keeps a record's first 128 attributes and
 * the logger writes `app` last.
 */
const PRIORITY_FIELDS = ["app", "env", "component", "event"];
function priorityFirst(fields) {
    const out = {};
    for (const key of PRIORITY_FIELDS)
        if (key in fields)
            out[key] = fields[key];
    for (const [key, value] of Object.entries(fields))
        if (!(key in out))
            out[key] = value;
    return out;
}
function bodyOf(msg, event) {
    if (typeof msg === "string" && msg !== "")
        return msg;
    if (typeof event === "string" && event !== "")
        return event;
    return NO_MESSAGE;
}
/**
 * A sink that turns each line the scrubbing logger wrote into an OTel log record: `msg` (else
 * `event`) is the body, `level` the severity, `time` the timestamp, `trace_id`/`span_id` the record
 * context, every other field an attribute. Only the serialized line is read, so a record holds
 * nothing the line does not. The record is emitted after the line is written, so an SDK diagnostic
 * about it (a dropped attribute) follows the line on stdout instead of preceding it.
 */
export function logLineSink(logger) {
    return (line) => {
        const parsed = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
            return;
        const { msg, level, time, trace_id, span_id, ...attributes } = parsed;
        if (isOtelDiag(attributes))
            return;
        const record = {
            body: bodyOf(msg, attributes.event),
            attributes: priorityFirst(attributes),
            context: lineContext(trace_id, span_id) ?? ROOT_CONTEXT,
        };
        if (typeof level === "string") {
            record.severityText = level;
            record.severityNumber = SEVERITY[level] ?? SeverityNumber.UNSPECIFIED;
        }
        const timestamp = timestampOf(time);
        if (timestamp)
            record.timestamp = timestamp;
        queueMicrotask(() => {
            try {
                logger.emit(record);
            }
            catch {
                // the line is already on stdout
            }
        });
    };
}
/**
 * Forwards only records from `scope`, the one fed by the scrubbing logger. Any other emitter on
 * the global provider (an instrumentation's raw exception record) is never exported.
 */
export class ScopedLogRecordProcessor {
    inner;
    scope;
    constructor(inner, scope) {
        this.inner = inner;
        this.scope = scope;
    }
    onEmit(record, context) {
        if (record.instrumentationScope.name === this.scope)
            this.inner.onEmit(record, context);
    }
    enabled(options) {
        return options.instrumentationScope.name === this.scope;
    }
    forceFlush() {
        return this.inner.forceFlush();
    }
    shutdown() {
        return this.inner.shutdown();
    }
}
