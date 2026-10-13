import { describe, expect, it } from "vitest";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { metricViews } from "../metric-views.js";
import type { MetricViewOptions } from "../options.js";

const APP_VIEWS: MetricViewOptions = {
  instrumentPrefix: "app.",
  allowedAttributes: ["queue", "outcome"],
};

async function exportedAttributes(
  instrument: string,
  attributes: Record<string, string>,
  options: MetricViewOptions | undefined = APP_VIEWS,
) {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader], views: metricViews(options) });
  provider.getMeter("app-worker").createCounter(instrument).add(1, attributes);
  await reader.forceFlush();
  const metric = exporter
    .getMetrics()
    .flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics))
    .find((m) => m.descriptor.name === instrument);
  await provider.shutdown();
  return metric?.dataPoints[0]?.attributes;
}

// WHY: a metric label is a time series per value. An identifier or a message on an app
// instrument would explode cardinality and put personal data in Prometheus, which keeps it.
describe("metricViews", () => {
  it("exports only allowlisted labels from the app's prefixed instruments", async () => {
    const attributes = await exportedAttributes("app.worker.job.duration", {
      queue: "late-fees",
      outcome: "failed",
      tenantId: "tenant-123",
      "error.message": "duplicate email jane@example.com",
    });
    expect(attributes).toEqual({ queue: "late-fees", outcome: "failed" });
  });

  it("leaves instruments outside the prefix to their own instrumentation", async () => {
    const attributes = await exportedAttributes("http.server.request.duration", {
      "http.route": "/v1/tenants",
      "server.address": "api",
    });
    expect(attributes).toEqual({ "http.route": "/v1/tenants", "server.address": "api" });
  });
});
