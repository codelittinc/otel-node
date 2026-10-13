import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { diag } from "@opentelemetry/api";
import { captureConsole, releaseConsole } from "../console-capture.js";
import { shutdownTelemetry, startTelemetry } from "../sdk.js";
import { exported, flushLogs, stopTelemetry } from "./otlp-export-helpers.js";

vi.mock("@opentelemetry/exporter-logs-otlp-proto", async () =>
  (await import("./otlp-export-helpers.js")).memoryLogExporterModule(),
);

// Installed before @opentelemetry/api loads, so the SDK's console diag logger writes here.
const printed = vi.hoisted(() => {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = keep;
  console.warn = keep;
  return lines;
});

beforeAll(async () => {
  // With OTEL_LOG_LEVEL set, NodeSDK installs its own console diag logger.
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9");
  vi.stubEnv("OTEL_LOG_LEVEL", "ERROR");
  await startTelemetry({
    serviceName: "acp-api",
    esmLoaderHook: false,
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", OTEL_LOG_LEVEL: "ERROR" },
  });
  captureConsole();
  await flushLogs();
  exported.length = 0;
});

afterAll(async () => {
  releaseConsole();
  await shutdownTelemetry(1_000);
  await stopTelemetry();
});

// WHY: an exporter failure reported through the console would otherwise be exported, fail, and
// report itself again, once per batch, forever.
describe("the SDK's console diag logger under captureConsole", () => {
  it("prints an SDK error but never exports it", async () => {
    diag.error("export failed: diag-sentinel");
    expect(printed.join("\n")).toContain("diag-sentinel");
    await flushLogs();
    expect(JSON.stringify(exported)).not.toContain("diag-sentinel");
  });
});
