import { vi } from "vitest";
import { logs } from "@opentelemetry/api-logs";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { shutdownTelemetry, startTelemetry } from "../sdk.js";
import type { TelemetryOptions } from "../options.js";

/** Records the real log pipeline handed to its (mocked) OTLP exporter. */
export const exported: ReadableLogRecord[] = [];

/** An OTLP log exporter that keeps records in `exported`; install with `vi.mock`. */
export function memoryLogExporterModule() {
  return {
    OTLPLogExporter: class {
      export(records: ReadableLogRecord[], done: (result: { code: number }) => void): void {
        exported.push(...records);
        done({ code: 0 });
      }
      shutdown(): Promise<void> {
        return Promise.resolve();
      }
      forceFlush(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
}

/** Boots the real SDK against an unreachable collector, with logs going to `exported`. */
export async function bootWithMemoryLogs(options: Omit<TelemetryOptions, "env">): Promise<void> {
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9");
  await startTelemetry({
    ...options,
    esmLoaderHook: false,
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", OTEL_LOG_LEVEL: "NONE" },
  });
}

/** Exports everything emitted so far: the sink emits on a microtask, the batch on flush. */
export async function flushLogs(): Promise<ReadableLogRecord[]> {
  await Promise.resolve();
  await (logs.getLoggerProvider() as { forceFlush?: () => Promise<void> }).forceFlush?.();
  return exported;
}

export async function stopTelemetry(): Promise<void> {
  await shutdownTelemetry(1_000);
  logs.disable();
  vi.unstubAllEnvs();
}
