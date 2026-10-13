import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { suppressTracing } from "@opentelemetry/core";
import {
  currentTraceparent,
  linkFromTraceparent,
  withLinkedSpan,
  withRootSpan,
} from "../trace-context.js";

const memory = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] });
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(provider);
const tracer = provider.getTracer("trace-context-test");

const STORED = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

beforeEach(() => memory.reset());
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

describe("currentTraceparent", () => {
  it("is undefined outside any span", () => {
    expect(currentTraceparent()).toBeUndefined();
  });

  it("returns the W3C header of the active span", () => {
    tracer.startActiveSpan("writer", (span) => {
      const { traceId, spanId } = span.spanContext();
      expect(currentTraceparent()).toBe(`00-${traceId}-${spanId}-01`);
      span.end();
    });
  });
});

describe("linkFromTraceparent", () => {
  it("links to the stored trace and span", () => {
    expect(linkFromTraceparent(STORED)?.context).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });
  });

  it.each([null, undefined, "", "garbage", "00-zz-00f067aa0ba902b7-01", `${STORED}-extra`])(
    "gives no link for %j",
    (value) => {
      expect(linkFromTraceparent(value)).toBeUndefined();
    },
  );

  it("gives no link for an all-zero trace ID", () => {
    expect(
      linkFromTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"),
    ).toBeUndefined();
  });
});

describe("withLinkedSpan", () => {
  it("runs the function inside a span linked to the stored trace", async () => {
    const result = await withLinkedSpan("outbox.process X", STORED, async () => {
      expect(trace.getActiveSpan()).toBeDefined();
      return 42;
    });
    expect(result).toBe(42);
    const [span] = memory.getFinishedSpans();
    expect(span!.name).toBe("outbox.process X");
    expect(span!.links[0]!.context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("has no link for a malformed value and still runs the function", async () => {
    await expect(withLinkedSpan("outbox.process X", "not-a-header", async () => 1)).resolves.toBe(
      1,
    );
    expect(memory.getFinishedSpans()[0]!.links).toEqual([]);
  });

  it("marks the span as an error and rethrows", async () => {
    await expect(
      withLinkedSpan("outbox.process X", STORED, async () => {
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
    const [span] = memory.getFinishedSpans();
    expect(span!.status.code).toBe(2);
    expect(span!.ended).toBe(true);
  });
});

// The HTTP instrumentation runs an ignored path (`/ready`) with tracing suppressed. A check that
// fails there still needs a trace for its log lines to point at.
describe("withRootSpan", () => {
  const suppressed = <T>(fn: () => Promise<T>) =>
    context.with(suppressTracing(context.active()), fn);

  it("records a span, active for the function, even where tracing is suppressed", async () => {
    const traceIds: (string | undefined)[] = [];
    await suppressed(() =>
      withRootSpan("readiness.check", async () => {
        traceIds.push(trace.getActiveSpan()?.spanContext().traceId);
        return 200;
      }),
    );
    const [span] = memory.getFinishedSpans();
    expect(span!.name).toBe("readiness.check");
    expect(traceIds).toEqual([span!.spanContext().traceId]);
    expect(span!.parentSpanContext).toBeUndefined();
  });

  it("ends with OK when the result is not a failure", async () => {
    await expect(
      withRootSpan(
        "readiness.check",
        async () => 200,
        (s) => s >= 500,
      ),
    ).resolves.toBe(200);
    expect(memory.getFinishedSpans()[0]!.status.code).toBe(SpanStatusCode.OK);
  });

  it("ends with ERROR when the result is a failure", async () => {
    await expect(
      withRootSpan(
        "readiness.check",
        async () => 503,
        (s) => s >= 500,
      ),
    ).resolves.toBe(503);
    expect(memory.getFinishedSpans()[0]!.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("ends with ERROR and rethrows when the function throws", async () => {
    await expect(
      withRootSpan("readiness.check", async () => {
        throw new Error("check failed");
      }),
    ).rejects.toThrow("check failed");
    const [span] = memory.getFinishedSpans();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.ended).toBe(true);
  });
});
