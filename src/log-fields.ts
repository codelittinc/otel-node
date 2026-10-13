import { isSpanContextValid, trace } from "@opentelemetry/api";

/** Trace correlation fields for the active span; empty outside a valid span. */
export function traceLogFields(): { trace_id?: string; span_id?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}
