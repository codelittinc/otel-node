import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const start = vi.fn();
const stop = vi.fn(async () => undefined);
const loaded = vi.fn();

vi.mock("@pyroscope/nodejs", () => {
  loaded();
  return { default: { init, start, stop } };
});

const config = {
  enabled: true,
  serviceName: "api",
  serviceVersion: "abc123",
  serviceInstanceId: "replica-1",
  environment: "cody-dev-env",
};

describe("startProfiling", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await (await import("../profiling.js")).stopProfiling();
  });

  it("returns false and loads nothing without an address", async () => {
    const { startProfiling } = await import("../profiling.js");
    expect(await startProfiling(config, {})).toBe(false);
    expect(loaded).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });

  it("stays off under the kill switch even with an address", async () => {
    const { startProfiling } = await import("../profiling.js");
    const env = { PYROSCOPE_SERVER_ADDRESS: "http://p:4040", OTEL_SDK_DISABLED: "true" };
    expect(await startProfiling(config, env)).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("tags only env and version, so no request identifier reaches a profile", async () => {
    const { startProfiling, stopProfiling } = await import("../profiling.js");
    expect(await startProfiling(config, { PYROSCOPE_SERVER_ADDRESS: "http://p:4040" })).toBe(true);
    expect(init).toHaveBeenCalledWith({
      serverAddress: "http://p:4040",
      appName: "api",
      tags: { env: "cody-dev-env", version: "abc123" },
      // Literals, checked against @pyroscope/nodejs 0.6.4 dist/esm/profilers/pyroscope-profiler.js
      // (the defaults are not exported): DEFAULT_FLUSH_DURATION_MS = 60000 (l.10),
      // DEFAULT_SAMPLING_DURATION_MS = 1e3 * 60 (l.12), DEFAULT_SAMPLING_INTERVAL_MICROS =
      // 1e6 / 100 Hz = 10000 (l.14), DEFAULT_SAMPLING_INTERVAL_BYTES = 1024 * 512 = 524288 (l.16),
      // DEFAULT_STACK_DEPTH = 64 (l.17).
      flushIntervalMs: 60_000,
      wall: { samplingDurationMs: 60_000, samplingIntervalMicros: 10_000 },
      heap: { samplingIntervalBytes: 524_288, stackDepth: 64 },
    });
    expect(start).toHaveBeenCalledOnce();
    await stopProfiling();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not init twice on a second call", async () => {
    const { startProfiling } = await import("../profiling.js");
    const env = { PYROSCOPE_SERVER_ADDRESS: "http://p:4040" };
    await startProfiling(config, env);
    expect(await startProfiling(config, env)).toBe(true);
    expect(init).toHaveBeenCalledOnce();
  });

  it("logs profiling_start_failed when the profiler fails to start", async () => {
    const { log } = await import("../log-safely.js");
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    start.mockImplementationOnce(() => {
      throw new Error("native binary missing");
    });
    const { startProfiling } = await import("../profiling.js");
    await startProfiling(config, { PYROSCOPE_SERVER_ADDRESS: "http://p:4040" });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "profiling_start_failed" }),
      "profiling_start_failed",
    );
    warn.mockRestore();
  });

  it("returns false instead of throwing when the profiler fails to start", async () => {
    start.mockImplementationOnce(() => {
      throw new Error("native binary missing");
    });
    const { startProfiling } = await import("../profiling.js");
    await expect(
      startProfiling(config, { PYROSCOPE_SERVER_ADDRESS: "http://p:4040" }),
    ).resolves.toBe(false);
  });
});
