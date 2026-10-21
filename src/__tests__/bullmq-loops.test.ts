import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { context, propagation, trace as otelTrace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanKind, trace } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { rootLoopSpans } from "../bullmq-loops.js";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
otelTrace.setGlobalTracerProvider(provider);
// NodeSDK installs this in an app; BullMQ carries a job's parent through it.
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
const telemetry = rootLoopSpans(new BullMQOtel({ tracerName: "bullmq-loops-test" }));

afterAll(async () => {
  await provider.shutdown();
  otelTrace.disable();
  propagation.disable();
  context.disable();
});

beforeEach(() => exporter.reset());

const span = (name: string) => exporter.getFinishedSpans().filter((s) => s.name === name);

/** BullMQ 6's Worker.startStalledCheckTimer: the loop starts inside the span and outlives it. */
async function stalledCheckTimer(queue: string, iterations: number): Promise<void> {
  let loop: Promise<void> = Promise.resolve();
  await trace(telemetry, SpanKind.INTERNAL, queue, "startStalledCheckTimer", queue, async () => {
    loop = (async () => {
      for (let i = 0; i < iterations; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await trace(telemetry, SpanKind.INTERNAL, queue, "moveStalledJobsToWait", queue, async () =>
          otelTrace.getTracer("redis").startSpan("evalsha").end(),
        );
      }
    })();
  });
  await loop;
}

describe("rootLoopSpans", () => {
  // WHY: Backbone's worker grew one trace per queue for its whole uptime, every check a child of
  // startStalledCheckTimer, until Tempo refused it (trace_too_large) a day and a half in.
  it("gives each stalled check a trace of its own, with its redis call inside it", async () => {
    await stalledCheckTimer("q", 3);
    const [timer] = span("startStalledCheckTimer q");
    const checks = span("moveStalledJobsToWait q");
    const traceIds = new Set(checks.map((s) => s.spanContext().traceId));

    expect(checks).toHaveLength(3);
    expect(traceIds.size).toBe(3);
    expect(traceIds.has(timer!.spanContext().traceId)).toBe(false);
    for (const check of checks) expect(check.parentSpanContext).toBeUndefined();
    for (const call of span("evalsha")) {
      expect(traceIds.has(call.spanContext().traceId)).toBe(true);
      expect(call.parentSpanContext?.spanId).toBeDefined();
    }
  });

  it("leaves every other operation under the active span", async () => {
    const parent = otelTrace.getTracer("app").startSpan("request");
    await context.with(otelTrace.setSpan(context.active(), parent), () =>
      trace(telemetry, SpanKind.PRODUCER, "q", "add", "q.job", async () => undefined),
    );
    parent.end();
    const [add] = span("add q.job");
    expect(add!.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(add!.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it("keeps a job's propagated parent", async () => {
    let metadata = "";
    await trace(telemetry, SpanKind.PRODUCER, "q", "add", "q.job", async (_span, dst) => {
      metadata = dst!;
    });
    await trace(
      telemetry,
      SpanKind.CONSUMER,
      "q",
      "process",
      "q",
      async () => undefined,
      metadata,
    );
    const [add] = span("add q.job");
    const [processed] = span("process q");
    expect(processed!.spanContext().traceId).toBe(add!.spanContext().traceId);
  });
});
