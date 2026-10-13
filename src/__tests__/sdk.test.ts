import { afterEach, describe, expect, it, vi } from "vitest";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import type { IncomingMessage } from "node:http";
import { trace } from "@opentelemetry/api";
import { buildInstrumentations } from "../instrumentations.js";
import { shutdownTelemetry, startTelemetry } from "../sdk.js";

describe("buildInstrumentations", () => {
  it("traces redis only under a parent span, so BullMQ polling is silent", () => {
    const redis = buildInstrumentations([]).find((i) => i instanceof IORedisInstrumentation)!;
    expect(redis.getConfig()).toMatchObject({ requireParentSpan: true });
  });
  it("never records bound SQL values", () => {
    const pg = buildInstrumentations([]).find((i) => i instanceof PgInstrumentation)!;
    // packages/db's outbox-backlog sentinel test runs pg with these same options.
    expect(pg.getConfig()).toMatchObject({
      enhancedDatabaseReporting: false,
      requireParentSpan: true,
    });
  });

  // WHY: health probes and the PostHog proxy would each open a server span per request. An
  // entry ignores its own path and everything under it, never a sibling that shares a prefix.
  it.each([
    ["/health", true],
    ["/ready?probe=1", true],
    ["/health/deep", true],
    ["/api/ready", true],
    ["/ingest/e/?compression=gzip-js", true],
    ["/ingest", true],
    ["/readyz", false],
    ["/ingestion", false],
    ["/v1/tenants", false],
  ])("ignoring %s: %s", (url, ignored) => {
    const http = buildInstrumentations(["/health", "/ready", "/api/ready", "/ingest"]).find(
      (i) => i instanceof HttpInstrumentation,
    )!;
    const hook = http.getConfig().ignoreIncomingRequestHook!;
    expect(hook({ url } as IncomingMessage)).toBe(ignored);
  });
});

describe("startTelemetry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op without an endpoint", async () => {
    expect((await startTelemetry({ serviceName: "api", env: {} })).enabled).toBe(false);
  });

  it("survives an unreachable collector without an unhandled rejection", async () => {
    // The exporters read process.env themselves, so the endpoint must be stubbed there.
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9");
    vi.stubEnv("OTEL_EXPORTER_OTLP_TIMEOUT", "500");
    const onRejection = vi.fn();
    process.on("unhandledRejection", onRejection);
    try {
      const config = await startTelemetry({
        serviceName: "api",
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", OTEL_LOG_LEVEL: "NONE" },
      });
      expect(config.enabled).toBe(true);
      trace.getTracer("t").startSpan("probe").end();
      const started = Date.now();
      await expect(shutdownTelemetry(2_000)).resolves.toBeUndefined();
      expect(Date.now() - started).toBeLessThan(3_000);
      // Let any late rejection from the exporter surface before the listener is removed.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(onRejection).not.toHaveBeenCalled();
  }, 10_000);
});
