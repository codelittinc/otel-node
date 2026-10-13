import { afterAll, describe, expect, it } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { serializeError, traceLogFields } from "../index.js";
import { createTestLogger } from "../testing.js";

const provider = new BasicTracerProvider();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(provider);
const tracer = provider.getTracer("error-helpers-test");

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

describe("serializeError from the main entry", () => {
  it("matches the err shape log exports, scrubbed and redacted", () => {
    const error = Object.assign(new Error("bad ssn 123-45-6789"), {
      password: "hunter2",
    });
    const { logger, records } = createTestLogger();
    logger.error({ err: error }, "failed");

    const shaped = serializeError(error);
    expect(shaped).toEqual(records[0]!.err);
    const text = JSON.stringify(shaped);
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("hunter2");
  });
});

describe("traceLogFields from the main entry", () => {
  it("returns the active span ids", () => {
    tracer.startActiveSpan("work", (span) => {
      const { traceId, spanId } = span.spanContext();
      expect(traceLogFields()).toEqual({ trace_id: traceId, span_id: spanId });
      span.end();
    });
  });

  it("returns {} when the active span has an invalid context", () => {
    const span = trace.wrapSpanContext({
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 0,
    });
    context.with(trace.setSpan(context.active(), span), () => {
      expect(traceLogFields()).toEqual({});
    });
  });

  it("returns {} with no active span", () => {
    expect(traceLogFields()).toEqual({});
  });
});
