import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  constructed: 0,
  config: undefined as Record<string, unknown> | undefined,
  shutdownThrows: false,
  register: vi.fn(),
  registerOptions: { data: { marker: "iitm" } },
  acknowledged: vi.fn((): Promise<void> => Promise.resolve()),
  order: [] as string[],
  interval: undefined as NodeJS.Timeout | undefined,
}));

vi.mock("node:module", () => ({ register: state.register }));
vi.mock("import-in-the-middle", () => ({
  createAddHookMessageChannel: () => ({
    registerOptions: state.registerOptions,
    // Like the real one: a referenced interval guards the wait until the ack lands.
    waitForAllMessagesAcknowledged: () => {
      state.interval = setInterval(() => undefined, 1_000);
      state.order.push("acknowledged");
      return state.acknowledged().then(() => clearInterval(state.interval));
    },
  }),
}));
vi.mock("@opentelemetry/sdk-node", () => {
  return {
    NodeSDK: class {
      constructor(config: Record<string, unknown>) {
        state.constructed += 1;
        state.config = config;
      }
      start() {
        state.order.push("start");
      }
      shutdown(): Promise<void> {
        if (state.shutdownThrows) throw new Error("sync shutdown failure");
        return Promise.resolve();
      }
    },
  };
});

import { diag } from "@opentelemetry/api";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { hasLogLineSink } from "../log-sink.js";
import { ScopedLogRecordProcessor } from "../log-otlp.js";
import { bullmqTelemetry } from "../bullmq.js";
import { shutdownTelemetry, startTelemetry } from "../sdk.js";
import { diagLogger, log as telemetryLog } from "../log-safely.js";

const enabled = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9" };

