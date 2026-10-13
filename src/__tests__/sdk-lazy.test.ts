import { describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ modules: [] as string[] }));

vi.mock("@opentelemetry/sdk-node", () => {
  loaded.modules.push("@opentelemetry/sdk-node");
  return { NodeSDK: class {} };
});
vi.mock("bullmq-otel", () => {
  loaded.modules.push("bullmq-otel");
  return { BullMQOtel: class {} };
});

// WHY: a process with no endpoint (local runs, CI, every environment until the stack is
// switched on) must not pay for loading the SDK, its exporters and instrumentations.
describe("@codelittinc/otel-node with no endpoint", () => {
  it("loads neither the SDK nor the BullMQ adapter", async () => {
    const telemetry = await import("../index.js");
    expect((await telemetry.startTelemetry({ serviceName: "api", env: {} })).enabled).toBe(false);
    expect(telemetry.bullmqTelemetry()).toBeUndefined();
    expect(loaded.modules).toEqual([]);
  });
});
