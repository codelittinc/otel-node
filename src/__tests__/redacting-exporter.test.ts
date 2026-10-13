import { describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { RedactingSpanExporter } from "../redacting-exporter.js";
import { stripQuery } from "../redact.js";

function exportOne(attributes: Record<string, string | number | boolean | undefined>) {
  const memory = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
  });
  const span = provider.getTracer("t").startSpan("GET /v1/tenants", { attributes });
  span.addEvent("exception", { "url.full": "https://x/y?token=SECRET" });
  span.end();
  return memory.getFinishedSpans()[0]!;
}

describe("RedactingSpanExporter", () => {
  it("drops query strings, headers and redis statements", () => {
    const span = exportOne({
      "url.full": "https://api.carboncrei.io/v1/tenants?search=Jane%20Doe#frag",
      "url.query": "search=Jane%20Doe",
      "url.path": "/v1/tenants/Jane%20Doe",
      "http.request.header.authorization": "Bearer SECRET",
      "db.system.name": "redis",
      "db.query.text": 'hset bull:invoice-email:1 data {"email":"jane@example.com"}',
      "http.route": "/v1/tenants",
    });
    const serialized = JSON.stringify([span.attributes, span.events]);
    expect(serialized).not.toMatch(/Jane|SECRET|jane@example\.com/);
    expect(span.attributes["url.full"]).toBe("https://api.carboncrei.io/v1/tenants");
    expect(span.attributes["url.path"]).toBe("/v1/tenants");
    expect(span.attributes["http.route"]).toBe("/v1/tenants");
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });
  it("keeps parameterized SQL from Prisma", () => {
    const span = exportOne({
      "db.system.name": "postgresql",
      "db.query.text": "SELECT 1 WHERE id = $1",
    });
    expect(span.attributes["db.query.text"]).toBe("SELECT 1 WHERE id = $1");
  });

  it("scrubs links with url and header attributes", () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
    });
    const span = provider.getTracer("t").startSpan("GET /v1/tenants", {
      links: [
        {
          context: provider.getTracer("t").startSpan("linked").spanContext(),
          attributes: {
            "url.full": "https://api.carboncrei.io/v1/tenants?search=Jane%20Doe",
            "http.request.header.authorization": "Bearer SECRET",
          },
        },
      ],
    });
    span.end();
    const exported = memory.getFinishedSpans()[0]!;
    const serialized = JSON.stringify(exported.links);
    expect(serialized).not.toMatch(/Jane|SECRET/);
    const linkAttrs = exported.links[0]?.attributes;
    expect(linkAttrs?.["url.full"]).toBe("https://api.carboncrei.io/v1/tenants");
    expect(linkAttrs?.["http.request.header.authorization"]).toBeUndefined();
  });

  it("scrubs exception.message and stacktrace with recorded exceptions", () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
    });
    const span = provider.getTracer("t").startSpan("test");
    span.recordException(new Error("duplicate email jane@example.com"));
    span.end();
    const exported = memory.getFinishedSpans()[0]!;
    const serialized = JSON.stringify([exported.attributes, exported.events]);
    expect(serialized).not.toMatch(/jane@example\.com/);
    const exceptionEvent = exported.events.find((e) => e.name === "exception");
    expect(exceptionEvent?.attributes?.["exception.type"]).toBe("Error");
    expect(exceptionEvent?.attributes?.["exception.message"]).toBe("[redacted]");
    const stacktrace = exceptionEvent?.attributes?.["exception.stacktrace"] as string | undefined;
    expect(stacktrace).toContain("Error: [redacted]");
    expect(stacktrace).toMatch(/\n\s+at /);
  });

  it("scrubs status.message but keeps status.code", () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
    });
    const span = provider.getTracer("t").startSpan("test");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "ssn 123-45-6789" });
    span.end();
    const exported = memory.getFinishedSpans()[0]!;
    expect(exported.status.message).toBe("[redacted]");
    expect(exported.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("drops db.query.parameter. and db.operation.parameter. prefixes", () => {
    const span = exportOne({
      "db.query.parameter.id": "12345",
      "db.operation.parameter.email": "jane@example.com",
      "db.query.text": "SELECT 1",
    });
    const attrs = span.attributes;
    expect(attrs["db.query.parameter.id"]).toBeUndefined();
    expect(attrs["db.operation.parameter.email"]).toBeUndefined();
    expect(attrs["db.query.text"]).toBe("SELECT 1");
  });

  it("drops enduser. and user. prefixes", () => {
    const span = exportOne({
      "enduser.id": "tenant-123",
      "enduser.email": "jane@example.com",
      "user.agent": "chrome",
      "user.ip.address": "192.168.1.1",
      "http.route": "/api/test",
    });
    const attrs = span.attributes;
    expect(attrs["enduser.id"]).toBeUndefined();
    expect(attrs["enduser.email"]).toBeUndefined();
    expect(attrs["user.agent"]).toBeUndefined();
    expect(attrs["user.ip.address"]).toBeUndefined();
    expect(attrs["http.route"]).toBe("/api/test");
  });

  it("drops client.address", () => {
    const span = exportOne({
      "client.address": "192.168.1.1",
      "http.route": "/api/test",
    });
    const attrs = span.attributes;
    expect(attrs["client.address"]).toBeUndefined();
    expect(attrs["http.route"]).toBe("/api/test");
  });

  it("stripQuery removes userinfo from URLs", () => {
    expect(stripQuery("https://user:pass@host/p?q")).toBe("https://host/p");
    expect(stripQuery("https://user:pass@host/p#frag")).toBe("https://host/p");
    expect(stripQuery("https://host/p")).toBe("https://host/p");
    expect(stripQuery("HTTPS://user:pass@host/p?q")).toBe("HTTPS://host/p");
    expect(stripQuery("Https://user:pass@host/p")).toBe("Https://host/p");
  });

  // WHY: BullMQ's worker span carries the processor's return value and the thrown message,
  // and Queue.updateJobProgress the progress payload, any of which can hold resident data.
  it("redacts the BullMQ failure reason and drops job results and progress", () => {
    const span = exportOne({
      "bullmq.job.failed.reason": "duplicate email jane@example.com",
      "bullmq.job.result": '{"email":"jane@example.com"}',
      "bullmq.job.progress": '{"tenant":"Jane Doe"}',
      "bullmq.job.name": "invoice-email",
      "bullmq.queue.name": "invoice-email",
    });
    expect(JSON.stringify(span.attributes)).not.toMatch(/jane@example\.com|Jane/);
    expect(span.attributes["bullmq.job.failed.reason"]).toBe("[redacted]");
    expect(span.attributes["bullmq.job.result"]).toBeUndefined();
    expect(span.attributes["bullmq.job.progress"]).toBeUndefined();
    expect(span.attributes["bullmq.job.name"]).toBe("invoice-email");
    expect(span.attributes["bullmq.queue.name"]).toBe("invoice-email");
  });

  it("treats db.system.name: 'redis' + db.query.text as Redis", () => {
    const span = exportOne({
      "db.system.name": "redis",
      "db.query.text": 'hset bull:job data {"email":"jane@example.com"}',
    });
    expect(span.attributes["db.query.text"]).toBeUndefined();
  });

  it("treats db.system: 'redis' + db.statement as Redis", () => {
    const span = exportOne({
      "db.system": "redis",
      "db.statement": 'hset bull:job data {"email":"jane@example.com"}',
    });
    const attrs = span.attributes;
    expect(attrs["db.statement"]).toBeUndefined();
  });

  it("proxies resource, parentSpanContext, instrumentationScope, startTime, endTime, duration, and spanContext unchanged", () => {
    let rawSpan: ReadableSpan | undefined;
    const memory = new InMemorySpanExporter();
    const captureRaw = {
      export(spans: ReadableSpan[], done: (result: ExportResult) => void) {
        rawSpan = spans[0];
        memory.export(spans, done);
      },
      shutdown() {
        return memory.shutdown();
      },
      forceFlush() {
        return memory.forceFlush?.() ?? Promise.resolve();
      },
    };
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(captureRaw),
        new SimpleSpanProcessor(new RedactingSpanExporter(memory)),
      ],
    });
    const span = provider
      .getTracer("t")
      .startSpan("test", { attributes: { "exception.message": "leak" } });
    span.end();
    const exported = memory.getFinishedSpans()[0]!;

    expect(rawSpan).toBeDefined();
    const raw = rawSpan!;
    expect(exported.resource).toBe(raw.resource);
    expect(exported.parentSpanContext).toBe(raw.parentSpanContext);
    expect(exported.instrumentationScope).toBe(raw.instrumentationScope);
    expect(exported.startTime).toEqual(raw.startTime);
    expect(exported.endTime).toEqual(raw.endTime);
    expect(exported.duration).toEqual(raw.duration);
    expect(exported.spanContext()).toEqual(raw.spanContext());
  });

  it("forceFlush works with stub exporter having only export and shutdown", async () => {
    const stub = {
      export(_spans: ReadableSpan[], done: (result: ExportResult) => void) {
        done({ code: 0 });
      },
      shutdown() {
        return Promise.resolve();
      },
    };
    const redacting = new RedactingSpanExporter(stub);
    const result = await redacting.forceFlush();
    expect(result).toBeUndefined();
  });

  it("redacts multi-line exception messages with PII on non-first lines", () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
    });
    const span = provider.getTracer("t").startSpan("test");
    span.recordException(new Error("first\nemail jane@x.com"));
    span.end();
    const exported = memory.getFinishedSpans()[0]!;
    const serialized = JSON.stringify(exported.events);
    expect(serialized).not.toMatch(/jane@x\.com/);
    const exceptionEvent = exported.events.find((e) => e.name === "exception");
    const stacktrace = exceptionEvent?.attributes?.["exception.stacktrace"] as string | undefined;
    expect(stacktrace).toContain("Error: [redacted]");
    expect(stacktrace).toMatch(/\n\s+at /);
  });

  it("handles non-string exception.stacktrace by redacting it", () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
    });
    const span = provider.getTracer("t").startSpan("test");
    span.addEvent("exception", {
      "exception.stacktrace": 123,
      "exception.type": "CustomError",
    });
    span.end();
    const exported = memory.getFinishedSpans()[0]!;
    const exceptionEvent = exported.events[0]!;
    expect(exceptionEvent.attributes?.["exception.stacktrace"]).toBe("[redacted]");
  });

  it("handles non-string exception.message (as number) by redacting it", () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
    });
    const span = provider.getTracer("t").startSpan("test");
    span.addEvent("exception", {
      "exception.message": 12345,
    });
    span.end();
    const exported = memory.getFinishedSpans()[0]!;
    const exceptionEvent = exported.events[0]!;
    expect(exceptionEvent.attributes?.["exception.message"]).toBe("[redacted]");
  });
});
