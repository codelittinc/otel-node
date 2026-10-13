import { context, defaultTextMapGetter, defaultTextMapSetter, isSpanContextValid, ROOT_CONTEXT, SpanStatusCode, trace, } from "@opentelemetry/api";
import { unsuppressTracing, W3CTraceContextPropagator } from "@opentelemetry/core";
// The W3C propagator is used directly, not the global one, so a stored value is always a
// `traceparent` header whatever OTEL_PROPAGATORS says.
const w3c = new W3CTraceContextPropagator();
const TRACER_NAME = "@codelittinc/otel-node";
/** The W3C `traceparent` of the active span, or undefined when no span is active. */
export function currentTraceparent() {
    const carrier = {};
    w3c.inject(context.active(), carrier, defaultTextMapSetter);
    return carrier.traceparent;
}
/** A span link to a stored `traceparent`. A missing or malformed value gives no link. */
export function linkFromTraceparent(value) {
    if (!value)
        return undefined;
    try {
        const extracted = w3c.extract(ROOT_CONTEXT, { traceparent: value }, defaultTextMapGetter);
        const spanContext = trace.getSpanContext(extracted);
        return spanContext && isSpanContextValid(spanContext) ? { context: spanContext } : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Run `fn` inside a new active span that links to the trace in `traceparent`. A link, not a
 * parent: the work runs later and apart from the request that stored the value.
 */
export function withLinkedSpan(name, traceparent, fn) {
    const link = linkFromTraceparent(traceparent);
    return trace
        .getTracer(TRACER_NAME)
        .startActiveSpan(name, { links: link ? [link] : [] }, async (span) => {
        try {
            return await fn();
        }
        catch (err) {
            span.recordException(err instanceof Error ? err : String(err));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
        }
        finally {
            span.end();
        }
    });
}
/**
 * Run `fn` inside a new active root span, recorded even where the HTTP instrumentation suppressed
 * tracing for an ignored path. The span ends with ERROR when `fn` throws or `failed` holds for its
 * result, else OK.
 */
export function withRootSpan(name, fn, failed = () => false) {
    return trace
        .getTracer(TRACER_NAME)
        .startActiveSpan(name, { root: true }, unsuppressTracing(context.active()), async (span) => {
        try {
            const result = await fn();
            span.setStatus({ code: failed(result) ? SpanStatusCode.ERROR : SpanStatusCode.OK });
            return result;
        }
        catch (err) {
            span.recordException(err instanceof Error ? err : String(err));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
        }
        finally {
            span.end();
        }
    });
}
