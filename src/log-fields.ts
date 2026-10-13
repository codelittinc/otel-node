import { isSpanContextValid, trace } from "@opentelemetry/api";

/** Returns the active span's `trace_id` and `span_id`, or `{}` when there is no active span. */
export function traceLogFields(): { trace_id?: string; span_id?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}
