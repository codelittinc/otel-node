import type { DiagLogger } from "@opentelemetry/api";
import { log as sharedLog } from "./shared-log.js";

export const log = sharedLog.child({ component: "telemetry" });

type Level = "trace" | "debug" | "info" | "warn" | "error";

/** Telemetry never breaks the app, so not even a failing logger may throw out of it. */
export function logSafely(level: Level, fields: Record<string, unknown>, message: string): void {
  try {
    log[level](fields, message);
  } catch {
    // nothing left to report to
  }
}

/** OTel's own diagnostics, through the redacting logger; only an Error argument is kept. */
function diagMethod(level: Level, event: string) {
  return (message: string, ...args: unknown[]): void => {
    const err = args.find((arg) => arg instanceof Error);
    logSafely(level, { event, ...(err !== undefined && { err }) }, message);
  };
}

export const diagLogger: DiagLogger = {
  error: diagMethod("error", "otel_diag"),
  warn: diagMethod("warn", "otel_diag"),
  info: diagMethod("info", "otel_diag"),
  debug: diagMethod("debug", "otel_diag"),
  verbose: diagMethod("trace", "otel_diag"),
};