describe("telemetry lifecycle", () => {
  beforeEach(() => {
    state.constructed = 0;
    state.shutdownThrows = false;
    state.order.length = 0;
    state.register.mockClear();
  });
  afterEach(async () => {
    state.shutdownThrows = false;
    await shutdownTelemetry(100);
  });

  it("hooks only instrumented modules and waits for the loader to acknowledge", async () => {
    await startTelemetry({ serviceName: "api", env: enabled });
    expect(state.register).toHaveBeenCalledWith(
      "import-in-the-middle/hook.mjs",
      expect.any(String),
      state.registerOptions,
    );
    expect(state.order).toEqual(["start", "acknowledged"]);
  });

  it("names the replica on the resource, so Prometheus labels each series with its instance", async () => {
    await startTelemetry({
      serviceName: "api",
      env: { ...enabled, RAILWAY_REPLICA_ID: "replica-7", RAILWAY_GIT_COMMIT_SHA: "abc123" },
    });
    const resource = state.config?.resource as { attributes: Record<string, unknown> };
    expect(resource.attributes).toEqual({
      "service.name": "api",
      "service.version": "abc123",
      "service.instance.id": "replica-7",
      "deployment.environment.name": "unknown",
    });
  });

  // WHY: logs reach OTLP only through the scrubbing logger's own output, never through a
  // logger instrumentation that could see a record before it is scrubbed.
  it("exports logs through one scope-filtered batch processor fed by the scrubbing logger", async () => {
    await startTelemetry({ serviceName: "api", env: enabled });
    const processors = state.config?.logRecordProcessors as unknown[];
    expect(processors).toHaveLength(1);
    expect(processors[0]).toBeInstanceOf(ScopedLogRecordProcessor);
    expect((processors[0] as unknown as { inner: unknown }).inner).toBeInstanceOf(
      BatchLogRecordProcessor,
    );
    expect(hasLogLineSink()).toBe(true);
    const names = (state.config?.instrumentations as { instrumentationName: string }[]).map(
      (i) => i.instrumentationName,
    );
    expect(names.some((name) => /pino|winston|bunyan/.test(name))).toBe(false);
  });

  // WHY: Alloy refuses a whole OTLP request over its body limit, and the logger does not cap a
  // line, so the batch is bounded by record count (see sdk-boot.ts for the arithmetic).
  it("exports logs in batches of at most 64 records", async () => {
    await startTelemetry({ serviceName: "api", env: enabled });
    const [scoped] = state.config?.logRecordProcessors as { inner: unknown }[];
    // Reads the processor's private limit: a rename in the SDK fails here, not in production.
    expect((scoped?.inner as { _maxExportBatchSize: number })._maxExportBatchSize).toBe(64);
  });

  it("stops feeding the log exporter on shutdown", async () => {
    await startTelemetry({ serviceName: "api", env: enabled });
    await shutdownTelemetry(100);
    expect(hasLogLineSink()).toBe(false);
  });

  it("exports no logs when the host opts out", async () => {
    await startTelemetry({ serviceName: "web", env: enabled, esmLoaderHook: false, logs: false });
    expect(state.config?.logRecordProcessors).toEqual([]);
    expect(hasLogLineSink()).toBe(false);
  });

  it("creates no log pipeline while telemetry is off", async () => {
    await startTelemetry({ serviceName: "api", env: {} });
    await startTelemetry({
      serviceName: "api",
      env: { ...enabled, OTEL_SDK_DISABLED: "true" },
    });
    expect(state.constructed).toBe(0);
    expect(hasLogLineSink()).toBe(false);
  });

  it("filters backbone.* metric labels through the allowlist view", async () => {
    await startTelemetry({
      serviceName: "api",
      env: enabled,
      metricViews: { instrumentPrefix: "backbone.", allowedAttributes: ["queue", "outcome"] },
    });
    expect(state.config?.views).toEqual([
      expect.objectContaining({ instrumentName: "backbone.*" }),
    ]);
  });

  // WHY: a Next.js server runs bundled CommonJS, and the hook's specifier cannot be resolved
  // from a bundle chunk. A failed register would take the whole SDK down with it.
  it("starts without the ESM loader hook when the host has no ESM to hook", async () => {
    await startTelemetry({ serviceName: "web", env: enabled, esmLoaderHook: false });
    expect(state.register).not.toHaveBeenCalled();
    expect(state.constructed).toBe(1);
    expect(state.order).toEqual(["start"]);
  });

  it("returns the same config and builds one SDK on a second enabled call", async () => {
    const first = await startTelemetry({ serviceName: "api", env: enabled });
    const second = await startTelemetry({ serviceName: "api", env: enabled });
    expect(second).toBe(first);
    expect(state.constructed).toBe(1);
  });

  it("starts telemetry after an earlier disabled call", async () => {
    expect((await startTelemetry({ serviceName: "api", env: {} })).enabled).toBe(false);
    expect(state.constructed).toBe(0);
    expect((await startTelemetry({ serviceName: "api", env: enabled })).enabled).toBe(true);
    expect(state.constructed).toBe(1);
  });

  it("resolves the config when the loader hook fails", async () => {
    state.register.mockImplementationOnce(() => {
      throw new Error("hook failure");
    });
    const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
    await expect(startTelemetry({ serviceName: "api", env: enabled })).resolves.toMatchObject({
      enabled: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "telemetry_start_failed" }),
      "telemetry_start_failed",
    );
    warn.mockRestore();
  });

  it("hands every queue the one BullMQ adapter built at start", async () => {
    await startTelemetry({ serviceName: "api", env: enabled });
    const adapter = bullmqTelemetry();
    expect(adapter?.tracer).toBeDefined();
    expect(bullmqTelemetry()).toBe(adapter);
  });

  // WHY: a typo'd endpoint or a rejected export is otherwise silent; the started line names the
  // collector host so an operator can tell telemetry is on, without leaking credentials.
  it("logs one started line with the endpoint host only, and SDK warnings", async () => {
    const info = vi.spyOn(telemetryLog, "info").mockImplementation(() => undefined);
    const setLogger = vi.spyOn(diag, "setLogger");
    await startTelemetry({
      serviceName: "worker",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://user:pw@alloy.internal:4318/otlp?key=k" },
    });
    expect(info.mock.calls).toEqual([
      [
        { event: "telemetry_started", serviceName: "worker", endpointHost: "alloy.internal:4318" },
        "telemetry_started",
      ],
    ]);
    expect(setLogger).toHaveBeenCalledWith(diagLogger, expect.objectContaining({ logLevel: 50 }));
    info.mockRestore();
    setLogger.mockRestore();
  });

  // NodeSDK installs its own logger when OTEL_LOG_LEVEL is set; a second one makes it warn that
  // the logger is overwritten on every boot.
  it("leaves the diag logger to NodeSDK when OTEL_LOG_LEVEL is set", async () => {
    const setLogger = vi.spyOn(diag, "setLogger");
    vi.spyOn(telemetryLog, "info").mockImplementation(() => undefined);
    await startTelemetry({ serviceName: "api", env: { ...enabled, OTEL_LOG_LEVEL: "debug" } });
    expect(setLogger).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("still resolves when the logger itself throws while reporting a failed start", async () => {
    state.register.mockImplementationOnce(() => {
      throw new Error("hook failure");
    });
    const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => {
      throw new Error("logger broken");
    });
    await expect(startTelemetry({ serviceName: "api", env: enabled })).resolves.toMatchObject({
      enabled: true,
    });
    warn.mockRestore();
  });

  it("abandons a loader acknowledgement that never arrives and keeps telemetry running", async () => {
    vi.useFakeTimers();
    try {
      state.acknowledged.mockImplementationOnce(() => new Promise<void>(() => undefined));
      const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
      const pending = startTelemetry({ serviceName: "api", env: enabled });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toMatchObject({ enabled: true });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "telemetry_hook_ack_timeout" }),
        "telemetry_hook_ack_timeout",
      );
      expect(warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "telemetry_start_failed" }),
        expect.anything(),
      );
      // The abandoned wait's interval must not hold the process open.
      expect(state.interval?.hasRef()).toBe(false);
      clearInterval(state.interval);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never rejects when the SDK shutdown throws synchronously", async () => {
    await startTelemetry({ serviceName: "api", env: enabled });
    state.shutdownThrows = true;
    await expect(shutdownTelemetry(100)).resolves.toBeUndefined();
  });

  // WHY: options that cannot be read on a later call must not report export off while it runs.
  it("returns the running config for unreadable options on a later call", async () => {
    const first = await startTelemetry({ serviceName: "api", env: enabled });
    const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
    await expect(startTelemetry(null as never)).resolves.toBe(first);
    warn.mockRestore();
  });
});
