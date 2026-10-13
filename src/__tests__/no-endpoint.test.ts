import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ modules: [] as string[] }));
const SDK_MODULES = vi.hoisted(() => [
  "@opentelemetry/sdk-node",
  "@opentelemetry/sdk-metrics",
  "@opentelemetry/sdk-trace-base",
  "@opentelemetry/exporter-trace-otlp-proto",
  "@opentelemetry/exporter-metrics-otlp-proto",
  "@opentelemetry/exporter-logs-otlp-proto",
  "@opentelemetry/instrumentation-http",
  "@opentelemetry/instrumentation-undici",
  "@opentelemetry/instrumentation-ioredis",
  "@opentelemetry/instrumentation-pg",
  "@opentelemetry/instrumentation-runtime-node",
  "bullmq-otel",
  "import-in-the-middle",
]);

for (const name of SDK_MODULES) {
  vi.doMock(name, () => {
    loaded.modules.push(name);
    return {};
  });
}

afterEach(async () => {
  const { shutdownTelemetry } = await import("../sdk.js");
  await shutdownTelemetry(100);
  vi.unstubAllEnvs();
});

// WHY: a process with no endpoint (local runs, CI, an app before its stack is switched on) must
// not pay for loading the SDK, its exporters and instrumentations, whatever options it passes.
describe("with no endpoint", () => {
  it("startTelemetry loads no SDK module, with every option set", async () => {
    const telemetry = await import("../index.js");
    const config = await telemetry.startTelemetry({
      serviceName: "acp-api",
      env: {},
      logScope: "acp",
      metricViews: { instrumentPrefix: "acp.", allowedAttributes: ["queue"] },
      redactKeys: ["unitLabel"],
      onError: () => undefined,
    });
    telemetry.captureConsole();
    expect(config.enabled).toBe(false);
    expect(telemetry.isTelemetryStarted()).toBe(false);
    expect(loaded.modules).toEqual([]);
  });

  it("the register entry loads no SDK module", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    vi.stubEnv("OTEL_SERVICE_NAME", "acp-worker");
    await import("../register.js");
    const { isTelemetryStarted } = await import("../sdk.js");
    expect(isTelemetryStarted()).toBe(false);
    expect(loaded.modules).toEqual([]);
  });
});
