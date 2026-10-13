import { afterEach, describe, expect, it, vi } from "vitest";
import { logs } from "@opentelemetry/api-logs";
import { LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";

const state = vi.hoisted(() => ({
  provider: undefined as LoggerProvider | undefined,
  /** Bodies of the records exported; kept after shutdown, unlike the in-memory exporter's. */
  exported: [] as unknown[],
}));

// A NodeSDK whose logger provider exports to memory, and whose shutdown closes that provider at
// once, as the real one does.
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start() {
      const exporter = {
        export(records: { body?: unknown }[], done: (result: { code: number }) => void) {
          state.exported.push(...records.map((record) => record.body));
          done({ code: 0 });
        },
        shutdown: () => Promise.resolve(),
        forceFlush: () => Promise.resolve(),
      };
      state.provider = new LoggerProvider({
        processors: [new SimpleLogRecordProcessor({ exporter })],
      });
      logs.setGlobalLoggerProvider(state.provider);
    }
    shutdown(): Promise<void> {
      return state.provider!.shutdown();
    }
  },
}));

import { bootSdk } from "../sdk-boot.js";
import { forwardLogLine, setLogLineSink } from "../log-sink.js";

const config = {
  enabled: true,
  serviceName: "api",
  serviceVersion: "test",
  environment: "test",
  serviceInstanceId: "instance-1",
};

describe("bootSdk shutdown", () => {
  afterEach(() => {
    setLogLineSink(undefined);
    logs.disable();
  });

  // WHY: the sink emits a record on a microtask after the line is written. A process that logs
  // its last line and shuts down in the same tick must still export that line.
  it("exports a line logged in the same tick as the shutdown", async () => {
    const booted = await bootSdk(config, {
      logScope: "backbone",
      ignoredPaths: [],
      esmLoaderHook: false,
      exportLogs: true,
    });
    forwardLogLine(JSON.stringify({ level: "info", event: "worker_stopping", msg: "stopping" }));
    await booted.shutdown();
    expect(state.exported).toEqual(["stopping"]);
  });
});
