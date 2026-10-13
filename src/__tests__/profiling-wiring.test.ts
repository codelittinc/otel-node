import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const start = vi.fn();
const stop = vi.fn<() => Promise<void>>(async () => undefined);

vi.mock("@pyroscope/nodejs", () => ({ default: { init, start, stop } }));

describe("profiling wiring in startTelemetry and shutdownTelemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stop.mockImplementation(async () => undefined);
  });
  afterEach(async () => {
    const { shutdownTelemetry } = await import("../sdk.js");
    await shutdownTelemetry(100);
  });

  it("profiles with only a Pyroscope address, without enabling OTLP export", async () => {
    const { startTelemetry } = await import("../sdk.js");
    const config = await startTelemetry({
      serviceName: "api",
      env: { PYROSCOPE_SERVER_ADDRESS: "http://p:4040" },
    });
    expect(config.enabled).toBe(false);
    expect(init).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it("stops the profiler on shutdown", async () => {
    const { startTelemetry, shutdownTelemetry } = await import("../sdk.js");
    await startTelemetry({
      serviceName: "api",
      env: { PYROSCOPE_SERVER_ADDRESS: "http://p:4040" },
    });
    await shutdownTelemetry(1_000);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not let a profiler stop that never resolves stall shutdown", async () => {
    stop.mockImplementation(() => new Promise<void>(() => undefined));
    const { startTelemetry, shutdownTelemetry } = await import("../sdk.js");
    await startTelemetry({
      serviceName: "api",
      env: { PYROSCOPE_SERVER_ADDRESS: "http://p:4040" },
    });
    const began = Date.now();
    await expect(shutdownTelemetry(200)).resolves.toBeUndefined();
    expect(Date.now() - began).toBeLessThan(1_000);
  });
});
